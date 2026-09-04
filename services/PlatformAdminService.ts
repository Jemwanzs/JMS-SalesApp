import type { SupabaseClient } from "@supabase/supabase-js";

import { TenantService } from "@/services/TenantService";
import type { AddonKey, Database, SubscriptionStatus, TenantCreditStatus, TenantStatus } from "@/types/database.types";
import { assertNotPlatformOwnerTenant } from "@/lib/tenant/assert-not-platform-owner";

/**
 * PlatformAdminService — tenant management, impersonation, platform
 * analytics. SERVICE-ROLE ONLY: platform_admins/platform_audit_logs/
 * impersonation_sessions are not reachable via normal RLS at all (see
 * docs/15-super-admin.md). Every method here writes a platform_audit_logs
 * row as part of the same operation — never as an optional afterthought,
 * and impersonation logging specifically is never configurable off.
 *
 * HARD RULE: this service never reads auth.* tables directly. Password-
 * reset/disable actions go exclusively through supabase.auth.admin.* SDK
 * calls under the service-role key. See
 * docs/05-authentication-security.md's password-visibility boundary.
 *
 * Phase 7a: tenant list/detail + suspend/reactivate/extend-trial/adjust-
 * grace, all through this service, all audited (docs/15's "Tenant
 * management" section). Phase 7b: "Access Workspace" impersonation
 * (startImpersonation/endImpersonation/getActiveImpersonation) — no
 * session-token swap to the target's real identity; migration 0024's
 * SQL functions grant the target's exact permission set to the platform
 * admin's OWN session instead, see that migration's header comment for
 * the full design. Phase 7c: getUsageAnalytics() — platform-wide DAU/
 * MAU/conversion/churn plus a per-tenant sales/products/imports/reports/
 * storage breakdown (docs/15's "Platform usage analytics" section).
 * "Send reminder" (needs Resend, not wired yet — see every earlier
 * Resend-dependent deferral this session) is still deliberately not
 * built here. A single TENANT's own billing detail (on the tenant detail
 * page, "view billing") still isn't a separate action — that page reads
 * BillingService directly for the same subscription/payment data the
 * billing owner's own screen shows; getUsageAnalytics is the platform-
 * wide "view usage" the doc separately calls for.
 *
 * Every list/aggregate query here follows the same "fetch raw rows,
 * join/group in application code" convention AnalyticsService already
 * established, rather than introducing new SQL aggregation functions —
 * consistent with the rest of the codebase, and platform-admin tenant
 * counts aren't yet at a scale where that matters.
 */
export interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  ownerEmail: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  userCount: number;
  planName: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  trialEnd: string | null;
  lastPaymentAt: string | null;
  nextBillingDate: string | null;
  lastActivityAt: string | null;
}

export interface TenantDetail extends TenantListItem {
  country: string | null;
  currency: string;
  timezone: string;
  businessType: string | null;
  website: string | null;
  createdAt: string;
  gracePeriodEnd: string | null;
  anniversaryDate: string | null;
  productsSoldCount: number;
  locationName: string | null;
  locationAddress: string | null;
  /** Null when the tenant has no location yet (onboarding Step 2 skipped) -- distinct from "location exists but every day is closedAllDay", which is a real, displayable answer. */
  businessHours: { dayOfWeek: number; openTime: string; closeTime: string; closedAllDay: boolean }[] | null;
  /** Every branch under this tenant (Multi-Branch User Access, docs/24-multi-branch-access.md) -- locationName/locationAddress above stay the single primary/oldest branch for the existing summary row; this is the full list for the Branches section. */
  branches: { id: string; name: string; address: string | null }[];
  /** True when billing_owner_profile_id resolves to a real platform_admins row -- the platform owner's own tenant, which suspendTenant/deactivateTenant refuse to touch and the billing sweep (migration 0044) never pushes. Drives TenantActionsPanel hiding those two buttons. */
  isPlatformOwner: boolean;
}

export interface TenantCreditView {
  id: string;
  amount: number;
  currency: string;
  reason: string;
  status: TenantCreditStatus;
  createdAt: string;
  appliedAt: string | null;
}

export interface AddonPlanRow {
  id: string;
  addonKey: AddonKey;
  code: string;
  name: string;
  price: number;
  currency: string;
  durationDays: number;
  discountPercent: number;
  isActive: boolean;
}

export interface TenantAddonView {
  id: string;
  addonKey: AddonKey;
  status: SubscriptionStatus;
  planName: string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  gracePeriodEnd: string | null;
}

export interface PlatformAuditLogEntry {
  id: string;
  action: string;
  adminName: string | null;
  adminEmail: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

export interface PlatformUsageSummary {
  dau: number;
  mau: number;
  totalTenants: number;
  totalSalesCount: number;
  /** tenants whose subscription has ever converted from TRIAL (plan_id set) / tenants with any subscription row. */
  trialConversionRate: number;
  /** SUSPENDED / (ACTIVE + PAYMENT_DUE + GRACE_PERIOD + SUSPENDED) -- tenants that were ever billable and are
   * currently not paying. `CANCELLED` is tracked separately since no feature in this app can actually reach it
   * yet (see PlatformAdminService.extendTrial's own header comment) -- a churn rate built on a status nothing
   * ever sets would always read zero, which is honest but not the number a real "churn" metric should mean here. */
  churnRate: number;
  cancelledCount: number;
}

export interface TenantUsageRow {
  tenantId: string;
  tenantName: string;
  currency: string;
  salesCount: number;
  salesVolume: number;
  productCount: number;
  importedRowCount: number;
  reportCount: number;
  storageBytes: number;
  lastLoginAt: string | null;
  subscriptionStatus: SubscriptionStatus | null;
}

export class PlatformAdminService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async isPlatformAdmin(profileId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("platform_admins")
      .select("id")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (error) {
      throw new Error(`PlatformAdminService.isPlatformAdmin: ${error.message}`);
    }

    return Boolean(data);
  }

  /**
   * platform_audit_logs.platform_admin_id references platform_admins.id,
   * not profiles.id -- every action-logging server action needs this
   * resolved once before calling suspend/reactivate/extendTrial/
   * adjustGracePeriod, which all take that id, not the caller's own
   * auth.uid(). This is the sole enforcement gate for every platform-
   * admin action (require-platform-admin.ts treats null the same
   * whether it means "not an admin" or "the query itself failed") --
   * failing closed on a real error is the right call security-wise, but
   * a genuine outage here silently reads as "Not authorized" with
   * nothing to debug from. Logging the error (not swallowing it
   * entirely) doesn't change that fail-closed behavior, just makes an
   * outage distinguishable from an access denial in the server logs.
   */
  async getPlatformAdminId(profileId: string): Promise<string | null> {
    const { data, error } = await this.supabase.from("platform_admins").select("id").eq("profile_id", profileId).maybeSingle();
    if (error) {
      console.error(`PlatformAdminService.getPlatformAdminId: ${error.message}`);
    }
    return data?.id ?? null;
  }

  /** Foundation-level KPIs (tenant/user counts) for the dashboard's top row — see getUsageAnalytics() for the full Phase 7c usage/analytics set. */
  async getDashboardKpis(): Promise<{
    totalTenants: number;
    activeTenants: number;
    suspendedTenants: number;
    totalUsers: number;
  }> {
    const [
      { count: totalTenants },
      { count: activeTenants },
      { count: suspendedTenants },
      { count: totalUsers },
    ] = await Promise.all([
      this.supabase.from("tenants").select("id", { count: "exact", head: true }),
      this.supabase
        .from("tenants")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      this.supabase
        .from("tenants")
        .select("id", { count: "exact", head: true })
        .eq("status", "suspended"),
      this.supabase.from("profiles").select("id", { count: "exact", head: true }),
    ]);

    return {
      totalTenants: totalTenants ?? 0,
      activeTenants: activeTenants ?? 0,
      suspendedTenants: suspendedTenants ?? 0,
      totalUsers: totalUsers ?? 0,
    };
  }

  /**
   * Phase 7c (docs/15-super-admin.md's "Platform usage analytics"):
   * sales by tenant, DAU/MAU, storage consumption, product count, import
   * volumes, report usage, login frequency, subscription/trial
   * conversion, churn -- read-only aggregation, computed here from raw
   * per-table fetches (same "aggregate in app code" convention as
   * listTenants/getTenantDetail), never exposed through any tenant-
   * scoped RLS-reachable view.
   *
   * Sales VOLUME is deliberately never summed across tenants -- tenants
   * carry their own `currency` (docs/03), and adding KES to USD would be
   * a real correctness bug, not a display nicety. The platform-wide
   * summary only sums sales COUNT (currency-agnostic); volume is always
   * shown per tenant, next to that tenant's own currency.
   */
  async getUsageAnalytics(): Promise<{ summary: PlatformUsageSummary; tenantRows: TenantUsageRow[] }> {
    // sales excludes 'corrected' too, not just 'voided' -- see
    // AnalyticsService.getAnalytics's own comment on this exact filter.
    const [
      { data: tenants },
      { data: subscriptions },
      { data: sales },
      { data: products },
      { data: imports },
      { data: reportJobs },
      { data: loginEvents },
    ] = await Promise.all([
      this.supabase.from("tenants").select("id, name, currency, status"),
      this.supabase.from("subscriptions").select("tenant_id, status, plan_id"),
      this.supabase.from("sales").select("tenant_id, actual_amount").neq("status", "voided").neq("status", "corrected"),
      this.supabase.from("products").select("tenant_id").neq("status", "archived"),
      this.supabase.from("imports").select("tenant_id, imported_rows"),
      this.supabase.from("report_jobs").select("tenant_id").eq("status", "completed"),
      this.supabase.from("login_events").select("tenant_id, profile_id, created_at").eq("success", true),
    ]);

    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

    const dauProfiles = new Set<string>();
    const mauProfiles = new Set<string>();
    const lastLoginByTenant = new Map<string, string>();
    for (const e of loginEvents ?? []) {
      if (!e.profile_id) continue; // profile_id is nullable on this table; every real successful login has one
      const t = new Date(e.created_at).getTime();
      if (t >= monthAgo) mauProfiles.add(e.profile_id);
      if (t >= dayAgo) dauProfiles.add(e.profile_id);
      if (e.tenant_id && (!lastLoginByTenant.has(e.tenant_id) || e.created_at > lastLoginByTenant.get(e.tenant_id)!)) {
        lastLoginByTenant.set(e.tenant_id, e.created_at);
      }
    }

    const salesByTenant = new Map<string, { count: number; volume: number }>();
    for (const s of sales ?? []) {
      const agg = salesByTenant.get(s.tenant_id) ?? { count: 0, volume: 0 };
      agg.count += 1;
      agg.volume += Number(s.actual_amount);
      salesByTenant.set(s.tenant_id, agg);
    }

    const productCountByTenant = new Map<string, number>();
    for (const p of products ?? []) {
      productCountByTenant.set(p.tenant_id, (productCountByTenant.get(p.tenant_id) ?? 0) + 1);
    }

    const importedRowsByTenant = new Map<string, number>();
    for (const i of imports ?? []) {
      importedRowsByTenant.set(i.tenant_id, (importedRowsByTenant.get(i.tenant_id) ?? 0) + i.imported_rows);
    }

    const reportCountByTenant = new Map<string, number>();
    for (const r of reportJobs ?? []) {
      reportCountByTenant.set(r.tenant_id, (reportCountByTenant.get(r.tenant_id) ?? 0) + 1);
    }

    const subByTenant = new Map((subscriptions ?? []).map((s) => [s.tenant_id, s]));

    const everBillableStatuses = new Set(["ACTIVE", "PAYMENT_DUE", "GRACE_PERIOD", "SUSPENDED"]);
    const everBillable = (subscriptions ?? []).filter((s) => everBillableStatuses.has(s.status));
    const suspendedBillable = everBillable.filter((s) => s.status === "SUSPENDED");
    const cancelledCount = (subscriptions ?? []).filter((s) => s.status === "CANCELLED").length;
    const convertedCount = (subscriptions ?? []).filter((s) => s.plan_id !== null).length;

    const storageByTenant = await this.computeStorageBytesByTenant((tenants ?? []).map((t) => t.id));

    const tenantRows: TenantUsageRow[] = (tenants ?? []).map((t) => ({
      tenantId: t.id,
      tenantName: t.name,
      currency: t.currency,
      salesCount: salesByTenant.get(t.id)?.count ?? 0,
      salesVolume: salesByTenant.get(t.id)?.volume ?? 0,
      productCount: productCountByTenant.get(t.id) ?? 0,
      importedRowCount: importedRowsByTenant.get(t.id) ?? 0,
      reportCount: reportCountByTenant.get(t.id) ?? 0,
      storageBytes: storageByTenant.get(t.id) ?? 0,
      lastLoginAt: lastLoginByTenant.get(t.id) ?? null,
      subscriptionStatus: subByTenant.get(t.id)?.status ?? null,
    }));

    return {
      summary: {
        dau: dauProfiles.size,
        mau: mauProfiles.size,
        totalTenants: tenants?.length ?? 0,
        totalSalesCount: (sales ?? []).length,
        trialConversionRate: subscriptions && subscriptions.length > 0 ? convertedCount / subscriptions.length : 0,
        churnRate: everBillable.length > 0 ? suspendedBillable.length / everBillable.length : 0,
        cancelledCount,
      },
      tenantRows,
    };
  }

  /**
   * Both Storage buckets (product-images, imports -- migrations 0007/0020)
   * key their paths by tenant_id as the top-level folder, so a per-tenant
   * total is a bounded-depth recursive listing (Storage has no cheaper
   * "sum bytes under this prefix" API) rather than a SQL aggregate --
   * storage.objects isn't exposed over PostgREST the way public-schema
   * tables are, so supabase.storage.*.list() is the only reliable path
   * regardless of project-level API config.
   *
   * Hardening roadmap Phase 2.3 (docs/22-hardening-roadmap.md): was
   * fully sequential (one tenant at a time), a deliberate original
   * choice to stay gentle on Storage's API -- worth keeping the spirit
   * of, not just parallelizing outright, so this processes a bounded
   * number of tenants concurrently (CONCURRENCY) rather than either
   * extreme: still real backpressure on Storage, but no longer O(tenant
   * count) sequential round trips on an admin page that only gets
   * slower as the platform grows.
   */
  private async computeStorageBytesByTenant(tenantIds: string[]): Promise<Map<string, number>> {
    const CONCURRENCY = 5;
    const result = new Map<string, number>();

    for (let i = 0; i < tenantIds.length; i += CONCURRENCY) {
      const chunk = tenantIds.slice(i, i + CONCURRENCY);
      const totals = await Promise.all(
        chunk.map(async (tenantId) => {
          let total = 0;
          for (const bucket of ["product-images", "imports"] as const) {
            total += await this.sumBucketFolderBytes(bucket, tenantId, 0);
          }
          return [tenantId, total] as const;
        })
      );
      for (const [tenantId, total] of totals) {
        result.set(tenantId, total);
      }
    }

    return result;
  }

  private async sumBucketFolderBytes(bucket: string, path: string, depth: number): Promise<number> {
    if (depth > 4) return 0; // safety bound against an unexpectedly deep/cyclical listing
    const { data: entries } = await this.supabase.storage.from(bucket).list(path, { limit: 1000 });
    if (!entries) return 0;

    let total = 0;
    for (const entry of entries) {
      if (entry.id === null) {
        // A folder entry (Storage's own convention: no id/metadata means "folder, not file").
        total += await this.sumBucketFolderBytes(bucket, `${path}/${entry.name}`, depth + 1);
      } else {
        total += Number(entry.metadata?.size ?? 0);
      }
    }
    return total;
  }

  async listTenants(): Promise<TenantListItem[]> {
    // Hardening roadmap Phase 2.3 (docs/22-hardening-roadmap.md,
    // performance finding #3): both queries below fetch platform-wide,
    // ordered-desc, then take the FIRST match per tenant_id in the JS
    // loops that follow -- unbounded before this, so they grew with
    // total platform history forever, not per tenant. RECENT_ROWS_LIMIT
    // is a safety cap, not a perfect fix: a proper fix is a SQL-level
    // "last row per tenant_id" aggregate (a view or RPC), which this
    // isn't yet -- until then, this bounds the worst case (unbounded
    // growth) rather than pretending a row cap can't ever miss a
    // genuinely stale tenant's last payment/login. 10k is deliberately
    // generous for this project's actual current scale.
    const RECENT_ROWS_LIMIT = 10000;
    const [{ data: tenants }, { data: subscriptions }, { data: plans }, { data: memberships }, { data: payments }, { data: loginEvents }] =
      await Promise.all([
        this.supabase.from("tenants").select("id, name, slug, status, billing_owner_profile_id").order("created_at", { ascending: false }),
        this.supabase.from("subscriptions").select("tenant_id, plan_id, status, trial_end, next_billing_date"),
        this.supabase.from("billing_plans").select("id, name"),
        this.supabase.from("tenant_memberships").select("tenant_id").eq("status", "active"),
        this.supabase
          .from("payments")
          .select("tenant_id, paid_at, status")
          .eq("status", "success")
          .order("paid_at", { ascending: false })
          .limit(RECENT_ROWS_LIMIT),
        this.supabase.from("login_events").select("tenant_id, created_at").order("created_at", { ascending: false }).limit(RECENT_ROWS_LIMIT),
      ]);

    const ownerIds = [...new Set((tenants ?? []).map((t) => t.billing_owner_profile_id).filter((id): id is string => !!id))];
    const { data: owners } =
      ownerIds.length > 0 ? await this.supabase.from("profiles").select("id, full_name, email, phone").in("id", ownerIds) : { data: [] };
    const ownerById = new Map((owners ?? []).map((o) => [o.id, o]));

    const planById = new Map((plans ?? []).map((p) => [p.id, p.name]));
    const subByTenant = new Map((subscriptions ?? []).map((s) => [s.tenant_id, s]));

    const userCountByTenant = new Map<string, number>();
    for (const m of memberships ?? []) {
      userCountByTenant.set(m.tenant_id, (userCountByTenant.get(m.tenant_id) ?? 0) + 1);
    }

    const lastPaymentByTenant = new Map<string, string>();
    for (const p of payments ?? []) {
      if (!lastPaymentByTenant.has(p.tenant_id) && p.paid_at) {
        lastPaymentByTenant.set(p.tenant_id, p.paid_at);
      }
    }

    const lastActivityByTenant = new Map<string, string>();
    for (const e of loginEvents ?? []) {
      if (e.tenant_id && !lastActivityByTenant.has(e.tenant_id)) {
        lastActivityByTenant.set(e.tenant_id, e.created_at);
      }
    }

    return (tenants ?? []).map((t) => {
      const sub = subByTenant.get(t.id);
      const owner = t.billing_owner_profile_id ? ownerById.get(t.billing_owner_profile_id) : undefined;
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        ownerEmail: owner?.email ?? null,
        ownerName: owner?.full_name ?? null,
        ownerPhone: owner?.phone ?? null,
        userCount: userCountByTenant.get(t.id) ?? 0,
        planName: sub?.plan_id ? (planById.get(sub.plan_id) ?? null) : null,
        subscriptionStatus: sub?.status ?? null,
        trialEnd: sub?.trial_end ?? null,
        lastPaymentAt: lastPaymentByTenant.get(t.id) ?? null,
        nextBillingDate: sub?.next_billing_date ?? null,
        lastActivityAt: lastActivityByTenant.get(t.id) ?? null,
      };
    });
  }

  async getTenantDetail(tenantId: string): Promise<TenantDetail | null> {
    const { data: tenant } = await this.supabase
      .from("tenants")
      .select(
        "id, name, slug, status, country, currency, timezone, business_type, website, anniversary_date, created_at, billing_owner_profile_id"
      )
      .eq("id", tenantId)
      .maybeSingle();

    if (!tenant) return null;

    const [
      { data: sub },
      { data: owner },
      { count: userCount },
      { data: lastPayment },
      { data: lastLogin },
      { data: allLocations },
      { data: soldSales },
      { data: platformAdminRow },
    ] = await Promise.all([
      this.supabase
        .from("subscriptions")
        .select("plan_id, status, trial_end, next_billing_date, grace_period_end")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      tenant.billing_owner_profile_id
        ? this.supabase.from("profiles").select("full_name, email, phone").eq("id", tenant.billing_owner_profile_id).maybeSingle()
        : Promise.resolve({ data: null }),
      this.supabase.from("tenant_memberships").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "active"),
      this.supabase
        .from("payments")
        .select("paid_at")
        .eq("tenant_id", tenantId)
        .eq("status", "success")
        .order("paid_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.supabase
        .from("login_events")
        .select("created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.supabase.from("locations").select("id, name, address").eq("tenant_id", tenantId).order("created_at", { ascending: true }),
      // Distinct products actually SOLD, not catalog size -- different
      // from getUsageAnalytics()'s TenantUsageRow.productCount, which
      // counts every non-archived catalog product regardless of sales.
      // Excludes 'voided'/'corrected' only (not 'reversed'), same
      // convention AnalyticsService.getAnalytics documents: a reversed
      // sale's amount is still real, exactly offset by its pair.
      this.supabase
        .from("sales")
        .select("product_id")
        .eq("tenant_id", tenantId)
        .neq("status", "voided")
        .neq("status", "corrected"),
      tenant.billing_owner_profile_id
        ? this.supabase.from("platform_admins").select("id").eq("profile_id", tenant.billing_owner_profile_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const plan = sub?.plan_id
      ? await this.supabase.from("billing_plans").select("name").eq("id", sub.plan_id).maybeSingle()
      : { data: null };

    const primaryLocation = allLocations?.[0] ?? null;

    // Depends on primaryLocation.id, so it can't join the Promise.all
    // above -- same "sequential because it genuinely depends on an
    // earlier result" shape as `plan` just above. Reuses TenantService's
    // own read (added for the Workspace edit page) rather than
    // re-deriving the same default-filling logic a second time here.
    const businessHours = primaryLocation
      ? await new TenantService(this.supabase).getLocationHours(tenantId, primaryLocation.id)
      : null;

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      country: tenant.country,
      currency: tenant.currency,
      timezone: tenant.timezone,
      businessType: tenant.business_type,
      website: tenant.website,
      createdAt: tenant.created_at,
      anniversaryDate: tenant.anniversary_date,
      ownerEmail: owner?.email ?? null,
      ownerName: owner?.full_name ?? null,
      ownerPhone: owner?.phone ?? null,
      userCount: userCount ?? 0,
      planName: plan.data?.name ?? null,
      subscriptionStatus: sub?.status ?? null,
      trialEnd: sub?.trial_end ?? null,
      gracePeriodEnd: sub?.grace_period_end ?? null,
      lastPaymentAt: lastPayment?.paid_at ?? null,
      nextBillingDate: sub?.next_billing_date ?? null,
      lastActivityAt: lastLogin?.created_at ?? null,
      locationName: primaryLocation?.name ?? null,
      locationAddress: primaryLocation?.address ?? null,
      businessHours,
      branches: (allLocations ?? []).map((l) => ({ id: l.id, name: l.name, address: l.address })),
      productsSoldCount: new Set((soldSales ?? []).map((s) => s.product_id)).size,
      isPlatformOwner: !!platformAdminRow,
    };
  }

  /**
   * The platform owner's own tenant (billing_owner_profile_id resolving to
   * a real platform_admins row -- never a hardcoded email, same check as
   * BillingService.resolveAddonTrialDays) must always stay active: it's
   * always readily available and never billing-pushed. This is app-layer
   * defense for a clean UI error; migration 0044's trigger on tenants is
   * the DB-level backstop if this check is ever bypassed, and that same
   * migration excludes this tenant from run_billing_sweep()/
   * run_addon_billing_sweep() entirely so it's never automatically pushed
   * toward suspension in the first place.
   */
  private async assertNotPlatformOwnerTenant(tenantId: string, verb: "suspend" | "deactivate" | "delete"): Promise<void> {
    await assertNotPlatformOwnerTenant(this.supabase, tenantId, verb);
  }

  async suspendTenant(platformAdminId: string, tenantId: string, reason: string): Promise<void> {
    await this.assertNotPlatformOwnerTenant(tenantId, "suspend");

    const { data: before } = await this.supabase.from("tenants").select("status").eq("id", tenantId).single();

    const { error } = await this.supabase.from("tenants").update({ status: "suspended" }).eq("id", tenantId);
    if (error) {
      throw new Error(`PlatformAdminService.suspendTenant: ${error.message}`);
    }

    await this.logAction(platformAdminId, "TENANT_SUSPENDED", tenantId, null, before, { status: "suspended" }, reason);
  }

  /**
   * Permanent, irreversible -- unlike suspend/deactivate, there's no
   * reactivateTenant equivalent for this. Every tenant-scoped table
   * already has `tenant_id ... on delete cascade` (migration 0001
   * onward), so deleting the tenants row cleanly removes its sales,
   * products, subscriptions, memberships, stock data, everything --
   * this method does nothing beyond that single delete. Employee/owner
   * LOGIN accounts (profiles/auth.users) are deliberately NOT touched:
   * they're never tenant-owned in this schema, tenant_memberships just
   * cascades away (removing the link), and a membership-less signed-in
   * user already lands on a real, handled state (/no-tenant) -- see
   * app/(tenant)/t/[tenantSlug]/layout.tsx.
   *
   * The audit log entry is written BEFORE the delete, not after -- the
   * tenants row must still exist for target_tenant_id's FK to resolve
   * at insert time (migration 0047 makes that FK `on delete set null`
   * for exactly this reason: the row survives the tenant's own deletion
   * afterward, just with its tenant reference nulled out). old_values
   * captures a snapshot so the audit entry stays meaningful once the
   * tenant itself is gone.
   *
   * migration 0047's BEFORE DELETE trigger on tenants is the DB-level
   * backstop if assertNotPlatformOwnerTenant is ever bypassed -- same
   * pairing as suspendTenant/deactivateTenant and migration 0044's own
   * BEFORE UPDATE trigger.
   *
   * Member LOGIN accounts (profiles/auth.users) are deleted too, but
   * only when it's actually safe to: tenant_memberships has no
   * uniqueness on profile_id alone (unique is on the (tenant_id,
   * profile_id) PAIR), so the same login can genuinely belong to more
   * than one tenant -- deleting it here would wrongly revoke access to
   * a DIFFERENT, still-existing tenant. A profile is only deleted if,
   * after this tenant is gone, it (a) isn't a platform_admins row
   * (never touched, regardless of membership) and (b) has zero
   * remaining tenant_memberships anywhere. Even then, sales/
   * stock_movements/stock_reconciliations.recorded_by all reference
   * profiles with a plain (RESTRICT) FK -- a profile that once recorded
   * something in a DIFFERENT tenant it's since left can still have
   * orphaned history there, so auth.admin.deleteUser() is attempted
   * per-profile and a failure is swallowed: it just leaves that one
   * login intact rather than failing the tenant deletion that already
   * succeeded. profiles itself cascades from auth.users (migration
   * 0001), so deleting the auth user is the one call needed.
   */
  async deleteTenant(platformAdminId: string | null, tenantId: string, reason: string): Promise<void> {
    await this.assertNotPlatformOwnerTenant(tenantId, "delete");

    const { data: before } = await this.supabase
      .from("tenants")
      .select("name, slug, status, billing_owner_profile_id")
      .eq("id", tenantId)
      .single();

    const { data: members } = await this.supabase
      .from("tenant_memberships")
      .select("profile_id")
      .eq("tenant_id", tenantId);
    const memberProfileIds = [...new Set((members ?? []).map((m) => m.profile_id))];

    await this.logAction(platformAdminId, "TENANT_DELETED", tenantId, null, before, null, reason);

    const { error } = await this.supabase.from("tenants").delete().eq("id", tenantId);
    if (error) {
      throw new Error(`PlatformAdminService.deleteTenant: ${error.message}`);
    }

    if (memberProfileIds.length > 0) {
      await this.deleteOrphanedMemberLogins(platformAdminId, reason, memberProfileIds);
    }
  }

  /**
   * Second pass after a tenant is gone: delete login accounts that were
   * only members of the tenant just deleted. See deleteTenant's own
   * header comment for why this can't simply delete every former
   * member's login outright. Runs AFTER the tenant row itself is gone,
   * so any audit entry here can't reference the now-nonexistent tenant
   * (target_tenant_id is left null; old_values carries the tenant name
   * instead) -- one summary row per deletion, not per profile, to keep
   * platform_audit_logs from filling up with one row per employee on
   * every tenant deletion.
   */
  private async deleteOrphanedMemberLogins(
    platformAdminId: string | null,
    reason: string,
    memberProfileIds: string[]
  ): Promise<void> {
    const { data: admins } = await this.supabase
      .from("platform_admins")
      .select("profile_id")
      .in("profile_id", memberProfileIds);
    const adminProfileIds = new Set((admins ?? []).map((a) => a.profile_id));

    const { data: otherMemberships } = await this.supabase
      .from("tenant_memberships")
      .select("profile_id")
      .in("profile_id", memberProfileIds);
    const stillMemberElsewhere = new Set((otherMemberships ?? []).map((m) => m.profile_id));

    const { data: profiles } = await this.supabase.from("profiles").select("id, email").in("id", memberProfileIds);
    const emailByProfileId = new Map((profiles ?? []).map((p) => [p.id, p.email]));

    const deleted: string[] = [];
    const skipped: string[] = [];

    for (const profileId of memberProfileIds) {
      if (adminProfileIds.has(profileId) || stillMemberElsewhere.has(profileId)) {
        continue;
      }
      const { error } = await this.supabase.auth.admin.deleteUser(profileId);
      if (error) {
        skipped.push(emailByProfileId.get(profileId) ?? profileId);
      } else {
        deleted.push(emailByProfileId.get(profileId) ?? profileId);
      }
    }

    if (deleted.length > 0 || skipped.length > 0) {
      await this.logAction(
        platformAdminId,
        "TENANT_MEMBER_LOGINS_DELETED",
        null,
        null,
        null,
        { deleted, skipped },
        reason
      );
    }
  }

  /**
   * Also clears any pending self-service deletion request (migration
   * 0063) -- a platform admin manually rescuing a tenant that requested
   * its own deletion must not leave stale grace-period state behind
   * (the outbox purge only ever looks at deletion_requested_at, not
   * status alone, but a reactivated tenant with those columns still set
   * would confusingly still show "scheduled for deletion" on its own
   * /tenant-deactivated page if it were ever deactivated again).
   * Unconditional, same as the status update itself -- a no-op when
   * already null.
   */
  async reactivateTenant(platformAdminId: string, tenantId: string, reason: string): Promise<void> {
    const { data: before } = await this.supabase.from("tenants").select("status").eq("id", tenantId).single();

    const { error } = await this.supabase
      .from("tenants")
      .update({ status: "active", deletion_requested_at: null, deletion_requested_by: null })
      .eq("id", tenantId);
    if (error) {
      throw new Error(`PlatformAdminService.reactivateTenant: ${error.message}`);
    }

    await this.logAction(platformAdminId, "TENANT_REACTIVATED", tenantId, null, before, { status: "active" }, reason);
  }

  /**
   * A genuinely stronger lockout than suspendTenant -- migration 0031's
   * has_permission() redefinition is what actually enforces this (zero
   * permissions resolve true for a deactivated tenant's real members, no
   * is_read_only carve-out); this method just flips the status column
   * and audits it, same shape as suspendTenant. reactivateTenant already
   * handles bringing a deactivated tenant back to 'active' for free (it
   * sets status='active' unconditionally regardless of prior status).
   */
  async deactivateTenant(platformAdminId: string, tenantId: string, reason: string): Promise<void> {
    await this.assertNotPlatformOwnerTenant(tenantId, "deactivate");

    const { data: before } = await this.supabase.from("tenants").select("status").eq("id", tenantId).single();

    const { error } = await this.supabase.from("tenants").update({ status: "deactivated" }).eq("id", tenantId);
    if (error) {
      throw new Error(`PlatformAdminService.deactivateTenant: ${error.message}`);
    }

    await this.logAction(platformAdminId, "TENANT_DEACTIVATED", tenantId, null, before, { status: "deactivated" }, reason);
  }

  /**
   * A support action for a struggling/valued customer, not the normal
   * signup-time bootstrap (BillingService.bootstrapTrialSubscription) --
   * moves the subscription back to TRIAL regardless of its current
   * status (short of ACTIVE/CANCELLED, which extending a trial doesn't
   * meaningfully apply to), clears any grace period, and un-suspends the
   * tenant if it had been suspended, since the whole point is giving
   * them a clean runway.
   */
  async extendTrial(platformAdminId: string, tenantId: string, additionalDays: number, reason: string): Promise<void> {
    const { data: before } = await this.supabase.from("subscriptions").select("status, trial_end").eq("tenant_id", tenantId).maybeSingle();

    if (!before) {
      throw new Error("PlatformAdminService.extendTrial: no subscription found for this tenant");
    }
    if (before.status === "ACTIVE" || before.status === "CANCELLED") {
      throw new Error(`PlatformAdminService.extendTrial: cannot extend a trial for a subscription that is "${before.status}"`);
    }

    const trialEnd = new Date(Date.now() + additionalDays * 86_400_000).toISOString();

    // plan_id is cleared, not just status -- a PAYMENT_DUE/GRACE_PERIOD/
    // SUSPENDED subscription (the other statuses this can run from) has
    // a real plan_id from its last paid period, and leaving it in place
    // would show that plan's name next to a "Free trial" badge, which
    // reads as a real inconsistency, not just a stale display quirk.
    const { error } = await this.supabase
      .from("subscriptions")
      .update({ status: "TRIAL", plan_id: null, trial_end: trialEnd, grace_period_end: null })
      .eq("tenant_id", tenantId);
    if (error) {
      throw new Error(`PlatformAdminService.extendTrial: ${error.message}`);
    }

    await this.supabase.from("tenants").update({ status: "active" }).eq("id", tenantId);

    await this.logAction(
      platformAdminId,
      "TENANT_TRIAL_EXTENDED",
      tenantId,
      null,
      before,
      { status: "TRIAL", trial_end: trialEnd },
      reason
    );
  }

  /**
   * Extends the runway before automatic suspension (run_billing_sweep)
   * kicks in. If the tenant is already SUSPENDED, this also reactivates
   * it back to GRACE_PERIOD -- same "give them a clean window" intent
   * as extendTrial, just for the payment-overdue case instead of trial.
   */
  async adjustGracePeriod(platformAdminId: string, tenantId: string, additionalDays: number, reason: string): Promise<void> {
    const { data: before } = await this.supabase
      .from("subscriptions")
      .select("status, grace_period_end")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!before) {
      throw new Error("PlatformAdminService.adjustGracePeriod: no subscription found for this tenant");
    }

    const graceEnd = new Date(Date.now() + additionalDays * 86_400_000).toISOString();
    const nextStatus = before.status === "SUSPENDED" ? "GRACE_PERIOD" : before.status;

    const { error } = await this.supabase
      .from("subscriptions")
      .update({ status: nextStatus, grace_period_end: graceEnd })
      .eq("tenant_id", tenantId);
    if (error) {
      throw new Error(`PlatformAdminService.adjustGracePeriod: ${error.message}`);
    }

    if (before?.status === "SUSPENDED") {
      await this.supabase.from("tenants").update({ status: "active" }).eq("id", tenantId);
    }

    await this.logAction(
      platformAdminId,
      "TENANT_GRACE_PERIOD_ADJUSTED",
      tenantId,
      null,
      before,
      { status: nextStatus, grace_period_end: graceEnd },
      reason
    );
  }

  /**
   * A one-time, fixed-amount credit toward the tenant's NEXT checkout --
   * this app has no auto-recurring Paystack subscription object (every
   * billing cycle is a manually-initiated checkout for a fixed-duration
   * pass), so "next billing cycle" means "the next checkout the billing
   * owner completes," whenever that happens to be, for whichever plan
   * they pick. See BillingService.initializeCheckout for how this
   * actually gets applied (subtracted from the charge, or — since a
   * credit routinely exceeds the cheapest plan's price — skips Paystack
   * entirely and activates the subscription directly).
   */
  async grantSubscriptionCredit(
    platformAdminId: string,
    tenantId: string,
    amount: number,
    currency: string,
    reason: string
  ): Promise<void> {
    const { error } = await this.supabase.from("tenant_credits").insert({
      tenant_id: tenantId,
      granted_by: platformAdminId,
      amount,
      currency,
      reason,
      status: "available",
    });

    if (error) {
      throw new Error(`PlatformAdminService.grantSubscriptionCredit: ${error.message}`);
    }

    await this.logAction(platformAdminId, "TENANT_CREDIT_GRANTED", tenantId, null, null, { amount, currency }, reason);
  }

  /** Tenant 360's "Credits" section -- available + already-applied history. */
  async listTenantCredits(tenantId: string): Promise<TenantCreditView[]> {
    const { data, error } = await this.supabase
      .from("tenant_credits")
      .select("id, amount, currency, reason, status, created_at, applied_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`PlatformAdminService.listTenantCredits: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      currency: row.currency,
      reason: row.reason,
      status: row.status,
      createdAt: row.created_at,
      appliedAt: row.applied_at,
    }));
  }

  /** Admin catalog view -- unlike BillingService.listAddonPlans (public-facing, is_active only), this shows every plan so a Super Admin can also re-enable one. */
  async listAddonPlans(addonKey: AddonKey): Promise<AddonPlanRow[]> {
    const { data, error } = await this.supabase
      .from("addon_plans")
      .select("id, addon_key, code, name, price, currency, duration_days, discount_percent, is_active")
      .eq("addon_key", addonKey)
      .order("duration_days", { ascending: true });

    if (error) {
      throw new Error(`PlatformAdminService.listAddonPlans: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      addonKey: row.addon_key,
      code: row.code,
      name: row.name,
      price: Number(row.price),
      currency: row.currency,
      durationDays: row.duration_days,
      discountPercent: Number(row.discount_percent),
      isActive: row.is_active,
    }));
  }

  async updateAddonPlan(
    platformAdminId: string,
    planId: string,
    changes: { price?: number; currency?: string; durationDays?: number; discountPercent?: number; isActive?: boolean },
    reason: string
  ): Promise<void> {
    const { data: before } = await this.supabase
      .from("addon_plans")
      .select("price, currency, duration_days, discount_percent, is_active")
      .eq("id", planId)
      .maybeSingle();

    const updates: Database["public"]["Tables"]["addon_plans"]["Update"] = {};
    if (changes.price !== undefined) updates.price = changes.price;
    if (changes.currency !== undefined) updates.currency = changes.currency;
    if (changes.durationDays !== undefined) updates.duration_days = changes.durationDays;
    if (changes.discountPercent !== undefined) updates.discount_percent = changes.discountPercent;
    if (changes.isActive !== undefined) updates.is_active = changes.isActive;

    const { error } = await this.supabase.from("addon_plans").update(updates).eq("id", planId);
    if (error) {
      throw new Error(`PlatformAdminService.updateAddonPlan: ${error.message}`);
    }

    await this.logAction(platformAdminId, "ADDON_PLAN_UPDATED", null, null, before, updates, reason);
  }

  /** Read counterpart to setAddonTrialDays, for the admin/addons page. */
  async getAddonTrialDays(addonKey: AddonKey): Promise<number> {
    const { data } = await this.supabase
      .from("platform_settings")
      .select("value")
      .eq("key", `${addonKey}_addon_trial_days`)
      .maybeSingle();
    return typeof data?.value === "number" ? data.value : 0;
  }

  /**
   * The first setter for any `platform_settings` key -- until now only
   * BillingService.getGlobalSetting (private, read-only) touched that
   * table; trial_days/grace_period_days are still hand-edited via
   * migration. This is where the "Super Admin can configure Inventory
   * trial availability" spec line actually lands.
   */
  async setAddonTrialDays(platformAdminId: string, addonKey: AddonKey, days: number, reason: string): Promise<void> {
    const key = `${addonKey}_addon_trial_days`;
    const { data: before } = await this.supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();

    const { error } = await this.supabase
      .from("platform_settings")
      .update({ value: days, updated_by: null, updated_at: new Date().toISOString() })
      .eq("key", key);

    if (error) {
      throw new Error(`PlatformAdminService.setAddonTrialDays: ${error.message}`);
    }

    await this.logAction(platformAdminId, "ADDON_TRIAL_DAYS_SET", null, null, before, { [key]: days }, reason);
  }

  /** Support override -- force-activates a tenant's add-on regardless of billing state (e.g. comping a customer). */
  async activateAddonForTenant(platformAdminId: string, tenantId: string, addonKey: AddonKey, reason: string): Promise<void> {
    const { data: before } = await this.supabase
      .from("tenant_addon_subscriptions")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("addon_key", addonKey)
      .maybeSingle();

    const { error } = await this.supabase
      .from("tenant_addon_subscriptions")
      .upsert({ tenant_id: tenantId, addon_key: addonKey, status: "ACTIVE" }, { onConflict: "tenant_id,addon_key" });

    if (error) {
      throw new Error(`PlatformAdminService.activateAddonForTenant: ${error.message}`);
    }

    await this.logAction(platformAdminId, "TENANT_ADDON_ACTIVATED", tenantId, null, before, { status: "ACTIVE" }, reason);
  }

  async deactivateAddonForTenant(platformAdminId: string, tenantId: string, addonKey: AddonKey, reason: string): Promise<void> {
    const { data: before } = await this.supabase
      .from("tenant_addon_subscriptions")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("addon_key", addonKey)
      .maybeSingle();

    const { error } = await this.supabase
      .from("tenant_addon_subscriptions")
      .update({ status: "SUSPENDED" })
      .eq("tenant_id", tenantId)
      .eq("addon_key", addonKey);

    if (error) {
      throw new Error(`PlatformAdminService.deactivateAddonForTenant: ${error.message}`);
    }

    await this.logAction(platformAdminId, "TENANT_ADDON_DEACTIVATED", tenantId, null, before, { status: "SUSPENDED" }, reason);
  }

  /** Thin wrapper mirroring grantSubscriptionCredit's exact body, scoped to one add-on via the addon_key column (0034). */
  async grantAddonCredit(
    platformAdminId: string,
    tenantId: string,
    addonKey: AddonKey,
    amount: number,
    currency: string,
    reason: string
  ): Promise<void> {
    const { error } = await this.supabase.from("tenant_credits").insert({
      tenant_id: tenantId,
      granted_by: platformAdminId,
      amount,
      currency,
      reason,
      status: "available",
      addon_key: addonKey,
    });

    if (error) {
      throw new Error(`PlatformAdminService.grantAddonCredit: ${error.message}`);
    }

    await this.logAction(platformAdminId, "TENANT_ADDON_CREDIT_GRANTED", tenantId, null, null, { amount, currency, addonKey }, reason);
  }

  /** Tenant 360's add-on panel -- read helper mirroring BillingService.getAddonSubscription, kept separate since this service always uses the service-role client, unlike the tenant-facing settings page. */
  async getTenantAddon(tenantId: string, addonKey: AddonKey): Promise<TenantAddonView | null> {
    const { data: sub } = await this.supabase
      .from("tenant_addon_subscriptions")
      .select("id, addon_key, plan_id, status, trial_end, current_period_end, grace_period_end")
      .eq("tenant_id", tenantId)
      .eq("addon_key", addonKey)
      .maybeSingle();

    if (!sub) return null;

    const plan = sub.plan_id
      ? await this.supabase.from("addon_plans").select("name").eq("id", sub.plan_id).maybeSingle()
      : { data: null };

    return {
      id: sub.id,
      addonKey: sub.addon_key,
      status: sub.status,
      planName: plan.data?.name ?? null,
      trialEnd: sub.trial_end,
      currentPeriodEnd: sub.current_period_end,
      gracePeriodEnd: sub.grace_period_end,
    };
  }

  /**
   * Tenant 360's "Activity Log" section -- every Super Admin action
   * taken against this specific tenant, newest first. Joins
   * platform_admins -> profiles in application code, this file's own
   * established convention (see the class header comment), not a new
   * embedded-select.
   */
  async listTenantAuditLog(tenantId: string): Promise<PlatformAuditLogEntry[]> {
    const { data: logs, error } = await this.supabase
      .from("platform_audit_logs")
      .select("id, platform_admin_id, action, old_values, new_values, reason, created_at")
      .eq("target_tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`PlatformAdminService.listTenantAuditLog: ${error.message}`);
    }

    // System-actioned entries (e.g. the automatic 30-day deletion-grace
    // purge, migration 0062) have platform_admin_id = null -- filtered
    // out before .in(), same "drop nulls before .in()" pattern already
    // used for ownerIds elsewhere in this class.
    const adminIds = [...new Set((logs ?? []).map((l) => l.platform_admin_id))].filter((id): id is string => id !== null);
    const { data: admins } =
      adminIds.length > 0 ? await this.supabase.from("platform_admins").select("id, profile_id").in("id", adminIds) : { data: [] };
    const profileIdByAdminId = new Map((admins ?? []).map((a) => [a.id, a.profile_id]));

    const profileIds = [...new Set([...profileIdByAdminId.values()])];
    const { data: profiles } =
      profileIds.length > 0 ? await this.supabase.from("profiles").select("id, full_name, email").in("id", profileIds) : { data: [] };
    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

    return (logs ?? []).map((l) => {
      const profileId = l.platform_admin_id ? profileIdByAdminId.get(l.platform_admin_id) : undefined;
      const profile = profileId ? profileById.get(profileId) : undefined;
      return {
        id: l.id,
        action: l.action,
        adminName: profile?.full_name ?? null,
        adminEmail: profile?.email ?? null,
        oldValues: l.old_values,
        newValues: l.new_values,
        reason: l.reason,
        createdAt: l.created_at,
      };
    });
  }

  /**
   * Public (not private) -- every mutating method in this class already
   * calls it internally, and the anniversary-wish server actions
   * (features/platform-admin/actions/send-anniversary-wish.ts, send-
   * adhoc-wish.ts) now call it directly too, right after
   * AnniversaryService.sendWish/skipWish/sendAdHocWish succeed -- closing
   * a real gap where those actions never wrote to platform_audit_logs at
   * all before this. AnniversaryService itself stays free of any
   * PlatformAdminService dependency; the action layer orchestrates both,
   * same "actions call multiple services" convention this app already
   * uses elsewhere (e.g. features/products/actions/create-product.ts
   * calling ProductService then AuditService separately). Still the sole
   * write path to platform_audit_logs.
   */
  async logAction(
    platformAdminId: string | null,
    action: string,
    targetTenantId: string | null,
    targetProfileId: string | null,
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown> | null,
    reason: string | null
  ): Promise<void> {
    const { error } = await this.supabase.from("platform_audit_logs").insert({
      platform_admin_id: platformAdminId,
      action,
      target_tenant_id: targetTenantId,
      target_profile_id: targetProfileId,
      old_values: oldValues,
      new_values: newValues,
      reason,
    });

    if (error) {
      throw new Error(`PlatformAdminService.logAction: ${error.message}`);
    }
  }

  /**
   * "Access Workspace" (docs/15-super-admin.md): reason -> platform MFA
   * -> time-limited session -> immutable audit. Platform MFA itself is
   * verified by the CALLER (features/platform-admin/actions/start-
   * impersonation.ts checks AAL2 via supabase.auth.mfa before this ever
   * runs) -- this method's job is recording that it happened
   * (mfa_verified_at) and creating the bounded session that migration
   * 0024's SQL functions key off of. durationMinutes is clamped
   * server-side (never trusts a client-supplied value outright) to a
   * 5-minute-to-2-hour window -- "bounded session duration" per spec,
   * not an open-ended one a client could request.
   */
  async startImpersonation(input: {
    platformAdminId: string;
    targetTenantId: string;
    targetProfileId: string;
    reason: string;
    durationMinutes: number;
  }): Promise<{ sessionId: string; expiresAt: string }> {
    const { data: membership } = await this.supabase
      .from("tenant_memberships")
      .select("status")
      .eq("tenant_id", input.targetTenantId)
      .eq("profile_id", input.targetProfileId)
      .maybeSingle();

    if (!membership || membership.status !== "active") {
      throw new Error("PlatformAdminService.startImpersonation: target user is not an active member of this tenant");
    }

    const clampedMinutes = Math.min(Math.max(Math.round(input.durationMinutes), 5), 120);
    const expiresAt = new Date(Date.now() + clampedMinutes * 60_000).toISOString();

    const { data, error } = await this.supabase
      .from("impersonation_sessions")
      .insert({
        platform_admin_id: input.platformAdminId,
        target_tenant_id: input.targetTenantId,
        target_profile_id: input.targetProfileId,
        reason: input.reason,
        mfa_verified_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(`PlatformAdminService.startImpersonation: ${error?.message}`);
    }

    await this.logAction(
      input.platformAdminId,
      "IMPERSONATION_STARTED",
      input.targetTenantId,
      input.targetProfileId,
      null,
      { session_id: data.id, expires_at: expiresAt },
      input.reason
    );

    return { sessionId: data.id, expiresAt };
  }

  /** Safe to call twice (a manual "End session" after expiry already
   * happened server-side) -- a session already ended is a no-op, not an
   * error, since the caller's intent ("make sure this isn't active") is
   * already satisfied either way. */
  async endImpersonation(platformAdminId: string, sessionId: string): Promise<void> {
    const { data: session } = await this.supabase
      .from("impersonation_sessions")
      .select("target_tenant_id, target_profile_id, ended_at")
      .eq("id", sessionId)
      .eq("platform_admin_id", platformAdminId)
      .maybeSingle();

    if (!session) {
      throw new Error("PlatformAdminService.endImpersonation: session not found");
    }
    if (session.ended_at) {
      return;
    }

    const { error } = await this.supabase
      .from("impersonation_sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", sessionId);

    if (error) {
      throw new Error(`PlatformAdminService.endImpersonation: ${error.message}`);
    }

    await this.logAction(
      platformAdminId,
      "IMPERSONATION_ENDED",
      session.target_tenant_id,
      session.target_profile_id,
      null,
      null,
      null
    );
  }

  /**
   * Called from app/(tenant)/t/[tenantSlug]/layout.tsx's membership
   * fallback (a platform admin has no real tenant_memberships row) to
   * resolve whether the CURRENT profile is running an active session
   * against this specific tenant, and what the SUPPORT MODE banner
   * should say. Mirrors exactly what migration 0024's
   * impersonated_profile_id() SQL function resolves -- this is the
   * TypeScript-side read of the same fact, not a second source of truth
   * (the SQL function is what actually gates every RLS-backed query;
   * this is purely for the layout/banner to know what to render).
   */
  async getActiveImpersonation(
    profileId: string,
    tenantId: string
  ): Promise<{
    sessionId: string;
    targetProfileId: string;
    targetProfileName: string | null;
    reason: string;
    expiresAt: string;
  } | null> {
    const admin = await this.getPlatformAdminId(profileId);
    if (!admin) return null;

    const { data: session } = await this.supabase
      .from("impersonation_sessions")
      .select("id, target_profile_id, reason, expires_at")
      .eq("platform_admin_id", admin)
      .eq("target_tenant_id", tenantId)
      .is("ended_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) return null;

    const { data: target } = await this.supabase
      .from("profiles")
      .select("full_name")
      .eq("id", session.target_profile_id)
      .maybeSingle();

    return {
      sessionId: session.id,
      targetProfileId: session.target_profile_id,
      targetProfileName: target?.full_name ?? null,
      reason: session.reason,
      expiresAt: session.expires_at,
    };
  }
}

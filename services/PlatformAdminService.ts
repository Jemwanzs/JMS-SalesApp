import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, SubscriptionStatus, TenantStatus } from "@/types/database.types";

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
 * the full design. "Send reminder" (needs Resend, not wired yet — see
 * every earlier Resend-dependent deferral this session) is still
 * deliberately not built here. "View billing"/"view usage" aren't
 * separate actions — the tenant detail page reads BillingService
 * directly for the same subscription/payment data the billing owner's
 * own screen shows.
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
  createdAt: string;
  gracePeriodEnd: string | null;
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
   * auth.uid().
   */
  async getPlatformAdminId(profileId: string): Promise<string | null> {
    const { data } = await this.supabase.from("platform_admins").select("id").eq("profile_id", profileId).maybeSingle();
    return data?.id ?? null;
  }

  /**
   * Foundation-level KPIs only (tenant/user counts) — the full Phase 7
   * dashboard (revenue, renewals, failed payments, usage analytics) needs
   * the billing tables Phase 6 introduces. Real counts now rather than
   * placeholders, since tenants/tenant_memberships already exist for real.
   */
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

  async listTenants(): Promise<TenantListItem[]> {
    const [{ data: tenants }, { data: subscriptions }, { data: plans }, { data: memberships }, { data: payments }, { data: loginEvents }] =
      await Promise.all([
        this.supabase.from("tenants").select("id, name, slug, status, billing_owner_profile_id").order("created_at", { ascending: false }),
        this.supabase.from("subscriptions").select("tenant_id, plan_id, status, trial_end, next_billing_date"),
        this.supabase.from("billing_plans").select("id, name"),
        this.supabase.from("tenant_memberships").select("tenant_id").eq("status", "active"),
        this.supabase.from("payments").select("tenant_id, paid_at, status").eq("status", "success").order("paid_at", { ascending: false }),
        this.supabase.from("login_events").select("tenant_id, created_at").order("created_at", { ascending: false }),
      ]);

    const ownerIds = [...new Set((tenants ?? []).map((t) => t.billing_owner_profile_id).filter((id): id is string => !!id))];
    const { data: owners } =
      ownerIds.length > 0 ? await this.supabase.from("profiles").select("id, full_name, email").in("id", ownerIds) : { data: [] };
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
      .select("id, name, slug, status, country, currency, created_at, billing_owner_profile_id")
      .eq("id", tenantId)
      .maybeSingle();

    if (!tenant) return null;

    const [{ data: sub }, { data: owner }, { count: userCount }, { data: lastPayment }, { data: lastLogin }] = await Promise.all([
      this.supabase
        .from("subscriptions")
        .select("plan_id, status, trial_end, next_billing_date, grace_period_end")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      tenant.billing_owner_profile_id
        ? this.supabase.from("profiles").select("full_name, email").eq("id", tenant.billing_owner_profile_id).maybeSingle()
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
    ]);

    const plan = sub?.plan_id
      ? await this.supabase.from("billing_plans").select("name").eq("id", sub.plan_id).maybeSingle()
      : { data: null };

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      country: tenant.country,
      currency: tenant.currency,
      createdAt: tenant.created_at,
      ownerEmail: owner?.email ?? null,
      ownerName: owner?.full_name ?? null,
      userCount: userCount ?? 0,
      planName: plan.data?.name ?? null,
      subscriptionStatus: sub?.status ?? null,
      trialEnd: sub?.trial_end ?? null,
      gracePeriodEnd: sub?.grace_period_end ?? null,
      lastPaymentAt: lastPayment?.paid_at ?? null,
      nextBillingDate: sub?.next_billing_date ?? null,
      lastActivityAt: lastLogin?.created_at ?? null,
    };
  }

  async suspendTenant(platformAdminId: string, tenantId: string, reason: string): Promise<void> {
    const { data: before } = await this.supabase.from("tenants").select("status").eq("id", tenantId).single();

    const { error } = await this.supabase.from("tenants").update({ status: "suspended" }).eq("id", tenantId);
    if (error) {
      throw new Error(`PlatformAdminService.suspendTenant: ${error.message}`);
    }

    await this.logAction(platformAdminId, "TENANT_SUSPENDED", tenantId, null, before, { status: "suspended" }, reason);
  }

  async reactivateTenant(platformAdminId: string, tenantId: string, reason: string): Promise<void> {
    const { data: before } = await this.supabase.from("tenants").select("status").eq("id", tenantId).single();

    const { error } = await this.supabase.from("tenants").update({ status: "active" }).eq("id", tenantId);
    if (error) {
      throw new Error(`PlatformAdminService.reactivateTenant: ${error.message}`);
    }

    await this.logAction(platformAdminId, "TENANT_REACTIVATED", tenantId, null, before, { status: "active" }, reason);
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

  private async logAction(
    platformAdminId: string,
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

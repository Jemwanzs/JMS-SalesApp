import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { SaleHistoryFilters } from "@/features/sales/components/sale-history-filters";
import { SaleHistoryList } from "@/features/sales/components/sale-history-list";
import { BusinessDayService } from "@/services/BusinessDayService";
import { SalesService } from "@/services/SalesService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { todayString } from "@/lib/utils/date-ranges";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { resolveActiveLocationId } from "@/lib/tenant/resolve-active-location";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Sales History | JMS Sales App",
};

/**
 * Phase 2i (sales history) + the UI half of Phase 2e (void/correct). RLS
 * on `sales` (migration 0005) already restricts the rows this query can
 * see to "all sales" or "just my own" depending on the caller's
 * sales.view_all/sales.view_own grant -- SalesService.listRecent() doesn't
 * need to re-derive that.
 *
 * Date-range/search filters (`from`/`to`/`q`) live as URL search params
 * (SaleHistoryFilters pushes them), so the filtered list is a real
 * server-rendered query against SalesService.listRecent() rather than a
 * client-side filter over an already-truncated page. Unfiltered default
 * stays capped at 100 rows same as before; a filtered query raises the
 * cap to 500 since a narrowed date range/search is exactly when someone
 * wants more than the last 100 rows (e.g. exporting a month's CSV).
 *
 * Defaults to today's sales (spec: Product Enhancements #5) when the
 * caller hasn't touched the date filter at all -- neither `from` nor
 * `to` present in the URL. Setting either one (via SaleHistoryFilters'
 * Apply/Today/Clear-then-Apply flow) is treated as an explicit range
 * from then on, so a genuine "show me everything" or a custom range
 * still works exactly as it did before this default was added.
 */
export default async function SalesHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ from?: string; to?: string; q?: string }>;
}) {
  const { tenantSlug } = await params;
  const { from, to, q } = await searchParams;
  const supabase = await createClient();
  const t = await getTranslations("SalesHistory");

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);

  // The tenant layout above already redirects/notFounds on these same
  // conditions, but its redirect() isn't guaranteed to short-circuit
  // this page's own async body first -- Server Components layouts and
  // their nested pages can execute concurrently, so an unauthenticated
  // request could otherwise reach `tenant!.id` below with `tenant` still
  // null (RLS-filtered) and throw instead of cleanly redirecting.
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  const tenantId = tenant.id;

  // Reporting Tabs (Settings): defense in depth alongside BottomNav's
  // own gate on this same setting -- a direct visit to the URL must be
  // blocked too, not just the nav entry hidden. Default ON (`=== false`
  // only matches an explicit turn-off, never "not configured yet").
  const historyEnabled = await new TenantService(supabase).getSetting<boolean>(tenantId, "history_enabled");
  if (historyEnabled === false) {
    redirect(`/t/${tenantSlug}/sales`);
  }

  // Business Day Rollover: "today" here means the effective BUSINESS
  // date, not the raw calendar date -- for a cross-midnight tenant, a
  // sale recorded at 01:00 still belongs to yesterday's still-open
  // business day (see BusinessDayService's own header comments,
  // migration 0055), and the default view/the "Today" button must keep
  // showing it rather than an empty "today" that hasn't opened yet.
  const activeLocationId = await resolveActiveLocationId(supabase, tenantId);
  const today = activeLocationId
    ? (await new BusinessDayService(supabase).getEffectiveBusinessDate(tenantId, activeLocationId)).date
    : todayString(tenant.timezone);
  const hasFilters = Boolean(from || to || q);
  const hasDateFilter = Boolean(from || to);

  const [sales, canVoid, canReverse, canEditWindow, canCorrectHistorical, requiresDownloadPasscode] = await Promise.all([
    new SalesService(supabase).listRecent(tenantId, {
      limit: hasFilters ? 500 : 100,
      dateFrom: hasDateFilter ? from : today,
      dateTo: hasDateFilter ? to : today,
      search: q,
    }),
    can("sales.void", { tenantId }),
    can("sales.reverse", { tenantId }),
    can("sales.edit_window", { tenantId }),
    can("sales.correct_historical", { tenantId }),
    new TenantService(supabase).getSetting<boolean>(tenantId, "require_download_passcode"),
  ]);

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">{t("heading")}</h1>
      <SaleHistoryFilters tenantId={tenantId} todayDate={today} />
      <SaleHistoryList
        sales={sales}
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        currentUserId={user!.id}
        canVoid={canVoid}
        canReverse={canReverse}
        canEditWindow={canEditWindow}
        canCorrectHistorical={canCorrectHistorical}
        requiresDownloadPasscode={requiresDownloadPasscode === true}
        filters={{ from, to, q }}
      />
    </div>
  );
}

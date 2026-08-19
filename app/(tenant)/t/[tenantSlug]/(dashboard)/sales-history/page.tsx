import type { Metadata } from "next";

import { SaleHistoryFilters } from "@/features/sales/components/sale-history-filters";
import { SaleHistoryList } from "@/features/sales/components/sale-history-list";
import { SalesService } from "@/services/SalesService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();

  const tenantId = tenant!.id;
  const hasFilters = Boolean(from || to || q);

  const [sales, canVoid, canReverse, canEditWindow, canCorrectHistorical, requiresDownloadPasscode] = await Promise.all([
    new SalesService(supabase).listRecent(tenantId, {
      limit: hasFilters ? 500 : 100,
      dateFrom: from,
      dateTo: to,
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
      <h1 className="mb-4 text-xl font-semibold">Sales History</h1>
      <SaleHistoryFilters />
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

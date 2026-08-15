import type { Metadata } from "next";

import { SaleHistoryList } from "@/features/sales/components/sale-history-list";
import { SalesService } from "@/services/SalesService";
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
 */
export default async function SalesHistoryPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
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

  const [sales, canVoid, canEditWindow, canCorrectHistorical] = await Promise.all([
    new SalesService(supabase).listRecent(tenantId, { limit: 100 }),
    can("sales.void", { tenantId }),
    can("sales.edit_window", { tenantId }),
    can("sales.correct_historical", { tenantId }),
  ]);

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">Sales History</h1>
      <SaleHistoryList
        sales={sales}
        tenantSlug={tenantSlug}
        currentUserId={user!.id}
        canVoid={canVoid}
        canEditWindow={canEditWindow}
        canCorrectHistorical={canCorrectHistorical}
      />
    </div>
  );
}

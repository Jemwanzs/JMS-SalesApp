import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StockDashboardList } from "@/features/stock/components/stock-dashboard-list";
import { StockService } from "@/services/StockService";
import { assertInventoryEnabled } from "@/lib/inventory/entitlement";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Stock | JMS Sales App",
};

/**
 * Stock dashboard (Product Enhancements #4/#6) -- mobile card list (not
 * a desktop table) of every tracks_inventory product with its current
 * balance, a low-stock badge, and a tap-through to the per-product
 * detail/quick-entry page. assertInventoryEnabled here is defense in
 * depth alongside the bottom nav already hiding this entry point when
 * the module isn't entitled (lib/inventory/entitlement.ts) -- a direct
 * URL hit still needs to redirect cleanly, not error.
 */
export default async function StockPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const { data: tenant } = await supabase.from("tenants").select("id").eq("slug", tenantSlug).single();
  const tenantId = tenant!.id;

  const canView = await can("inventory.view", { tenantId });
  if (!canView) {
    redirect(`/t/${tenantSlug}/more`);
  }

  try {
    await assertInventoryEnabled(tenantId);
  } catch {
    redirect(`/t/${tenantSlug}/more`);
  }

  const balances = await new StockService(supabase).listBalances(tenantId);

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">Stock</h1>
      <StockDashboardList tenantSlug={tenantSlug} balances={balances} />
    </div>
  );
}

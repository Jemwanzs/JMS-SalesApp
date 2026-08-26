import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BarChart3, ClipboardCheck } from "lucide-react";

import { StockDashboardList } from "@/features/stock/components/stock-dashboard-list";
import { StockService } from "@/services/StockService";
import { getInventoryEntitlement } from "@/lib/inventory/entitlement";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

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

  const tenant = await getTenantBySlug(supabase, tenantSlug);
  const tenantId = tenant!.id;

  // Hardening roadmap Phase 1 (docs/22-hardening-roadmap.md, perf finding
  // #8): both checks are independent of each other, and both failure
  // modes redirect to the exact same place -- run them together with the
  // non-throwing entitlement read instead of a sequential await + a
  // second try/catch around the throwing variant.
  const [canView, entitlement] = await Promise.all([can("inventory.view", { tenantId }), getInventoryEntitlement(tenantId)]);
  if (!canView || !entitlement.enabled) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const [balances, canReconcile] = await Promise.all([
    new StockService(supabase).listBalances(tenantId),
    can("stock.reconcile", { tenantId }),
  ]);

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Stock</h1>
        <div className="flex gap-2">
          <Link
            href={`/t/${tenantSlug}/stock/reports`}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            <BarChart3 className="h-4 w-4" />
            Reports
          </Link>
          {canReconcile && (
            <Link
              href={`/t/${tenantSlug}/stock/reconcile`}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              <ClipboardCheck className="h-4 w-4" />
              Reconcile
            </Link>
          )}
        </div>
      </div>
      <StockDashboardList tenantSlug={tenantSlug} balances={balances} />
    </div>
  );
}

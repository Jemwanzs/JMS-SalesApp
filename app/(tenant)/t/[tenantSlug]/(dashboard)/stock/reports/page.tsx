import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BackLink } from "@/components/shared/back-link";
import { LowStockList } from "@/features/stock/components/low-stock-list";
import { StockMovementChart } from "@/features/stock/components/stock-movement-chart";
import { VarianceReportList } from "@/features/stock/components/variance-report-list";
import { StockService } from "@/services/StockService";
import { assertInventoryEnabled } from "@/lib/inventory/entitlement";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import { trailingDaysRange } from "@/lib/utils/date-ranges";

export const metadata: Metadata = {
  title: "Stock Reports | JMS Sales App",
};

const REPORT_WINDOW_DAYS = 30;

/**
 * Charts-first, same "visual before numbers" principle as Phase 1's
 * Analytics pass -- a stock-in-vs-out trend, then the variance and
 * low-stock lists (deliberately plain lists, not more charts -- their
 * reason text/exact counts are the point, not a magnitude to compare at
 * a glance). Reached via a link from /stock, not its own bottom-nav
 * slot -- one more permanent nav item for a sub-report isn't warranted
 * (dataviz/product-enhancements' own "avoid overcrowding" principle).
 * Trailing 30-day window, no date-range picker -- this report is about
 * recent activity, not the same permission-tiered historical drill-down
 * Analytics offers; keeping it simple avoids inventing a parallel
 * stock.past_dates/date_range permission pair nothing else needs yet.
 */
export default async function StockReportsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const tenant = await getTenantBySlug(supabase, tenantSlug);
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

  const range = trailingDaysRange(REPORT_WINDOW_DAYS, tenant!.timezone);
  const stockService = new StockService(supabase);

  const [movementTrend, varianceReport, lowStock] = await Promise.all([
    stockService.getMovementTrend(tenantId, range),
    stockService.getVarianceReport(tenantId, range),
    stockService.listLowStock(tenantId),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <BackLink href={`/t/${tenantSlug}/stock`} label="Stock" />
      <h1 className="text-xl font-semibold">Stock reports</h1>

      <StockMovementChart data={movementTrend} />
      <VarianceReportList rows={varianceReport} />
      <LowStockList tenantSlug={tenantSlug} rows={lowStock} />

      {movementTrend.length < 2 && varianceReport.length === 0 && lowStock.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">Not enough activity yet to report on.</p>
      )}
    </div>
  );
}

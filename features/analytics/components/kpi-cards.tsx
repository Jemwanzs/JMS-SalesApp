import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import type { Kpis } from "@/services/AnalyticsService";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="mt-1 text-2xl tabular-nums">{value}</CardTitle>
      </CardContent>
    </Card>
  );
}

/**
 * Spec's KPI set (docs/11-analytics-reports.md): Total Sales,
 * Transactions, Average Sale, Highest Sale, Lowest Sale, Products Sold,
 * Active Sales Users. Active Sales Users is omitted (not shown as zero)
 * when the caller lacks analytics.all_users -- AnalyticsService.getKpis
 * returns `null` for it in that case, distinct from a genuine zero.
 */
export async function KpiCards({ kpis }: { kpis: Kpis }) {
  const t = await getTranslations("Analytics");

  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile label={t("totalSales")} value={kpis.totalSales.toFixed(2)} />
      <Tile label={t("transactions")} value={String(kpis.transactionCount)} />
      <Tile label={t("averageSale")} value={kpis.averageSale.toFixed(2)} />
      <Tile label={t("highestSale")} value={kpis.highestSale.toFixed(2)} />
      <Tile label={t("lowestSale")} value={kpis.lowestSale.toFixed(2)} />
      <Tile label={t("productsSold")} value={String(kpis.productsSoldCount)} />
      {kpis.activeSalesUsersCount !== null && (
        <Tile label={t("activeSalesUsers")} value={String(kpis.activeSalesUsersCount)} />
      )}
    </div>
  );
}

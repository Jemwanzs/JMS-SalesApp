import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProductPerformanceItem } from "@/services/AnalyticsService";

/**
 * Ranked by revenue, single-hue magnitude bars (bg-primary, the same
 * accent already used for buttons throughout the app) sized relative to
 * the top product -- one series, so no categorical palette is needed
 * here (see dataviz skill: a single-series ranked list doesn't require
 * palette validation).
 */
export async function ProductPerformanceList({ items }: { items: ProductPerformanceItem[] }) {
  if (items.length === 0) {
    return null;
  }

  const t = await getTranslations("Analytics");
  const maxRevenue = Math.max(...items.map((i) => i.totalRevenue));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("topProducts")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item.productId} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">{item.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {item.totalRevenue.toFixed(2)} · {t("saleCount", { count: item.saleCount })}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${maxRevenue > 0 ? (item.totalRevenue / maxRevenue) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

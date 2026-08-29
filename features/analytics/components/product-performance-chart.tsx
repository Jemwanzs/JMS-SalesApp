"use client";

import { useTranslations } from "next-intl";
import { Bar, BarChart, Tooltip, XAxis, YAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProductPerformanceItem } from "@/services/AnalyticsService";

const MAX_BARS = 6;
const LABEL_MAX_CHARS = 14;

function truncateLabel(name: string): string {
  return name.length > LABEL_MAX_CHARS ? `${name.slice(0, LABEL_MAX_CHARS - 1)}…` : name;
}

/**
 * Custom tooltip (rather than the generic ui/chart ChartTooltipContent)
 * so a tap/hover surfaces both totalRevenue and saleCount plus the FULL
 * (untruncated) product name -- the Y-axis tick itself is truncated for
 * space, and the tooltip's own `label` is that same truncated dataKey
 * value, so the full item is looked up by name from `items` instead.
 */
function ProductTooltip({
  active,
  label,
  items,
}: {
  active?: boolean;
  label?: string;
  items: ProductPerformanceItem[];
}) {
  const t = useTranslations("Analytics");
  if (!active || label == null) return null;
  const item = items.find((i) => i.name === label);
  if (!item) return null;

  return (
    <div className="rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <p className="mb-1 font-medium">{item.name}</p>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{t("revenue")}</span>
        <span className="ml-auto font-medium tabular-nums">{item.totalRevenue.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{t("salesSeries")}</span>
        <span className="ml-auto font-medium tabular-nums">{item.saleCount}</span>
      </div>
    </div>
  );
}

/**
 * Ranked horizontal bar chart, top MAX_BARS by revenue -- a magnitude
 * comparison across products, so one sequential hue (var(--primary))
 * for every bar, not a categorical palette per bar (dataviz skill: a
 * value-ramp/per-bar-hue on nominal categories double-encodes length as
 * color and fails the categorical checks by design). No per-bar value
 * label -- the ranked list (ProductPerformanceList) sits directly below
 * this chart on the page and already shows the exact revenue/sale-count
 * for every item, so it's the table-view companion this chart's values
 * are reachable through (dataviz skill: direct labels are supplementary,
 * not required, once a table view already carries the same numbers).
 * Tap (or hover) a bar for the exact figures via recharts' own built-in
 * touch-aware tooltip -- "tap a chart to view detailed figures."
 */
export function ProductPerformanceChart({ items }: { items: ProductPerformanceItem[] }) {
  const t = useTranslations("Analytics");
  const chartConfig: ChartConfig = {
    totalRevenue: { label: t("revenue"), color: "var(--primary)" },
  };
  const top = items.slice(0, MAX_BARS);
  const remaining = items.length - top.length;

  if (top.length === 0) {
    return null;
  }

  const chartHeight = Math.max(top.length * 40, 120);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("productPerformance")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} style={{ height: chartHeight }}>
          <BarChart data={top} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis
              dataKey="name"
              type="category"
              tickFormatter={truncateLabel}
              tickLine={false}
              axisLine={false}
              width={92}
              fontSize={11}
            />
            <Tooltip cursor={{ fill: "var(--muted)" }} content={<ProductTooltip items={top} />} />
            <Bar dataKey="totalRevenue" radius={4} maxBarSize={24} fill="var(--color-totalRevenue)" />
          </BarChart>
        </ChartContainer>
        {remaining > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">{t("moreInList", { count: remaining })}</p>
        )}
      </CardContent>
    </Card>
  );
}

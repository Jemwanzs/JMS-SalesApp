"use client";

import { useLocale, useTranslations } from "next-intl";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LOCALE_BCP47, type SupportedLocale } from "@/lib/i18n/config";
import type { DailyTrendPoint } from "@/services/AnalyticsService";

/**
 * Locale-aware month abbreviation (replaces a hardcoded English MONTHS
 * array) -- Intl.DateTimeFormat with the resolved BCP-47 tag gives the
 * correct month name AND ordering convention for the active language,
 * not just a translated string.
 */
function formatShortDate(date: string, bcp47: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(bcp47, { month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

/**
 * Custom tooltip (rather than the generic ui/chart ChartTooltipContent)
 * so a tap/hover surfaces BOTH totalSales and transactionCount, even
 * though only totalSales is drawn as a mark -- recharts' tooltip payload
 * only carries rendered series by default, so the second figure is
 * looked up from the full point via `label` instead of a second
 * (invisible) series.
 */
function TrendTooltip({
  active,
  label,
  data,
  bcp47,
}: {
  active?: boolean;
  label?: string;
  data: DailyTrendPoint[];
  bcp47: string;
}) {
  const t = useTranslations("Analytics");
  if (!active || label == null) return null;
  const point = data.find((d) => d.date === label);
  if (!point) return null;

  return (
    <div className="rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <p className="mb-1 font-medium">{formatShortDate(point.date, bcp47)}</p>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{t("totalSalesSeries")}</span>
        <span className="ml-auto font-medium tabular-nums">{point.totalSales.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{t("transactions")}</span>
        <span className="ml-auto font-medium tabular-nums">{point.transactionCount}</span>
      </div>
    </div>
  );
}

/**
 * Single-series area chart (sequential hue, var(--primary) -- same ink
 * already used for the ranked-row magnitude bars elsewhere on this page,
 * see dataviz skill: one series needs no legend/categorical palette).
 * Only renders once there are >= 2 distinct days in range -- a one-point
 * "trend" isn't a trend, matching ProductPerformanceList's own
 * return-null-when-not-meaningful convention for an empty range. Tap (or
 * hover) a point for the exact day's numbers via recharts' own built-in
 * touch-aware tooltip -- "tap a chart to view detailed figures."
 */
export function SalesTrendChart({ data }: { data: DailyTrendPoint[] }) {
  const t = useTranslations("Analytics");
  const locale = useLocale() as SupportedLocale;
  const bcp47 = LOCALE_BCP47[locale];
  const chartConfig: ChartConfig = {
    totalSales: { label: t("totalSalesSeries"), color: "var(--primary)" },
  };

  if (data.length < 2) {
    return null;
  }

  const peak = data.reduce((max, point) => (point.totalSales > max.totalSales ? point : max), data[0]);
  const latest = data[data.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("salesTrend")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis
              dataKey="date"
              tickFormatter={(date: string) => formatShortDate(date, bcp47)}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
              minTickGap={24}
            />
            <Tooltip content={<TrendTooltip data={data} bcp47={bcp47} />} />
            <Area
              dataKey="totalSales"
              type="monotone"
              stroke="var(--color-totalSales)"
              strokeWidth={2}
              fill="var(--color-totalSales)"
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            />
          </AreaChart>
        </ChartContainer>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t("peak")} {formatShortDate(peak.date, bcp47)} ·{" "}
            <span className="tabular-nums text-foreground">{peak.totalSales.toFixed(2)}</span>
          </span>
          <span>
            {t("latest")} {formatShortDate(latest.date, bcp47)} ·{" "}
            <span className="tabular-nums text-foreground">{latest.totalSales.toFixed(2)}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

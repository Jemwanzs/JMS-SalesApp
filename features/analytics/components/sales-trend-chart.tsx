"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyTrendPoint } from "@/services/AnalyticsService";

const chartConfig: ChartConfig = {
  totalSales: { label: "Total sales", color: "var(--primary)" },
};

function formatShortDate(date: string): string {
  const [, month, day] = date.split("-");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MONTHS[Number(month) - 1]} ${Number(day)}`;
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
}: {
  active?: boolean;
  label?: string;
  data: DailyTrendPoint[];
}) {
  if (!active || label == null) return null;
  const point = data.find((d) => d.date === label);
  if (!point) return null;

  return (
    <div className="rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <p className="mb-1 font-medium">{formatShortDate(point.date)}</p>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Total sales</span>
        <span className="ml-auto font-medium tabular-nums">{point.totalSales.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Transactions</span>
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
  if (data.length < 2) {
    return null;
  }

  const peak = data.reduce((max, point) => (point.totalSales > max.totalSales ? point : max), data[0]);
  const latest = data[data.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
              minTickGap={24}
            />
            <Tooltip content={<TrendTooltip data={data} />} />
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
            Peak {formatShortDate(peak.date)} · <span className="tabular-nums text-foreground">{peak.totalSales.toFixed(2)}</span>
          </span>
          <span>
            Latest {formatShortDate(latest.date)} · <span className="tabular-nums text-foreground">{latest.totalSales.toFixed(2)}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

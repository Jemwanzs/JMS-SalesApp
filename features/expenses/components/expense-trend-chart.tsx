"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExpenseTrendPoint } from "@/services/ExpenseService";

function formatShortDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

function TrendTooltip({ active, label, data }: { active?: boolean; label?: string; data: ExpenseTrendPoint[] }) {
  if (!active || label == null) return null;
  const point = data.find((d) => d.date === label);
  if (!point) return null;

  return (
    <div className="rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <p className="mb-1 font-medium">{formatShortDate(point.date)}</p>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Total</span>
        <span className="ml-auto font-medium tabular-nums">{point.total.toFixed(2)}</span>
      </div>
    </div>
  );
}

/**
 * Single-series area chart, same shape as SalesTrendChart -- hardcoded
 * English throughout (not next-intl), matching this feature's own
 * established i18n convention (docs/26-daily-expenses.md). Only renders
 * once there are >= 2 distinct days in range -- a one-point "trend" isn't
 * a trend.
 */
export function ExpenseTrendChart({ data }: { data: ExpenseTrendPoint[] }) {
  const chartConfig: ChartConfig = {
    total: { label: "Total", color: "var(--primary)" },
  };

  if (data.length < 2) {
    return null;
  }

  const peak = data.reduce((max, point) => (point.total > max.total ? point : max), data[0]);
  const latest = data[data.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Expense Trend</CardTitle>
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
              dataKey="total"
              type="monotone"
              stroke="var(--color-total)"
              strokeWidth={2}
              fill="var(--color-total)"
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            />
          </AreaChart>
        </ChartContainer>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Peak {formatShortDate(peak.date)} · <span className="tabular-nums text-foreground">{peak.total.toFixed(2)}</span>
          </span>
          <span>
            Latest {formatShortDate(latest.date)} · <span className="tabular-nums text-foreground">{latest.total.toFixed(2)}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

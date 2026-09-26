"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrderTrendPoint } from "@/services/OrderService";

function formatShortDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

function TrendTooltip({ active, label, data }: { active?: boolean; label?: string; data: OrderTrendPoint[] }) {
  if (!active || label == null) return null;
  const point = data.find((d) => d.date === label);
  if (!point) return null;

  return (
    <div className="rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <p className="mb-1 font-medium">{formatShortDate(point.date)}</p>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Completed Value</span>
        <span className="ml-auto font-medium tabular-nums">{point.completedValue.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Completed Orders</span>
        <span className="ml-auto font-medium tabular-nums">{point.completedCount}</span>
      </div>
    </div>
  );
}

/** Same single-series area-chart shape as SalesTrendChart -- see that component's own header comment. */
export function OrderTrendChart({ data }: { data: OrderTrendPoint[] }) {
  if (data.length < 2) {
    return null;
  }

  const chartConfig: ChartConfig = {
    completedValue: { label: "Completed Value", color: "var(--primary)" },
  };
  const latest = data[data.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order Trend</CardTitle>
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
              dataKey="completedValue"
              type="monotone"
              stroke="var(--color-completedValue)"
              strokeWidth={2}
              fill="var(--color-completedValue)"
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            />
          </AreaChart>
        </ChartContainer>
        <div className="mt-2 flex items-center justify-end text-xs text-muted-foreground">
          <span>
            Latest {formatShortDate(latest.date)} · <span className="tabular-nums text-foreground">{latest.completedValue.toFixed(2)}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

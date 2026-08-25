"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyMovementPoint } from "@/services/StockService";

/**
 * Two-series chart (stock in vs stock out) -- unlike Phase 1's
 * single-hue charts, this genuinely needs two colors to tell the series
 * apart (dataviz skill: "tell distinct series apart" -> categorical).
 * Blue/orange, the same pair Phase 1's design pass already validated
 * (CVD-safe, orange needs the "relief" rule -- satisfied here by the
 * legend below the chart plus the variance/low-stock lists on the page
 * as this report's table-view companion).
 */
const chartConfig: ChartConfig = {
  stockIn: { label: "Stock in", color: "#2a78d6" },
  stockOut: { label: "Stock out", color: "#eb6834" },
};

function formatShortDate(date: string): string {
  const [, month, day] = date.split("-");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MONTHS[Number(month) - 1]} ${Number(day)}`;
}

export function StockMovementChart({ data }: { data: DailyMovementPoint[] }) {
  if (data.length < 2) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock in vs out</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis dataKey="date" tickFormatter={formatShortDate} tickLine={false} axisLine={false} tickMargin={8} fontSize={11} minTickGap={24} />
            <Tooltip
              content={({ active, label, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                return (
                  <div className="rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
                    <p className="mb-1 font-medium">{formatShortDate(String(label))}</p>
                    {payload.map((entry) => (
                      <div key={String(entry.dataKey)} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: entry.color }} />
                        <span className="text-muted-foreground">{entry.dataKey === "stockIn" ? "Stock in" : "Stock out"}</span>
                        <span className="ml-auto font-medium tabular-nums">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Area dataKey="stockIn" type="monotone" stroke="var(--color-stockIn)" strokeWidth={2} fill="var(--color-stockIn)" fillOpacity={0.1} dot={false} />
            <Area dataKey="stockOut" type="monotone" stroke="var(--color-stockOut)" strokeWidth={2} fill="var(--color-stockOut)" fillOpacity={0.1} dot={false} />
          </AreaChart>
        </ChartContainer>
        <div className="mt-2 flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: "#2a78d6" }} />
            Stock in
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: "#eb6834" }} />
            Stock out
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

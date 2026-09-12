"use client";

import dynamic from "next/dynamic";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExpenseTrendPoint } from "@/services/ExpenseService";

/**
 * Same code-splitting rationale as SalesTrendChartLazy -- recharts stays
 * out of the initial JS for a chart that renders below the fold. The
 * skeleton matches ChartContainer's own fixed h-[220px] so there's no
 * layout shift once the real chart mounts.
 */
export const ExpenseTrendChartLazy = dynamic(() => import("./expense-trend-chart").then((m) => m.ExpenseTrendChart), {
  ssr: false,
  loading: () => (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[220px] w-full" />
      </CardContent>
    </Card>
  ),
});

export type { ExpenseTrendPoint };

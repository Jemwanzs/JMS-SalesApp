"use client";

import dynamic from "next/dynamic";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyMovementPoint } from "@/services/StockService";

/** See features/analytics/components/sales-trend-chart-lazy.tsx's header comment -- same pattern, same reasoning. */
export const StockMovementChartLazy = dynamic(() => import("./stock-movement-chart").then((m) => m.StockMovementChart), {
  ssr: false,
  loading: () => (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-36" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[220px] w-full" />
      </CardContent>
    </Card>
  ),
});

export type { DailyMovementPoint };

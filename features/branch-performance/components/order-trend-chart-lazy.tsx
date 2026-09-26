"use client";

import dynamic from "next/dynamic";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrderTrendPoint } from "@/services/OrderService";

/** See features/analytics/components/sales-trend-chart-lazy.tsx's header comment -- same pattern, same reasoning. */
export const OrderTrendChartLazy = dynamic(() => import("./order-trend-chart").then((m) => m.OrderTrendChart), {
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

export type { OrderTrendPoint };

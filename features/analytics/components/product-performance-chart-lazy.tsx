"use client";

import dynamic from "next/dynamic";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProductPerformanceItem } from "@/services/AnalyticsService";

/** See sales-trend-chart-lazy.tsx's header comment -- same pattern, same reasoning. */
export const ProductPerformanceChartLazy = dynamic(() => import("./product-performance-chart").then((m) => m.ProductPerformanceChart), {
  ssr: false,
  loading: () => (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[220px] w-full" />
      </CardContent>
    </Card>
  ),
});

export type { ProductPerformanceItem };

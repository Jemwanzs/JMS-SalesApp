"use client";

import dynamic from "next/dynamic";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyTrendPoint } from "@/services/AnalyticsService";

/**
 * Hardening roadmap Phase 2.4 (docs/22-hardening-roadmap.md, performance
 * finding #6): recharts was bundled into Analytics' initial JS even
 * though the chart renders below other content on first paint --
 * `ssr: false` requires a Client Component boundary (Next.js rejects it
 * directly in a Server Component page), so this thin wrapper is that
 * boundary; analytics/page.tsx imports this file normally instead of
 * calling next/dynamic itself. The skeleton matches ChartContainer's own
 * fixed h-[220px] (components/ui/chart.tsx) so there's no layout shift
 * once the real chart mounts.
 */
export const SalesTrendChartLazy = dynamic(() => import("./sales-trend-chart").then((m) => m.SalesTrendChart), {
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

export type { DailyTrendPoint };

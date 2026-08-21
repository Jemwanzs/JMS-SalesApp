import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PerformanceTier, UserPerformanceItem } from "@/services/AnalyticsService";

const TIER_LABEL: Record<PerformanceTier, string> = {
  gold: "🥇 Gold",
  silver: "🥈 Silver",
  bronze: "🥉 Bronze",
};

const TIER_BADGE_CLASS: Record<PerformanceTier, string> = {
  gold: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  silver: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  bronze: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
};

/**
 * Who's selling the most, for the selected period -- same Gold/Silver/
 * Bronze ranking language and magnitude-bar visual as
 * product-performance-list.tsx, so the two feel like one consistent
 * "performance" idiom rather than two different UI patterns.
 */
export function UserPerformanceList({ items }: { items: UserPerformanceItem[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Team Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No sales recorded for this period yet.</p>
        </CardContent>
      </Card>
    );
  }

  const maxRevenue = Math.max(...items.map((i) => i.totalRevenue));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team Performance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item, index) => (
          <div key={item.profileId} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{index + 1}</span>
                <span className="truncate font-medium">{item.name}</span>
                {item.tier && (
                  <Badge className={`shrink-0 ${TIER_BADGE_CLASS[item.tier]}`}>{TIER_LABEL[item.tier]}</Badge>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {item.totalRevenue.toFixed(2)} · {item.saleCount} sale
                {item.saleCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${maxRevenue > 0 ? (item.totalRevenue / maxRevenue) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

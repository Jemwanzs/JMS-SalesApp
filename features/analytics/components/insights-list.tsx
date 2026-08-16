import { AlertTriangle, Info, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

const SEVERITY_ICON = {
  positive: TrendingUp,
  warning: AlertTriangle,
  info: Info,
} as const;

const SEVERITY_CLASSES = {
  positive: "text-primary",
  warning: "text-destructive",
  info: "text-muted-foreground",
} as const;

/**
 * Rule-based insights (Phase 3d, docs/11-analytics-reports.md) -- plain-
 * language cards, no chart/color-palette apparatus needed since each
 * card carries an icon + text, not a data mark (status colors, used
 * sparingly and always paired with an icon/label, never color alone).
 */
export function InsightsList({
  insights,
}: {
  insights: Array<{ id: string; severity: "positive" | "warning" | "info"; message: string }>;
}) {
  if (insights.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        {insights.map((insight) => {
          const Icon = SEVERITY_ICON[insight.severity];
          return (
            <div key={insight.id} className="flex items-start gap-2 text-sm">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${SEVERITY_CLASSES[insight.severity]}`} />
              <span>{insight.message}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

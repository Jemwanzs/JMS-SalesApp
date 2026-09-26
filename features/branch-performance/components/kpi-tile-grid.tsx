import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";

/**
 * A generic version of features/analytics/components/kpi-cards.tsx's
 * own `Tile` -- that file is bound to AnalyticsService's `Kpis` shape
 * and the "Analytics" i18n namespace, so it isn't reusable as-is for
 * Stock/Orders' own tile sets. Same visual shape (Card size="sm",
 * grid-cols-2), generic over `{label, value}[]` instead.
 */
export function KpiTileGrid({ tiles }: { tiles: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map((tile) => (
        <Card key={tile.label} size="sm">
          <CardContent>
            <CardDescription>{tile.label}</CardDescription>
            <CardTitle className="mt-1 text-2xl tabular-nums">{tile.value}</CardTitle>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

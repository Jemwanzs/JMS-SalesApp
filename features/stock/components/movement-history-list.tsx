import type { StockMovementRow } from "@/services/StockService";

export const MOVEMENT_LABEL: Record<string, string> = {
  opening_stock: "Opening stock",
  stock_in: "Stock in",
  stock_out: "Stock out",
  adjustment_increase: "Adjustment (up)",
  adjustment_decrease: "Adjustment (down)",
  damaged: "Damaged",
  expired: "Expired",
  lost: "Lost/missing",
  reconciliation_variance: "Reconciliation variance",
  sale: "Sale",
  sale_reversal: "Sale reversal",
};

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function MovementHistoryList({ movements, unitOfMeasure }: { movements: StockMovementRow[]; unitOfMeasure: string | null }) {
  if (movements.length === 0) {
    return <p className="text-center text-sm text-muted-foreground">No stock movements recorded yet.</p>;
  }

  return (
    <div className="divide-y rounded-lg border">
      {movements.map((m) => {
        const positive = m.quantity > 0;
        return (
          <div key={m.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{MOVEMENT_LABEL[m.movementType] ?? m.movementType}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(m.occurredOn)}
                {m.reason ? ` · ${m.reason}` : ""}
              </p>
            </div>
            <p className={`shrink-0 text-sm font-medium tabular-nums ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
              {positive ? "+" : ""}
              {m.quantity} {unitOfMeasure ?? ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

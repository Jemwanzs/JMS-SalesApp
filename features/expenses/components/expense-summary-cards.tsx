import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import type { ExpenseSummary } from "@/services/ExpenseService";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="mt-1 text-2xl tabular-nums">{value}</CardTitle>
      </CardContent>
    </Card>
  );
}

/** Total Expenses / Number of Expenses / Highest Expense Item, per spec -- same Tile pattern kpi-cards.tsx already uses for Sales Analytics. */
export function ExpenseSummaryCards({ summary }: { summary: ExpenseSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile label="Total Expenses" value={summary.totalAmount.toFixed(2)} />
      <Tile label="Number of Expenses" value={String(summary.count)} />
      <Tile label="Highest Expense Item" value={summary.highestItem?.expenseItemName ?? "--"} />
    </div>
  );
}

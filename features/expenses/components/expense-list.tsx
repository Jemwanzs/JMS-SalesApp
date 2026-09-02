"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { ExpenseDetailDialog } from "@/features/expenses/components/expense-detail-dialog";
import { RecordExpenseDialog } from "@/features/expenses/components/record-expense-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ExpenseItem } from "@/services/ExpenseItemService";
import type { ExpenseRecord } from "@/services/ExpenseService";

/**
 * Expense Name | Actual Amount | Date | Recorded By, per spec -- a
 * voided expense stays visible (struck through, tagged) rather than
 * disappearing, since it's still a real record of what happened.
 * "No expenses recorded for {date}" zero-state, never blank, matching
 * this app's established "Reports Must Always Be Available" philosophy.
 */
export function ExpenseList({
  tenantId,
  tenantSlug,
  timezone,
  todayDate,
  viewedDate,
  expenses,
  activeItems,
  canCreate,
  canEdit,
  canVoid,
}: {
  tenantId: string;
  tenantSlug: string;
  timezone: string;
  /** The real "today" (tenant-timezone) -- distinct from viewedDate, which can be any past date being browsed. Always the default/max for the Add/Edit date fields, never the viewed date. */
  todayDate: string;
  viewedDate: string;
  expenses: ExpenseRecord[];
  activeItems: ExpenseItem[];
  canCreate: boolean;
  canEdit: boolean;
  canVoid: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<ExpenseRecord | null>(null);

  const totalActive = expenses.filter((e) => e.status === "active").reduce((sum, e) => sum + e.actualAmount, 0);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="rounded-lg border bg-muted/30 p-3">
        <p className="text-xs text-muted-foreground">Total for {viewedDate}</p>
        <p className="text-xl font-semibold tabular-nums">{totalActive.toFixed(2)}</p>
      </div>

      {canCreate && (
        <Button onClick={() => setAddOpen(true)} className="w-full">
          <Plus className="h-4 w-4" />
          Add expense
        </Button>
      )}

      {expenses.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No expenses recorded for {viewedDate}.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {expenses.map((expense) => {
            const canOpen = (canEdit || canVoid) && expense.status === "active";
            const Row = (
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`truncate font-medium ${expense.status === "voided" ? "line-through text-muted-foreground" : ""}`}>
                      {expense.expenseItemName}
                    </p>
                    {expense.status === "voided" && (
                      <Badge variant="secondary" className="shrink-0">
                        Voided
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {expense.expenseDate} &middot; {expense.recordedByName ?? "Unknown"}
                  </p>
                </div>
                <p className="shrink-0 font-medium tabular-nums">{expense.actualAmount.toFixed(2)}</p>
              </div>
            );

            return canOpen ? (
              <button key={expense.id} type="button" onClick={() => setSelected(expense)} className="block w-full text-left hover:bg-muted">
                {Row}
              </button>
            ) : (
              <div key={expense.id}>{Row}</div>
            );
          })}
        </div>
      )}

      <RecordExpenseDialog
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        timezone={timezone}
        todayDate={todayDate}
        open={addOpen}
        onOpenChange={setAddOpen}
        activeItems={activeItems}
      />

      <ExpenseDetailDialog
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        timezone={timezone}
        todayDate={todayDate}
        expense={selected}
        canEdit={canEdit}
        canVoid={canVoid}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import { listExpenseSplitSiblingsAction } from "@/features/expenses/actions/list-expense-split-siblings";
import type { ExpenseRecord } from "@/services/ExpenseService";

/** Eagerly loads (unlike ExpenseCorrectionsHistory's expand-to-load) since this is only rendered at all when the expense IS part of a split -- a small, always-relevant fact about the record being viewed, not optional history. */
export function ExpenseSplitSiblings({
  tenantId,
  splitGroupId,
  expenseId,
}: {
  tenantId: string;
  splitGroupId: string;
  expenseId: string;
}) {
  const [siblings, setSiblings] = useState<ExpenseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listExpenseSplitSiblingsAction(tenantId, splitGroupId, expenseId).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
        return;
      }
      setSiblings(result.siblings ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId, splitGroupId, expenseId]);

  if (error) {
    return <p className="text-xs text-destructive">{error}</p>;
  }
  if (!siblings) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="mb-1.5 text-sm font-medium">Part of a split expense</p>
      <div className="space-y-1">
        {siblings.map((s) => (
          <div key={s.id} className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate">{s.categoryName ?? "Unknown category"}</span>
            <span className="shrink-0 tabular-nums">{s.actualAmount.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

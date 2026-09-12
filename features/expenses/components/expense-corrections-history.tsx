"use client";

import { useEffect, useState } from "react";

import { listExpenseCorrectionsAction } from "@/features/expenses/actions/list-expense-corrections";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import type { ExpenseCorrection } from "@/services/ExpenseService";

const FIELD_LABELS: Record<string, string> = {
  expense_date: "Date",
  expense_item_name_snapshot: "Item",
  category_name_snapshot: "Category",
  actual_amount: "Amount",
  vendor: "Vendor",
  payment_method_name_snapshot: "Payment method",
  reference_number: "Reference number",
  tax_amount: "Tax amount",
  reimbursable: "Reimbursable",
  notes: "Notes",
  receipt_storage_path: "Receipt",
  status: "Status",
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** Read-only old->new diff for one correction row, only the fields new_values actually names. */
function CorrectionDiff({ correction }: { correction: ExpenseCorrection }) {
  if (!correction.newValues) return null;
  const keys = Object.keys(correction.newValues).filter((k) => FIELD_LABELS[k]);

  return (
    <div className="space-y-1 text-xs">
      {keys.map((key) => {
        const oldVal = correction.oldValues[key];
        const newVal = correction.newValues![key];
        if (oldVal === newVal) return null;
        return (
          <p key={key} className="text-muted-foreground">
            <span className="font-medium text-foreground">{FIELD_LABELS[key]}:</span> {formatValue(oldVal)} &rarr; {formatValue(newVal)}
          </p>
        );
      })}
    </div>
  );
}

/** Lazily loads and shows an expense's full void/correct history -- fetched on first expand, not eagerly with the rest of the detail dialog. */
export function ExpenseCorrectionsHistory({ tenantId, expenseId }: { tenantId: string; expenseId: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [corrections, setCorrections] = useState<ExpenseCorrection[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    listExpenseCorrectionsAction(tenantId, expenseId).then((result) => {
      if (result.error) {
        setError(result.error);
        return;
      }
      setCorrections(result.corrections ?? []);
      setLoaded(true);
    });
  }, [open, loaded, tenantId, expenseId]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="text-sm font-medium text-muted-foreground hover:text-foreground">
        Correction history
      </CollapsibleTrigger>
      <CollapsiblePanel className="space-y-2 pt-2">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {loaded && corrections.length === 0 && <p className="text-xs text-muted-foreground">No corrections yet.</p>}
        {corrections.map((correction) => (
          <div key={correction.id} className="rounded-lg border p-2.5">
            <div className="mb-1 flex items-center gap-2">
              <Badge variant={correction.correctionType === "void" ? "destructive" : "secondary"}>
                {correction.correctionType === "void" ? "Voided" : "Corrected"}
              </Badge>
              <p className="text-xs text-muted-foreground">
                {correction.correctedByName ?? "a team member"} &middot; {new Date(correction.correctedAt).toLocaleString()}
              </p>
            </div>
            <p className="text-xs">{correction.reason}</p>
            <CorrectionDiff correction={correction} />
          </div>
        ))}
      </CollapsiblePanel>
    </Collapsible>
  );
}

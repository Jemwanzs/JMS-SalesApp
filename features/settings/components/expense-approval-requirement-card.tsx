"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  setExpenseApprovalRequirementAction,
  type ExpenseApprovalRequirementMode,
} from "@/features/settings/actions/set-expense-approval-requirement";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ExpenseApprovalRequirementCard({
  tenantId,
  tenantSlug,
  initialMode,
  initialAmountThreshold,
}: {
  tenantId: string;
  tenantSlug: string;
  initialMode: ExpenseApprovalRequirementMode | null;
  initialAmountThreshold: number | null;
}) {
  const [mode, setMode] = useState<ExpenseApprovalRequirementMode>(initialMode ?? "never");
  const [amountThreshold, setAmountThreshold] = useState(String(initialAmountThreshold ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("mode", mode);
    formData.set("amountThreshold", amountThreshold);

    startTransition(async () => {
      const result = await setExpenseApprovalRequirementAction(tenantId, tenantSlug, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Expense approval</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Decide when a recorded expense needs review before it counts toward totals and reports. A request shows up under
          Approvals for anyone who can review approvals -- until then, the expense stays in a &ldquo;Pending approval&rdquo; state.
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="expense-approval-mode">Require approval</Label>
            <select
              id="expense-approval-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as ExpenseApprovalRequirementMode)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="never">Never</option>
              <option value="always">Always</option>
              <option value="amount_threshold">Based on amount</option>
              <option value="category">Based on category</option>
            </select>
          </div>

          {mode === "amount_threshold" && (
            <div className="space-y-2">
              <Label htmlFor="expense-approval-threshold">Require approval for expenses at or above</Label>
              <Input
                id="expense-approval-threshold"
                type="number"
                min="0"
                step="0.01"
                value={amountThreshold}
                onChange={(e) => setAmountThreshold(e.target.value)}
                required
              />
            </div>
          )}

          {mode === "category" && (
            <p className="text-xs text-muted-foreground">
              Turn &ldquo;Always require approval&rdquo; on for individual categories under More &rarr; Expense Setup &rarr;
              Categories.
            </p>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setExpenseReceiptOcrEnabledAction } from "@/features/settings/actions/set-expense-receipt-ocr-enabled";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * A per-tenant opt-in, off by default -- turning this on means a
 * receipt image the user chooses to extract from gets sent to a third-
 * party AI vision service (Anthropic's Claude API) to read back a few
 * fields as a suggestion. Same plain-instant-toggle shape as
 * ExpensesModuleCard (no billing dimension here either), but the copy
 * is explicit about what "on" actually means rather than just "a
 * feature exists," since this one has a real data-sharing consequence
 * the receipt-requirement/approval-mode cards don't.
 */
export function ExpenseReceiptOcrCard({
  tenantId,
  tenantSlug,
  initialEnabled,
  configured,
}: {
  tenantId: string;
  tenantSlug: string;
  initialEnabled: boolean;
  configured: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  function onToggle(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const result = await setExpenseReceiptOcrEnabledAction(tenantId, tenantSlug, next);
      if (result.error) {
        setEnabled(!next);
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Receipt OCR (Beta)</CardTitle>
      </CardHeader>
      <CardContent>
        {!configured ? (
          <p className="text-xs text-muted-foreground">Not available on this deployment yet.</p>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="expense-receipt-ocr-toggle" className="font-normal text-muted-foreground">
              Let anyone recording an expense tap &ldquo;Extract details&rdquo; on an attached receipt image to pre-fill vendor, amount, date,
              and tax as a suggestion they review before saving. The receipt image is sent to a third-party AI vision service to read it.
            </Label>
            <Switch id="expense-receipt-ocr-toggle" checked={enabled} disabled={isPending} onCheckedChange={onToggle} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

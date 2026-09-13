"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { resolveApprovalAction } from "@/features/sales/actions/resolve-approval";
import { Button } from "@/components/ui/button";

export function ApprovalRowActions({
  approvalRequestId,
  tenantSlug,
  onResolved,
}: {
  approvalRequestId: string;
  tenantSlug: string;
  onResolved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "approved" | "rejected") {
    setError(null);
    const formData = new FormData();
    formData.set("approvalRequestId", approvalRequestId);
    formData.set("decision", decision);

    startTransition(async () => {
      const result = await resolveApprovalAction(tenantSlug, {}, formData);

      // A validation failure (fieldErrors) is just as much a non-success
      // as `error` -- checking only `error` let a schema mismatch (see
      // resolve-approval.ts's own note) silently no-op while this UI
      // still showed a success toast and cleared the row.
      if (result.error || result.fieldErrors) {
        setError(result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? "Could not resolve this request");
        return;
      }

      toast.success(decision === "approved" ? "Request approved" : "Request rejected");
      onResolved();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => decide("rejected")}
        >
          Reject
        </Button>
        <Button size="sm" disabled={isPending} onClick={() => decide("approved")}>
          Approve
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

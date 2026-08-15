"use client";

import { useState } from "react";

import { ApprovalRowActions } from "@/features/sales/components/approval-row-actions";
import type { PendingApprovalRequest } from "@/services/ApprovalService";

const TYPE_LABEL: Record<string, string> = {
  sale_void: "Void sale",
  sale_correction: "Correct sale",
};

export function ApprovalsInboxList({
  requests,
  tenantSlug,
}: {
  requests: PendingApprovalRequest[];
  tenantSlug: string;
}) {
  const [items, setItems] = useState(requests);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">No pending approval requests.</p>
      </div>
    );
  }

  return (
    <div className="divide-y rounded-lg border">
      {items.map((request) => (
        <div key={request.id} className="flex items-start justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">{TYPE_LABEL[request.type] ?? request.type}</p>
            <p className="text-xs text-muted-foreground">
              Reason: {String(request.requestPayload.reason ?? "—")}
            </p>
            <p className="text-xs text-muted-foreground">
              Requested {new Date(request.createdAt).toLocaleString()}
            </p>
          </div>
          <ApprovalRowActions
            approvalRequestId={request.id}
            tenantSlug={tenantSlug}
            onResolved={() => setItems((prev) => prev.filter((r) => r.id !== request.id))}
          />
        </div>
      ))}
    </div>
  );
}

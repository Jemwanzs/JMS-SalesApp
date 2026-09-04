"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { cancelTenantDeletionAction } from "@/features/settings/actions/cancel-tenant-deletion";
import { Button } from "@/components/ui/button";

export function CancelTenantDeletionButton({ tenantId, tenantSlug }: { tenantId: string; tenantSlug: string }) {
  const [isPending, startTransition] = useTransition();

  function onCancel() {
    startTransition(async () => {
      const result = await cancelTenantDeletionAction(tenantId, tenantSlug);
      if (result?.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button onClick={onCancel} disabled={isPending}>
      {isPending ? "Cancelling..." : "Cancel deletion"}
    </Button>
  );
}

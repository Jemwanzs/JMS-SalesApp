"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { requestTenantDeletionAction } from "@/features/settings/actions/request-tenant-deletion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Account Deletion (Feature 1) -- shown to Tenant Administrators
 * (settings.manage holders) instead of SelfDeleteAccountCard.
 * "Type the business name to confirm" is the same high-friction
 * convention tenant-actions-panel.tsx's DeleteConfirmForm already uses
 * for permanent/irreversible actions on the platform-admin side.
 * Submitting immediately deactivates the whole business for every
 * member -- the actual 30-day grace period and Cancel button live on
 * /tenant-deactivated, which is where this redirects to.
 */
export function RequestTenantDeletionCard({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [isPending, startTransition] = useTransition();
  const matches = confirmName === tenantName;

  function onConfirm() {
    startTransition(async () => {
      const result = await requestTenantDeletionAction(tenantId);
      if (result?.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Delete My Business</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Deactivates {tenantName} immediately for every member, then permanently deletes it — all sales, products,
          and stock data — in 30 days. You can cancel any time before then.
        </p>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete My Business
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {tenantName}?</DialogTitle>
            <DialogDescription>
              Every member, including you, loses access immediately. The business and all of its data — sales,
              products, stock — are permanently deleted in 30 days unless you cancel from the deactivated screen
              before then.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="confirm-tenant-name" className="text-xs">
              Type <strong>{tenantName}</strong> to confirm
            </Label>
            <Input
              id="confirm-tenant-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm} disabled={isPending || !matches}>
              {isPending ? "Submitting..." : "Delete My Business"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

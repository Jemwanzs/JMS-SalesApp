"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { selfDeleteAccountAction } from "@/features/settings/actions/self-delete-account";
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
 * Self-service account deletion (Google Play Account Deletion policy) --
 * for an invited employee only; a Tenant Administrator sees
 * RequestTenantDeletionCard instead (see security/page.tsx). "Type your
 * email to confirm" gates the button, same high-friction convention
 * tenant-actions-panel.tsx's DeleteConfirmForm already uses for
 * permanent, irreversible actions.
 */
export function SelfDeleteAccountCard({ tenantId, userEmail }: { tenantId: string; userEmail: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [isPending, startTransition] = useTransition();
  const matches = confirmEmail.trim().toLowerCase() === userEmail.trim().toLowerCase();

  function onConfirm() {
    startTransition(async () => {
      const result = await selfDeleteAccountAction(tenantId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.push("/login");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete My Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Removes your access to this business. Your recorded sales and activity history stay exactly as they are —
          only your login access is removed.
        </p>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete My Account
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              You will be signed out immediately and lose access to this business. Your past sales and activity
              stay attributed to you for the business&apos;s own records — this cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="confirm-email" className="text-xs">
              Type <strong>{userEmail}</strong> to confirm
            </Label>
            <Input
              id="confirm-email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm} disabled={isPending || !matches}>
              {isPending ? "Deleting..." : "Delete My Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

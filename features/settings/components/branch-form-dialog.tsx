"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createLocationAction, updateLocationAction } from "@/features/settings/actions/manage-locations";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LocationSummary } from "@/services/LocationService";

/**
 * Create/edit in one dialog -- `location` present means edit mode.
 * Same shape as RoleFormDialog (features/roles/components/
 * role-form-dialog.tsx): one dialog, one form, `location`'s presence
 * decides which server action fires on submit.
 */
export function BranchFormDialog({
  tenantId,
  tenantSlug,
  location,
  trigger,
  onSaved,
}: {
  tenantId: string;
  tenantSlug: string;
  location?: LocationSummary;
  trigger: React.ReactElement;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [code, setCode] = useState(location?.code ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = location
        ? await updateLocationAction(tenantId, tenantSlug, location.id, { name, address, code })
        : await createLocationAction(tenantId, tenantSlug, { name, address, code });

      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success(location ? "Branch updated" : "Branch created");
      setOpen(false);
      onSaved?.();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{location ? `Edit ${location.name}` : "New branch"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="branch-name">Name</Label>
            <Input id="branch-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branch-address">Address (optional)</Label>
            <Input id="branch-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branch-code">Code (optional)</Label>
            <Input id="branch-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? "Saving..." : location ? "Save changes" : "Create branch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

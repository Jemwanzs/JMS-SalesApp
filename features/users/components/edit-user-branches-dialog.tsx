"use client";

import { useState, useTransition } from "react";
import { Building2 } from "lucide-react";
import { toast } from "sonner";

import { setUserRoleAction } from "@/features/users/actions/set-user-role";
import { BranchAssignmentField } from "@/features/users/components/branch-assignment-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { LocationSummary } from "@/services/LocationService";
import type { TenantUserSummary } from "@/services/UserService";

/**
 * Multi-Branch User Access Phase 3 -- separate from the role Select
 * deliberately (not folded into the same row control): re-uses
 * setUserRoleAction (a full replace of this membership's
 * user_role_assignments rows), so it must always send the CURRENT
 * role alongside the NEW branch selection -- sending branches alone
 * would silently wipe the role too, since the action has no partial-
 * update mode (same "whole desired state, not a diff" contract
 * RoleService.setRolePermissions already uses).
 */
export function EditUserBranchesDialog({
  tenantId,
  tenantSlug,
  user,
  currentRoleId,
  locations,
  onSaved,
}: {
  tenantId: string;
  tenantSlug: string;
  user: TenantUserSummary;
  currentRoleId: string;
  locations: LocationSummary[];
  onSaved: (locationIds: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [locationIds, setLocationIds] = useState<string[] | null>(user.locationIds);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        await setUserRoleAction(tenantId, tenantSlug, user.membershipId, currentRoleId, locationIds ?? undefined);
        toast.success("Branches updated");
        setOpen(false);
        onSaved(locationIds);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update branches");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`Edit branches for ${user.fullName ?? user.email}`}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Building2 className="h-3.5 w-3.5" />
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Branches for {user.fullName?.trim() || user.email}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <BranchAssignmentField locations={locations} value={locationIds} onChange={setLocationIds} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

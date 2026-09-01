"use client";

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { inviteUserAction } from "@/features/users/actions/invite-user";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LocationSummary } from "@/services/LocationService";
import type { TenantUserSummary } from "@/services/UserService";

export function InviteUserDialog({
  tenantId,
  tenantSlug,
  roles,
  locations,
  onInvited,
}: {
  tenantId: string;
  tenantSlug: string;
  roles: { id: string; name: string }[];
  locations: LocationSummary[];
  onInvited: (user: TenantUserSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [locationIds, setLocationIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("email", email);
    formData.set("fullName", fullName);
    formData.set("roleId", roleId);
    for (const id of locationIds ?? []) {
      formData.append("locationIds", id);
    }

    startTransition(async () => {
      const result = await inviteUserAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Please check your entries");
        return;
      }
      if (result.success && result.membershipId) {
        toast.success("Invitation sent");
        setOpen(false);
        onInvited({
          membershipId: result.membershipId,
          profileId: "",
          fullName,
          email,
          status: "invited",
          isCurrentUser: false,
          roleNames: [roles.find((r) => r.id === roleId)?.name ?? ""],
          locationIds,
        });
        setEmail("");
        setFullName("");
        setRoleId("");
        setLocationIds(null);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="w-full">
            <UserPlus className="h-4 w-4" />
            Invite user
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="invite-name">Full name</Label>
            <Input id="invite-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select
              items={roles.map((role) => ({ value: role.id, label: role.name }))}
              value={roleId}
              onValueChange={(value) => setRoleId(value ?? "")}
            >
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {locations.length > 1 && (
            <BranchAssignmentField locations={locations} value={locationIds} onChange={setLocationIds} />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending || !roleId}>
              {isPending ? "Sending..." : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { EditUserBranchesDialog } from "@/features/users/components/edit-user-branches-dialog";
import { InviteUserDialog } from "@/features/users/components/invite-user-dialog";
import { resendInviteAction } from "@/features/users/actions/resend-invite";
import { setUserActiveAction } from "@/features/users/actions/set-user-active";
import { setUserRoleAction } from "@/features/users/actions/set-user-role";
import { updateUserNameAction } from "@/features/users/actions/update-user-name";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LocationSummary } from "@/services/LocationService";
import type { TenantUserSummary } from "@/services/UserService";

const STATUS_VARIANT: Record<TenantUserSummary["status"], "default" | "secondary" | "destructive"> = {
  active: "default",
  invited: "secondary",
  disabled: "destructive",
};

export function UserList({
  users,
  roles,
  locations,
  tenantId,
  tenantSlug,
  canCreate,
  canEdit,
}: {
  users: TenantUserSummary[];
  roles: { id: string; name: string }[];
  locations: LocationSummary[];
  tenantId: string;
  tenantSlug: string;
  canCreate: boolean;
  canEdit: boolean;
}) {
  const [items, setItems] = useState(users);
  const [isPending, startTransition] = useTransition();
  const [editingMembershipId, setEditingMembershipId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));

  function startEditingName(user: TenantUserSummary) {
    setEditingMembershipId(user.membershipId);
    setNameDraft(user.fullName ?? "");
  }

  function saveName(user: TenantUserSummary) {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      toast.error("Enter a name");
      return;
    }
    startTransition(async () => {
      try {
        await updateUserNameAction(tenantId, tenantSlug, user.profileId, trimmed);
        setItems((prev) =>
          prev.map((u) => (u.membershipId === user.membershipId ? { ...u, fullName: trimmed } : u))
        );
        setEditingMembershipId(null);
        toast.success("Name updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not update name");
      }
    });
  }

  function onInvited(user: TenantUserSummary) {
    setItems((prev) => [...prev, user]);
  }

  function onResendInvite(user: TenantUserSummary) {
    startTransition(async () => {
      const result = await resendInviteAction(tenantId, tenantSlug, user.membershipId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Invite resent to ${user.email}`);
    });
  }

  function onToggleActive(user: TenantUserSummary) {
    const nextActive = user.status !== "active";
    startTransition(async () => {
      try {
        await setUserActiveAction(tenantId, tenantSlug, user.membershipId, nextActive);
        setItems((prev) =>
          prev.map((u) =>
            u.membershipId === user.membershipId ? { ...u, status: nextActive ? "active" : "disabled" } : u
          )
        );
        toast.success(nextActive ? "User activated" : "User disabled");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not update user");
      }
    });
  }

  function onRoleChange(user: TenantUserSummary, roleId: string) {
    const roleName = roles.find((r) => r.id === roleId)?.name;
    if (!roleName) return;

    startTransition(async () => {
      try {
        // setUserRoleAction replaces the WHOLE assignment set -- pass
        // this person's current branch assignment through unchanged, or
        // a role-only edit would silently reset them to "all branches".
        await setUserRoleAction(tenantId, tenantSlug, user.membershipId, roleId, user.locationIds ?? undefined);
        setItems((prev) =>
          prev.map((u) => (u.membershipId === user.membershipId ? { ...u, roleNames: [roleName] } : u))
        );
        toast.success("Role updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not update role");
      }
    });
  }

  function onBranchesSaved(user: TenantUserSummary, locationIds: string[] | null) {
    setItems((prev) => prev.map((u) => (u.membershipId === user.membershipId ? { ...u, locationIds } : u)));
  }

  return (
    <div className="space-y-4">
      {canCreate && (
        <InviteUserDialog
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          roles={roles}
          locations={locations}
          onInvited={onInvited}
        />
      )}

      <div className="divide-y rounded-lg border">
        {items.map((user) => (
          <div key={user.membershipId} className="space-y-2 p-3">
            <div className="min-w-0">
              {editingMembershipId === user.membershipId ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    autoFocus
                    className="h-8"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName(user);
                      if (e.key === "Escape") setEditingMembershipId(null);
                    }}
                  />
                  <Button size="sm" disabled={isPending} onClick={() => saveName(user)}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => setEditingMembershipId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{user.fullName?.trim() || user.email}</p>
                  {user.isCurrentUser && <Badge variant="secondary">You</Badge>}
                  <Badge variant={STATUS_VARIANT[user.status]}>{user.status}</Badge>
                  {canEdit && !user.isCurrentUser && user.status !== "disabled" && (
                    <button
                      type="button"
                      aria-label="Edit name"
                      onClick={() => startEditingName(user)}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canEdit ? (
                <Select
                  items={roles.map((role) => ({ value: role.id, label: role.name }))}
                  value={roleIdByName.get(user.roleNames[0] ?? "") ?? ""}
                  onValueChange={(roleId) => roleId && onRoleChange(user, roleId)}
                  disabled={isPending}
                >
                  <SelectTrigger className="w-36 shrink-0">
                    <SelectValue placeholder="No role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="shrink-0 text-xs text-muted-foreground">{user.roleNames.join(", ") || "No role"}</p>
              )}

              {canEdit && locations.length > 1 && (
                <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <span>{user.locationIds === null ? "All branches" : `${user.locationIds.length} branch(es)`}</span>
                  <EditUserBranchesDialog
                    tenantId={tenantId}
                    tenantSlug={tenantSlug}
                    user={user}
                    currentRoleId={roleIdByName.get(user.roleNames[0] ?? "") ?? ""}
                    locations={locations}
                    onSaved={(locationIds) => onBranchesSaved(user, locationIds)}
                  />
                </div>
              )}

              {canCreate && user.status === "invited" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => onResendInvite(user)}
                >
                  Resend invite
                </Button>
              )}

              {canEdit && !user.isCurrentUser && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => onToggleActive(user)}
                >
                  {user.status === "active" ? "Disable" : "Activate"}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

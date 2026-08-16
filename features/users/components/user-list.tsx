"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { InviteUserDialog } from "@/features/users/components/invite-user-dialog";
import { setUserActiveAction } from "@/features/users/actions/set-user-active";
import { setUserRoleAction } from "@/features/users/actions/set-user-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TenantUserSummary } from "@/services/UserService";

const STATUS_VARIANT: Record<TenantUserSummary["status"], "default" | "secondary" | "destructive"> = {
  active: "default",
  invited: "secondary",
  disabled: "destructive",
};

export function UserList({
  users,
  roles,
  tenantId,
  tenantSlug,
  canCreate,
  canEdit,
}: {
  users: TenantUserSummary[];
  roles: { id: string; name: string }[];
  tenantId: string;
  tenantSlug: string;
  canCreate: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(users);
  const [isPending, startTransition] = useTransition();
  const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));

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
        await setUserRoleAction(tenantId, tenantSlug, user.membershipId, roleId);
        setItems((prev) =>
          prev.map((u) => (u.membershipId === user.membershipId ? { ...u, roleNames: [roleName] } : u))
        );
        toast.success("Role updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not update role");
      }
    });
  }

  return (
    <div className="space-y-4">
      {canCreate && (
        <InviteUserDialog tenantId={tenantId} tenantSlug={tenantSlug} roles={roles} onInvited={() => router.refresh()} />
      )}

      <div className="divide-y rounded-lg border">
        {items.map((user) => (
          <div key={user.membershipId} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">{user.fullName ?? user.email}</p>
                {user.isCurrentUser && <Badge variant="secondary">You</Badge>}
                <Badge variant={STATUS_VARIANT[user.status]}>{user.status}</Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>

            {canEdit ? (
              <Select
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
        ))}
      </div>
    </div>
  );
}

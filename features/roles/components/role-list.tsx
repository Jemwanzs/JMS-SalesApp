"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { deleteRoleAction } from "@/features/roles/actions/delete-role";
import { RoleFormDialog } from "@/features/roles/components/role-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PermissionCatalogItem } from "@/services/PermissionService";
import type { RoleSummary } from "@/services/RoleService";

export function RoleList({
  roles,
  catalog,
  tenantId,
  tenantSlug,
}: {
  roles: RoleSummary[];
  catalog: PermissionCatalogItem[];
  tenantId: string;
  tenantSlug: string;
}) {
  const [items, setItems] = useState(roles);
  const [isPending, startTransition] = useTransition();

  function onSaved(saved: RoleSummary, isNew: boolean) {
    setItems((prev) =>
      isNew ? [...prev, saved] : prev.map((r) => (r.id === saved.id ? saved : r))
    );
  }

  function onDelete(role: RoleSummary) {
    if (!window.confirm(`Delete "${role.name}"? This cannot be undone.`)) {
      return;
    }
    startTransition(async () => {
      try {
        await deleteRoleAction(tenantId, tenantSlug, role.id);
        setItems((prev) => prev.filter((r) => r.id !== role.id));
        toast.success("Role deleted");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not delete role");
      }
    });
  }

  return (
    <div className="space-y-4">
      <RoleFormDialog
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        catalog={catalog}
        onSaved={(saved) => onSaved(saved, true)}
        trigger={
          <Button className="w-full">
            <Plus className="h-4 w-4" />
            New role
          </Button>
        }
      />

      <div className="divide-y rounded-lg border">
        {items.map((role) => (
          <div key={role.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">{role.name}</p>
                {role.isSystemDefault && <Badge variant="secondary">Default</Badge>}
              </div>
              {role.description && (
                <p className="truncate text-xs text-muted-foreground">{role.description}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {role.permissionKeys.length} permission{role.permissionKeys.length === 1 ? "" : "s"} ·{" "}
                {role.assignedUserCount} user{role.assignedUserCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <RoleFormDialog
                tenantId={tenantId}
                tenantSlug={tenantSlug}
                catalog={catalog}
                role={role}
                onSaved={(saved) => onSaved(saved, false)}
                trigger={
                  <Button variant="outline" size="sm">
                    Edit
                  </Button>
                }
              />
              {!role.isSystemDefault && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => onDelete(role)}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

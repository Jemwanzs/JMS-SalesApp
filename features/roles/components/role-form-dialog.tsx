"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createRoleAction } from "@/features/roles/actions/create-role";
import { updateRoleAction } from "@/features/roles/actions/update-role";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PermissionCatalogItem } from "@/services/PermissionService";
import type { RoleDetail, RoleSummary } from "@/services/RoleService";

function groupByModule(catalog: PermissionCatalogItem[]) {
  const groups = new Map<string, PermissionCatalogItem[]>();
  for (const item of catalog) {
    groups.set(item.module, [...(groups.get(item.module) ?? []), item]);
  }
  return groups;
}

/**
 * Create/edit in one dialog -- `role` present means edit mode. Both
 * modes submit name/description/permissionKeys together (RoleService.
 * createRole already sets initial permissions in one call; updateRole +
 * setRolePermissions are called together server-side for edit).
 */
export function RoleFormDialog({
  tenantId,
  tenantSlug,
  catalog,
  role,
  trigger,
  onSaved,
}: {
  tenantId: string;
  tenantSlug: string;
  catalog: PermissionCatalogItem[];
  role?: RoleDetail & { assignedUserCount?: number };
  trigger: React.ReactElement;
  onSaved?: (role: RoleSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissionKeys ?? []));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const grouped = groupByModule(catalog);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("name", name);
    formData.set("description", description);
    for (const key of selected) {
      formData.append("permissionKeys", key);
    }
    if (role) {
      formData.set("roleId", role.id);
    }

    startTransition(async () => {
      const result = role
        ? await updateRoleAction(tenantId, tenantSlug, {}, formData)
        : await createRoleAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Please check your entries");
        return;
      }
      if (result.success) {
        toast.success(role ? "Role updated" : "Role created");
        setOpen(false);
        onSaved?.({
          id: role?.id ?? ("roleId" in result ? (result.roleId as string) : ""),
          name,
          description: description || null,
          isSystemDefault: role?.isSystemDefault ?? false,
          permissionKeys: [...selected],
          assignedUserCount: role?.assignedUserCount ?? 0,
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "New role"}</DialogTitle>
          <DialogDescription>
            Choose exactly which permissions this role grants — nothing is implied by a name.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-description">Description (optional)</Label>
            <Input
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <Label className="font-normal text-muted-foreground">Permissions</Label>
            {[...grouped.entries()].map(([module, items]) => (
              <div key={module} className="space-y-1.5 rounded-lg border p-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">{module}</p>
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 py-1">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{item.key}</p>
                      {item.description && (
                        <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                      )}
                    </div>
                    <Switch
                      checked={selected.has(item.key)}
                      onCheckedChange={() => toggle(item.key)}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : role ? "Save changes" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

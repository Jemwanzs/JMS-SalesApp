import { z } from "zod";

export const createRoleSchema = z.object({
  name: z.string().trim().min(1, "Role name is required").max(100),
  description: z.string().trim().max(500).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  roleId: z.uuid(),
  name: z.string().trim().min(1, "Role name is required").max(100),
  description: z.string().trim().max(500).optional(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const deleteRoleSchema = z.object({
  roleId: z.uuid(),
});

export type DeleteRoleInput = z.infer<typeof deleteRoleSchema>;

// permissionKeys arrives as repeated FormData entries (checkbox group),
// not a single field -- parsed as string[] directly by the caller, not
// through safeParse against a single FormData.get() the way the other
// fields here are.
export const setRolePermissionsSchema = z.object({
  roleId: z.uuid(),
  permissionKeys: z.array(z.string()),
});

export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;

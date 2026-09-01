import { z } from "zod";

export const inviteUserSchema = z.object({
  email: z.email("Enter a valid email"),
  fullName: z.string().trim().min(1, "Name is required"),
  roleId: z.uuid("Choose a role"),
  // Multi-Branch User Access Phase 3 -- omitted/empty means tenant-wide
  // (every current branch), same as before this existed.
  locationIds: z.array(z.uuid()).optional(),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const setUserActiveSchema = z.object({
  membershipId: z.uuid(),
  active: z.boolean(),
});

export type SetUserActiveInput = z.infer<typeof setUserActiveSchema>;

export const setUserRoleSchema = z.object({
  membershipId: z.uuid(),
  roleId: z.uuid("Choose a role"),
  locationIds: z.array(z.uuid()).optional(),
});

export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;

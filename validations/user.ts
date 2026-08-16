import { z } from "zod";

export const inviteUserSchema = z.object({
  email: z.email("Enter a valid email"),
  fullName: z.string().trim().min(1, "Name is required"),
  roleId: z.uuid("Choose a role"),
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
});

export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;

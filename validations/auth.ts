import { z } from "zod";

/**
 * Shared by React Hook Form resolvers (features/auth/components) and
 * server actions (features/auth/actions) -- one schema, so client and
 * server can never validate a payload differently. See
 * docs/16-api-services.md.
 */

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");

export const signUpSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required"),
    lastName: z.string().trim().min(1, "Last name is required"),
    businessName: z.string().trim().min(2, "Business name is required"),
    email: z.email("Enter a valid email address"),
    phone: z.string().trim().min(1, "Phone number is required"),
    country: z.string().trim().min(1, "Country is required"),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;

export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const requestPasswordResetSchema = z.object({
  email: z.email("Enter a valid email address"),
});

export type RequestPasswordResetInput = z.infer<
  typeof requestPasswordResetSchema
>;

export const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

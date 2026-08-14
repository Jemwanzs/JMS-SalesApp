"use server";

import { redirect } from "next/navigation";

import { AuthService } from "@/services/AuthService";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenantSlug } from "@/lib/tenant/resolve-active-tenant";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { loginSchema, type LoginInput } from "@/validations/auth";

export interface LoginActionState {
  error?: string;
  fieldErrors?: Partial<Record<keyof LoginInput, string>>;
}

export async function signInAction(
  _prevState: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof LoginInput>(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const authService = new AuthService(supabase);

  let userId: string;
  try {
    const result = await authService.signIn(parsed.data);
    userId = result.userId;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Sign in failed" };
  }

  const slug = await resolveActiveTenantSlug(supabase, userId);

  redirect(slug ? `/t/${slug}/sales` : "/no-tenant");
}

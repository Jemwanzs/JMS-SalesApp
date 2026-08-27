"use server";

import { redirect } from "next/navigation";

import { AuthService } from "@/services/AuthService";
import { TenantService } from "@/services/TenantService";
import { checkRateLimit, getClientIp, signUpRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { signUpSchema, type SignUpInput } from "@/validations/auth";

export interface SignUpActionState {
  error?: string;
  fieldErrors?: Partial<Record<keyof SignUpInput, string>>;
}

export async function signUpAction(
  _prevState: SignUpActionState,
  formData: FormData
): Promise<SignUpActionState> {
  const parsed = signUpSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    businessName: formData.get("businessName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    country: formData.get("country"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof SignUpInput>(parsed.error.issues),
    };
  }

  // Hardening roadmap Phase 4.3 (docs/22-hardening-roadmap.md) -- IP-based,
  // checked before any real work (Supabase Auth call, tenant bootstrap).
  const ip = await getClientIp();
  const { allowed } = await checkRateLimit(signUpRateLimit, ip);
  if (!allowed) {
    return { error: "Too many sign-up attempts. Please wait a while and try again." };
  }

  const input = parsed.data;
  const supabase = await createClient();
  const authService = new AuthService(supabase);

  let signUpResult;
  try {
    signUpResult = await authService.signUp({
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Sign up failed" };
  }

  // Bootstrap the tenant with the service-role client -- a brand-new
  // tenant has no role_permissions yet, so the RLS-respecting client
  // couldn't do this even with an active session. See the note atop
  // supabase/migrations/0001_core_tenancy_and_rbac.sql.
  const tenantService = new TenantService(createServiceRoleClient());

  let tenant;
  try {
    tenant = await tenantService.createTenant({
      name: input.businessName,
      country: input.country,
      ownerProfileId: signUpResult.userId,
    });
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `Account created, but business setup failed: ${err.message}. Contact support.`
          : "Account created, but business setup failed. Contact support.",
    };
  }

  if (signUpResult.emailConfirmationRequired) {
    redirect("/verify-email");
  }

  redirect(`/t/${tenant.slug}/onboarding`);
}

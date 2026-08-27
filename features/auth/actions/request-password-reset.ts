"use server";

import { AuthService } from "@/services/AuthService";
import { checkRateLimit, getClientIp, passwordResetRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import {
  requestPasswordResetSchema,
  type RequestPasswordResetInput,
} from "@/validations/auth";

export interface RequestPasswordResetActionState {
  fieldErrors?: Partial<Record<keyof RequestPasswordResetInput, string>>;
  error?: string;
  success?: boolean;
}

export async function requestPasswordResetAction(
  _prevState: RequestPasswordResetActionState,
  formData: FormData
): Promise<RequestPasswordResetActionState> {
  const parsed = requestPasswordResetSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof RequestPasswordResetInput>(
        parsed.error.issues
      ),
    };
  }

  // Hardening roadmap Phase 4.3 -- IP-based, not email-based (the point
  // is to stop a scripted sweep across many emails from one source; an
  // email-keyed limit wouldn't catch that at all). Checked before any
  // real work, same as sign-in's lockout check.
  const ip = await getClientIp();
  const { allowed } = await checkRateLimit(passwordResetRateLimit, ip);
  if (!allowed) {
    return { error: "Too many password reset requests. Please wait a while and try again." };
  }

  const supabase = await createClient();
  const authService = new AuthService(supabase);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    await authService.requestPasswordReset(
      parsed.data.email,
      `${appUrl}/api/auth/callback?next=/reset-password/confirm`
    );
  } catch {
    // Deliberately swallowed: always report success regardless of
    // whether the email is registered, to avoid account enumeration.
    // The real failure (if any) is on Supabase's side, not actionable
    // by the caller either way.
  }

  return { success: true };
}

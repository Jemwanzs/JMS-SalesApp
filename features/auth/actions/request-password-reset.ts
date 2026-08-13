"use server";

import { AuthService } from "@/services/AuthService";
import { createClient } from "@/lib/supabase/server";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import {
  requestPasswordResetSchema,
  type RequestPasswordResetInput,
} from "@/validations/auth";

export interface RequestPasswordResetActionState {
  fieldErrors?: Partial<Record<keyof RequestPasswordResetInput, string>>;
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

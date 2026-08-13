"use server";

import { redirect } from "next/navigation";

import { AuthService } from "@/services/AuthService";
import { createClient } from "@/lib/supabase/server";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import {
  updatePasswordSchema,
  type UpdatePasswordInput,
} from "@/validations/auth";

export interface UpdatePasswordActionState {
  error?: string;
  fieldErrors?: Partial<Record<keyof UpdatePasswordInput, string>>;
}

export async function updatePasswordAction(
  _prevState: UpdatePasswordActionState,
  formData: FormData
): Promise<UpdatePasswordActionState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof UpdatePasswordInput>(
        parsed.error.issues
      ),
    };
  }

  const supabase = await createClient();
  const authService = new AuthService(supabase);

  try {
    await authService.updatePassword(parsed.data.password);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not update password",
    };
  }

  redirect("/login");
}

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * AuthService — sign up/in/out, password reset. Wraps Supabase Auth on
 * the request-scoped, RLS-respecting client (lib/supabase/server.ts) so
 * session cookies are set correctly via @supabase/ssr — never construct
 * this with the service-role client for these methods.
 *
 * The composed "access gate" (working-hours + geo-fencing + tenant
 * suspension + edit-window evaluated together, see
 * docs/05-authentication-security.md) is a later Phase 4 addition, not
 * part of this file yet.
 */
export interface SignUpResult {
  userId: string;
  emailConfirmationRequired: boolean;
}

export class AuthService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async signUp(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone: string;
  }): Promise<SignUpResult> {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    const { data, error } = await this.supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: `${appUrl}/api/auth/callback?next=/login`,
        data: {
          full_name: `${input.firstName} ${input.lastName}`.trim(),
          first_name: input.firstName,
          last_name: input.lastName,
          phone: input.phone,
        },
      },
    });

    if (error || !data.user) {
      throw new Error(`AuthService.signUp: ${error?.message ?? "unknown error"}`);
    }

    // full_name and phone are captured from raw_user_meta_data by the
    // handle_new_auth_user trigger (supabase/migrations/0001 + 0003) as
    // part of the same transaction that creates the auth.users row --
    // deliberately not a separate update call here, since there's no
    // authenticated session yet when email confirmation is required (the
    // profiles_update_own RLS policy would silently block it).
    return {
      userId: data.user.id,
      emailConfirmationRequired: !data.session,
    };
  }

  async signIn(input: { email: string; password: string }) {
    const { data, error } = await this.supabase.auth.signInWithPassword(input);

    if (error || !data.user) {
      throw new Error(`AuthService.signIn: ${error?.message ?? "unknown error"}`);
    }

    return { userId: data.user.id };
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();

    if (error) {
      throw new Error(`AuthService.signOut: ${error.message}`);
    }
  }

  async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      throw new Error(`AuthService.requestPasswordReset: ${error.message}`);
    }
  }

  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await this.supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      throw new Error(`AuthService.updatePassword: ${error.message}`);
    }
  }

  async evaluateAccessGate(_input: { profileId: string; tenantId: string }) {
    throw new Error(
      "AuthService.evaluateAccessGate: not yet implemented (Phase 4)"
    );
  }
}

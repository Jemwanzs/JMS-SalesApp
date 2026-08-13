import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * AuthService — sign up/in/out, email verification, password reset, MFA
 * enrollment/challenge, and the composed "access gate" that evaluates
 * working-hours restriction + geo-fencing + tenant suspension + edit-window
 * rules together so a blocked user gets one prioritized, legible reason
 * instead of stacked/contradictory errors. See
 * docs/05-authentication-security.md.
 *
 * Not yet implemented — sign-up/login is Phase 1c; the composed access
 * gate is Phase 4.
 */
export class AuthService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async signUp(_input: { email: string; password: string; fullName: string }) {
    throw new Error("AuthService.signUp: not yet implemented (Phase 1c)");
  }

  async evaluateAccessGate(_input: { profileId: string; tenantId: string }) {
    throw new Error(
      "AuthService.evaluateAccessGate: not yet implemented (Phase 4)"
    );
  }
}

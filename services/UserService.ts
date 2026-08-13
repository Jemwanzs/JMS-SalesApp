import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * UserService — user invitations, activation, active/inactive toggle.
 * Administrators never see/retrieve a user's actual password — invite and
 * reset flows only ever produce a secure link. See
 * docs/05-authentication-security.md's password-visibility boundary.
 *
 * Not yet implemented — Phase 4b.
 */
export class UserService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async inviteUser(_input: {
    tenantId: string;
    email: string;
    fullName: string;
    roleId: string;
  }) {
    throw new Error("UserService.inviteUser: not yet implemented (Phase 4b)");
  }

  async setActive(_membershipId: string, _active: boolean) {
    throw new Error("UserService.setActive: not yet implemented (Phase 4b)");
  }
}

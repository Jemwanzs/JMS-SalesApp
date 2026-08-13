import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * SecurityService — sessions/devices, geo-fencing, working-hours
 * restriction, download-passcode gating, temporary access requests. Owns
 * (jointly with AuthService) the composed access-gate evaluation. See
 * docs/05-authentication-security.md.
 *
 * requestTemporaryAccess() is the Approval Engine's second consumer —
 * geo-fencing's "location unavailable" case auto-routes here rather than
 * silently allowing or hard-blocking (docs/19-security-checklist.md
 * decision #3).
 *
 * Not yet implemented — Phase 4c/4f/4g.
 */
export class SecurityService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async revokeSession(_sessionId: string) {
    throw new Error(
      "SecurityService.revokeSession: not yet implemented (Phase 4c)"
    );
  }

  async requestTemporaryAccess(_input: {
    tenantId: string;
    profileId: string;
    locationId: string;
    reason: string;
    requestedDurationMinutes: number;
  }) {
    throw new Error(
      "SecurityService.requestTemporaryAccess: not yet implemented (Phase 4f)"
    );
  }
}

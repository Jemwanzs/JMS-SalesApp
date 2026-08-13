import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * AuditService — writes to audit_logs. Called by every other service on
 * any sensitive mutation; never optional (see docs/05-authentication-security.md
 * and docs/19-security-checklist.md's non-negotiables).
 *
 * audit_logs has no UPDATE/DELETE RLS policy at all (see
 * supabase/migrations, Phase 1b+) — immutability is enforced by the
 * database, not by this service's discipline alone.
 *
 * Implemented alongside the first feature that needs it (Phase 1c auth
 * events). Not yet implemented.
 */
export interface AuditLogInput {
  tenantId: string | null;
  actorProfileId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  reason?: string | null;
  ipAddress?: string | null;
  device?: string | null;
  metadata?: Record<string, unknown> | null;
}

export class AuditService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async log(_input: AuditLogInput): Promise<void> {
    throw new Error("AuditService.log: not yet implemented (Phase 1c)");
  }
}

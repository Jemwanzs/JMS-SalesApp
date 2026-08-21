import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * AuditService — writes to audit_logs (Phase 4's full coverage pass,
 * docs/05-authentication-security.md's "Audit logging" section). Called
 * by every action listed there on its corresponding sensitive mutation
 * (LOGIN/LOGOUT/FAILED_LOGIN, SALE_CREATED/EDITED/VOIDED,
 * BUSINESS_DAY_OPENED/CLOSED/REOPENED, PRODUCT_CREATED/EDITED/DELETED,
 * USER_INVITED/DISABLED, ROLE_CHANGED, PERMISSION_CHANGED,
 * EXPORT_REQUESTED/COMPLETED, SECURITY_SETTING_CHANGED,
 * TEMPORARY_ACCESS_REQUESTED/APPROVED/REJECTED, SUBSCRIPTION_CHANGED
 * (wired from BillingService.handleChargeSuccess, Phase 6),
 * IMPERSONATION_STARTED/ENDED (wired from features/platform-admin/
 * actions/{start,end}-impersonation.ts, Phase 7b — actor is always the
 * real platform admin's own profile id, never the impersonated target's,
 * so the tenant's own audit trail stays honest about who actually acted),
 * SESSION_REVOKED (wired from features/security/actions/force-sign-out-
 * user.ts — the admin-driven, account-wide force sign-out; self-service
 * "sign out of other devices" isn't logged here, same as every other
 * purely self-scoped action in this app), TENANT_SETTING_CHANGED
 * (general business-configuration settings — sale_number_template,
 * anniversary_wish_mode — distinct from SECURITY_SETTING_CHANGED, which
 * docs/05 scopes specifically to 4e/4f/4g's security toggles; the audit
 * vocabulary is documented as "non-exhaustive," so this is an addition,
 * not a deviation), ACCESS_RESTRICTION_BYPASSED (wired from features/
 * auth/actions/sign-in.ts — a settings.manage holder's login overriding
 * a working-hours/geofence block that would otherwise have applied, see
 * AuthService.evaluateAccessGate's own header comment for why).
 *
 * Always constructed with the service-role client (added to
 * lib/supabase/service-role.ts's allowed-callers list) — audit_logs has
 * RLS enabled with zero write policies, same reasoning as login_events:
 * a FAILED_LOGIN attempt has no authenticated session for a self-scoped
 * insert policy to key off of, so every event type writes the same way
 * rather than switching client depending on which event it is. Every
 * caller treats a logging failure as best-effort (`.catch(() => {})`)
 * — an audit-log write must never block the real mutation it's
 * recording, same convention as SecurityService.logLoginEvent.
 *
 * audit_logs has no UPDATE/DELETE RLS policy at all (migration 0019) —
 * immutability is enforced by the database, not by this service's
 * discipline alone.
 */
export interface AuditLogInput {
  tenantId: string | null;
  actorProfileId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  reason?: string | null;
  ipAddress?: string | null;
  device?: string | null;
  metadata?: Record<string, unknown> | null;
}

export class AuditService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async log(input: AuditLogInput): Promise<void> {
    const { error } = await this.supabase.from("audit_logs").insert({
      tenant_id: input.tenantId,
      actor_profile_id: input.actorProfileId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      old_values: input.oldValues ?? null,
      new_values: input.newValues ?? null,
      reason: input.reason ?? null,
      ip: input.ipAddress ?? null,
      device: input.device ?? null,
      metadata: input.metadata ?? null,
    });

    if (error) {
      throw new Error(`AuditService.log: ${error.message}`);
    }
  }
}

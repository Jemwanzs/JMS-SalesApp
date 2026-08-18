import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * Service-role Supabase client — BYPASSES ROW LEVEL SECURITY ENTIRELY.
 *
 * The `server-only` import above makes it a build error to pull this file
 * into any client-bundled code path.
 *
 * Allowed callers, and ONLY these (see docs/02-system-architecture.md):
 *   - app/api/webhooks/paystack/route.ts (Paystack is the sole source of
 *     truth for subscription/payment state — see docs/14-billing-paystack.md)
 *   - app/api/cron/outbox/route.ts (draining the report_jobs/notifications
 *     outbox — see docs/09-business-day-engine.md)
 *   - PlatformAdminService (platform_admins/platform_audit_logs/
 *     impersonation_sessions are not reachable via normal RLS at all —
 *     see docs/15-super-admin.md)
 *   - ApprovalService's auto-approval writes and TenantService's onboarding
 *     bootstrap sequence (creating a tenant's first owner membership +
 *     default roles, before any role_permissions exist for that tenant to
 *     grant the creator anything — see the note atop
 *     supabase/migrations/0001_core_tenancy_and_rbac.sql)
 *   - UserService.inviteUser (looking up whether an email already has a
 *     profile crosses tenant boundaries, which profiles_select RLS
 *     deliberately blocks for an ordinary tenant admin's RLS-respecting
 *     client — see UserService's own header comment)
 *   - SecurityService's writes (logLoginEvent/createSession/
 *     revokeOtherSessions) — login_events/sessions have RLS enabled with
 *     zero write policies (a FAILED login attempt has no authenticated
 *     session for a self-scoped insert policy to key off of) — see
 *     SecurityService's own header comment
 *   - AuditService.log — audit_logs has RLS enabled with zero write
 *     policies, same reasoning as login_events (FAILED_LOGIN in
 *     particular has no session to key a self-scoped policy off of) —
 *     see AuditService's own header comment
 *   - ImportService — confirming an import writes across import_rows +
 *     business_days + sales as one consistent bulk operation, and a
 *     historical business day is correctly 'closed' (never 'open'),
 *     which the live-capture-shaped business_day.open/sales.create RLS
 *     policies would otherwise reject — see ImportService's own header
 *     comment and migration 0020
 *
 * Every other read/write MUST go through lib/supabase/server.ts so RLS
 * stays the enforced boundary. Reaching for this file because "it's
 * easier" is exactly the mistake docs/04-multi-tenancy.md warns about.
 */
export function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

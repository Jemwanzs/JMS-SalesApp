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

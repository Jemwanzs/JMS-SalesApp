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
 *   - BillingService (subscriptions/payments/billing_events have RLS
 *     enabled with zero write policies — the webhook route
 *     (app/api/webhooks/paystack/route.ts) is the sole state-transition
 *     authority per docs/14-billing-paystack.md, and even the initial
 *     TRIAL row is created inside TenantService.createTenant's own
 *     bootstrap sequence, not a client-authenticated insert. Also marks
 *     a tenant_credits row 'applied' when a Super Admin-granted credit
 *     is redeemed at checkout — tenant_credits has RLS with a SELECT
 *     policy only, migration 0031, same reasoning as payments/
 *     subscriptions themselves)
 *   - app/api/cron/outbox/route.ts (draining the report_jobs/notifications
 *     outbox — see docs/09-business-day-engine.md)
 *   - PlatformAdminService (platform_admins/platform_audit_logs/
 *     impersonation_sessions/tenant_credits grants are not reachable via
 *     normal RLS at all — see docs/15-super-admin.md)
 *   - ApprovalService's auto-approval writes and TenantService's onboarding
 *     bootstrap sequence (creating a tenant's first owner membership +
 *     default roles, before any role_permissions exist for that tenant to
 *     grant the creator anything — see the note atop
 *     supabase/migrations/0001_core_tenancy_and_rbac.sql)
 *   - UserService.inviteUser (looking up whether an email already has a
 *     profile crosses tenant boundaries, which profiles_select RLS
 *     deliberately blocks for an ordinary tenant admin's RLS-respecting
 *     client — see UserService's own header comment)
 *   - UserService.resendInvite (features/users/actions/resend-invite.ts) —
 *     same Admin API reasoning as inviteUser above (auth.admin.inviteUserByEmail
 *     is unreachable from the RLS-respecting client regardless of
 *     permissions); the caller's own session is checked first via
 *     assertCan("users.create") before this ever runs
 *   - UserService.acceptInvite / getPendingInvite (a newly-invited user
 *     holds no role/permission on themselves yet — same class of
 *     bootstrapping problem as TenantService's onboarding sequence and
 *     ApprovalService's auto-approval writes. getPendingInvite also
 *     needs it for reads alone: tenants_select/roles_select/
 *     user_role_assignments_select all gate on is_tenant_member, which
 *     requires an ACTIVE membership — an invited user can see their own
 *     tenant_memberships row via profile_id = auth.uid(), but not the
 *     tenant's name or their assigned role's name, until after they
 *     accept — see UserService's own header comment)
 *   - SecurityService's writes (logLoginEvent/createSession/
 *     revokeOtherSessions) — login_events/sessions have RLS enabled with
 *     zero write policies (a FAILED login attempt has no authenticated
 *     session for a self-scoped insert policy to key off of) — see
 *     SecurityService's own header comment
 *   - AuditService.log — audit_logs has RLS enabled with zero write
 *     policies, same reasoning as login_events (FAILED_LOGIN in
 *     particular has no session to key a self-scoped policy off of) —
 *     see AuditService's own header comment
 *   - AnniversaryService's writes (ensureScheduledForUpcoming/
 *     sendDueAutomaticWishes, called from the daily cron sweep across
 *     every tenant at once, and sendWish/skipWish, a platform-admin
 *     action on another tenant's data) — anniversary_wishes has RLS
 *     enabled with a SELECT policy but zero write policies (migration
 *     0025), same reasoning as report_jobs/insights_snapshots. Reads
 *     (getWishMode/listUpcoming) and the tenant's own settings.manage
 *     -gated setWishMode call go through the ordinary RLS-respecting
 *     client instead — see AnniversaryService's own header comment
 *   - features/sales/actions/get-daily-sales-report.ts (Product
 *     Enhancements #7's Daily Report/poster) — a business-wide summary
 *     ("Business/Tenant Name", "Tenant Admin Email"), not a personal
 *     one, so it must include every sale for the day regardless of
 *     whether the caller holds sales.view_all or only sales.view_own;
 *     gated by an explicit reports.view assertCan() check first
 *   - ImportService — confirming a sales_history import writes across
 *     import_rows + business_days + sales as one consistent bulk
 *     operation, and a historical business day is correctly 'closed'
 *     (never 'open'), which the live-capture-shaped business_day.open/
 *     sales.create RLS policies would otherwise reject; confirming a
 *     products import writes import_rows + products directly for the
 *     same "one bulk actor, not a per-row authenticated write" reason —
 *     see ImportService's own header comment and migration 0020
 *   - ProductService.enableTrackingForExistingProducts (called from
 *     features/settings/actions/set-inventory-enabled.ts when the
 *     Inventory module is switched on) — a system-triggered bulk
 *     consequence of enabling the module (flipping tracks_inventory on
 *     every existing product so none stay permanently invisible on the
 *     Stock page), not a user-initiated per-product edit, so it
 *     shouldn't depend on the caller also holding products.edit on top
 *     of the settings.manage the surrounding action already requires
 *   - features/auth/actions/sign-in.ts / select-branch.ts / sign-out.ts —
 *     writing and deleting active_branch_sessions rows (Multi-Branch
 *     User Access Phase 4). active_branch_sessions has RLS enabled with
 *     a SELECT-only policy (migration 0050, same reasoning as sessions/
 *     login_events above) — the row itself is what tells every other
 *     table's location-scoped RLS policy which branch this session is
 *     in, so it can't be gated behind that same lookup without a
 *     circular dependency
 *   - lib/supabase/middleware.ts — the 12-hour session-age cap (Smart
 *     Auto-Login & 12-Hour Session) reads/revokes the requester's own
 *     `sessions` row on every request; same RLS reasoning as every other
 *     sessions/login_events write above, and this is the one place that
 *     already runs before any RLS-respecting client exists for the
 *     request at all
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

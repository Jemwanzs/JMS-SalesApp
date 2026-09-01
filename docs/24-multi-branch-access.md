# 24 — Multi-Branch User Access

## What this is

A tenant can operate more than one physical branch (`locations`), assign each team member to one, several, or all of its branches, and every login pins that session to exactly one branch — sales, business days, stock, reports, and analytics are all scoped to it. Switching branches requires logging out and back in; there is deliberately no in-app switcher. Shipped as six sequential phases, each independently verified live before the next began.

The schema had substantial latent support for this from day one (`locations`, `location_id` on `sales`/`business_days`, a nullable `user_role_assignments.location_id` designed for exactly this — see `04-multi-tenancy.md`'s tenant hierarchy). This feature wired the application and RLS layers up to actually use it; single-branch tenants (the common case) see zero behavioral change anywhere.

## Phase 1 — One tenant per profile

`tenant_memberships` gained `unique (profile_id)` (migration `0049`) — a profile can hold at most one membership row, active or otherwise, at any time. This **supersedes** the M:N membership model `04-multi-tenancy.md` originally described; removing a membership (row deleted) frees that email to join elsewhere later, but two simultaneous active memberships are now impossible at the database level, not just discouraged at the app layer. `UserService.inviteUser` checks across **all** tenants for the invitee's profile (service-role — crosses a boundary `profiles_select` RLS otherwise blocks) before inviting, returning a distinct error for "already in another business" vs. "already in this one."

## Phase 2 — Branch management

`LocationService` (`listLocations`/`createLocation`/`updateLocation`/`deactivateLocation`/`reactivateLocation`) plus the Branches card under Settings. Deactivation only — a branch is never hard-deleted, matching this app's general stance on destructive operations. A tenant's first branch still comes from onboarding's `TenantService.upsertPrimaryLocation` (single-location assumption, unchanged); this UI is for the second branch onward.

## Phase 3 — Assigning users to branches

Reuses `user_role_assignments.location_id` exactly as it was designed: one row per assigned branch (same `role_id`, same `tenant_membership_id`) instead of the previous single tenant-wide row. `location_id = null` means "every branch the tenant currently has" — the convention every pre-existing user already satisfies, and one that auto-expands as new branches are added rather than freezing a snapshot at assignment time. `UserService.inviteUser`/`setUserRole` both take an optional `locationIds?: string[]`; `lib/tenant/resolve-user-branches.ts`'s `resolveUserBranches()` is the single place this convention is read back.

## Phase 4 — Active branch per session

`active_branch_sessions` (migration `0050`) ties one row to one Supabase Auth session (keyed by `session_id`, the same required JWT claim every session already carries — not this app's own separate `sessions` table used for "sign out of other devices"). Chosen over a Supabase Auth Hook / custom JWT claim specifically so it works on any Supabase plan with no unverified platform dependency, and it naturally satisfies "must log out to switch": a fresh login gets a fresh `session_id`, so there is no live mechanism to repoint an existing token to a different branch.

- `signInAction` resolves the signed-in user's branches after password auth succeeds. Exactly one → writes the row automatically and continues straight into the tenant (unchanged from before this feature for every single-branch tenant). Two or more → redirects to `/select-branch`.
- `/select-branch` (`app/(auth)/select-branch/`) re-resolves the user's branches server-side (never trusts a client-submitted `locationId`), lists only those, and on submit upserts the row and redirects into the tenant.
- Logout (`sign-out.ts`) deletes the row for that session — hygiene, not a security requirement, since a logged-out `session_id` is already unreachable via `current_active_location()` (Phase 5) the instant the session itself is invalidated.

## Phase 5 — Enforcing it at the database level

`current_active_location(p_tenant_id uuid)` (migration `0050`, a `SECURITY DEFINER` SQL function reading `auth.jwt() ->> 'session_id'`) is called from every location-scoped RLS policy (migration `0051`):

| Table | `location_id` | Enforcement |
|---|---|---|
| `sales` | `not null` | `location_id = current_active_location(tenant_id)` on select and insert |
| `business_days` | `not null` | same, on select and the combined write policy |
| `stock_movements` | nullable | `location_id is null or location_id = current_active_location(...)` — see note below |
| `stock_reconciliations` | nullable | same pattern, select only (writes go through the existing `record_stock_reconciliation` `SECURITY DEFINER` function, `21-inventory-management.md`) |
| `reports` | nullable | same pattern, select only (writes are service-role, the cron outbox) |

**Why the three nullable tables use `is null or ...` instead of strict equality**: every existing row in those tables has `location_id = null` today — there is no per-location stock/report workflow yet (`21-inventory-management.md`'s own note on this). A strict equality clause would have silently hidden every pre-existing row from every branch the moment this migration ran. The permissive form is a no-op today and starts enforcing automatically the moment a future feature actually populates `location_id` on those tables, with no second migration required.

**Impersonation carve-out**: every clause above is additionally wrapped `impersonated_profile_id(tenant_id) is not null or ...`. Support's Access Workspace (`15-super-admin.md`) has no real `tenant_memberships`/branch assignment in the tenant it's viewing, so it can never have an `active_branch_sessions` row there — without this, an impersonating admin would see zero rows everywhere. This is the same "must still work on a deactivated tenant" exception `app/(tenant)/t/[tenantSlug]/layout.tsx` already makes elsewhere, extended to branch scoping. `sales/page.tsx` mirrors this at the app layer: if `resolveActiveLocationId` finds nothing and the session is impersonating, it falls back to the tenant's first location (the pre-Phase-5 resolution) rather than forcing Support through a branch picker it has no assignment to answer.

`AnalyticsService`/the leaderboard and `ReportService.listReports` needed **no code changes** to become branch-scoped — both already query through the RLS-respecting client filtered only by `tenant_id`, so the RLS policy change alone narrows their results to the active branch.

## Stale-session self-heal

A session that authenticated **before** this feature shipped has no `active_branch_sessions` row and never will until it re-authenticates — `current_active_location()` returns null for it, and `location_id = null` is never true in SQL, so every location-scoped query returns zero rows. `app/(tenant)/t/[tenantSlug]/layout.tsx` checks for this on every request (real members only, skipped while the tenant has no location at all yet i.e. onboarding pending, skipped for impersonation) and redirects through `/select-branch` to resolve and write the missing row before continuing — covering every route under the tenant, not only `/sales`. This was found to be a live gap (not just a theoretical one) shortly after Phase 5 shipped: a real tenant's `active_branch_sessions` table was empty because its members' sessions predated the deploy, which would have shown empty Analytics/Sales History/Reports pages until this layout-level check was added.

## Known scope boundaries (deliberate, not oversights)

- **Products stay tenant-wide**, never per-branch — a confirmed product decision, not a gap.
- **Users/Roles pages stay tenant-wide** — an admin manages the whole team from one screen regardless of which branch they're currently working from.
- **`AuthService.evaluateAccessGate`** (working-hours/geofence login restriction) still resolves the tenant's first location, unchanged. It runs *before* branch selection in the login flow — there is no active branch yet to key off, and geofencing by whichever branch a not-yet-authenticated user happens to be physically near is a materially different feature nobody asked for. Revisit only if a real multi-branch tenant actually needs per-branch geofencing.
- **`TenantService.upsertPrimaryLocation`/`setLocationGeofence`/`getPrimaryLocation`** (business-hours and geofence *settings*, as opposed to data access) still resolve "the tenant's first location" — per-branch hours/geofence configuration is a real potential feature but was not part of this scope and would need its own settings UI.
- **`ImportService`'s bulk sales-history import** defaults an unspecified row's location to the tenant's first location — a reasonable fallback for a batch job with no live session to key off, not a live per-request resolution gap.

## See also

- `04-multi-tenancy.md` — the underlying tenant/location hierarchy this feature builds on.
- `06-roles-permissions.md` — `user_role_assignments.location_id` and the permission catalog.
- `15-super-admin.md` — Access Workspace impersonation, the carve-out this feature had to account for.

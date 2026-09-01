# 04 — Multi-Tenancy

## Membership model

```
auth.users --1:1--> profiles --M:N--> tenant_memberships --M:1--> tenants
```

A `profile` is a person, independent of any business. A `tenant_membership` row is what makes them a member of a specific tenant, with a `status` (active/invited/disabled).

**One tenant at a time, enforced at the database level.** `tenant_memberships` carries `unique (profile_id)` (migration `0049`, Multi-Branch User Access Phase 1, `24-multi-branch-access.md`) — a profile can hold at most one membership row (any status) at once. This superseded an earlier many-to-many design (spec §104's "an accountant working across two shops"); removing a membership frees the email to join elsewhere later, but two *simultaneous* active memberships are no longer possible. A Platform Super Admin who is *also* a tenant owner of their own demo business is unaffected — platform admin status is a separate table (`platform_admins`), not a membership.

## Row Level Security strategy

Every tenant-owned table carries `tenant_id`. RLS is enabled on all of them. But **no policy queries membership/role tables inline** — that recurses when the policy lives on `tenant_memberships` itself, and even where it doesn't recurse, joining through 3–4 tables per row under RLS's row-by-row evaluation model is a real performance problem at scale.

Instead, two `SECURITY DEFINER` Postgres functions are the single point of truth, called by every policy:

```sql
is_tenant_member(tenant_id uuid) returns boolean
has_permission(tenant_id uuid, permission_key text, location_id uuid default null) returns boolean
```

Both are:
- Owned by a locked-down role, with `SET search_path = public, pg_temp` pinned explicitly. **This is mandatory** — an unpinned `search_path` in a `SECURITY DEFINER` function is a known Postgres privilege-escalation vector (a malicious search_path could shadow a table/function the definer-context function relies on).
- `REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO authenticated` — not callable by the `anon` role.
- The **only** place the membership → role → permission join logic exists in the entire system. RLS policies call them; the TypeScript `can()` helper (`lib/permissions/can.ts`) calls the same underlying RPC rather than reimplementing the join — see `06-roles-permissions.md`.

`has_permission()` also folds in `tenants.status`, so a suspended tenant's write-type permissions resolve false centrally, instead of every feature needing its own bolted-on suspension check.

## The rule RLS does not enforce

RLS proves **"can this authenticated user access rows belonging to tenant X"**. It does not know or care which tenant is "active" in a given request — that's an application concept, not a database one. A user who belongs to Tenant A and Tenant B, querying without an explicit filter, would see rows from *both* under RLS alone (RLS is a ceiling, not a substitute for correct query scoping).

**Mandatory rule**: every `services/*` method that reads or writes tenant data must explicitly filter/parameterize by the caller's currently-selected `tenant_id` — sourced from the resolved request context (see `02-system-architecture.md`), never inferred. This is checked in code review and covered by the tenant-isolation test suite (`18-testing-qa.md`), not assumed.

## Tenant hierarchy

```
PLATFORM
  -> TENANT / BUSINESS
       -> LOCATIONS
            -> USERS (via tenant_memberships)
                 -> ROLES
                      -> PERMISSIONS
```

Multi-location support exists in the data model from day one (`locations`, `location_hours`, `special_hours`, and `location_id` on `products`, `business_days`, `sales`, `user_role_assignments`) and, as of Multi-Branch User Access (`24-multi-branch-access.md`), is fully wired up: a tenant can operate several branches, assign users to specific ones, and every login session is pinned to exactly one branch at the RLS level, not just the UI. A tenant that never adds a second branch sees no behavioral change — the original single-location-per-tenant experience still holds for it.

## Tenant status & suspension

`tenants.status`: `active` | `suspended` | `cancelled`. On suspension (billing-driven, see `14-billing-paystack.md`):

- **Disabled**: new sales, edits, exports, user administration (enforced via `has_permission`).
- **Preserved**: billing owner login, billing screen, historical data (read), payment ability.

Never delete tenant data because of a billing lapse.

## Configuration cascade

Every tenant-configurable setting resolves through:

```
System Default -> Tenant Override -> Location Override -> User Preference
```

Implemented by `lib/config-cascade/resolveSetting(tenantId, locationId, userId, key)`, backed by `tenant_settings` (and a future `user_settings`/`location_settings` extension if a setting needs finer granularity than the tenant level). The closest valid configuration wins — e.g. tenant default language `Kiswahili`, one user overrides to `French`; that user sees French, nobody else is affected (spec §62, §154).

## Cross-tenant isolation is the top test priority

> **Tenant A must never read, modify, export, or infer Tenant B's information.**

This is proven with pgTAP tests directly against RLS policies (not just through the app layer) using two seeded test tenants (`Tenant Alpha`, `Tenant Beta`), required to pass before any feature building on top of Phase 1b's schema is considered safe to build further. See `18-testing-qa.md`.

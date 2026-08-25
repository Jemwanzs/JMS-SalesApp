# 06 — Roles & Permissions

## Model: RBAC + fine-grained permission strings

Code never asks "is this user an Admin?" — it asks "does this user have `sales.void`?". Every sensitive feature answers: **WHO? WHAT? WHICH TENANT? WHICH LOCATION? WHICH RECORD? WHAT ACTION? UNDER WHAT CONDITIONS?** before allowing access (spec §155) — more robust than hiding a screen.

## Permission catalog (seed data, `supabase/seeds/`)

```
sales.create  sales.view_own  sales.view_all  sales.edit_window
sales.correct_historical  sales.void

analytics.view_own  analytics.view_all  analytics.past_dates
analytics.date_range  analytics.all_users  analytics.products  analytics.locations

products.view  products.create  products.edit  products.archive

reports.view  reports.export

business_day.open  business_day.close  business_day.reopen

users.create  users.edit  users.disable

roles.manage
security.manage
settings.manage
billing.view  billing.manage

inventory.view  inventory.manage
stock.movement.record  stock.reconcile
```

The `inventory.*`/`stock.*` group (migration `0035`) only means anything for a tenant with the Inventory add-on enabled (`21-inventory-management.md`) — holding the permission with the module off just means nothing to gate yet, the same as any permission for a feature the tenant hasn't turned on.

Permission actions in general: `VIEW, CREATE, EDIT, VOID, APPROVE, EXPORT, MANAGE, REOPEN`. Deletion of critical financial records is not a permission that exists — see `08-sales-engine.md` for VOID/CORRECT/REVERSE instead.

## Roles are per-tenant rows, not shared templates

`roles` has `tenant_id`. At tenant creation, three system-default roles are **seeded as that tenant's own rows** (not references to a global template):

- **Sales User** — `sales.create`, `sales.view_own`, `analytics.view_own`. No products/users/settings/billing/security/business-wide analytics/exports/inventory — keeping Sales simple is a repeated explicit principle (`00-project-overview.md`), so a Sales User gets nothing from the `inventory.*`/`stock.*` group either, even after the add-on is enabled.
- **Supervisor** — Sales User's grants + `sales.view_all` (team scope via location), `analytics.products`, `reports.view`, limited correction rights, `inventory.view` (read-only stock visibility).
- **Tenant Administrator** — full grant set: settings, users, roles, products, analytics, reports, security, business-day management, billing, and the full `inventory.*`/`stock.*` group.

Because each tenant owns its own role rows, a tenant can freely edit "Supervisor"'s grants without affecting any other tenant, and can create fully custom roles (Cashier, Sales Agent, Auditor, Finance Manager, Operations Manager, Owner, etc. — spec §59) with individually chosen permissions.

### Adding a permission key after tenants already exist

`RoleService.seedDefaultRoles()` only runs once, at tenant creation — it computes "Tenant Administrator = every permission in the catalog" from whatever's in `permissions` **at that moment**. A migration that adds a new key (as `inventory.*`/`stock.*` did) reaches every *future* tenant automatically for free, but reaches **zero** pre-existing tenants unless the same migration explicitly backfills `role_permissions` for the relevant system-default roles. No migration before `0035` had ever needed to do this; it's now the established pattern for any future permission addition that existing tenants should get immediately rather than only on next role edit.

## Location-scoped assignments

`user_role_assignments.location_id` is nullable — a role assignment can be scoped to one location or left tenant-wide. This is what "View Team Sales" means for a Supervisor at one branch of a multi-location tenant.

## The billing-owner exception

`tenants.billing_owner_profile_id` is a dedicated FK column, deliberately **not** modeled as a permission grant. Billing/legal accountability for a tenant is a 1:1 organizational fact, not a role — trying to express "the owner" purely through RBAC would conflict with the "fully custom roles" design. This resolves the apparent tension between "no hardcoded roles" and the spec's references to a fixed accountable owner.

## `can()` — the app-layer entry point

`lib/permissions/can.ts` exposes:

```ts
can(ctx, permission: string, opts?: { tenantId?, locationId?, resourceOwnerId? }): Promise<boolean>
```

It **never reimplements** the membership → role → permission join. It either reads from the request-scoped permission-set cache (below) or calls the same `has_permission` RPC that RLS policies call (`04-multi-tenancy.md`). This guarantees RLS and app-layer authorization cannot drift apart — there is exactly one place the join logic lives, in SQL.

Two SQL functions back everything:
- `has_permission(tenant_id, permission_key, location_id default null)` — used directly inside RLS policies.
- `get_my_permissions(tenant_id)` — returns the caller's resolved permission-key array for a tenant; called once per request via RPC.

## Caching & invalidation

- **Request-scoped**: `get_my_permissions(tenantId)` wrapped in React's `cache()` — one DB round trip per request no matter how many `can()` checks occur.
- **Cross-request**: active `tenant_id` + resolved role IDs embedded as custom claims in the Supabase JWT via an Auth Hook at token-mint time, so common-case checks avoid a DB round trip entirely.
- **Invalidation**: a `permissions_version` counter (per tenant or per membership) bumped on any role/permission/assignment mutation, included in cache keys and forcing a token refresh — so a revoked grant can't linger past the mutation that revoked it.

## `sales.view_own` vs `sales.view_all`

A Sales User by default only ever sees `My Sales Today` — their own activity. `sales.view_all` is a *separate* permission that unlocks `Business Sales Today` without granting any administrative rights (spec §31–32). This separation — visibility vs. administration — repeats across `analytics.view_own`/`view_all` and the location/date-range dimensions in `analytics.*`.

## Analytics permission dimensions

`analytics.today` (implicit with `view_own`), `analytics.past_dates`, `analytics.date_range`, `analytics.all_users`, `analytics.products`, `analytics.locations` are independent grants — a role can see today's own sales without ever being able to pull a historical date range, and vice versa. The date-range permission check happens at the query-parameter level in `AnalyticsService` (RLS can't cleanly express "this permission only applies to date ranges the caller supplies") — see `11-analytics-reports.md`.

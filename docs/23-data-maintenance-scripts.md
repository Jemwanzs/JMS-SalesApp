# 23. Data Maintenance Scripts

Operational, one-off SQL scripts for Supabase Studio's SQL Editor — not schema
changes, so they deliberately do **not** live in `supabase/migrations/`. Run
manually, by hand, when actually needed; nothing here is scheduled or
automatic.

---

## Wipe all tenant business data (keep the platform owner's tenant, accounts, and billing)

**What this does:** deletes sales, products, business days, stock movements
and reconciliations, reports, insights, approval requests, and imports for
**every tenant except the platform owner's own tenant** — resolved via real
`platform_admins` membership (never a hardcoded email, same pattern
`BillingService.resolveAddonTrialDays` and migration `0044`'s sweep
exclusion both use). Everything else is left completely untouched:

- **Tenants themselves** — every tenant row survives; only its data is cleared.
- **User accounts** — `profiles`/`auth.users`, so everyone can still sign in.
- **Roles & permissions** — `roles`, `role_permissions`, `user_role_assignments`.
- **Business setup** — `locations`, `location_hours`, `special_hours`, `tenant_settings`.
- **Billing/subscriptions** — `subscriptions`, `tenant_addon_subscriptions`,
  `payments`, `billing_events`, `tenant_credits`. A tenant's plan/trial
  status is unaffected by this wipe.

**When to use it:** clearing out test/demo tenant data (sales, catalogs,
stock history) for a fresh start, without disturbing real sign-in accounts
or anyone's billing state.

**Origin:** written 2026-08-31, in response to a request to clear all
recorded sales/products/inventory data across tenants ahead of a clean
start, while explicitly keeping the platform owner's own tenant and every
tenant's login accounts and billing intact.

### Step 1 — preview (read-only, changes nothing)

Run this first. It reports row counts per table for every tenant that
would be affected, plus a sanity-check count of how many tenants are
currently protected (normally `1` — your own).

```sql
with protected_tenants as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
select 'sales' as table_name, count(*) from public.sales where tenant_id not in (select id from protected_tenants)
union all select 'sale_corrections', count(*) from public.sale_corrections where tenant_id not in (select id from protected_tenants)
union all select 'products', count(*) from public.products where tenant_id not in (select id from protected_tenants)
union all select 'business_days', count(*) from public.business_days where tenant_id not in (select id from protected_tenants)
union all select 'stock_movements', count(*) from public.stock_movements where tenant_id not in (select id from protected_tenants)
union all select 'stock_reconciliations', count(*) from public.stock_reconciliations where tenant_id not in (select id from protected_tenants)
union all select 'reports', count(*) from public.reports where tenant_id not in (select id from protected_tenants)
union all select 'report_jobs', count(*) from public.report_jobs where tenant_id not in (select id from protected_tenants)
union all select 'insights_snapshots', count(*) from public.insights_snapshots where tenant_id not in (select id from protected_tenants)
union all select 'approval_requests', count(*) from public.approval_requests where tenant_id not in (select id from protected_tenants)
union all select 'imports', count(*) from public.imports where tenant_id not in (select id from protected_tenants)
union all select '— protected tenant(s) —', count(*) from protected_tenants;
```

The last row should read `1` (or however many tenants a real platform admin
personally owns) — confirm that before going further. If it reads `0`,
**stop** — the protection query found no protected tenant, which almost
certainly means the wipe below would touch every tenant with nothing
excluded.

### Step 2 — the actual wipe

Wrapped in a single transaction, in the specific order these foreign keys
require (verified against the actual schema, not assumed): `sale_corrections`
must be deleted before `sales` (its `sale_id` FK has no cascade), and
`stock_movements`/`stock_reconciliations` must be deleted before `products`
(same reason — a sold/stocked product can't silently vanish out from under
its own history by design). `import_rows` and `product_images` aren't listed
separately because both already cascade automatically (`on delete cascade`)
from `imports`/`products` respectively.

```sql
begin;

with protected_tenants as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.sale_corrections where tenant_id not in (select id from protected_tenants);

with protected_tenants as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.approval_requests where tenant_id not in (select id from protected_tenants);

with protected_tenants as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.insights_snapshots where tenant_id not in (select id from protected_tenants);

with protected_tenants as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.report_jobs where tenant_id not in (select id from protected_tenants);

with protected_tenants as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.reports where tenant_id not in (select id from protected_tenants);

with protected_tenants as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.stock_reconciliations where tenant_id not in (select id from protected_tenants);

with protected_tenants as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.stock_movements where tenant_id not in (select id from protected_tenants);

with protected_tenants as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.sales where tenant_id not in (select id from protected_tenants);

with protected_tenants as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.business_days where tenant_id not in (select id from protected_tenants);

with protected_tenants as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.imports where tenant_id not in (select id from protected_tenants);
-- import_rows cascades automatically from imports (on delete cascade) -- no separate delete needed.

with protected_tenants as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.products where tenant_id not in (select id from protected_tenants);
-- product_images cascades automatically from products (on delete cascade).

-- Review the output above (each DELETE reports how many rows it removed).
-- If everything looks right:
commit;
-- If anything looks wrong, run this instead of the commit above:
-- rollback;
```

### Notes

- **If a "violates foreign key constraint" error appears mid-script**, a
  table's foreign keys have changed since this doc was written — stop,
  don't reorder statements blindly, and re-verify the current schema
  (`grep -rn "references public.<table>" supabase/migrations/*.sql`) before
  retrying.
- **Re-run Step 1's preview query afterward** — every count except the
  protected-tenant row should read `0`.
- This does **not** reset each tenant's sale-number sequence
  (`sale_number_sequences`) — new sales after the wipe continue numbering
  from wherever the sequence already was. Harmless, just not a literal
  restart at `1`. Ask if you ever want that included too.
- This does **not** touch `audit_logs` — the audit trail for what was
  recorded before the wipe stays intact (append-only by design, see
  `docs/05-authentication-security.md`).

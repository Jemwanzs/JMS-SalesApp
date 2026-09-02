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

---

## Wipe sales & stock history for ONE tenant only (keep products, keep everything else)

**What this does:** the mirror image of the script above — instead of every
tenant *except* the platform owner's, this clears sales/stock **history**
for **only** the platform owner's own tenant, resolved the same
`platform_admins`-membership way (never a hardcoded email). Deliberately
narrower than the wipe-all script: `products` is **not** touched, so the
existing catalog survives untouched — only what's been *recorded against*
it goes.

Cleared: `sale_corrections`, `approval_requests`, `insights_snapshots`,
`report_jobs`, `reports`, `stock_reconciliations`, `stock_movements`,
`sales`, `business_days`, and `sale_number_sequences` (so the next sale
after this starts numbering at `SALE-<year>-000001` again, not wherever the
counter was left). Left alone: `products`/`product_images` (the catalog),
`imports` (the upload history is a job log, not a sales/stock record),
accounts, roles, billing — same as the wipe-all script's untouched list.

**When to use it:** the platform owner's own tenant was used to test/demo
recording sales and stock, and it's time to hand it to real invited users
with a clean slate — reports should read nil, but the product catalog they'll
sell against should stay exactly as set up.

**Origin:** written 2026-08-31, in response to a request to clear the
platform owner's own recorded sales and stock history (products kept) ahead
of inviting real users to start keying in daily sales/stock for feedback.

### Step 1 — preview (read-only, changes nothing)

```sql
with owner_tenant as (
  select t.id
  from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
select 'sales' as table_name, count(*) from public.sales where tenant_id in (select id from owner_tenant)
union all select 'sale_corrections', count(*) from public.sale_corrections where tenant_id in (select id from owner_tenant)
union all select 'business_days', count(*) from public.business_days where tenant_id in (select id from owner_tenant)
union all select 'stock_movements', count(*) from public.stock_movements where tenant_id in (select id from owner_tenant)
union all select 'stock_reconciliations', count(*) from public.stock_reconciliations where tenant_id in (select id from owner_tenant)
union all select 'reports', count(*) from public.reports where tenant_id in (select id from owner_tenant)
union all select 'report_jobs', count(*) from public.report_jobs where tenant_id in (select id from owner_tenant)
union all select 'insights_snapshots', count(*) from public.insights_snapshots where tenant_id in (select id from owner_tenant)
union all select 'approval_requests', count(*) from public.approval_requests where tenant_id in (select id from owner_tenant)
union all select 'sale_number_sequences', count(*) from public.sale_number_sequences where tenant_id in (select id from owner_tenant)
union all select '— owner tenant(s) resolved —', count(*) from owner_tenant;
```

The last row **must** read `1`. If it reads `0`, stop — no owner tenant
resolved, so every other count above is meaningless (the `in (...)` filter
matched nothing). If it reads `2` or more, also stop — more than one
platform admin owns a tenant, and the script below would touch all of them,
not just yours; resolve that ambiguity before running anything further.

### Step 2 — the actual wipe

Same FK ordering as the wipe-all script, just `in` instead of `not in`.

```sql
begin;

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.sale_corrections where tenant_id in (select id from owner_tenant);

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.approval_requests where tenant_id in (select id from owner_tenant);

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.insights_snapshots where tenant_id in (select id from owner_tenant);

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.report_jobs where tenant_id in (select id from owner_tenant);

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.reports where tenant_id in (select id from owner_tenant);

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.stock_reconciliations where tenant_id in (select id from owner_tenant);

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.stock_movements where tenant_id in (select id from owner_tenant);

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.sales where tenant_id in (select id from owner_tenant);

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.business_days where tenant_id in (select id from owner_tenant);

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.sale_number_sequences where tenant_id in (select id from owner_tenant);
-- products/product_images and imports are deliberately NOT deleted here.

-- Review the output above (each DELETE reports how many rows it removed).
-- If everything looks right:
commit;
-- If anything looks wrong, run this instead of the commit above:
-- rollback;
```

### Notes

- **Products are untouched on purpose** — this script only clears what was
  *recorded* (sales/stock/reports), not the catalog those records point at.
  Run the wipe-all script above instead if the catalog itself needs
  clearing too.
- Re-run Step 1's preview afterward — every count except the owner-tenant
  row should read `0`.
- Doesn't touch `audit_logs`, accounts, roles, or billing — same reasoning
  as the wipe-all script above.

---

## Clear ONE tenant's sales for a SINGLE date only (keep the business day open, keep everything else)

**What this does:** the narrowest of the three — clears only `sales` (plus
any `sale_corrections`/`insights_snapshots` tied to that exact day) for one
specific `sale_date`, for one specific tenant (resolved via real
`platform_admins` → `billing_owner_profile_id` membership, never a
hardcoded email). Everything else about that day survives: the
`business_days` row itself is **kept** (still `open`, so real sales can
still be recorded that same day afterward), historical sales from every
other date are untouched, and `sale_number_sequences` is **deliberately
not reset** — other dates already hold earlier numbers, so resetting the
counter would collide with them the moment a new sale tries to reuse one.
A visible gap in sale numbers where the deleted ones used to be is the
expected, harmless result.

Cleared: `sales` for the target date, plus any `sale_corrections`/
`insights_snapshots` referencing that day's records (rare in practice,
since test sales are usually never voided/corrected first — the script
still checks). Left alone: `business_days` (kept open), every other
date's `sales`/`reports`/etc., `products`, `stock_movements` (sales don't
drive stock movements in this app — there's no relationship between
them), accounts, roles, billing.

**When to use it:** a specific day's transactions were recorded purely as
a test/training run (not real sales) and need to disappear from
dashboards/leaderboard/reports, without touching any other date or
resetting anything that would affect real sales recorded before or after.

**Origin:** written 2026-09-02, in response to a request to clear the
platform owner's own tenant's sales recorded that same day as test/
training data, while confirming no other date or tenant was affected and
the day itself stayed usable for real sales going forward.

### Step 1 — preview (read-only, changes nothing)

```sql
with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
select 'sales' as table_name, count(*) from public.sales
  where tenant_id in (select id from owner_tenant) and sale_date = '2026-09-02'
union all select 'sale_corrections', count(*) from public.sale_corrections sc
  where sc.sale_id in (select id from public.sales where tenant_id in (select id from owner_tenant) and sale_date = '2026-09-02')
union all select 'insights_snapshots', count(*) from public.insights_snapshots
  where business_day_id in (select id from public.business_days where tenant_id in (select id from owner_tenant) and business_date = '2026-09-02')
union all select '— owner tenant(s) resolved —', count(*) from owner_tenant;
```

The last row **must** read `1` — same stop conditions as the script above
(`0` = no owner tenant resolved, `2`+ = ambiguous, resolve before
continuing).

### Step 2 — the actual deletion

```sql
begin;

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
), target_sales as (
  select id from public.sales
  where tenant_id in (select id from owner_tenant) and sale_date = '2026-09-02'
)
delete from public.sale_corrections where sale_id in (select id from target_sales);

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.insights_snapshots
where business_day_id in (
  select id from public.business_days
  where tenant_id in (select id from owner_tenant) and business_date = '2026-09-02'
);

with owner_tenant as (
  select t.id from public.tenants t
  join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
)
delete from public.sales
where tenant_id in (select id from owner_tenant) and sale_date = '2026-09-02';
-- business_days is intentionally NOT deleted -- the day stays open.

-- Review the output above (each DELETE reports how many rows it removed).
-- If everything looks right:
commit;
-- If anything looks wrong, run this instead of the commit above:
-- rollback;
```

### Notes

- Change the two literal `'2026-09-02'` dates in Step 1 and the one in
  Step 2 together before running for a different date — nothing else
  needs editing.
- Analytics/reports/leaderboard read `sales` live on every request (no
  cache/snapshot table in front of them) — the moment the rows are gone,
  every dashboard immediately reflects zero sales for that date, with no
  separate "refresh" step needed.
- Re-run Step 1's preview afterward — the `sales` count should read `0`;
  the other two are usually already `0` even before deleting.

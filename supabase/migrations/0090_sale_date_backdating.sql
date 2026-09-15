-- ============================================================================
-- 0090_sale_date_backdating.sql
--
-- FEATURE ENHANCEMENT — OPTIONAL SALE DATE DURING RECORDING.
--
-- Lets an authorized user record a brand-new sale directly onto a past
-- date (e.g. a Monday sale discovered on Tuesday, after Monday's
-- business day already closed), rather than the only existing path
-- today (correct_sale(), which only ever moves an ALREADY-recorded
-- sale's date after the fact and requires a reason).
--
-- Deliberately off by default at two independent layers, matching the
-- spec: a per-tenant `sale_date_selection_enabled` setting (tenant_
-- settings is schema-less -- no column needed) AND a new permission,
-- `sales.record_backdated`, scoped Tenant-Administrator-only by
-- default -- the same default scope as the closest existing analogue,
-- `sales.correct_historical` (also absent from RoleService.ts's
-- DEFAULT_ROLE_GRANTS for "Sales User"/"Supervisor", granted to Tenant
-- Administrator only because that role is computed as "every
-- permission in the catalog" at seed time).
--
-- No schema change to `sales` itself: `sale_date` (migration 0005) is
-- already a plain `date not null` column, separate from `created_at`,
-- that every downstream reader (SalesService, ReportService,
-- AnalyticsService, CSV/PDF export, the stock-deduction trigger from
-- migration 0067) already queries directly -- a sale inserted with a
-- backdated sale_date is already fully correct everywhere with zero
-- further changes.
--
-- The one real piece of new logic: `business_days` rows are only
-- writable (RLS) by someone holding business_day.open/close/reopen,
-- which a Sales User authorized to backdate a sale won't necessarily
-- hold -- so resolving-or-creating the target past business_days row
-- needs its own security definer RPC. Reuses the exact resolve-or-
-- create-CLOSED pattern _apply_sale_date_change() (migration 0078)
-- already established for the correction flow: a business day
-- materialized purely to host a backdated entry is 'closed', never
-- 'open' -- it must never become live/capturable for fresh same-day
-- entries just because a backdated sale landed on it.
-- ============================================================================

insert into public.permissions (key, module, description, is_read_only) values
  ('sales.record_backdated', 'sales', 'Record a new sale directly onto a past date', false);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Tenant Administrator'
  and p.key = 'sales.record_backdated'
on conflict do nothing;

-- Resolves (or creates, as 'closed') the business_days row for a past
-- sale date, after checking the actor holds sales.record_backdated,
-- the tenant has opted into sale_date_selection_enabled, the date
-- isn't in the future (checked against the tenant/location's own
-- EFFECTIVE business date, resolve_effective_business_date -- migration
-- 0055 -- not a raw current_date comparison, same idiom correct_sale()
-- already uses), and the date doesn't exceed the tenant's optional
-- sale_date_max_backdating_days setting. Callable directly by
-- `authenticated` (no revoke below) -- the server action calls this
-- under the signed-in user's own session via .rpc(), it is not an
-- internal helper invoked from inside another security definer
-- function the way _apply_sale_date_change's own callers are.
create or replace function public.resolve_backdated_business_day(
  p_tenant_id uuid,
  p_location_id uuid,
  p_sale_date date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_selection_enabled boolean;
  v_effective_date date;
  v_max_days int;
  v_target_day public.business_days;
begin
  if not public.has_permission(p_tenant_id, 'sales.record_backdated') then
    raise exception 'Not authorized to record a backdated sale';
  end if;

  select coalesce((value)::text::boolean, false) into v_selection_enabled
  from public.tenant_settings
  where tenant_id = p_tenant_id and setting_key = 'sale_date_selection_enabled';

  if not coalesce(v_selection_enabled, false) then
    raise exception 'Sale date selection is not enabled for this tenant';
  end if;

  if p_sale_date is null then
    raise exception 'A sale date is required';
  end if;

  select business_date into v_effective_date
  from public.resolve_effective_business_date(p_tenant_id, p_location_id);

  if p_sale_date > v_effective_date then
    raise exception 'Cannot record a sale for a future date';
  end if;

  -- No DELETE policy on tenant_settings and a stored JSON null would
  -- break this very cast (`(value)::text::int` on a JSON null renders
  -- the literal string 'null', which fails) -- same reasoning
  -- set-stock-variance-tolerance.ts's own header comment documents, so
  -- set-sale-date-selection.ts (features/settings/actions) never writes
  -- an actual null for "Unlimited": it stores -1 as that sentinel
  -- instead. A genuinely absent row (setting never configured at all)
  -- still resolves to plain SQL NULL here, treated the same as -1.
  select (value)::text::int into v_max_days
  from public.tenant_settings
  where tenant_id = p_tenant_id and setting_key = 'sale_date_max_backdating_days';

  if v_max_days is not null and v_max_days > 0 and p_sale_date < (v_effective_date - (v_max_days || ' days')::interval) then
    raise exception 'Selected date exceeds the maximum backdating period';
  end if;

  -- Resolve-or-create, identical logic/idempotency to migration 0078's
  -- _apply_sale_date_change -- a day created here purely to host a
  -- backdated entry is 'closed', never 'open'.
  select * into v_target_day
  from public.business_days
  where tenant_id = p_tenant_id and location_id = p_location_id and business_date = p_sale_date;

  if not found then
    insert into public.business_days (tenant_id, location_id, business_date, status, closed_at, closing_reason)
    values (
      p_tenant_id, p_location_id, p_sale_date, 'closed', now(),
      'Created automatically for a backdated sale'
    )
    on conflict (tenant_id, location_id, business_date) do nothing;

    select * into v_target_day
    from public.business_days
    where tenant_id = p_tenant_id and location_id = p_location_id and business_date = p_sale_date;
  end if;

  return v_target_day.id;
end;
$$;

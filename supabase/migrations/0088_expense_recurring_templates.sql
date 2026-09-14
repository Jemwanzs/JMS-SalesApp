-- ============================================================================
-- 0088_expense_recurring_templates.sql
--
-- Expense Management Phase 2d: recurring expenses (rent, subscriptions,
-- anything that repeats on the same day every month without anyone
-- re-entering it). A template holds everything a normal recorded
-- expense needs (item/category/payment method/amount/branch/vendor/
-- reference/tax/reimbursable/notes) plus a day-of-month; a daily
-- pg_cron sweep inserts a real `expenses` row on the day it's due,
-- exactly the "pg_cron for state, Vercel Cron for side effects" split
-- docs/09-business-day-engine.md already establishes (run_business_day_
-- sweep/run_billing_sweep/run_addon_billing_sweep all use the same
-- mechanism) -- no external side effect here (no email/webhook), so
-- this never touches Vercel Cron's once-daily Hobby-plan-gated outbox.
--
-- Deliberately a PLAIN INSERT into `expenses`, not a new SECURITY
-- DEFINER "create" function -- every BEFORE INSERT trigger already on
-- that table (assign_expense_number, enforce_receipt_requirement,
-- gate_expense_approval, sync_reimbursement_status) fires exactly as it
-- would for a manually-recorded expense, so a recurring expense gets a
-- real sequential number, is still gated by the receipt/approval
-- settings a tenant configured, and its reimbursement_status still
-- syncs correctly -- no duplicated logic to keep in sync with those four
-- triggers as they evolve.
--
-- Idempotency (the lesson from the report_jobs duplicate-row incident,
-- see memory/project_report_jobs_idempotency.md): a real DB-level unique
-- constraint, not "the sweep just tries not to double-run." `expenses`
-- gains `recurring_template_id` + `recurring_period` (the first-of-month
-- this row was generated for), with a partial unique index on the pair
-- -- `insert ... on conflict ... do nothing` makes re-running the sweep
-- for an already-generated month a true no-op, not just unlikely to
-- double-fire.
--
-- Each template's insert runs inside its own exception-catching block
-- (unlike the other sweeps, which are simple status transitions that
-- can't fail on data validity): enforce_receipt_requirement CAN reject
-- an insert (e.g. a tenant set "Always require a receipt" and a
-- recurring template naturally has none to attach) -- one
-- misconfigured template must never abort every other tenant's sweep.
-- ============================================================================

insert into public.permissions (key, module, description, is_read_only) values
  ('expenses.manage_recurring', 'expenses', 'Configure recurring expense templates', false);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Tenant Administrator'
  and p.key = 'expenses.manage_recurring'
on conflict do nothing;

create table public.expense_recurring_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid not null references public.locations (id),
  expense_item_id uuid not null references public.expense_items (id),
  category_id uuid not null references public.expense_categories (id),
  payment_method_id uuid not null references public.expense_payment_methods (id),
  amount numeric(12, 2) not null check (amount > 0),
  vendor text,
  reference_number text,
  tax_amount numeric(12, 2) check (tax_amount is null or tax_amount >= 0),
  reimbursable boolean not null default false,
  notes text,
  -- Clamped to each month's actual length at generation time (day 31
  -- lands on Feb 28/29, Apr/Jun/Sep/Nov 30, ...) -- a plain integer
  -- rather than a separate "last day of month" flag, since clamping
  -- already gives that behavior for free at 31.
  day_of_month int not null check (day_of_month between 1 and 31),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_expense_recurring_templates_tenant on public.expense_recurring_templates (tenant_id, status);

create trigger set_expense_recurring_templates_updated_at
before update on public.expense_recurring_templates
for each row execute function public.set_updated_at();

alter table public.expense_recurring_templates enable row level security;

create policy expense_recurring_templates_select on public.expense_recurring_templates
for select to authenticated
using (public.has_permission(tenant_id, 'expenses.view'));

create policy expense_recurring_templates_insert on public.expense_recurring_templates
for insert to authenticated
with check (public.has_permission(tenant_id, 'expenses.manage_recurring'));

create policy expense_recurring_templates_update on public.expense_recurring_templates
for update to authenticated
using (public.has_permission(tenant_id, 'expenses.manage_recurring'))
with check (public.has_permission(tenant_id, 'expenses.manage_recurring'));

-- No delete policy -- archived, never deleted, same convention every
-- other expense config table already follows.

alter table public.expenses
  add column recurring_template_id uuid references public.expense_recurring_templates (id),
  add column recurring_period date;

create unique index idx_expenses_recurring_once
  on public.expenses (recurring_template_id, recurring_period)
  where recurring_template_id is not null;

create or replace function public.generate_due_recurring_expenses()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rt record;
  v_today date;
  v_target_day int;
  v_period date;
  v_item_name text;
  v_category_name text;
  v_payment_method_name text;
  v_generated_count int := 0;
  v_skipped_count int := 0;
  v_error_count int := 0;
begin
  for rt in
    select t.*, tn.timezone
    from public.expense_recurring_templates t
    join public.tenants tn on tn.id = t.tenant_id
    where t.status = 'active'
      and tn.status = 'active'
      and coalesce((
        select (value)::text::boolean
        from public.tenant_settings
        where tenant_id = t.tenant_id and setting_key = 'expenses_enabled'
      ), false)
  loop
    v_today := (now() at time zone coalesce(rt.timezone, 'UTC'))::date;
    v_target_day := least(
      rt.day_of_month,
      extract(day from (date_trunc('month', v_today) + interval '1 month - 1 day'))::int
    );

    if extract(day from v_today)::int <> v_target_day then
      continue;
    end if;

    v_period := date_trunc('month', v_today)::date;

    begin
      select name into v_item_name from public.expense_items where id = rt.expense_item_id;
      select name into v_category_name from public.expense_categories where id = rt.category_id;
      select name into v_payment_method_name from public.expense_payment_methods where id = rt.payment_method_id;

      if v_item_name is null or v_category_name is null or v_payment_method_name is null then
        raise exception 'Template % references a deleted item/category/payment method', rt.id;
      end if;

      insert into public.expenses (
        tenant_id, location_id, expense_item_id, expense_item_name_snapshot,
        category_id, category_name_snapshot, payment_method_id, payment_method_name_snapshot,
        vendor, reference_number, tax_amount, reimbursable, actual_amount, expense_date, notes,
        recorded_by, recurring_template_id, recurring_period
      ) values (
        rt.tenant_id, rt.location_id, rt.expense_item_id, v_item_name,
        rt.category_id, v_category_name, rt.payment_method_id, v_payment_method_name,
        rt.vendor, rt.reference_number, rt.tax_amount, rt.reimbursable, rt.amount, v_today, rt.notes,
        rt.created_by, rt.id, v_period
      )
      on conflict (recurring_template_id, recurring_period) where recurring_template_id is not null
      do nothing;

      if found then
        v_generated_count := v_generated_count + 1;
      else
        v_skipped_count := v_skipped_count + 1;
      end if;
    exception
      when others then
        v_error_count := v_error_count + 1;
    end;
  end loop;

  return jsonb_build_object(
    'generated', v_generated_count,
    'alreadyGenerated', v_skipped_count,
    'errors', v_error_count,
    'ranAt', now()
  );
end;
$$;

revoke execute on function public.generate_due_recurring_expenses() from public, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'recurring-expense-sweep';
exception
  when others then
    raise exception 'pg_cron extension not found or inaccessible -- enable it first (Dashboard > Database > Extensions), then re-run this migration. Original error: %', sqlerrm;
end $$;

-- Once a day is enough (unlike business-day-sweep's 5-minute
-- granularity) -- a recurring expense being generated at 03:30 UTC
-- rather than the exact stroke of midnight in the tenant's own timezone
-- is a non-issue, same reasoning billing-sweep's own daily cadence uses.
select cron.schedule(
  'recurring-expense-sweep',
  '30 3 * * *',
  $$select public.generate_due_recurring_expenses();$$
);

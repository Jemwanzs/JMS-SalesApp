-- ============================================================================
-- 0081_expense_numbering.sql
--
-- Phase 1 of the Expense Management expansion: a unique expense number
-- (EXP-{YYYY}-{000001}), mirroring sale_number_sequences/assign_sale_
-- number() exactly (0005_sales_engine_core.sql) minus the sales format's
-- own per-tenant configurability -- that's real complexity this feature
-- doesn't need yet (a fixed format is all the spec actually asks for).
-- ============================================================================

create table public.expense_number_sequences (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  year integer not null,
  current_value bigint not null default 0,
  primary key (tenant_id, location_id, year)
);

-- No RLS policies -- internal counter, touched only by the trigger below
-- (SECURITY DEFINER), same as sale_number_sequences.
alter table public.expense_number_sequences enable row level security;

alter table public.expenses add column expense_number text;
alter table public.expenses add constraint expenses_tenant_expense_number_unique unique (tenant_id, expense_number);

-- Atomic assignment: a single INSERT ... ON CONFLICT ... RETURNING
-- serializes concurrent inserts for the same tenant/location/year via
-- row-level locking, without an explicit SELECT ... FOR UPDATE. Small
-- gaps on rollback are acceptable -- uniqueness within scope is what
-- matters, not a gapless sequence (same note as assign_sale_number()).
create or replace function public.assign_expense_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer;
  v_seq bigint;
begin
  if new.expense_number is not null then
    return new;
  end if;

  v_year := extract(year from new.expense_date);

  insert into public.expense_number_sequences (tenant_id, location_id, year, current_value)
  values (new.tenant_id, new.location_id, v_year, 1)
  on conflict (tenant_id, location_id, year)
  do update set current_value = public.expense_number_sequences.current_value + 1
  returning current_value into v_seq;

  new.expense_number := 'EXP-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  return new;
end;
$$;

create trigger set_expense_number
before insert on public.expenses
for each row execute function public.assign_expense_number();

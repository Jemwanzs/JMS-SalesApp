-- ============================================================================
-- 0086_expense_reimbursement_tracking.sql
--
-- Expense Management Phase 2b: reimbursement tracking. Turns the Phase 1
-- `reimbursable` boolean (set/correctable, but otherwise inert until now)
-- into a real three-state pipeline: not_applicable -> pending -> paid.
--
-- Deliberately NOT routed through the generic approval_requests engine
-- (migration 0006, reused for expense_create in 0085) -- that engine
-- models "should this ACTION be allowed to happen," with a requester and
-- a reviewer deciding yes/no before anything changes. Reimbursement is a
-- different shape: the expense already happened and was already
-- approved/active; this just tracks whether the EMPLOYEE has been PAID
-- BACK for it yet. There's no request to approve or reject, only a
-- payment to record -- so a single forward mark_expense_reimbursed()
-- RPC, gated on a new expenses.manage_reimbursements permission, is the
-- whole mechanism. No new tenant setting either (unlike receipt/approval
-- requirement): there's no configurable mode here, just "the reimbursable
-- flag drives whether this expense enters the pending-reimbursement
-- queue at all."
--
-- Scope note (documented gap, not silently dropped, matching migration
-- 0006's own "REVERSE is a documented future increment" precedent):
-- there is no "undo/unmark paid" path in this phase, and correct_expense()
-- is intentionally left untouched here -- see sync_reimbursement_status()
-- below for how it still interacts safely with corrections that flip the
-- reimbursable flag.
-- ============================================================================

insert into public.permissions (key, module, description, is_read_only) values
  ('expenses.manage_reimbursements', 'expenses', 'Mark reimbursable expenses as paid back to the employee', false);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Tenant Administrator'
  and p.key = 'expenses.manage_reimbursements'
on conflict do nothing;

alter table public.expenses
  add column reimbursement_status text not null default 'not_applicable'
    check (reimbursement_status in ('not_applicable', 'pending', 'paid')),
  add column reimbursed_by uuid references public.profiles (id),
  add column reimbursed_at timestamptz,
  add column reimbursement_reference text,
  add column reimbursement_notes text;

-- Backfill: any already-reimbursable expense recorded before this
-- migration starts life as 'pending' (nothing was ever paid before this
-- column existed), everything else defaults to 'not_applicable' already.
update public.expenses set reimbursement_status = 'pending' where reimbursable = true;

-- Keeps reimbursement_status in sync with the reimbursable flag without
-- ever clobbering a real payment record. Fires on INSERT (compute fresh)
-- and on UPDATE only when `reimbursable` itself actually changed (e.g.
-- correct_expense() flipping it) -- a status-only update (void_expense,
-- mark_expense_reimbursed itself) never touches `reimbursable`, so this
-- trigger is a no-op for those, exactly like enforce_receipt_requirement's
-- own "is not distinct from" guard (migration 0083). Never downgrades an
-- already-'paid' row back to pending/not_applicable, even if a later
-- correction turns reimbursable off -- the payment already happened and
-- stays on record.
create or replace function public.sync_reimbursement_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.reimbursement_status := case when new.reimbursable then 'pending' else 'not_applicable' end;
    return new;
  end if;

  if new.reimbursable is distinct from old.reimbursable and old.reimbursement_status <> 'paid' then
    new.reimbursement_status := case when new.reimbursable then 'pending' else 'not_applicable' end;
  end if;

  return new;
end;
$$;

create trigger expenses_sync_reimbursement_status
  before insert or update on public.expenses
  for each row
  execute function public.sync_reimbursement_status();

create or replace function public.mark_expense_reimbursed(
  p_expense_id uuid,
  p_reference text,
  p_notes text
)
returns public.expenses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expense public.expenses;
  v_actor uuid := auth.uid();
begin
  select * into v_expense from public.expenses where id = p_expense_id for update;
  if not found then
    raise exception 'Expense not found';
  end if;

  if not public.has_permission(v_expense.tenant_id, 'expenses.manage_reimbursements') then
    raise exception 'Not authorized to mark expenses as reimbursed';
  end if;

  if v_expense.status <> 'active' then
    raise exception 'Expense is "%", not active -- only an active expense can be reimbursed', v_expense.status;
  end if;

  if not v_expense.reimbursable then
    raise exception 'This expense is not marked as reimbursable';
  end if;

  if v_expense.reimbursement_status <> 'pending' then
    raise exception 'Reimbursement is "%", not pending', v_expense.reimbursement_status;
  end if;

  update public.expenses
  set reimbursement_status = 'paid',
      reimbursed_by = v_actor,
      reimbursed_at = now(),
      reimbursement_reference = p_reference,
      reimbursement_notes = p_notes
  where id = p_expense_id
  returning * into v_expense;

  return v_expense;
end;
$$;

revoke execute on function public.mark_expense_reimbursed(uuid, text, text) from public;
grant execute on function public.mark_expense_reimbursed(uuid, text, text) to authenticated;

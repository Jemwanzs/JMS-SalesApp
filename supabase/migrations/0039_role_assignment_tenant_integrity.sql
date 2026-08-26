-- Hardening roadmap Phase 1 (docs/22-hardening-roadmap.md, security
-- finding #2): has_permission() (migration 0001) joins
-- tenant_memberships -> user_role_assignments -> role_permissions and
-- only ever checks the CALLER's own membership.tenant_id -- it never
-- confirms the ROLE being checked (user_role_assignments.role_id) is
-- itself owned by that same tenant. user_role_assignments_write's RLS
-- only requires has_permission(tenant_id, 'roles.manage') on the
-- assignment's own tenant_id column, so nothing in the existing schema
-- stops a tenant admin from attaching a role belonging to a DIFFERENT
-- tenant (e.g. a role UUID leaked from a former dual-membership) to one
-- of their own members -- has_permission() would then silently honor
-- that foreign role's permissions for a lookup scoped to the wrong
-- tenant.
--
-- Postgres has no native cross-table CHECK constraint, so this is a
-- BEFORE INSERT OR UPDATE trigger, not a constraint clause. Written as
-- SECURITY DEFINER only because trigger functions run with the
-- invoking statement's privileges by default and this needs to read
-- public.roles regardless of who's performing the write; it does no
-- writes of its own and returns/raises based purely on the row being
-- inserted, so there's no privilege-escalation surface here the way
-- there would be in a callable RPC.

create or replace function public.enforce_role_assignment_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_tenant_id uuid;
begin
  select tenant_id into v_role_tenant_id
  from public.roles
  where id = new.role_id;

  if v_role_tenant_id is null then
    raise exception 'user_role_assignments.role_id % does not reference an existing role', new.role_id;
  end if;

  if v_role_tenant_id <> new.tenant_id then
    raise exception 'Role % belongs to a different tenant than this assignment (role tenant %, assignment tenant %)',
      new.role_id, v_role_tenant_id, new.tenant_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_role_assignment_tenant_match on public.user_role_assignments;

create trigger trg_enforce_role_assignment_tenant_match
before insert or update on public.user_role_assignments
for each row execute function public.enforce_role_assignment_tenant_match();

-- ============================================================================
-- 0047_delete_tenant.sql
--
-- Platform Admin gets a real, permanent "Delete Tenant" capability
-- (services/PlatformAdminService.ts's new deleteTenant method). Different
-- from -- and more tractable than -- deleting an individual user account
-- (which hits sales.recorded_by's intentional RESTRICT constraint): every
-- tenant-scoped table already has `tenant_id ... on delete cascade`
-- (verified against every migration, not assumed), so deleting a tenants
-- row cleanly removes its sales, products, subscriptions, memberships,
-- stock data, everything -- except employee/owner LOGIN accounts
-- (profiles/auth.users), which are never tenant-owned in this schema and
-- are deliberately left alone (same scoping discipline as
-- docs/23-data-maintenance-scripts.md's wipe script). A membership-less
-- signed-in user already lands on a real, handled state (/no-tenant).
--
-- Two things needed first:
--
-- 1. platform_audit_logs.target_tenant_id had NO `on delete` behavior at
--    all (defaults to blocking) -- would prevent deleting any tenant with
--    prior admin-action history, i.e. most real tenants. Fixed to `on
--    delete set null`, the exact same precedent already used by this
--    table's own sibling in migration 0021 (billing_events.tenant_id) --
--    the audit row survives, only the tenant reference nulls out.
--
-- 2. A BEFORE DELETE trigger on tenants blocking deletion of the platform
--    owner's own tenant -- a sibling to migration 0044's existing BEFORE
--    UPDATE trigger (enforce_platform_owner_tenant_active), same RAISE
--    EXCEPTION approach and same reasoning for why that's safe (every
--    real delete path is a single-row DELETE ... WHERE id = :id, never a
--    batch). Kept as its own function rather than folded into the
--    existing one -- BEFORE DELETE only has OLD, not NEW.
-- ============================================================================

alter table public.platform_audit_logs
  drop constraint platform_audit_logs_target_tenant_id_fkey,
  add constraint platform_audit_logs_target_tenant_id_fkey
    foreign key (target_tenant_id) references public.tenants (id) on delete set null;

create or replace function public.enforce_platform_owner_tenant_no_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.platform_admins pa where pa.profile_id = old.billing_owner_profile_id
  ) then
    raise exception 'Tenant % is the platform owner''s own tenant and cannot be deleted', old.id;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_enforce_platform_owner_tenant_no_delete on public.tenants;

create trigger trg_enforce_platform_owner_tenant_no_delete
before delete on public.tenants
for each row execute function public.enforce_platform_owner_tenant_no_delete();

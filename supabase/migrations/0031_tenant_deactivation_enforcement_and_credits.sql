-- ============================================================================
-- 0031_tenant_deactivation_enforcement_and_credits.sql
--
-- Requires 0030 (adds 'deactivated' to tenant_status) already committed.
--
-- Part A: has_permission() gains a new leading branch -- 'deactivated' is
-- a genuinely stronger lockout than 'suspended': ZERO permissions
-- resolve true, no is_read_only carve-out (unlike suspended, which
-- still lets a billing-owner-adjacent read-only permission through so
-- the billing screen stays reachable). This is the REAL enforcement --
-- app/(tenant)/t/[tenantSlug]/layout.tsx's own redirect is a UX fast-
-- path only, since a layout redirect doesn't stop a Server Action from
-- being invoked directly. The one exception: an actively-impersonating
-- platform admin is NOT blocked -- Support must still be able to
-- investigate a deactivated tenant (0024's own "Access Workspace"
-- design intent), so this branch explicitly checks
-- impersonated_profile_id(p_tenant_id) is null before locking out.
-- Byte-identical to 0024_impersonation.sql's version otherwise.
--
-- Part B: tenant_credits -- the Super Admin one-time subscription credit
-- (docs/15-super-admin.md's Tenant 360 addition). RLS SELECT only,
-- gated exactly like subscriptions_select/payments_select (0021) --
-- billing owner or settings.manage, not "any tenant member" -- since
-- this is billing-sensitive data at the same sensitivity level as those
-- two tables, not general tenant data. No write policy at all:
-- PlatformAdminService.grantSubscriptionCredit (service-role) is the
-- only way a credit is created; BillingService (service-role) is the
-- only way one is ever marked 'applied', mirroring the write posture
-- payments/subscriptions/platform_audit_logs already have.
-- ============================================================================

create or replace function public.has_permission(
  p_tenant_id uuid,
  p_permission_key text,
  p_location_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when (select t.status from public.tenants t where t.id = p_tenant_id) = 'deactivated'
      and public.impersonated_profile_id(p_tenant_id) is null
    then false
    when (select t.status from public.tenants t where t.id = p_tenant_id) = 'suspended'
      and not coalesce((select p.is_read_only from public.permissions p where p.key = p_permission_key), false)
    then false
    else exists (
      select 1
      from public.tenant_memberships tm
      join public.user_role_assignments ura on ura.tenant_membership_id = tm.id
      join public.role_permissions rp on rp.role_id = ura.role_id
      join public.permissions p on p.id = rp.permission_id
      where tm.tenant_id = p_tenant_id
        and tm.profile_id = coalesce(public.impersonated_profile_id(p_tenant_id), auth.uid())
        and tm.status = 'active'
        and p.key = p_permission_key
        and (p_location_id is null or ura.location_id is null or ura.location_id = p_location_id)
    )
  end;
$$;

create table public.tenant_credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  granted_by uuid not null references public.platform_admins (id),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null,
  reason text not null,
  status text not null default 'available' check (status in ('available', 'applied', 'expired')),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_to_payment_id uuid references public.payments (id)
);

create index idx_tenant_credits_tenant_status on public.tenant_credits (tenant_id, status);

alter table public.tenant_credits enable row level security;

create policy tenant_credits_select on public.tenant_credits
for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    where t.id = tenant_id and t.billing_owner_profile_id = auth.uid()
  )
  or public.has_permission(tenant_id, 'settings.manage')
);

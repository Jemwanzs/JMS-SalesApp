-- ============================================================================
-- 0022_platform_audit_logs.sql
--
-- Phase 7a (Platform Administration): tenant list/detail + suspend/
-- reactivate/extend-trial/adjust-grace, all through PlatformAdminService,
-- all audited (docs/15-super-admin.md's "Tenant management" section).
--
-- Only platform_audit_logs is created here -- impersonation_sessions and
-- anniversary_wishes belong to 7b/7d specifically and aren't created
-- speculatively ahead of the features that use them (migration 0004's
-- own "no empty, unused tables" principle).
--
-- Same posture as platform_admins itself (migration 0004): RLS enabled,
-- ZERO policies for authenticated/anon -- reachable only via the
-- service-role client after PlatformAdminService's own is_platform_admin()
-- app-layer check. A compromised tenant-side session can never enumerate
-- platform audit history, regardless of any RLS policy bug elsewhere.
-- ============================================================================

create table public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  platform_admin_id uuid not null references public.platform_admins (id),
  action text not null,
  target_tenant_id uuid references public.tenants (id),
  target_profile_id uuid references public.profiles (id),
  old_values jsonb,
  new_values jsonb,
  reason text,
  ip text,
  created_at timestamptz not null default now()
);

create index idx_platform_audit_logs_tenant on public.platform_audit_logs (target_tenant_id, created_at desc);
create index idx_platform_audit_logs_admin on public.platform_audit_logs (platform_admin_id, created_at desc);

alter table public.platform_audit_logs enable row level security;
-- No policies -- service-role only, same as platform_admins.

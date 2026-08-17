-- ============================================================================
-- 0018_download_audit.sql
--
-- Phase 4 (Enterprise Controls): download security (docs/05-authentication-
-- security.md's "Download security" section, docs/03-database-schema.md's
-- download_audit row). `require_download_passcode` and
-- `hashed_download_passcode` live in the existing tenant_settings
-- key/value table (same convention as 4e/4f's restrict_login_to_*
-- settings) -- no migration needed for those two, only this new table.
--
-- Unlike login_events (which must be writable for a FAILED login attempt
-- that by definition has no authenticated session), an export always
-- happens under a live, already-authenticated session -- so a plain
-- self-scoped INSERT policy is enough here; no service-role/SECURITY
-- DEFINER detour needed the way login_events required one.
-- ============================================================================

create table public.download_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  export_type text not null,
  entity_ref text,
  passcode_verified_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);

create index idx_download_audit_tenant on public.download_audit (tenant_id, created_at desc);
create index idx_download_audit_profile on public.download_audit (profile_id, created_at desc);

alter table public.download_audit enable row level security;

create policy download_audit_select on public.download_audit
for select to authenticated
using (
  profile_id = auth.uid()
  or public.has_permission(tenant_id, 'security.manage')
);

create policy download_audit_insert on public.download_audit
for insert to authenticated
with check (
  profile_id = auth.uid()
  and public.is_tenant_member(tenant_id)
);

-- No update/delete policy -- immutable audit trail, same posture as
-- sale_corrections/login_events.

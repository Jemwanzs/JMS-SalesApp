-- ============================================================================
-- 0016_login_events_and_sessions.sql
--
-- Phase 4c: security centre -- login_events + sessions (docs/05-
-- authentication-security.md, docs/03-database-schema.md section 3.7).
-- Scoped to exactly this per the roadmap's own breakdown ("security
-- centre (login_events/sessions, device revocation)") -- working-hours
-- restriction, geo-fencing/temporary-access, download security, and the
-- full audit_logs coverage pass are separate, later roadmap items, not
-- this migration.
--
-- Both tables get RLS with a SELECT policy (self, or a tenant member
-- holding security.manage) but ZERO write policies -- same posture as
-- report_jobs/insights_snapshots. Not a coincidence: login_events must
-- be writable for a FAILED login attempt, which by definition has no
-- authenticated session for a self-scoped RLS insert policy to key off
-- of, so both tables are written exclusively via the service-role
-- client (SecurityService), never a direct authenticated insert/update.
-- ============================================================================

create table public.login_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  ip text,
  device text,
  browser text,
  os text,
  success boolean not null,
  failure_reason text,
  created_at timestamptz not null default now()
);

create index idx_login_events_profile on public.login_events (profile_id, created_at desc);
create index idx_login_events_tenant on public.login_events (tenant_id, created_at desc);

alter table public.login_events enable row level security;

create policy login_events_select on public.login_events
for select to authenticated
using (
  profile_id = auth.uid()
  or (tenant_id is not null and public.has_permission(tenant_id, 'security.manage'))
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  tenant_id uuid references public.tenants (id) on delete cascade,
  device_fingerprint text,
  ip text,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  revoked_reason text,
  created_at timestamptz not null default now()
);

create index idx_sessions_profile on public.sessions (profile_id, created_at desc);
create index idx_sessions_tenant on public.sessions (tenant_id, created_at desc);

alter table public.sessions enable row level security;

create policy sessions_select on public.sessions
for select to authenticated
using (
  profile_id = auth.uid()
  or (tenant_id is not null and public.has_permission(tenant_id, 'security.manage'))
);

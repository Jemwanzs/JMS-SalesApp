-- ============================================================================
-- 0050_active_branch_sessions.sql
--
-- Multi-Branch User Access, Phase 4: ties a signed-in session to exactly
-- one branch, enforced at the database level (not just hidden in the
-- UI) -- confirmed with the user as a session-linked lookup table
-- rather than a Supabase Auth Hook / custom JWT claim (works on any
-- plan, no unverified platform feature dependency).
--
-- session_id is Supabase Auth's own session identifier -- a required
-- claim on every JWT (auth.jwt() ->> 'session_id'), NOT this app's own
-- separate `sessions` table (a different, pre-existing mechanism for
-- "sign out of other devices" on the Security page). One row per real
-- login session; a fresh login gets a fresh session_id, so there is no
-- in-app way to change which row applies mid-session -- switching
-- branches genuinely requires logging out and back in, per the user's
-- explicit requirement.
-- ============================================================================

create table public.active_branch_sessions (
  session_id uuid primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index idx_active_branch_sessions_profile on public.active_branch_sessions (profile_id);

alter table public.active_branch_sessions enable row level security;

-- A signed-in user can read/manage only their OWN session's row --
-- written by the sign-in/select-branch server actions (service-role,
-- same posture as sessions/login_events, migration 0016 -- see
-- lib/supabase/service-role.ts's allow-list), but RLS is still enabled
-- here (not "no policies, service-role only") because the SQL helper
-- function below runs as the querying user, reading this table from
-- inside OTHER tables' own RLS policies.
create policy active_branch_sessions_select on public.active_branch_sessions
for select to authenticated
using (profile_id = auth.uid());

-- The one real, purpose-built helper this whole phase exists for:
-- every location-scoped RLS policy (sales, business_days,
-- stock_movements, stock_reconciliations, reports -- Phase 5) calls
-- this to get "which branch is THIS session working in." No row yet
-- (branch not selected this session, or a stale/logged-out session_id)
-- returns null, and every caller treats null as "match nothing" --
-- fails closed, the same security-first default this schema already
-- uses everywhere else (has_permission, is_tenant_member).
create or replace function public.current_active_location(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select location_id
  from public.active_branch_sessions
  where session_id = (auth.jwt() ->> 'session_id')::uuid
    and tenant_id = p_tenant_id;
$$;

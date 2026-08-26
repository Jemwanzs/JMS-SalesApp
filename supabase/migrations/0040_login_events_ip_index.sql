-- Hardening roadmap Phase 2.1 (docs/22-hardening-roadmap.md): the new
-- login-lockout check (SecurityService.countRecentFailedLogins) counts
-- recent failed attempts by IP as well as by profile_id -- migration
-- 0016 only ever indexed (profile_id, created_at) and (tenant_id,
-- created_at), so the by-IP half of that check would sequential-scan
-- login_events as it grows. Matches the same index shape already used
-- for the other two lookups.

create index if not exists idx_login_events_ip on public.login_events (ip, created_at desc);

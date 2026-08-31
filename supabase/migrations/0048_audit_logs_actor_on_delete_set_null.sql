-- ============================================================================
-- 0048_audit_logs_actor_on_delete_set_null.sql
--
-- audit_logs.actor_profile_id had NO `on delete` behavior at all
-- (defaults to blocking), the exact same gap migration 0047 already
-- found and fixed for platform_audit_logs.target_tenant_id. In
-- practice this means NO profile that has ever triggered a single
-- audit_logs row -- including a FAILED_LOGIN, the most routine kind --
-- could ever be deleted, which would silently undermine
-- PlatformAdminService.deleteTenant's login-cleanup (migration-free,
-- shipped 2026-08-31): a former member's login is supposed to be
-- deleted once they belong to nowhere else, but this FK would quietly
-- block that for anyone who's ever mistyped their password once.
--
-- Same fix, same reasoning as 0047: `on delete set null` so the audit
-- row survives (append-only, by design -- see
-- docs/05-authentication-security.md) with only the actor reference
-- nulled out, exactly what billing_events.tenant_id (migration 0021)
-- and platform_audit_logs.target_tenant_id (migration 0047) already do.
-- ============================================================================

alter table public.audit_logs
  drop constraint audit_logs_actor_profile_id_fkey,
  add constraint audit_logs_actor_profile_id_fkey
    foreign key (actor_profile_id) references public.profiles (id) on delete set null;

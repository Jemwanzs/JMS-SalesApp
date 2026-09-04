-- ============================================================================
-- 0062_platform_audit_logs_admin_id_nullable.sql
--
-- Account Deletion (Feature 1): the automatic 30-day-grace-period purge
-- of a self-requested tenant deletion is a SYSTEM action, not something
-- any specific platform admin performs -- it fires from the outbox cron
-- (app/api/cron/outbox/route.ts), calling the existing
-- PlatformAdminService.deleteTenant() with no real admin actor to
-- attribute it to.
--
-- platform_audit_logs.platform_admin_id was NOT NULL (migration 0022),
-- with no precedent for a null "system" actor the way audit_logs already
-- has one (actor_profile_id = null, used by run_business_day_sweep()'s
-- own BUSINESS_DAY_CLOSED entries). Widening this one column to nullable
-- so the purge path can log honestly instead of being forced to
-- attribute an automatic action to a specific human.
-- ============================================================================

alter table public.platform_audit_logs
  alter column platform_admin_id drop not null;

-- ============================================================================
-- 0063_tenant_deletion_request.sql
--
-- Account Deletion (Feature 1): a Tenant Administrator's self-service
-- "delete my business" request. Submitting one immediately sets
-- tenants.status = 'deactivated' (already fully enforced everywhere --
-- has_permission() zeroes every permission for a deactivated tenant,
-- and the tenant layout already redirects real members to
-- /tenant-deactivated), stamped with WHEN and WHO requested it. The
-- outbox cron purges any tenant still deactivated with a pending
-- request 30+ days later (app/api/cron/outbox/route.ts); the requester
-- can cancel within that window from /tenant-deactivated, which clears
-- both columns and restores status='active'.
--
-- deletion_requested_by references profiles, not cascading -- if that
-- profile is later removed some other way, the request itself (and the
-- tenant's deactivated state) must not silently vanish with it; `on
-- delete set null` preserves "a deletion was requested" while losing
-- only who asked, mirroring platform_audit_logs.target_tenant_id's own
-- `on delete set null` reasoning (migration 0047).
--
-- The partial index only covers pending requests -- the purge sweep's
-- entire WHERE clause is `deletion_requested_at is not null`, so an
-- index over anything else would never be used.
-- ============================================================================

alter table public.tenants
  add column deletion_requested_at timestamptz,
  add column deletion_requested_by uuid references public.profiles (id) on delete set null;

create index idx_tenants_deletion_pending on public.tenants (deletion_requested_at)
  where deletion_requested_at is not null;

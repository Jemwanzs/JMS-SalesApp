-- ============================================================================
-- 0052_profile_tour_completed.sql
--
-- Guided Onboarding Tour: per-user, not per-tenant -- every new team
-- member gets their own first-run tour (permission-filtered to only
-- the steps relevant to what they can do), not just the tenant
-- creator. null = never finished or skipped; the tour auto-launches
-- once per profile the first time they reach the dashboard with this
-- still null. No separate "skipped" flag -- Finish and Skip both mean
-- "don't auto-show again," so both just set this the same way.
-- ============================================================================

alter table public.profiles add column tour_completed_at timestamptz;

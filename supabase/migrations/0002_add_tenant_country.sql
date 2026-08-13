-- ============================================================================
-- 0002_add_tenant_country.sql
--
-- Adds tenants.country, which the original scope's tenants table (source
-- doc S103) specifies but migration 0001 omitted. Caught while
-- implementing the sign-up flow (Phase 1c), which collects country per
-- spec S9.1. Fixed with a new migration rather than editing 0001, per
-- docs/17-devops-deployment.md's migration policy (migrations are never
-- edited after being applied).
-- ============================================================================

alter table public.tenants
  add column country text;

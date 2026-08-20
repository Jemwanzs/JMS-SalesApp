-- ============================================================================
-- 0030_tenant_status_add_deactivated.sql
--
-- Adds 'deactivated' to tenant_status -- a genuinely stronger state than
-- 'suspended', for the Super Admin Tenant 360 feature. Deliberately its
-- own migration, containing ONLY this statement: `ALTER TYPE ... ADD
-- VALUE` cannot be used within the same transaction it's added in
-- (Postgres rejects "unsafe use of new value" if a later statement in
-- the same implicit transaction references it), so anything that
-- actually USES 'deactivated' (has_permission()'s new branch, etc.)
-- lives in 0031, applied strictly after this one is committed.
-- ============================================================================

alter type public.tenant_status add value 'deactivated';

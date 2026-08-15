-- ============================================================================
-- 0012_fix_sale_number_uniqueness_scope.sql
--
-- Fixes a real bug found while live-verifying Phase 2f: sale_number_
-- sequences (migration 0005) is keyed (tenant_id, location_id, scope_key,
-- year) -- deliberately per-location, per docs/08-sales-engine.md's
-- numbering spec (a tenant-configurable template can include a "branch
-- prefix" precisely so different locations can run independent receipt-
-- book sequences). But sales.sale_number was only unique per
-- (tenant_id, sale_number), tenant-wide -- so two locations under the
-- same tenant, both on the still-hardcoded default template
-- SALE-{YYYY}-{000001} (no location-distinguishing token yet), collide
-- the moment each records its first sale of the year:
-- "duplicate key value violates unique constraint sales_tenant_id_sale_
-- number_key". Never surfaced before because every prior verification
-- used one location per tenant.
--
-- Fix: widen the constraint to match the sequence's actual scope,
-- (tenant_id, location_id, sale_number), rather than narrowing the
-- sequence to be tenant-wide -- the per-location design is intentional
-- (see above), the constraint was just scoped narrower than it. Once a
-- tenant-configurable template with a location-distinguishing token
-- lands (deferred fast-follow, see migration 0005's header), this
-- constraint stays correct either way.
-- ============================================================================

alter table public.sales
  drop constraint sales_tenant_id_sale_number_key;

alter table public.sales
  add constraint sales_tenant_id_location_id_sale_number_key
  unique (tenant_id, location_id, sale_number);

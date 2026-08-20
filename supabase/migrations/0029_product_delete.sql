-- ============================================================================
-- 0029_product_delete.sql
--
-- Migration 0005's own comment on `products` said "No delete policy:
-- products are archived... never deleted -- historical sales keep their
-- own snapshot regardless." This adds a real, narrow exception: a product
-- that has NEVER been sold can be permanently deleted from the catalog,
-- not just archived -- e.g. a duplicate accidentally created, or one that
-- turned out unwanted before it was ever used. A product WITH sales
-- history still cannot be deleted, on purpose, for the exact reason 0005
-- gave -- and this migration doesn't rely on app-layer discipline alone
-- to guarantee that: `sales.product_id references public.products (id)`
-- has no `on delete cascade`/`set null` (0005), so Postgres itself
-- rejects the delete with a foreign-key violation if any sales row still
-- references the product, even if the app-layer "never sold" check in
-- ProductService.delete were ever bypassed or buggy. Gated on the same
-- `products.archive` permission archiving already uses -- deleting a
-- never-sold product is the same authority tier as archiving one, not a
-- new, stricter capability.
-- ============================================================================

create policy products_delete on public.products
for delete to authenticated
using (public.has_permission(tenant_id, 'products.archive'));

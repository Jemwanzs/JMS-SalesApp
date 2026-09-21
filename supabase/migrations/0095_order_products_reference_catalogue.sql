-- ============================================================================
-- 0095_order_products_reference_catalogue.sql
--
-- CUSTOMER ORDERS MODULE — ORDER PRODUCTS REWORK.
--
-- `order_products` (migration 0092) started as a fully separate
-- catalogue -- tenants had to re-type product names and re-upload
-- photos that already exist in `products` (Sales/Inventory's own
-- catalogue). This migration turns `order_products` into a thin CONFIG
-- layer referencing `products` instead: only ordering-specific fields
-- (is_available, minimum_order_amount, display_order) remain on the
-- row; name/description/image now come from the referenced `products`
-- row, live, at read time.
--
-- Safe to drop name/description/image_storage_path/image_url without
-- touching order history: `order_items` never reads them live -- it
-- has its own product_name_snapshot/product_image_snapshot, populated
-- once at submission time (0092's own header comment on that table).
-- Only order_products.id itself must be preserved (order_items.
-- order_product_id references it) -- and it is, this migration never
-- touches that column or drops/recreates the table.
--
-- `status` (active/archived) is dropped too -- redundant once every
-- row maps to a real product that already has its own `status`;
-- "orderable" is now fully captured by is_available (the tenant's own
-- toggle) AND the referenced product's status = 'active' (checked at
-- query time in OrderProductService/PublicOrderingService, not via a
-- CHECK constraint here).
--
-- No real tenant has configured Order Products against this shape yet
-- (confirmed live before writing this migration -- MaliSafi's only 2
-- order_products rows were disconnected test data, deleted as part of
-- this change's own verification, not by this migration), so
-- product_id can go straight to NOT NULL in the same migration with no
-- backfill step.
--
-- display_order also dropped -- the new config UI doesn't expose a
-- per-order-product ordering control (spec only called it out as
-- "where applicable"), so a second, never-edited ordering column would
-- just be dead weight; the storefront instead orders by `products.
-- display_order`, which the tenant already manages for Sales and gets
-- reused here for free.
-- ============================================================================

alter table public.order_products add column product_id uuid references public.products (id);

alter table public.order_products drop column name;
alter table public.order_products drop column description;
alter table public.order_products drop column image_storage_path;
alter table public.order_products drop column image_url;
alter table public.order_products drop column status;
alter table public.order_products drop column display_order;

alter table public.order_products alter column product_id set not null;

alter table public.order_products
  add constraint order_products_tenant_product_unique unique (tenant_id, product_id);

create index idx_order_products_product on public.order_products (product_id);

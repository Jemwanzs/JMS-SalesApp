-- ============================================================================
-- 0010_product_photo_view_name_toggle.sql
--
-- Product photo-viewer enhancement: a per-product toggle for whether the
-- product name caption appears in the new enlarged photo view (see
-- features/products/components/product-photo-viewer.tsx). Mirrors the
-- existing show_expected_price column's pattern exactly -- a per-product
-- flag set by whoever creates/edits the product, not a tenant-wide
-- setting, since different products under the same tenant may reasonably
-- want different treatment.
-- ============================================================================

alter table public.products
  add column show_name_in_photo_view boolean not null default true;

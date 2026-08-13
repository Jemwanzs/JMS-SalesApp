# 10 — Products

## Schema

`products`: `tenant_id`, `location_id` (nullable — a product can be tenant-wide or location-specific), `sku`, `name`, `description`, `expected_price`, `show_expected_price`, `image_url`, `display_order`, `status`, `created_by`. `product_images` holds the Supabase Storage reference(s) — square, consistent aspect ratio, compressed, lazy-loaded (spec §42).

## Status lifecycle

`active` | `inactive` | `archived` — never hard-deleted. Historical sales keep their own name/image/price **snapshot** regardless of what happens to the underlying product afterward (see `08-sales-engine.md`).

## Display order & display mode

Administrators drag-and-drop products into a preferred `display_order`, which is the exact sequence shown on the Sales Capture screen (spec §43). Tenant-wide display mode setting controls what's shown per product card: image+name+price, image+name, or image-only (spec §14) — stored in `tenant_settings`, resolved via the config cascade (`04-multi-tenancy.md`).

## Images

Stored in Supabase Storage, bucket `product-images`, path structure `tenant_id/products/{productId}/{filename}` — access policies respect tenant membership (no cross-tenant image access even though bucket contents are otherwise similar-looking files). Images are compressed/resized client-side before upload where practical, with server-side validation of size/type regardless.

## Bulk upload

Download Product Template → Upload Completed Template → Validate → Preview → Import — same validation-first pattern as historical sales import (`12-imports-data-migration.md`), reusing `ImportService` with `type = 'products'`.

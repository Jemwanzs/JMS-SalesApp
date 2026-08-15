-- ============================================================================
-- 0007_product_images_storage.sql
--
-- Product image upload/remove/replace (product enhancements batch). See
-- docs/10-products.md's Images section: bucket `product-images`, path
-- `tenant_id/products/{productId}/{filename}`.
--
-- The bucket is PUBLIC -- images are fetched via the public URL
-- (`/storage/v1/object/public/...`), which Supabase serves without any
-- RLS check at all. This is a deliberate simplification over fully
-- tenant-private images (which would need signed, expiring URLs and a
-- re-signing story for <Image> tags): product photos aren't sensitive
-- data, and paths are UUID-namespaced (`{productId}/{uuid}-{filename}`),
-- so they're not practically guessable/enumerable even though a
-- determined party with a URL could view one cross-tenant. Documented
-- as a real trade-off, not an oversight -- see docs/20-development-progress.md.
--
-- WRITES (insert/update/delete) still go through storage.objects RLS,
-- scoped by the tenant_id folder segment + products.edit, so only an
-- authorized tenant member can ever upload/replace/remove into another
-- tenant's folder.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy product_images_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'product-images'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'products.edit')
);

create policy product_images_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'product-images'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'products.edit')
)
with check (
  bucket_id = 'product-images'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'products.edit')
);

create policy product_images_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'product-images'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'products.edit')
);

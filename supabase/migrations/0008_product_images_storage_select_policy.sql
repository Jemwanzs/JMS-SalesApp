-- ============================================================================
-- 0008_product_images_storage_select_policy.sql
--
-- Fixes a gap in migration 0007: Supabase Storage's remove() (and list())
-- perform an internal lookup against storage.objects before acting, which
-- is itself subject to RLS -- with no SELECT policy on the bucket, that
-- lookup silently found 0 rows for an authenticated caller, so remove()
-- returned success with an empty result (no error) while the object stayed
-- in place. The bucket being PUBLIC only bypasses RLS for the public-URL
-- read path (`/storage/v1/object/public/...`); the authenticated SDK path
-- (list/remove/download by an authenticated user) always goes through RLS
-- regardless of the bucket's public flag. Caught live: replacing a
-- product's image left the old file orphaned in Storage even though
-- ProductService.setImage reported success.
--
-- Gated by is_tenant_member (not products.edit) since viewing/listing
-- shouldn't require edit rights -- only the insert/update/delete policies
-- from 0007 (unchanged) gate on products.edit.
-- ============================================================================

create policy product_images_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'product-images'
  and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
);

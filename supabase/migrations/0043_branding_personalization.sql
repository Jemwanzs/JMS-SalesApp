-- ============================================================================
-- 0043_branding_personalization.sql
--
-- Two independent personalization features:
--   1. Per-user font preference -- profiles.preferred_font, null = default
--      (Outfit). Purely a client-rendering concern, no Storage involved.
--   2. Per-tenant logo -- tenants.logo_url already exists (unused since
--      migration 0001); adds the companion tenants.logo_storage_path so
--      replace/remove can delete the exact previous Storage object, same
--      role product_images.storage_path plays for products, just without
--      a whole side table since a tenant has exactly one current logo,
--      never a gallery/history.
--
-- Storage bucket `tenant-branding`: same public/UUID-namespaced-path
-- posture as `product-images` (migration 0007) -- logos aren't sensitive,
-- and paths aren't practically guessable. Deliberately DOES allow
-- image/svg+xml here, unlike product-images (migration 0041's hardening
-- pass excluded it there) -- safe specifically because the logo is only
-- ever rendered via a plain <img src>, never inline-injected, so a
-- browser never executes a <script> embedded in an SVG loaded that way.
-- file_size_limit matches product-image-upload.tsx's own 5MB MAX_BYTES.
-- ============================================================================

alter table public.profiles add column preferred_font text;

alter table public.tenants add column logo_storage_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-branding', 'tenant-branding', true, 5242880, array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
on conflict (id) do nothing;

create policy tenant_branding_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'tenant-branding'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'settings.manage')
);

create policy tenant_branding_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'tenant-branding'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'settings.manage')
)
with check (
  bucket_id = 'tenant-branding'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'settings.manage')
);

create policy tenant_branding_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'tenant-branding'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'settings.manage')
);

-- Matches product-images' own SELECT policy exactly (migration 0008's
-- fix for that bucket, same gotcha applies here): Storage's remove()/
-- list() do an internal lookup against storage.objects that's itself
-- subject to RLS, regardless of the bucket's public flag -- without this,
-- an authenticated caller's remove() during replace/delete would silently
-- report success while leaving the old object in place. The public bucket
-- flag already covers the actual <img> browser request (the public-URL
-- read path bypasses RLS entirely); this policy is only for the
-- authenticated SDK path. Gated by is_tenant_member, not settings.manage --
-- viewing shouldn't require edit rights, only the write policies above do.
create policy tenant_branding_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'tenant-branding'
  and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
);

-- Product Enhancements batch #3:
--   (2) a per-tenant system "Others" product, always exactly one per
--       tenant, never editable/deletable, always sorts last on Record
--       Sale.
--   (3) lets a Tenant Admin (users.edit) edit a teammate's display name
--       once that teammate has accepted their invite -- profiles has no
--       tenant_id column, so this policy re-derives "same tenant, active
--       membership on both sides" the same way profiles_select
--       (migration 0001) already does, adding a has_permission check on
--       top.

alter table public.products
  add column is_system boolean not null default false;

-- At most one system product per tenant -- ProductService.ensureOthersProduct
-- relies on this to make its own "does one already exist" check race-safe.
create unique index products_one_system_per_tenant
  on public.products (tenant_id)
  where is_system;

create policy profiles_update_by_admin on public.profiles
for update to authenticated
using (
  exists (
    select 1
    from public.tenant_memberships mine
    join public.tenant_memberships theirs on theirs.tenant_id = mine.tenant_id
    where mine.profile_id = auth.uid()
      and mine.status = 'active'
      and theirs.profile_id = public.profiles.id
      and theirs.status = 'active'
      and public.has_permission(mine.tenant_id, 'users.edit')
  )
)
with check (
  exists (
    select 1
    from public.tenant_memberships mine
    join public.tenant_memberships theirs on theirs.tenant_id = mine.tenant_id
    where mine.profile_id = auth.uid()
      and mine.status = 'active'
      and theirs.profile_id = public.profiles.id
      and theirs.status = 'active'
      and public.has_permission(mine.tenant_id, 'users.edit')
  )
);

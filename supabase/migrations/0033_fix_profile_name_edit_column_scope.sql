-- Fixes a real gap in migration 0032's profiles_update_by_admin policy,
-- caught by a security audit: Postgres RLS UPDATE policies restrict
-- which ROWS a statement can touch, not which COLUMNS -- so as written,
-- any Tenant Admin holding users.edit could update a teammate's email,
-- phone, or any other profiles column, not just full_name as intended.
--
-- Fixed the same way this codebase already solves "check a specific
-- permission, then allow only a narrow, specific write" elsewhere
-- (void_sale/correct_sale/reverse_sale, migrations 0006/0026): a
-- SECURITY DEFINER function that re-derives the same authorization check
-- and then updates exactly one column, with no generic table-level
-- UPDATE policy standing behind it.

drop policy if exists profiles_update_by_admin on public.profiles;

create or replace function public.update_teammate_name(p_target_profile_id uuid, p_full_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'A name is required';
  end if;

  if not exists (
    select 1
    from public.tenant_memberships mine
    join public.tenant_memberships theirs on theirs.tenant_id = mine.tenant_id
    where mine.profile_id = auth.uid()
      and mine.status = 'active'
      and theirs.profile_id = p_target_profile_id
      and theirs.status = 'active'
      and public.has_permission(mine.tenant_id, 'users.edit')
  ) then
    raise exception 'Not authorized to edit this user''s name';
  end if;

  update public.profiles
  set full_name = trim(p_full_name)
  where id = p_target_profile_id;
end;
$$;

grant execute on function public.update_teammate_name(uuid, text) to authenticated;

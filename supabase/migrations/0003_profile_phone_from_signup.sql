-- ============================================================================
-- 0003_profile_phone_from_signup.sql
--
-- handle_new_auth_user() (from migration 0001) only populated full_name
-- from raw_user_meta_data. Extend it to also capture phone, so the
-- sign-up flow (Phase 1c) doesn't need a separate post-signup profile
-- update -- which would silently no-op anyway when email confirmation is
-- required, since there's no authenticated session yet at that point for
-- the profiles_update_own RLS policy to allow through. Passing phone in
-- signUp()'s options.data and capturing it here keeps profile creation
-- fully transactional with the auth.users insert.
-- ============================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

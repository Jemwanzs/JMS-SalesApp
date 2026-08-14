-- ============================================================================
-- 001_platform_admin_bootstrap.sql
--
-- Grants super_admin on platform_admins to the bootstrap email
-- (PLATFORM_ADMIN_BOOTSTRAP_EMAIL in .env.example, spec S92:
-- jamosammy@gmail.com). This is a SEED, not a migration -- it depends on
-- a specific auth user existing, which is environment-specific (and
-- won't be true immediately after 0004 is applied, before that person
-- has signed up in the app). Run this manually whenever convenient, any
-- number of times -- it's a no-op if the profile doesn't exist yet, and
-- a no-op on repeat runs via ON CONFLICT.
--
-- The architecture never hardcodes this email in application logic
-- (docs/15-super-admin.md) -- this is the ONE place it appears, as a
-- one-time bootstrap value, not a check anywhere in services/ or app/.
-- ============================================================================

insert into public.platform_admins (profile_id, role)
select id, 'super_admin'
from public.profiles
where email = 'jamosammy@gmail.com'
on conflict (profile_id) do nothing;

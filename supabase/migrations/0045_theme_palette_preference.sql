-- ============================================================================
-- 0045_theme_palette_preference.sql
--
-- My Preferences (Theme & Colors): a per-user curated accent-color palette,
-- same "unset = default" convention as profiles.preferred_font (migration
-- 0043). Deliberately no tenants-side column -- this is independent of the
-- tenant's own logo/branding (migration 0043), never shared across users.
-- No RLS change needed: profiles_update_own (migration 0001) already lets
-- a user update their own row, the same policy preferred_font already
-- relies on.
-- ============================================================================

alter table public.profiles add column color_palette text;

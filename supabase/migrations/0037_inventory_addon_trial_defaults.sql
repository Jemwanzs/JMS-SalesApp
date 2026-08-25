-- Product Enhancements follow-up: give every tenant a real default trial
-- for the Inventory add-on (0034 seeded inventory_addon_trial_days=0 --
-- "no trial until Super Admin configures one" -- the user has now made
-- that call: 48 hours for everyone, 180 days for the platform admin's
-- own tenant). Mirrors the existing base-subscription pair
-- (trial_days / platform_admin_trial_days, migration 0009) exactly --
-- same two-key shape, same "not a hardcoded email" resolution
-- (services/BillingService.ts's resolveAddonTrialDays checks real
-- platform_admins membership of the tenant's billing owner, never a
-- literal email string).

update public.platform_settings
set value = '2'::jsonb
where key = 'inventory_addon_trial_days';

insert into public.platform_settings (key, value) values
  ('inventory_addon_platform_admin_trial_days', '180'::jsonb)
on conflict (key) do nothing;

-- ============================================================================
-- 0023_billing_plan_tiers.sql
--
-- Billing enhancement (post-Phase 6, user-requested): replaces the
-- single placeholder "Standard" monthly plan with a real menu of
-- fixed-duration packages, each with its own price -- the duration/
-- price the user PICKS at checkout is what actually gets charged and
-- what actually determines the resulting subscription period, not a
-- fixed 30-day assumption. Also shortens the default trial to 48 hours
-- (2 days) and gives a tenant owned by a platform admin a 180-day
-- trial instead, via platform_settings (no email hardcoded a second
-- time -- see below).
--
-- subscriptions.plan_id becomes NULLABLE: a TRIAL subscription has no
-- package chosen yet (nothing to charge yet), so there is nothing
-- correct to put there until the user actually picks one at checkout.
-- billing_plans.interval loses its 'monthly'/'yearly' vocabulary limit
-- and becomes a free-text short label ("2 days", "monthly", "annually")
-- for the picker UI -- duration_days is what actually drives period
-- computation now, not this column.
-- ============================================================================

alter table public.subscriptions alter column plan_id drop not null;

alter table public.billing_plans add column duration_days integer not null default 30;
alter table public.billing_plans drop constraint if exists billing_plans_interval_check;

update public.billing_plans set is_active = false where code = 'standard_monthly';

insert into public.billing_plans (code, name, price, currency, interval, duration_days, features) values
  ('pass_2d', '2-Day Pass', 100, 'KES', '2 days', 2, '[]'::jsonb),
  ('pass_3d', '3-Day Pass', 150, 'KES', '3 days', 3, '[]'::jsonb),
  ('pass_4d', '4-Day Pass', 175, 'KES', '4 days', 4, '[]'::jsonb),
  ('pass_5d', '5-Day Pass', 225, 'KES', '5 days', 5, '[]'::jsonb),
  ('pass_7d', 'Weekly', 400, 'KES', '7 days', 7, '[]'::jsonb),
  ('pass_15d', '15-Day Pass', 750, 'KES', '15 days', 15, '[]'::jsonb),
  ('pass_30d', 'Monthly', 1000, 'KES', 'monthly', 30, '[]'::jsonb),
  ('pass_60d', '60-Day Pass', 2000, 'KES', '60 days', 60, '[]'::jsonb),
  ('pass_90d', '90-Day Pass', 2750, 'KES', '90 days', 90, '[]'::jsonb),
  ('pass_180d', '180-Day Pass', 5500, 'KES', '180 days', 180, '[]'::jsonb),
  ('pass_365d', 'Annual', 10000, 'KES', 'annually', 365, '[]'::jsonb)
on conflict (code) do nothing;

update public.platform_settings set value = '2'::jsonb where key = 'trial_days';

-- Not a hardcoded email check anywhere in application code (docs/15-
-- super-admin.md's own principle) -- BillingService.bootstrapTrialSubscription
-- checks whether the tenant's owner is a real platform_admins row and,
-- if so, reads THIS setting instead of the normal trial_days default.
-- Any current or future platform admin gets the longer trial on their
-- own tenant automatically, not just the one bootstrap email.
insert into public.platform_settings (key, value) values ('platform_admin_trial_days', '180'::jsonb)
on conflict (key) do nothing;

-- Hardening roadmap Phase 6.4 (docs/22-hardening-roadmap.md): the
-- Google Drive backup workflow (.github/workflows/backup.yml,
-- scripts/backup-to-drive.mjs) reads these two settings before doing
-- any real work -- same shape and posture as every other global policy
-- value in this app (trial_days, grace_period_days, and the Inventory
-- add-on's own trial-days keys all follow this identical pattern: one
-- platform_settings row, a sane seeded default, no dedicated table).
--
-- backup_frequency_hours: how often a real backup should actually run.
-- The workflow itself ticks hourly (GitHub Actions cron entries are
-- static in the workflow file, so "configurable cadence" has to be
-- read from here instead, the same trick run_business_day_sweep()
-- already uses -- tick often, act conditionally) and skips unless at
-- least this many hours have passed since the most recent backup file
-- actually in the Drive folder (the script trusts Drive's own
-- timestamps as the source of truth for "when was the last backup",
-- not a separate DB column that could drift out of sync with it).
--
-- backup_retention_count: how many of the most recent backups to keep
-- in the Drive folder -- older ones are deleted after a successful
-- new upload, so the folder doesn't grow forever and silently exhaust
-- Drive's storage quota.

insert into public.platform_settings (key, value) values
  ('backup_frequency_hours', '24'::jsonb),
  ('backup_retention_count', '30'::jsonb)
on conflict (key) do nothing;

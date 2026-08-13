# 13 — Notifications

## Channels

In-app (core, always available) and Email (via Resend). Push is architecturally left possible (see `03-database-schema.md`'s `notification_preferences.channel`) but not required for Phase 1–7.

## Categories

Sales, Security, Billing, Reports, System, Access Requests (spec §68) — the Notification Centre bell groups by these.

## Example triggers

Sale correction, business day closing/reopened, location access request, trial ending, payment due/failed, weekly report ready, user invited, security alert (spec §67).

## Delivery mechanism: outbox pattern

Nothing writes directly to Resend/push from inside a database transaction or a pg_cron function. State-changing events (business-day close, subscription change, temporary-access decision, etc.) insert a row into `notifications` (in-app, immediate — RLS-readable by the target user) and, where email is also warranted, a `report_jobs`-style outbox entry. `app/api/cron/outbox` (Vercel Cron) drains the email/report-delivery side, so external I/O failures never block or roll back the underlying state change, and retries are independent and observable (see `09-business-day-engine.md`).

## Preferences

`notification_preferences` (`tenant_id, profile_id, channel, category, enabled`) lets each user opt in/out per category/channel. Users can mark notifications read / mark all read / jump to the related record from the Notification Centre (spec §68).

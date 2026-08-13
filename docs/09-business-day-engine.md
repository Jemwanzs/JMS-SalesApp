# 09 — Business Day Engine

## Concept

A `business_days` row exists per `(tenant_id, location_id, business_date)`, with status: `SCHEDULED -> OPEN -> CLOSING -> CLOSED`, or `CLOSED -> REOPENED -> CLOSED` (auto-relock). Sales can only be created while the owning business day is `OPEN` — enforced in `has_permission`/`SalesService`, not just the UI.

## Timezone handling

Effective timezone for a location = `COALESCE(locations.timezone, tenants.timezone)`. `business_date` is always computed from "now at the location's effective timezone" — never derived from UTC directly in application code, since a location could be mid-business-day in its own timezone while UTC has already rolled to the next calendar date.

Auto open/close times come from `location_hours` (weekly pattern), with `special_hours` overriding specific dates (holidays, stock-take days, extended hours — spec §65).

## Scheduled-job mechanism: pg_cron for state, Vercel Cron for side effects

**Decision**: `pg_cron` runs a SQL sweep every few minutes, directly inside Postgres, that:

1. Computes "now at location timezone" for every location.
2. Compares against scheduled open/close times (respecting `special_hours`).
3. Transitions any due `business_days` row: `SCHEDULED -> OPEN`, `OPEN -> CLOSING -> CLOSED` (computing daily aggregates as part of the close transition), and auto-relocks any `REOPENED` day whose `reopen_expires_at` has passed.

This sweep **never calls external APIs directly** (no Resend email, no push notification, no Sentry call from SQL). Instead it writes to an **outbox** — inserting rows into `report_jobs` / `notifications` — inside the same transaction as the state change. A lightweight **Vercel Cron** route (`app/api/cron/outbox`) polls those outbox tables every 1–5 minutes and performs the actual external I/O (email delivery, report file generation, push notifications), marking jobs completed/failed with retry.

**Why this split, not one extreme or the other**:
- Pure Vercel Cron doing both the DB transition *and* the email risks partial failure with no natural retry boundary (state changes but the email call fails, or vice versa).
- Pure pg_cron + Edge Functions for everything (`pg_net` calling an Edge Function from SQL) is possible but couples DB transaction timing to external API latency/availability, and Edge Functions have less mature local dev/observability tooling than a Next.js route with Sentry already wired in.
- This split gives transactional correctness where it matters (business-day state, daily aggregates) and independent retryability where external systems are involved.

Manual early-open, forced close, and the time-boxed reopen window all reuse the **same** sweep — its job is generically "process any `business_days` row whose next scheduled transition time has passed," which naturally covers auto-relock of a `REOPENED` day once `reopen_expires_at` elapses, with no separate code path.

## Manual open

Authorized user (`business_day.open`) can open before configured hours. Requires a reason, logged automatically (spec §25).

## Closing

At the configured time (or on forced close): stop new transactions, finalize daily figures, lock normal editing, calculate daily aggregates, generate the daily report (queued via the outbox), record the closing timestamp. Configurable closing warnings at 60/30/15/10/5 minutes before close (spec §27).

## Forced close

`business_day.close` + required reason + explicit confirmation ("Closing this day will prevent staff from recording additional sales. Continue?" — spec §28).

## Reopening — highly privileged

`business_day.reopen` requires: reason, MFA or passcode, optional approval (tenant-configurable, routed through the Approval Engine — see `19-security-checklist.md` §5), a bounded reopen duration ("Reopen until: 18:30"), and produces an immutable audit record. At the configured expiry, the day auto-relocks via the sweep described above — no manual step required, and no way to "forget" to relock a reopened day.

## Daily sales summary

Computed as part of the close transition and stored in `business_days.aggregates` (JSONB) plus a `reports` row: gross sales, transaction count, top product, highest sales person, average sale, vs. previous day (spec §30). Feeds directly into `11-analytics-reports.md`'s rule-based insights engine.

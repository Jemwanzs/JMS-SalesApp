# 09 — Business Day Engine

## Concept

A `business_days` row exists per `(tenant_id, location_id, business_date)`, with status: `SCHEDULED -> OPEN -> CLOSING -> CLOSED`, or `CLOSED -> REOPENED -> CLOSED` (auto-relock). Sales can only be created while the owning business day is `OPEN` — enforced in `has_permission`/`SalesService`, not just the UI.

## Timezone handling

Effective timezone for a location = `COALESCE(locations.timezone, tenants.timezone)`. `business_date` is always computed from "now at the location's effective timezone" — never derived from UTC directly in application code, since a location could be mid-business-day in its own timezone while UTC has already rolled to the next calendar date.

Auto open/close times come from `location_hours` (weekly pattern), with `special_hours` overriding specific dates (holidays, stock-take days, extended hours — spec §65).

## Cross-midnight business hours

A location's hours may cross midnight (e.g. open 07:00, close 03:00 the next calendar day) — auto-detected whenever `closing_time < opening_time` for a given day's effective hours, never hard-coded to a specific cutoff like 03:00. A sale, expense, or stock movement recorded at any point in that window belongs to the **same** business day as the one that opened at 07:00, not to a new day starting at midnight. Calendar date (`now()`'s raw date) and business date (which `business_days` row a transaction is attributed to) are deliberately different concepts — every read/write path that needs "today" in a business sense resolves the business date explicitly rather than assuming it equals the calendar date.

**`resolve_effective_business_date(p_tenant_id, p_location_id)`** (migrations `0055`–`0061`, see below) is the single canonical resolver, used by both the write path (`StockService.recordMovement`'s `occurredOn`; `SalesService.recordSale` already sourced `sale_date` from the resolved business day directly) and the read/display path (`BusinessDayService.getTodayBusinessDay`/`getEffectiveBusinessDate`, used by Sales capture, Sales History, Analytics, Reports, the Sales-page leaderboard, Expenses, and Stock reconciliation). Given "now," it:

1. Checks **yesterday's** calendar-date business day first — if its hours cross midnight and "now" still falls within the extended window, that's the effective business date (this is what keeps a 01:00 sale attributed to the day that opened at 07:00 the day before). If a `business_days` row already exists for that date, its own frozen `scheduled_open_time`/`scheduled_close_time` is the window used — not a fresh `special_hours`/`location_hours` lookup — so an hours-config edit made after the day opened can't retroactively move an already-open day's deadline out from under it; fresh config is only consulted when no row exists yet.
2. Else checks **today's** calendar-date business day the same way.
3. Else — the gap between closing and the next opening — falls back to the most recently **closed** business day for that location, bounded by its own `closed_at` instant actually having passed (not just its `business_date` label — a row can't be trusted as "the last completed day" if its own close time hasn't genuinely happened yet), so History/Analytics/Reports/Expenses keep showing the last completed day's data instead of going blank. A brand-new location with no history yet falls back to today's raw calendar date instead.

`BusinessDayService.getTodayBusinessDay()` only returns a row when the resolver reports the day as still live (`OPEN`/`REOPENED`) — this is the "can a sale be captured right now" signal, and correctly returns `null` during the closing-to-next-opening gap (you can't sell at 4am if hours are 7–3). `getEffectiveBusinessDate()` returns the resolved date regardless of liveness, for display/reporting defaults that must keep showing the gap period's last completed day rather than an empty "today."

The sweep (below) independently needed a second pass so a cross-midnight day actually closes at its real deadline: its original per-location loop only ever evaluates the **current** calendar date's row, so once the calendar rolls past midnight a still-`OPEN` cross-midnight day was never revisited by any later tick. The added pass scans every `OPEN` row directly (regardless of calendar date) and closes any whose own stored `scheduled_close_time` — cross-midnight adjusted — has passed.

`0055` shipped the resolver and the sweep's new pass; `0056`–`0061` are same-day live-testing fixes for bugs those two turned up under real conditions (a PL/pgSQL type mismatch in the new sweep pass, a column-vs-OUT-parameter ambiguity, the gap fallback trusting a future-dated or not-yet-actually-closed row, and the frozen-schedule fix described in step 1 above) — `resolve_effective_business_date`'s current, authoritative body is `0061`'s.

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

Authorized user (`business_day.open`) can open before configured hours. Requires a reason, logged automatically (spec §25). If the tenant has ever created a security passcode (Security → Download security — see below), opening also requires it; a tenant that's never set one up sees no change in behavior. Unlike reopen, this is deliberately conditional, not always-on — opening is a routine everyday action, not the "highly privileged" reopen case.

`BusinessDayService.getTodayBusinessDayRow()` — a direct, unfiltered lookup of today's own `business_days` row by calendar date — backs both this gate's existence check and the Sales page's closed-vs-never-opened distinction. It's deliberately separate from `getTodayBusinessDay()` (only ever returns a row when live) and `getEffectiveBusinessDate()` (can resolve to yesterday or the gap period's last closed day): those two answer "what's the tenant's current effective business day," this one answers "does *today's own* row exist, and in what state" — the question a manual action or today-specific UI decision actually needs.

## Closing

At the configured time (or on forced close): stop new transactions, finalize daily figures, lock normal editing, calculate daily aggregates, generate the daily report (queued via the outbox), record the closing timestamp. Configurable closing warnings at 60/30/15/10/5 minutes before close (spec §27).

## Forced close

`business_day.close` + required reason + explicit confirmation ("Closing this day will prevent staff from recording additional sales. Continue?" — spec §28).

## Reopening — highly privileged

`business_day.reopen` requires: reason, MFA or passcode, optional approval (tenant-configurable, routed through the Approval Engine — see `19-security-checklist.md` §5), a bounded reopen duration ("Reopen until: 18:30"), and produces an immutable audit record. At the configured expiry, the day auto-relocks via the sweep described above — no manual step required, and no way to "forget" to relock a reopened day.

## Daily sales summary

Computed as part of the close transition and stored in `business_days.aggregates` (JSONB) plus a `reports` row: gross sales, transaction count, top product, highest sales person, average sale, vs. previous day (spec §30). Feeds directly into `11-analytics-reports.md`'s rule-based insights engine.

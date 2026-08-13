# 11 — Analytics & Reports

## KPIs

Total Sales, Transactions, Average Sale, Highest Sale, Lowest Sale, Products Sold, Active Sales Users (spec §33). Product-level analytics: image, name, total revenue, sale count, trend vs. prior period (spec §34).

## Permission-gated filters

```
Today | Yesterday | This Week | Last Week | This Month | Last Month | Custom Date | Date Range
```

Backed by independent permissions: `analytics.today` (implicit with `view_own`), `analytics.past_dates`, `analytics.date_range`, `analytics.all_users`, `analytics.products`, `analytics.locations` (spec §35). The date-range dimension specifically is checked at the query-parameter level inside `AnalyticsService` rather than purely in RLS, since "this permission only applies to date ranges the caller explicitly requests" isn't cleanly expressible as a row-level policy — RLS still enforces tenant isolation on the underlying `sales` rows regardless.

## Date-range analytics

Selecting a range instantly computes total sales, transaction count, average sale, product performance, user performance, day-by-day breakdown, highest/lowest day, and trend (spec §36) — computed from `sales` + the precomputed `business_days.aggregates` where possible, to avoid re-scanning raw sales rows for every dashboard load.

## Snapshot vs. current-catalog identity

Product analytics grouped by `product_id` implicitly use the product's **current** name/status even though individual `sales` rows carry their own immutable snapshot (see `08-sales-engine.md`). Every `AnalyticsService` report method documents which identity it's using so a chart label and a drill-down row not matching isn't mistaken for a bug.

## Scheduled reports

Daily report generated automatically at business-day close (`09-business-day-engine.md`). Weekly report generated on a tenant-configurable day (default Sunday). Both are produced by the outbox-drain worker (`app/api/cron/outbox`), stored via `reports`/`report_jobs`, and delivered via Resend if the tenant has report-ready notifications enabled.

Report types: Daily Sales, Weekly Sales, Monthly Sales, Product Performance, User Performance, Sales Trend, Location Performance, Custom Period, Sales Corrections, Void/Reversal Report (spec §38).

## Rule-based insights engine (v1 — no LLM)

Deterministic rules evaluated against computed aggregates, written to `insights_snapshots`, surfaced as plain-language cards:

```
current_week_sales > previous_week_sales        -> "Sales increased by X%"
product_share > 30%                              -> "<Product> represents X% of business sales"
one weekday repeatedly underperforms             -> "Highlight recurring low-performance day"
today's sales 25% below typical same-time sales  -> Alert authorised manager
```

This is intentionally cheap and predictable to run — no per-tenant inference cost, no model latency. A generative narrative layer (LLM-authored prose on top of these same computed facts) is an explicitly deferred future enhancement, not part of Phase 3.

## Smart alerts / Daily Pulse (Phase 3 stretch, still rule-based)

"Sales are 31% below normal for this time of day", "No sales recorded today despite the business day being open for 3 hours", daily pulse summary (today's total, transaction count, top product, active sellers, strongest period). These reuse the same insights-engine rule format — no separate subsystem.

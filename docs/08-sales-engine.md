# 08 — Sales Engine

## Sale record

Every sale stores (spec §16): Sale ID (UUID), Sale Number, Barcode/Reference, Tenant, Location, Product, **Product Name/Image/Expected Price Snapshots** (captured at time of sale — see below), Actual Amount, Quantity, User, Date, Time, Status (Open/Locked/Corrected/Voided/Reversed/Deleted), Device metadata, Created At.

## Decided: `actual_amount` is the total charged

The spec doesn't explicitly resolve unit-price vs. total given the optional `quantity` field. **Resolved**: `actual_amount` is always the **total** amount charged for that sale line — resilient to negotiated/discounted pricing, and matches "record what was actually sold for." `quantity` is informational only; per-unit figures (`actual_amount / quantity`) are derived in analytics, never stored separately.

## Snapshot fields are intentional, not a bug

`product_name_snapshot`, `product_image_snapshot`, `expected_price_snapshot` are captured at sale time and never retroactively updated if the product is later renamed/repriced — this preserves historical accuracy of what was actually charged. **Documented nuance**: product-level analytics grouped by `product_id` will implicitly show a product's *current* name in aggregate views even though an individual sale row still displays its old snapshot name. Not a bug, but `AnalyticsService` documents per-report which identity (snapshot vs. current catalog) it uses, so a chart label mismatching a drill-down row isn't mistaken for a defect.

## Sale numbering

Tenant-configurable template stored in `tenant_settings`, e.g. `SALE-{YYYY}-{000001}`, `ABC-{DDMMYYYY}-{00001}`, `BRANCH-{YYYYMMDD}-{0001}` (spec §17). Configuration variables: business prefix, branch prefix, year/month/day, sequential number, product prefix, user prefix.

**Assignment mechanism**: `sale_number_sequences` keyed `(tenant_id, location_id, scope_key, year)` backs an atomic counter. A `BEFORE INSERT` trigger on `sales` performs a single `UPDATE ... SET current_value = current_value + 1 WHERE ... RETURNING current_value` (upserting the first row per scope via `INSERT ... ON CONFLICT DO UPDATE`), which is atomic under Postgres MVCC without an explicit `SELECT ... FOR UPDATE`. Small gaps on rollback are acceptable (not a gapless-sequence requirement); **uniqueness within scope** is what matters.

## Duplicate submission protection (idempotency)

The client generates one UUID `idempotency_key` when the sale-entry form is first opened/mounted — **not** regenerated on each submit attempt — so a double-tap, timeout-retry, or resubmit-after-flaky-network all carry the same key. The insert uses:

```sql
INSERT INTO sales (..., idempotency_key) VALUES (...)
ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
RETURNING *;
```

If zero rows return, the server looks up the existing row by that key and returns it as a successful idempotent-replay response — the client never needs to distinguish "this was my duplicate" from "this was a genuine retry." Uniqueness is permanent (no TTL cleanup), so a client bug reusing a UUID across genuinely different sale intents is a **client-side implementation discipline requirement** (generate fresh on mount, never reuse across distinct submissions) — the server design intentionally cannot and should not try to distinguish that case once it commits to full idempotent-replay semantics.

## Sale editing rules

Migration `0074` replaced the original fixed-minutes edit window with two tenant-configurable **modes** (`tenant_settings.sale_edit_window_mode`):

- **`business_day`** (default) — a sale stays editable by its own recording user for as long as its business day is still `open`/`reopened`; the window closes the moment that day closes, regardless of how many hours have passed.
- **`hours`** — a fixed window (`sale_edit_window_hours`, default 2) counted from `created_at`, independent of the business day's own state.

Within the window, the recording user (holding `sales.edit_window`, on their own sale) can edit; outside it, only `sales.correct_historical` can still reach it (see "Admin historical correction" below).

## Never physically delete a sale

Financial records are never hard-deleted. Instead:

- **VOID** — mark a sale voided with a required reason.
- **CORRECT** — void the original, create a replacement sale, link via `sale_corrections`. As of migration `0078`, a Sale Date change specifically is applied **in place** on the existing row instead (same `id`/`sale_number`, no replacement) — see "Correcting a sale's date" below; amount/quantity/product/notes corrections still use the replacement-row mechanism.
- **REVERSE** — same pattern for reversing entries.
- **DELETE** (migration `0074`) — a distinctly simpler, self-service-only mutation: `delete_sale()` flips `status` to `'deleted'` for the sale's own recording user, no mandatory reason, gated by a short tenant-configurable window (`sale_deletion_enabled`/`sale_delete_window_minutes`, default 2 minutes) rather than the broader edit window above. Unlike voided/corrected/reversed sales — which stay visible in Sales History with a status badge for audit continuity — a deleted sale disappears from Sales History entirely (`SalesService.listRecent`'s `.neq("status", "deleted")`), though the row itself is never actually removed from the table.

`sale_corrections` stores `old_values`/`new_values` (JSONB), `reason`, `requested_by`, `approved_by` (nullable), and an `approval_request_id` back-reference into the generic Approval Engine (see `19-security-checklist.md` §5) — the audit record is immutable (no UPDATE/DELETE policy, same pattern as `audit_logs`).

## Admin historical correction

After the normal edit window, an authorized administrator (`sales.correct_historical`) can still correct a sale, but must supply a reason; depending on tenant config (`sale_correction_requires_approval`), this either self-approves (if the actor already holds the permission and approval isn't required) or routes through the Approval Engine. Either way, the audit trail format is identical — see the Approval Engine design.

### Correcting a sale's date

Correct Sale can also move a sale to a different, never-future business date, alongside (or instead of) amount/quantity/product/notes changes — validated against `resolve_effective_business_date()`, never a raw calendar-date comparison. Unlike every other correctable field, a date change is applied **in place** on the same row (same `id`, same `sale_number` — explicitly not a replacement, per the feature's own "preserve transaction identity" requirement) via `_apply_sale_date_change()` (migration `0078`): it updates `sales.sale_date`/`business_day_id` directly, relocates the sale's own existing `stock_movements` row's `occurred_on` to match (no reversal/re-deduction pair, since there's no `status` transition to trigger one), and records the change in `sale_corrections` the same way any other correction is. If a date change is combined with an amount/quantity/product/notes change in the same request, the replacement-row correction runs first and the date change then applies to the resulting replacement row.

## Sales History filtering and Corrected Records

Sales History defaults to today's business date and can be narrowed by a single date or by product — "Filter by product" is an exact match against the live product catalog (a dropdown), not free-text search, so a later product rename never breaks an existing filter. Corrected (superseded) sales are hidden from the default list — they're still real, auditable rows, just not useful clutter in the everyday view — and surface instead in a dedicated "Corrected Records" sub-view (`?view=corrected` on the same page, reached via a button under the product filter), which shows only `status = 'corrected'` sales with no date default of its own (a corrected original keeps whatever date it originally had).

## Recording a sale (form flow)

Tap product → bottom sheet (image, name, expected price for reference, Amount Sold, Quantity if enabled, Notes optional) → Record Sale → success confirmation (`✓ Sale Recorded`, amount, product, sale number, time) → automatic return to Capture Sales, no unnecessary intermediate navigation (spec §15, §18).

## Poor-network protection

Because sales are entered from mobile devices on potentially flaky connections: prevent duplicate submits (idempotency, above), clearly show a pending state, support safe retry, preserve unsent form values if a submit fails, display connectivity state, and never show "successful" before the server actually confirms (spec §116). Offline capture mode is a documented future enhancement (`01-development-roadmap.md` does not include it in Phase 1–7), architecturally left possible by keeping the idempotency-key + snapshot design client-generatable ahead of a network round trip.

## Sales visibility

`sales.view_own` (default) — a Sales User sees only "My Sales Today" / their own history. `sales.view_all` is a separate, optional grant that unlocks business-wide sales visibility without granting any administrative rights (spec §31–32).

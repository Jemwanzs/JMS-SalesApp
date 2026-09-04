# 21 — Inventory Management (optional add-on)

## What this is

Inventory Management is a **separately-priced, separately-billed add-on module**, off by default, never bundled into or required by the base Sales product. A tenant that never turns it on sees zero behavioral change anywhere in the app — no new nav item, no new settings, no new schema-visible surface. This reverses the explicit non-goal `00-project-overview.md` used to list ("Inventory / stock management") into an explicit product decision, scoped narrowly to exactly this module.

Turning it on reuses the existing Product Master — there is no separate "inventory product" to create. A product already in the catalog simply gains `tracks_inventory = true`, a unit of measure, and (optionally) a low-stock threshold via its own edit form.

## Entitlement — two independent conditions, both required

```
enabled = tenant_settings.inventory_enabled (display flag)
      AND tenant_addon_subscriptions.status in (TRIAL, ACTIVE, PAYMENT_DUE, GRACE_PERIOD)
```

`lib/inventory/entitlement.ts`'s `getInventoryEntitlement()`/`assertInventoryEnabled()` compute this once per request (tenant layout) and hydrate it into `TenantContext` for the bottom nav, and every Stock page/action re-asserts it server-side independently — the nav hiding the entry point is a UX convenience, not the enforcement. Deliberately **not** folded into the SQL `has_permission()` function itself, to keep the highest-blast-radius piece of the whole security model untouched by an add-on's billing state.

Turning the module **off** (the Settings toggle) only ever flips `tenant_settings.inventory_enabled` — it never cancels or touches billing. Only Super Admin's `deactivateAddonForTenant` (`/admin/tenants/[id]`) actually cancels a subscription; a tenant hiding the module from their own nav is a display choice, not a billing event.

## Billing

Its own independent subscription state machine, own Paystack checkout, own Super-Admin-configurable pricing/discount/trial — see `14-billing-paystack.md`'s "Add-on billing" section and `03-database-schema.md` §3.10 for the full schema. Super Admin configures pricing/trial at `/admin/addons`; per-tenant force-activate/deactivate/credit lives on that tenant's Tenant 360 page.

## Units of measure

A fixed, code-level catalog (`lib/inventory/units-of-measure.ts`) grouped by category (Count, Weight, Volume, Length/Area, Other) covering the common units small businesses actually use (pieces, boxes, cartons, crates, kg, litres, etc.), plus a **Custom Unit** escape hatch (`products.unit_of_measure_is_custom = true` stores the tenant's own free-typed label verbatim). No database table for the catalog itself — a closed, product-level labeling concern with no per-tenant configurability need beyond the free-text option.

## The stock ledger

`stock_movements` is an immutable, append-only ledger — the same pattern `sales` already established (denormalized `tenant_id`, snapshot columns so a later product rename/UOM change doesn't rewrite history, no UPDATE/DELETE RLS policy ever). Every change in stock, whatever the reason, is a new signed-quantity row:

| Movement type | Sign | Reason required? |
|---|---|---|
| `opening_stock`, `stock_in` | positive | no |
| `stock_out` | negative | no |
| `adjustment_increase` | positive | **yes** |
| `adjustment_decrease` | negative | **yes** |
| `damaged`, `expired`, `lost` | negative | **yes** |
| `reconciliation_variance` | either | **yes**, whenever the variance is nonzero |
| `sale` | negative | no — automatic, see "Sales integration" |
| `sale_reversal` | positive | no — automatic, see "Sales integration" |

The sign convention lives in exactly one place (`StockService.recordMovement`'s `INCREASES_BALANCE` set and the mirrored `record_stock_reconciliation()` SQL function) — current balance is always a plain `SUM(quantity)`, never a per-type CASE expression scattered across every reader. `stock_balances` is a plain (non-materialized) view over that sum — movement volume for small-business daily stock is modest enough that avoiding refresh staleness is worth more than the marginal query cost of a live aggregate; revisit only if a real performance problem shows up. The view is `security_invoker` (migration `0066`, fixing a real cross-tenant leak the view's own earlier comment had gotten backwards about Postgres's actual default).

`reconciliation_variance` is deliberately not a valid input to the general `recordMovement` path — it's written only by the reconciliation RPC below, atomically alongside the reconciliation row it belongs to, so the ledger and the reconciliation log can never disagree about whether a variance was actually recorded. `sale`/`sale_reversal` are similarly never inserted through `recordMovement` — see "Sales integration" below.

Every row also carries `unit_cost_snapshot`/`unit_price_snapshot` (migration `0067`), copied from the product's `cost_price`/`expected_price` **at the moment of the movement**, never re-derived from the product's current price later. This is what lets every monetary figure downstream (Overview cards, value-based reconciliation, reports) stay accurate even after a product's price changes — the movement already knows what it was worth when it happened.

## Cost price & per-product control method

`products.cost_price` (nullable) is the acquisition/purchase cost per unit — distinct from the existing `expected_price` (selling price). `products.stock_control_method` (`'quantity'` default, or `'value'`) is a per-product **reporting preference, not a second ledger**: both methods write to the exact same `stock_movements` table with the exact same signed `quantity` column. A quantity-controlled product's Reconciliation/Overview views foreground units (opening/in/out/expected-closing in the product's own unit of measure); a value-controlled product's views foreground currency, computed by multiplying each movement's own quantity by its own snapshot price — never a duplicate source of truth for the balance itself.

## Daily reconciliation

**Quantity-based** (the original design, unchanged):

```
Opening + Stock In − Stock Out = Expected Closing
Actual Physical Count − Expected Closing = Variance
```

**Value-based** (migration `0067`/`0068`):

```
Opening Value + Stock Added Value = Expected Sales Value   (both from movements' own price snapshots)
Expected Sales Value − Actual Recorded Sales − Actual Remaining Value − Valid Adjustments = Unexplained Variance
```

`Actual Recorded Sales` is real revenue (`sales.actual_amount`, excluding voided/corrected originals — the same exclusion every gross-sales aggregate in this app already applies), not a theoretical full-price figure — so a legitimate discount shows up as an accounted-for gap, not phantom variance. `Actual Remaining Value` and `Valid Adjustments` (discounts/damage/spoilage/complimentary/etc., already reflected in the ledger for the day) are what the reconciler enters; only what's left over after subtracting both becomes the real, unexplained variance — the reconciliation never assumes every difference is theft or loss.

A quantity variance of exactly zero needs no reason and writes no offsetting ledger row; any nonzero variance requires a reason. `stock_reconciliations.actual_quantity` is nullable (migration `0068`) — required and enforced server-side for a quantity-controlled product, left null for a value-controlled one (which has no physical unit count at all).

Every reconciliation also gets a `status` (`balanced` / `within_tolerance` / `variance` / `material_variance`), computed and **stored** at write time against whatever the tenant's variance-tolerance setting was at that moment (`tenant_settings.stock_variance_tolerance_percent`/`_amount`, sensible built-in defaults when unset) — never recomputed on read, so a later tolerance change can't retroactively reclassify old history.

The write path is one atomic call, `record_stock_reconciliation(...)` — a `SECURITY DEFINER` Postgres function following the exact same established pattern this codebase already uses for `sales.void_sale()`/`correct_sale()` (`19-security-checklist.md`), not a new one invented for this feature: since neither `stock_movements` nor `stock_reconciliations` has an RLS write policy a client could use directly, the function does its own `has_permission(tenant_id, 'stock.reconcile')` check in code, then writes with the function-owner's privileges. `auth.uid()` still resolves to the real calling user regardless of security mode, so `recorded_by` is always the actual person who reconciled, never generic. One reconciliation per product per day is enforced by a coalesce-normalized unique index (location-independent for now, since there's no per-location stock UI yet).

## Sales integration

Recording, voiding, correcting, or reversing a sale of a `tracks_inventory` product automatically moves stock — implemented as two triggers on `sales` (migration `0067`), not application-code calls from `SalesService`. This matters: `void_sale`/`correct_sale`/`reverse_sale` can defer their real effect to `resolve_approval_request()` when a tenant requires sign-off (`08-sales-engine.md`), so a TypeScript-side hook would silently miss that path. A trigger fires on the actual row mutation regardless of which code path produced it:

- **`AFTER INSERT`** deducts stock (`movement_type = 'sale'`, `reference_type = 'sale'`, `reference_id = sales.id`) for any new row representing a real sale of tracked stock — every ordinary `recordSale` insert, and a correction's replacement row — but explicitly skips a reversal's replacement row (`reversal_of_sale_id is not null`), since that row exists only to zero out revenue, not to represent new stock leaving.
- **`AFTER UPDATE OF status`** restores stock (`movement_type = 'sale_reversal'`) when a sale transitions out of `'open'` (voided/corrected/reversed), by looking up whatever **that same row's own** `'sale'` movement actually recorded — not by re-deriving eligibility from the product's current `tracks_inventory`, which could have changed since. A correction therefore needs no special-casing: the original's full deduction is restored, the replacement's new deduction is applied, and the two net to exactly the right delta.

A partial unique index (`tenant_id, product_id, reference_id, movement_type` where `reference_type = 'sale'`) makes both triggers idempotent via `on conflict do nothing` — a retried write can never deduct or restore the same sale's stock twice.

`sales.quantity` — optional and "informational only" everywhere else in this app (`08-sales-engine.md`) — becomes **required** specifically for a `tracks_inventory` product whose `stock_control_method = 'quantity'`, enforced client-side (the Sales form), in `SalesService.recordSale` (a friendly pre-insert error), and, as a hard backstop against a direct API call bypassing both, inside the insert trigger itself. A `'value'`-controlled tracked product is deliberately exempt (migration `0069`) — per the tenant's own stated choice to measure that product by value, not count, the Sales form never shows/requires a quantity for it, and the insert trigger instead infers an implied quantity from `actual_amount / products.expected_price` when none was entered (still honoring one if a tenant chooses to enter it anyway). The tenant's one system "Others" product (free-text sales) can never be `tracks_inventory = true`, so ad-hoc sales are automatically excluded with no special-casing anywhere in this integration.

## Permissions

`inventory.view` (read-only), `inventory.manage`, `stock.movement.record`, `stock.reconcile` — see `06-roles-permissions.md`. Tenant Administrator gets the full group; Supervisor gets `inventory.view` only; Sales User gets nothing, deliberately, keeping Sales itself untouched regardless of whether the add-on is on. Existing tenants (created before migration `0035`) were explicitly backfilled — the first time this codebase needed to, since no earlier permission addition had required it (`06-roles-permissions.md`'s own note on this).

## UI surface

- **Settings → Modules** — the on/off toggle, gated behind a confirmation dialog whose copy (trial vs. re-enable vs. real checkout) is computed server-side using the exact same branching the enable action itself uses, so the dialog never promises a free trial the action won't actually grant.
- **Bottom nav "Stock"** — still exactly one nav item (unchanged) — appears only once both `inventory.view` and the entitlement above are satisfied; a direct URL hit without entitlement redirects cleanly (`assertInventoryEnabled`), it doesn't error.
- **`/stock`** — a single page with six internal sub-tabs (`components/ui/tabs.tsx`, the same Base UI wrapper Analytics already uses for its Products/User-Performance tabs), all data fetched server-side up front so tab switching is instant, no per-tab round trip:
  - **Overview** — summary cards (`StockService.getOverviewSummary`: current stock, stock value, products tracked, low/out of stock, stock added/sold, damaged-lost-adjusted, expected vs. actual sales, stock variance — the set the spec explicitly asked for, not every number that could theoretically be shown), plus the trend chart, variance list, and low-stock list that used to live on the separate `/stock/reports` page (that route still works, just no longer linked — nothing was deleted).
  - **Items** — the original per-product balance list, unchanged (`StockDashboardList`).
  - **Stock In** / **Adjust** — a searchable product picker; tapping a product opens the same `QuickStockEntryDialog` every per-product quick action already uses (`StockActionList`), scoped to the tab's relevant movement types (opening stock/stock in vs. stock out/adjust/damaged/expired/lost).
  - **Reconcile** — today's queue (`ReconciliationQueueList`, shared with the still-working standalone `/stock/reconcile` route), tapping through to the full-screen reconciliation form.
  - **History** — a tenant-wide, filterable feed of every stock-changing event across every tracked product (`StockService.listHistory` / `StockHistoryList`) — search by product, filter by event type.
- **`/stock/[productId]`** — unchanged: balance, quick-action buttons, movement history for one product.
- **`/stock/reconcile/[productId]`** — the full-screen reconciliation form, now branching on the product's `stock_control_method`: the original quantity form for `'quantity'`, a new value form (Opening/Added/Expected Sales Value, real recorded sales, an "actual remaining value" + "valid adjustments" entry, unexplained variance) for `'value'`.

## Barcode/QR readiness

No scanner integration yet — the concrete "readiness" step taken here is exposing the existing, previously-unused `products.sku` column as a plain text field in the product edit form (alongside the new UOM picker), so a barcode/SKU value has somewhere to live before any scanning feature is built.

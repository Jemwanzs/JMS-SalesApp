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

## Cost price & tenant-wide control method

`products.cost_price` (nullable) is the acquisition/purchase cost per unit — distinct from the existing `expected_price` (selling price), and still a per-product field (some products cost more than others).

`stock_control_method` (`tenant_settings`, `'value'` default when unset, or `'quantity'`) is a **tenant-wide policy, not a per-product one** (migration `0072`) — set once under Settings → Inventory Configuration → "Record Stock By", it governs every tracked product uniformly. An earlier revision made this a per-product column; reverted after live feedback, since a business tracks its stock by value or by count as one coherent decision, not product-by-product, and a per-product setting was exactly what let a product's own configuration silently override the tenant's own Settings toggle. `lib/inventory/stock-control-method.ts`'s `getStockControlMethod()` is the one place the `'value'` default is decided — every reader (Sales, Stock In/Adjust, Reconciliation, Settings) goes through it.

Both methods still write to the exact same `stock_movements` table with the exact same signed `quantity` column — this is a **reporting/input lens, not a second ledger**. A quantity tenant's Reconciliation/Stock In/Adjust screens foreground units; a value tenant's screens foreground currency (Stock In/Adjust ask for a value directly, converted to the ledger's underlying quantity via the product's own selling price — the same conversion Sales already uses, see below) — computed by multiplying each movement's own quantity by its own snapshot price, never a duplicate source of truth for the balance itself.

Choosing Quantity locks the Settings → "Quantity field" toggle ON (`quantity-field-card.tsx`'s `locked` prop, enforced again server-side in `set-quantity-enabled.ts` as a backstop) — quantity becomes mandatory for a tracked product's sale under that policy. Choosing Monetary Value (the default) leaves that toggle a free, ordinary preference.

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

A quantity variance of exactly zero needs no reason and writes no offsetting ledger row; any nonzero variance requires a reason. `stock_reconciliations.actual_quantity` is nullable (migration `0068`) — required and enforced server-side for a quantity-controlled tenant, left null for a value-controlled one (which has no physical unit count at all).

Every reconciliation also gets a `status` (`balanced` / `within_tolerance` / `variance` / `material_variance`), computed and **stored** at write time against whatever the tenant's variance-tolerance setting was at that moment (`tenant_settings.stock_variance_tolerance_percent`/`_amount`, sensible built-in defaults when unset) — never recomputed on read, so a later tolerance change can't retroactively reclassify old history.

The write path is one atomic call, `record_stock_reconciliation(...)` — a `SECURITY DEFINER` Postgres function following the exact same established pattern this codebase already uses for `sales.void_sale()`/`correct_sale()` (`19-security-checklist.md`), not a new one invented for this feature: since neither `stock_movements` nor `stock_reconciliations` has an RLS write policy a client could use directly, the function does its own `has_permission(tenant_id, 'stock.reconcile')` check in code, then writes with the function-owner's privileges. `auth.uid()` still resolves to the real calling user regardless of security mode, so `recorded_by` is always the actual person who reconciled, never generic. One reconciliation per product per day is enforced by a coalesce-normalized unique index (location-independent for now, since there's no per-location stock UI yet).

## Sales integration

Recording, voiding, correcting, or reversing a sale of a `tracks_inventory` product automatically moves stock — implemented as two triggers on `sales` (migration `0067`), not application-code calls from `SalesService`. This matters: `void_sale`/`correct_sale`/`reverse_sale` can defer their real effect to `resolve_approval_request()` when a tenant requires sign-off (`08-sales-engine.md`), so a TypeScript-side hook would silently miss that path. A trigger fires on the actual row mutation regardless of which code path produced it:

- **`AFTER INSERT`** deducts stock (`movement_type = 'sale'`, `reference_type = 'sale'`, `reference_id = sales.id`) for any new row representing a real sale of tracked stock — every ordinary `recordSale` insert, and a correction's replacement row — but explicitly skips a reversal's replacement row (`reversal_of_sale_id is not null`), since that row exists only to zero out revenue, not to represent new stock leaving.
- **`AFTER UPDATE OF status`** restores stock (`movement_type = 'sale_reversal'`) when a sale transitions out of `'open'` (voided/corrected/reversed), by looking up whatever **that same row's own** `'sale'` movement actually recorded — not by re-deriving eligibility from the product's current `tracks_inventory`, which could have changed since. A correction therefore needs no special-casing: the original's full deduction is restored, the replacement's new deduction is applied, and the two net to exactly the right delta.

A partial unique index (`tenant_id, product_id, reference_id, movement_type` where `reference_type = 'sale'`) makes both triggers idempotent via `on conflict do nothing` — a retried write can never deduct or restore the same sale's stock twice.

`sales.quantity` — optional, "informational only" (`08-sales-engine.md`) by default — is governed by two settings working together, both tenant-wide, neither ever overridden by a product's own configuration (that was tried per-product in two earlier revisions and reverted both times after live feedback):

- **Monetary Value** (the default): the ordinary Settings → Quantity field toggle (`quantity_enabled`) decides visibility, exactly as before Inventory existed. Never required. Stock deduction copes fine without one — the insert trigger infers an implied quantity from `actual_amount / products.expected_price` (raising a clear error only if the product has no selling price to convert from).
- **QTY**: the field is forced visible for every product (the toggle is locked ON in Settings) and **required specifically for a `tracks_inventory` product** — an untracked one has no stock ledger to need it for. The insert trigger enforces this as a hard backstop (migration `0072`) against a direct API call bypassing the UI/`SalesService` layers.

The tenant's one system "Others" product (free-text sales) can never be `tracks_inventory = true`, so ad-hoc sales are automatically excluded from the mandatory-quantity rule with no special-casing anywhere in this integration.

## Permissions

`inventory.view` (read-only), `inventory.manage`, `stock.movement.record`, `stock.reconcile` — see `06-roles-permissions.md`. Tenant Administrator gets the full group; Supervisor gets `inventory.view` only; Sales User gets nothing, deliberately, keeping Sales itself untouched regardless of whether the add-on is on. Existing tenants (created before migration `0035`) were explicitly backfilled — the first time this codebase needed to, since no earlier permission addition had required it (`06-roles-permissions.md`'s own note on this).

## UI surface

- **Settings → Modules** — the on/off toggle, gated behind a confirmation dialog whose copy (trial vs. re-enable vs. real checkout) is computed server-side using the exact same branching the enable action itself uses, so the dialog never promises a free trial the action won't actually grant. On a real success the dialog just confirms and stays put — an earlier version auto-navigated into `/stock` after a short pause; reverted after feedback, since turning the module on should only light up the Stock tab in the bottom nav (`router.refresh()` re-fetches the tenant layout that computes it), not pull the admin away from Settings.
- **Settings → Inventory Configuration** (shown only once genuinely entitled) — the tenant-wide "Record Stock By" choice (`inventory-configuration-card.tsx`), default Monetary Value. Switching either direction always flips the Quantity field toggle to match (`set-stock-control-method.ts`): QTY locks it ON (`quantity-field-card.tsx`'s `locked` prop); Monetary Value resets it OFF and unlocks it, a free preference from then on. First-ever activation (`set-inventory-enabled.ts`) initializes `quantity_enabled=false` to match the Monetary Value default -- only when NEITHER setting has ever been explicitly touched, so a tenant re-enabling after previously turning the module off keeps whatever they'd already chosen.
- **Bottom nav "Stock"** — still exactly one nav item (unchanged) — appears only once both `inventory.view` and the entitlement above are satisfied; a direct URL hit without entitlement redirects cleanly (`assertInventoryEnabled`), it doesn't error.
- **`/stock`** — a single page with up to six internal sub-tabs, laid out as a fixed 4-column CSS grid (`grid-cols-4` on the shared `TabsList`, not `flex-wrap`) so they settle into exactly two centered rows -- Overview/Items/Stock In/Adjust, then Reconcile/History -- deterministically regardless of viewport width or label length; two earlier attempts (a horizontally-scrolling single row, then plain flex-wrap) were each reverted after feedback for looking broken or splitting unevenly. All data fetched server-side up front so tab switching is instant, no per-tab round trip, except the Overview tab's own date filter (see below).
  - **Overview** — `StockService.getDailyOverviewSummary(tenantId, date)`, scoped to a single date via a Today/Yesterday/Select Date filter (`stock-overview-date-filter.tsx`, a `?overviewDate=` search param -- only this tab's data depends on it). Two card groups, deliberately never blended: the main stock cards (Current Stock, Opening/New/Closing Stock, Stock Adjusted, Expected/Actual Sales, Variance -- the first five switch between quantity and currency per `stock_control_method`, the last three always stay currency since a sale is always a monetary event; Current Stock turns red when at least one product is low or out of stock, the one live/non-date-scoped figure in the group) and, after a visual break, product-status counts (Products Tracked/Low Stock/Out of Stock -- always live, never date-filtered, since "low stock" has no retroactive meaning). Plus the trend chart and status bar that used to live on the separate `/stock/reports` page (that route still works, just no longer linked — nothing was deleted).
  - **Items** — the original per-product balance list, unchanged (`StockDashboardList`).
  - **Stock In** / **Adjust** — a searchable product picker; tapping a product opens the same `QuickStockEntryDialog` every per-product quick action already uses (`StockActionList`), scoped to the tab's relevant movement types (opening stock/stock in vs. stock out/adjust/damaged/expired/lost). The dialog's one amount field asks for a quantity or a value depending on the tenant's `stock_control_method` (`StockService.recordMovement` accepts either, converting a value to the ledger's quantity via the product's selling price when given one).
  - **Reconcile** — today's queue (`ReconciliationQueueList`, shared with the still-working standalone `/stock/reconcile` route), tapping through to the full-screen reconciliation form.
  - **History** — a tenant-wide, filterable feed of every stock-changing event across every tracked product (`StockService.listHistory` / `StockHistoryList`) — search by product, filter by event type.
- **`/stock/[productId]`** — unchanged: balance, quick-action buttons, movement history for one product.
- **`/stock/reconcile/[productId]`** — the full-screen reconciliation form, branching on the tenant's `stock_control_method`: the original quantity form for `'quantity'`, a value form (Opening/Added/Expected Sales Value, real recorded sales, an "actual remaining value" + "valid adjustments" entry, unexplained variance) for `'value'`.

## Barcode/QR readiness

No scanner integration yet — the concrete "readiness" step taken here is exposing the existing, previously-unused `products.sku` column as a plain text field in the product edit form (alongside the new UOM picker), so a barcode/SKU value has somewhere to live before any scanning feature is built.

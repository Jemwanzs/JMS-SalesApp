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

The sign convention lives in exactly one place (`StockService.recordMovement`'s `INCREASES_BALANCE` set and the mirrored `record_stock_reconciliation()` SQL function) — current balance is always a plain `SUM(quantity)`, never a per-type CASE expression scattered across every reader. `stock_balances` is a plain (non-materialized) view over that sum — movement volume for small-business daily stock is modest enough that avoiding refresh staleness is worth more than the marginal query cost of a live aggregate; revisit only if a real performance problem shows up.

`reconciliation_variance` is deliberately not a valid input to the general `recordMovement` path — it's written only by the reconciliation RPC below, atomically alongside the reconciliation row it belongs to, so the ledger and the reconciliation log can never disagree about whether a variance was actually recorded.

## Daily reconciliation

```
Opening + Stock In − Stock Out = Expected Closing
Actual Physical Count − Expected Closing = Variance
```

A variance of exactly zero needs no reason and writes no offsetting ledger row. Any nonzero variance requires a reason before the reconciliation can be saved — enforced twice: client-side (the form won't submit without one) and server-side (the RPC itself rejects a nonzero variance with an empty reason, so a direct API call can't bypass the rule either).

The write path is one atomic call, `record_stock_reconciliation(p_tenant_id, p_product_id, p_location_id, p_reconciliation_date, p_actual_quantity, p_variance_reason)` — a `SECURITY DEFINER` Postgres function following the exact same established pattern this codebase already uses for `sales.void_sale()`/`correct_sale()` (`19-security-checklist.md`), not a new one invented for this feature: since neither `stock_movements` nor `stock_reconciliations` has an RLS write policy a client could use directly, the function does its own `has_permission(tenant_id, 'stock.reconcile')` check in code, then writes with the function-owner's privileges. `auth.uid()` still resolves to the real calling user regardless of security mode (it reads the request's own JWT claims, unrelated to function ownership), so `recorded_by` is always the actual person who reconciled, never generic. One reconciliation per product per day is enforced by a coalesce-normalized unique index (location-independent for now, since there's no per-location stock UI yet).

## Permissions

`inventory.view` (read-only), `inventory.manage`, `stock.movement.record`, `stock.reconcile` — see `06-roles-permissions.md`. Tenant Administrator gets the full group; Supervisor gets `inventory.view` only; Sales User gets nothing, deliberately, keeping Sales itself untouched regardless of whether the add-on is on. Existing tenants (created before migration `0035`) were explicitly backfilled — the first time this codebase needed to, since no earlier permission addition had required it (`06-roles-permissions.md`'s own note on this).

## UI surface

- **Settings → Modules** — the on/off toggle, gated behind a confirmation dialog whose copy (trial vs. re-enable vs. real checkout) is computed server-side using the exact same branching the enable action itself uses, so the dialog never promises a free trial the action won't actually grant.
- **Bottom nav "Stock"** tab — appears only once both `inventory.view` and the entitlement above are satisfied; a direct URL hit without entitlement redirects cleanly (`assertInventoryEnabled`), it doesn't error.
- **`/stock`** — every tracked product with its current balance and a low-stock badge; **`/stock/[productId]`** — balance, quick-action buttons (opening stock, in, out, adjust ±, damaged, expired, lost) sharing one dialog (same "tap an item, get a focused form" idiom as `RecordSaleDialog`), movement history below.
- **`/stock/reconcile`** — today's queue (every tracked product with no reconciliation row yet for the tenant's own "today"); **`/stock/reconcile/[productId]`** — the full-screen reconciliation form (deliberately not a dialog/sheet — a multi-field flow, not a quick tap).
- **`/stock/reports`** — a stock-in-vs-out trend chart (trailing 30 days, reusing the same `components/ui/chart.tsx` wrapper Analytics uses), plus plain ranked lists for variances and low stock — deliberately lists, not more charts, since the reason text and exact counts are the actionable part, not a magnitude to compare at a glance.

## Barcode/QR readiness

No scanner integration yet — the concrete "readiness" step taken here is exposing the existing, previously-unused `products.sku` column as a plain text field in the product edit form (alongside the new UOM picker), so a barcode/SKU value has somewhere to live before any scanning feature is built.

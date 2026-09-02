# 26 — Daily Expenses (optional feature)

## What this is

Daily Expenses tracks operational expenditure — water, electricity,
rent, transport, county fees, airtime, cleaning, repairs, and any
tenant-configured item — strictly separate from stock/inventory
acquisition. A stock purchase is never treated as an expense here, and
an expense never touches `products`, `stock_movements`, or
`stock_reconciliations`. Off by default, tenant-admin-toggled, **no
additional billing** — unlike the Inventory add-on, this is a plain
`tenant_settings.expenses_enabled` boolean flag, the same mechanism
`quantity_enabled`/`notes_field_enabled` already use, not a billed
subscription.

## Schema (migration `0054_daily_expenses.sql`)

Two tables, mirroring the same "config catalog + append-only ledger"
split this codebase already uses for products/sales and inventory's
products/stock_movements:

- **`expense_items`** — the configured catalog (closer to `products`):
  name, `expense_type` (`recurring`/`one_time`), `estimated_amount`
  (a guide only, never enforced against what's actually recorded),
  `status` (`active`/`archived` — never hard-deleted, so a later-
  archived item's name still resolves for old expense records).
- **`expenses`** — the actual recorded spend (closer to `sales`):
  immutable append-only ledger, branch-scoped (`location_id` NOT
  NULL, same as `sales`), a name snapshot so a later item rename/
  archive doesn't rewrite history, `expense_date <= current_date`
  enforced by a DB check constraint (never just the form). No UPDATE/
  DELETE RLS policy — editing/voiding an existing row goes through two
  `SECURITY DEFINER` functions, `edit_expense()`/`void_expense()`,
  mirroring `reverse_sale()` (`0026_sale_reversal.sql`) minus its
  approval-workflow branch, deliberately simpler since expenses carry
  far lower stakes than a sale reversal and this feature is meant to
  stay lightweight.

## Permissions

`expenses.view`, `expenses.create`, `expenses.edit`, `expenses.void`
(soft — matches `sales.void`'s "delete does not exist as a permission"
philosophy, see `docs/06-roles-permissions.md`), `expenses.configure_items`,
`expenses.view_analytics`. Default grants (mirrors migration `0035`'s
exact `inventory.*` backfill shape, both in the migration's SQL and in
`services/RoleService.ts`'s `DEFAULT_ROLE_GRANTS`):

- **Tenant Administrator** — all six.
- **Supervisor** — `expenses.view` only (matches its `inventory.view`-only precedent).
- **Sales User** — nothing, deliberately (same "keep Sales simple" principle already applied to `inventory.*`/`stock.*`).

Existing tenants (created before migration `0054`) were explicitly
backfilled in that migration — see `docs/06`'s own note on why this is
required for every permission addition, not just the first one.

## UI surface

- **Settings → Daily Expenses** — a plain instant toggle
  (`features/settings/components/expenses-module-card.tsx`), not the
  confirmation-dialog/billing-branch pattern Inventory uses — there's
  no billing state to confirm here.
- **More → Expense Items** (`expenses.configure_items`-gated) and
  **More → Expenses** (`expenses.view`-gated) — both hidden until the
  feature is on, inserted immediately before **Settings** per spec.
  Nav placement is **More menu only**, not a bottom-nav tab (explicit
  choice — keeps the bottom nav unchanged for every tenant).
- **`/expense-items`** — the catalog: add/edit dialog, archive/
  reactivate toggle.
- **`/expenses`** — today's (or a browsed past date's) recorded
  expenses: Expense Name | Actual Amount | Date | Recorded By, a
  single-date filter + search (no date range), "+ Add Expense" dialog,
  tap a row to edit or void (with a required reason).
- **`/expenses/analytics`** — a dedicated screen, not a modal (spec
  allows either). Today / Yesterday / a specific date only, no range.
  KPI cards (Total Expenses, Number of Expenses, Highest Expense Item),
  a ranked breakdown-by-item list with actual-vs-estimated per item,
  and one computed sentence ("X is today's highest expense, accounting
  for Y% of total expenses"). Built as its own route rather than a
  `Dialog` specifically because this session verified live that the
  shared `Dialog` component mis-centers on a long scrollable page
  opened at scroll position 0 (see `components/shared/tenant-logo-viewer.tsx`'s
  own header comment for the full story) — a route sidesteps that risk
  entirely rather than reintroducing it in a second dialog.

No day-closure gate anywhere — expense records/summary update
immediately, computed live from `expenses`, same "Reports Must Always
Be Available" principle Sales Reports already established.

## Separation from Stock (enforced, not just documented)

No FK, join, or shared table between `expenses`/`expense_items` and
`products`/`stock_movements`/`stock_reconciliations` anywhere.
`ExpenseService`/`ExpenseItemService` never appear in `StockService`
or `AnalyticsService`'s existing product/stock queries. The only
future intersection point (explicitly out of scope for this pass) is a
later profitability report reading `sales` and `expenses` independently
and subtracting (`Sales − Cost of Goods − Operating Expenses = Profit`)
— never a schema link.

## i18n / styling

Plain hardcoded English throughout, matching the current-default
convention for a new, non-golden-path feature (Stock/Inventory,
Settings, Workspace, and Preferences all ship this way today —
`next-intl` is reserved for the already-converted golden-path surface:
Sales, Sales History, Analytics, Reports).

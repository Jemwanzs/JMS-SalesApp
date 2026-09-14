-- ============================================================================
-- 0089_expense_splits.sql
--
-- Expense Management Phase 2f: split expenses -- one payment (one item,
-- one vendor, one date, one payment method, one receipt) allocated
-- across multiple categories, e.g. a single shopping trip split between
-- Office Supplies and Cleaning Supplies. Same "split transaction" shape
-- QuickBooks/most real accounting tools use: split by category, not by
-- item or payee.
--
-- Deliberately NOT a parent-row + child-splits-table design. Each split
-- becomes its own ordinary `expenses` row (its own category_id,
-- actual_amount, and real EXP- number), sharing a `split_group_id` that
-- marks them as siblings -- nothing else. This is the only design that
-- doesn't require re-teaching every existing consumer of category_id/
-- actual_amount about a new multi-category concept: budgets
-- (expense_budgets/getBudgetStatus), the dashboard/breakdown/trend
-- aggregators, receipt/approval gating (enforce_receipt_requirement/
-- gate_expense_approval), reimbursement tracking, and CSV/Excel/PDF
-- export all already group and sum by category_id per row -- a split
-- expense is invisible to every one of them as anything other than N
-- ordinary rows that happen to add up to what was actually paid. The
-- only place `split_group_id` matters at all is the recording UI (one
-- form, multiple category/amount lines, one bulk insert) and the detail
-- view (showing "part of a split" with its siblings).
--
-- One real consequence worth being explicit about: enforce_receipt_
-- requirement/gate_expense_approval fire per row, so different splits
-- in the same group CAN land in different states (e.g. an amount-
-- threshold approval mode might require approval for a KES 6,000 split
-- but not a KES 400 one in the same group). That's correct, not a bug
-- -- each split is independently exactly as real an expense as if it had
-- been recorded on its own.
-- ============================================================================

alter table public.expenses
  add column split_group_id uuid;

create index idx_expenses_split_group on public.expenses (split_group_id) where split_group_id is not null;

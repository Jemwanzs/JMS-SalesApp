-- ============================================================================
-- 0099_branch_performance_analytics.sql
--
-- BRANCH PERFORMANCE (COMPANY-WIDE REPORTS).
--
-- One new permission for the new cross-cutting Sales/Expenses/Stock/Orders
-- analytics module under More -> Branch Performance. Serves two roles:
-- (a) the gate for entering the module at all, (b) the gate for whether
-- the shared branch filter offers anything beyond the caller's own
-- current branch ("All Branches" or a different specific branch).
--
-- Deliberately NOT the existing `analytics.locations` permission
-- (migration 0001) -- that one's documented intent (docs/06-roles-
-- permissions.md, docs/11-analytics-reports.md) is "show a location
-- breakdown of MY OWN already-visible data," parallel to
-- analytics.products/analytics.all_users, never "grant access to other
-- branches' data." Repurposing it would misuse its documented meaning;
-- this is a genuinely different capability, hence a new key.
--
-- Per-tab "can see this tab at all" reuses existing permissions with no
-- new keys: analytics.view_own/view_all (Sales), expenses.view_analytics
-- (Expenses), inventory.view (Stock), orders.view_analytics (Orders --
-- exists since migration 0092, dormant until this feature).
-- ============================================================================

insert into public.permissions (key, module, description, is_read_only) values
  ('analytics.branch_performance', 'analytics', 'View the company-wide Branch Performance module, including All Branches and other-branch data', true);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Tenant Administrator'
  and p.key = 'analytics.branch_performance'
on conflict do nothing;

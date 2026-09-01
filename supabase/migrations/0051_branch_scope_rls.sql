-- ============================================================================
-- 0051_branch_scope_rls.sql
--
-- Multi-Branch User Access, Phase 5: the database-level half of "once
-- selected, ALL relevant data is scoped to Tenant + Active Branch" --
-- RLS, not just hidden in the UI. Builds on migration 0050's
-- current_active_location(p_tenant_id) helper (reads the signed-in
-- session's active_branch_sessions row).
--
-- sales/business_days: location_id is NOT NULL on both (0005), so a
-- plain equality clause is correct and total -- every row already has
-- a real location.
--
-- stock_movements/stock_reconciliations/reports: location_id is
-- NULLABLE on all three, and every existing row is null today -- this
-- app has no per-location stock/report workflow yet (see 0036's own
-- header comment). A strict equality clause would silently hide every
-- existing row from every branch, which is exactly the "existing
-- configurations must keep working" regression the standing platform
-- instruction rules out. So these three get
-- `location_id is null or location_id = current_active_location(...)`
-- -- a no-op today (nothing sets a non-null location_id yet), but it
-- starts enforcing automatically the moment a future feature does,
-- with no second migration needed.
--
-- Every clause below is ALSO wrapped with
-- `public.impersonated_profile_id(tenant_id) is not null or ...` --
-- Support's "Access Workspace" impersonation (migration 0024) has no
-- real tenant_membership/branch assignment in the tenant it's viewing,
-- so it can never have an active_branch_sessions row there; without
-- this carve-out an impersonating platform admin would see zero rows
-- everywhere, the same "must still be able to open a deactivated
-- tenant to investigate it" exception this app already makes elsewhere
-- (app/(tenant)/t/[tenantSlug]/layout.tsx). The other half of this
-- fix -- not forcing Support through a branch picker it has no
-- assignment to answer -- lives in sales/page.tsx.
--
-- IMPORTANT operational note: current_active_location() returns null
-- for a session that predates this migration (no active_branch_sessions
-- row was ever written for it). sales/page.tsx self-heals this on
-- next visit (redirects through /select-branch, which writes the row
-- and sends them back) -- but any OTHER page reached directly by a
-- stale session before it visits /sales first (analytics, stock,
-- reports, sales-history) will show zero location-scoped rows until
-- that self-heal happens. A one-time transition cost for whoever is
-- already signed in when this migration goes live, not an ongoing
-- behavior.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- sales
-- ---------------------------------------------------------------------------

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
for select to authenticated
using (
  (
    public.impersonated_profile_id(tenant_id) is not null
    or location_id = public.current_active_location(tenant_id)
  )
  and (
    public.has_permission(tenant_id, 'sales.view_all')
    or (
      public.has_permission(tenant_id, 'sales.view_own')
      and recorded_by = coalesce(public.impersonated_profile_id(tenant_id), auth.uid())
    )
  )
);

drop policy if exists sales_insert on public.sales;
create policy sales_insert on public.sales
for insert to authenticated
with check (
  public.has_permission(tenant_id, 'sales.create')
  and (
    public.impersonated_profile_id(tenant_id) is not null
    or location_id = public.current_active_location(tenant_id)
  )
);

-- ---------------------------------------------------------------------------
-- business_days
-- ---------------------------------------------------------------------------

drop policy if exists business_days_select on public.business_days;
create policy business_days_select on public.business_days
for select to authenticated
using (
  public.is_tenant_member(tenant_id)
  and (
    public.impersonated_profile_id(tenant_id) is not null
    or location_id = public.current_active_location(tenant_id)
  )
);

drop policy if exists business_days_write on public.business_days;
create policy business_days_write on public.business_days
for all to authenticated
using (
  (
    public.has_permission(tenant_id, 'business_day.open')
    or public.has_permission(tenant_id, 'business_day.close')
    or public.has_permission(tenant_id, 'business_day.reopen')
  )
  and (
    public.impersonated_profile_id(tenant_id) is not null
    or location_id = public.current_active_location(tenant_id)
  )
)
with check (
  (
    public.has_permission(tenant_id, 'business_day.open')
    or public.has_permission(tenant_id, 'business_day.close')
    or public.has_permission(tenant_id, 'business_day.reopen')
  )
  and (
    public.impersonated_profile_id(tenant_id) is not null
    or location_id = public.current_active_location(tenant_id)
  )
);

-- ---------------------------------------------------------------------------
-- stock_movements (nullable location_id -- see header comment)
-- ---------------------------------------------------------------------------

drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements
for select to authenticated
using (
  public.is_tenant_member(tenant_id)
  and (
    public.impersonated_profile_id(tenant_id) is not null
    or location_id is null
    or location_id = public.current_active_location(tenant_id)
  )
);

drop policy if exists stock_movements_insert on public.stock_movements;
create policy stock_movements_insert on public.stock_movements
for insert to authenticated
with check (
  (
    (movement_type = 'reconciliation_variance' and public.has_permission(tenant_id, 'stock.reconcile'))
    or (movement_type <> 'reconciliation_variance' and public.has_permission(tenant_id, 'stock.movement.record'))
  )
  and (
    public.impersonated_profile_id(tenant_id) is not null
    or location_id is null
    or location_id = public.current_active_location(tenant_id)
  )
);

-- ---------------------------------------------------------------------------
-- stock_reconciliations (nullable location_id -- see header comment;
-- the only write path is the SECURITY DEFINER record_stock_reconciliation
-- function, which bypasses RLS, so no insert policy needed here)
-- ---------------------------------------------------------------------------

drop policy if exists stock_reconciliations_select on public.stock_reconciliations;
create policy stock_reconciliations_select on public.stock_reconciliations
for select to authenticated
using (
  public.has_permission(tenant_id, 'inventory.view')
  and (
    public.impersonated_profile_id(tenant_id) is not null
    or location_id is null
    or location_id = public.current_active_location(tenant_id)
  )
);

-- ---------------------------------------------------------------------------
-- reports (nullable location_id -- see header comment; only ever
-- written by the service-role cron worker, which bypasses RLS, so no
-- write policy needed here)
-- ---------------------------------------------------------------------------

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports
for select to authenticated
using (
  public.has_permission(tenant_id, 'reports.view')
  and (
    public.impersonated_profile_id(tenant_id) is not null
    or location_id is null
    or location_id = public.current_active_location(tenant_id)
  )
);

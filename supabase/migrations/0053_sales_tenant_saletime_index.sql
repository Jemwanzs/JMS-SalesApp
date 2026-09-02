-- ============================================================================
-- 0053_sales_tenant_saletime_index.sql
--
-- Performance audit: SalesService.listRecent() -- the Sales History
-- page's primary query -- orders by sale_time desc, but the existing
-- sales indexes (idx_sales_tenant, idx_sales_tenant_date, etc.,
-- migration 0005) all key on sale_date, never sale_time. Without a
-- matching index, Postgres has to filter via a less-specific index (or
-- a sequential scan) and then sort the result set in memory instead of
-- walking an index already in the right order -- the highest-traffic
-- list query in the app, with no supporting index for its own sort key.
-- ============================================================================

create index if not exists idx_sales_tenant_saletime on public.sales (tenant_id, sale_time desc);

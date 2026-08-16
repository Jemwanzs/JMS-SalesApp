-- ============================================================================
-- 0013_reports_table.sql
--
-- Phase 3c: scheduled report generation, daily report only (docs/09-
-- business-day-engine.md's "Daily sales summary": gross sales,
-- transaction count, top product, highest sales person, average sale, vs
-- previous day). Weekly/monthly/custom report types are later increments
-- -- `report_type` is unconstrained text so they can be added without a
-- migration, but nothing generates them yet.
--
-- `reports` per docs/03-database-schema.md section 3.4. `report_jobs.
-- report_id` (migration 0011, left nullable with no FK since this table
-- didn't exist yet) can now be linked once a job succeeds -- no FK added
-- here either, deliberately: report_jobs already predates this table and
-- the drain route sets report_id after the fact in a separate UPDATE, so
-- a FK would just add ordering risk for no real benefit yet.
-- ============================================================================

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid references public.locations (id) on delete cascade,
  report_type text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  storage_path text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_reports_tenant on public.reports (tenant_id);
create index idx_reports_tenant_period on public.reports (tenant_id, period_start);

-- RLS: readable by anyone holding reports.view for the tenant (existing
-- permission, seeded in migration 0001, already granted to Supervisor+
-- via RoleService.DEFAULT_ROLE_GRANTS) -- no write policy, since reports
-- are only ever produced by the service-role outbox-drain worker
-- (app/api/cron/outbox), never written directly by a client.
alter table public.reports enable row level security;

create policy reports_select on public.reports
for select to authenticated
using (public.has_permission(tenant_id, 'reports.view'));

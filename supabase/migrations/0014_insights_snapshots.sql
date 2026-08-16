-- ============================================================================
-- 0014_insights_snapshots.sql
--
-- Phase 3d: rule-based insights engine v1 (docs/11-analytics-reports.md)
-- -- deterministic rules over computed aggregates, no LLM, no per-tenant
-- inference cost. `insights_snapshots` per docs/03-database-schema.md
-- section 3.4.
--
-- Scoped to the three core rules the spec documents in full (week-over-
-- week change, product revenue concentration, recurring underperforming
-- weekday). "Smart alerts / Daily Pulse" is explicitly labeled a "Phase 3
-- stretch" in the same doc -- deliberately deferred, not silently
-- dropped, same posture as REVERSE/MFA/notifications elsewhere in this
-- project.
-- ============================================================================

create table public.insights_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  business_day_id uuid references public.business_days (id) on delete cascade,
  rule_key text not null,
  severity text not null check (severity in ('positive', 'warning', 'info')),
  message text not null,
  data jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);

create index idx_insights_snapshots_tenant on public.insights_snapshots (tenant_id);
create index idx_insights_snapshots_tenant_generated on public.insights_snapshots (tenant_id, generated_at desc);

-- RLS: readable by analytics.view_all holders -- these are business-wide
-- facts (week-over-week, product concentration, a recurring weekday
-- pattern), not scoped to "my own" sales the way analytics.view_own is,
-- so view_own alone isn't enough (same reasoning as 3b's analytics.
-- view_all gate on the KPI dashboard). No write policy: only the
-- service-role outbox-drain worker writes this table.
alter table public.insights_snapshots enable row level security;

create policy insights_snapshots_select on public.insights_snapshots
for select to authenticated
using (public.has_permission(tenant_id, 'analytics.view_all'));

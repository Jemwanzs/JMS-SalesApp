-- ============================================================================
-- 0025_anniversary_wishes.sql
--
-- Phase 7d (Platform Administration): business anniversary tracking +
-- automated wishes (docs/15-super-admin.md's "Business anniversaries"
-- section). `tenants.anniversary_date` already exists (migration 0001)
-- and is already settable by a tenant during onboarding (TenantService.
-- saveBusinessDetails) -- this migration is only the wish-scheduling
-- side of the feature.
--
-- Wish mode ("Automatic / Review Before Sending / Disabled", spec §100)
-- is a per-tenant PREFERENCE, not a per-row column -- it lives in the
-- existing generic `tenant_settings` table (key: 'anniversary_wish_mode'),
-- same convention as every other tenant-wide toggle already there
-- (require_download_passcode, restrict_login_to_*). Each row in THIS
-- table snapshots the mode that was active when it was scheduled, so a
-- tenant changing their preference mid-year never silently rewrites a
-- wish that's already pending or sent.
--
-- "Never forced on a tenant that hasn't opted in": AnniversaryService
-- treats a missing tenant_settings row as 'disabled', not 'automatic' --
-- an explicit choice, not a fallback default of convenience.
--
-- No write policy: every row is written by AnniversaryService via the
-- service-role client -- scheduling runs from the daily cron sweep
-- (app/api/cron/outbox/route.ts, best-effort alongside the existing
-- report_jobs drain) and "review" mode's actual send is a platform-admin
-- action, neither of which is an ordinary authenticated user's own write.
-- ============================================================================

create table public.anniversary_wishes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  year integer not null,
  mode text not null check (mode in ('automatic', 'review', 'disabled')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped')),
  scheduled_for date not null,
  sent_at timestamptz,
  message text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, year)
);

create index idx_anniversary_wishes_tenant on public.anniversary_wishes (tenant_id, year desc);
create index idx_anniversary_wishes_pending on public.anniversary_wishes (status, scheduled_for) where status = 'pending';

alter table public.anniversary_wishes enable row level security;

-- Any tenant member can see their own tenant's wishes (a scheduled/sent
-- congratulatory message isn't sensitive data) -- same is_tenant_member()
-- baseline every other tenant-visible-to-all-members table uses.
create policy anniversary_wishes_select on public.anniversary_wishes
for select to authenticated
using (public.is_tenant_member(tenant_id));

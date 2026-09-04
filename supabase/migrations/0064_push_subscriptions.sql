-- ============================================================================
-- 0064_push_subscriptions.sql
--
-- Web Push (Feature 3): a device's browser Push API subscription,
-- per-profile -- not tenant-scoped, matching the existing convention for
-- other per-user preferences (profiles.preferred_font/color_palette,
-- migrations 0043/0045) rather than a new tenant_settings entry, since a
-- push subscription belongs to a specific device/browser regardless of
-- which tenant the profile happens to be in.
--
-- `endpoint` is globally unique per the Push API spec itself (it's the
-- push service's own delivery URL for this one subscription) -- used as
-- the natural upsert key so re-subscribing the same device never creates
-- a duplicate row. No UPDATE policy: the client deletes and re-subscribes
-- on any change (a new permission grant, a cleared browser) rather than
-- mutating keys in place, which the Push API itself doesn't support
-- anyway (a changed subscription IS a new one).
--
-- RLS scoped to `profile_id = auth.uid()` for every operation a device
-- legitimately performs on its own subscription (insert/select/delete).
-- Reading OTHER profiles' subscriptions (to actually deliver a
-- notification) only ever happens via PushNotificationService, service-
-- role, from app/api/cron/outbox/route.ts -- see lib/supabase/
-- service-role.ts's allowed-callers list.
-- ============================================================================

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_push_subscriptions_profile on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select on public.push_subscriptions
  for select
  using (profile_id = auth.uid());

create policy push_subscriptions_insert on public.push_subscriptions
  for insert
  with check (profile_id = auth.uid());

create policy push_subscriptions_delete on public.push_subscriptions
  for delete
  using (profile_id = auth.uid());

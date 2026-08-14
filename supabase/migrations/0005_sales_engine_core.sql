-- ============================================================================
-- 0005_sales_engine_core.sql
--
-- Phase 2 core: products, business days, and sales -- the minimum schema
-- for a real "record a sale" golden path. See:
--   docs/08-sales-engine.md            -- sale record, numbering, idempotency
--   docs/09-business-day-engine.md     -- state machine
--   docs/10-products.md                -- product schema
--
-- Deliberately NOT in this migration (later Phase 2 increments):
--   - sale_corrections / approval_requests (Phase 2e/2g) -- sales
--     therefore has NO update/delete RLS policy at all yet. This is not
--     an oversight: "never physically edit/delete financial records"
--     means a raw client-side UPDATE was never going to be the right
--     mechanism anyway. Corrections land as a dedicated VOID/CORRECT/
--     REVERSE flow once the approval engine exists, not as a stripped-
--     down half-feature now.
--   - pg_cron auto open/close (Phase 2f) -- business_days supports
--     manual open/close only for now.
--   - sale_number_sequences' template is NOT tenant-configurable yet
--     (hardcoded SALE-{YYYY}-{000001} format in the trigger below) --
--     reading the format from tenant_settings is a fast-follow, not
--     blocking a working default.
-- ============================================================================

-- ============================================================================
-- 1. PRODUCTS
-- ============================================================================

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid references public.locations (id) on delete set null,
  sku text,
  name text not null,
  description text,
  expected_price numeric(12, 2),
  show_expected_price boolean not null default true,
  image_url text,
  display_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_products_tenant on public.products (tenant_id);
create index idx_products_tenant_status on public.products (tenant_id, status);

create trigger set_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null,
  width integer,
  height integer,
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_product_images_tenant on public.product_images (tenant_id);
create index idx_product_images_product on public.product_images (product_id);

-- ============================================================================
-- 2. BUSINESS DAYS
-- ============================================================================

create type public.business_day_status as enum ('scheduled', 'open', 'closing', 'closed', 'reopened');

create table public.business_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  business_date date not null,
  status public.business_day_status not null default 'scheduled',
  scheduled_open_time time,
  scheduled_close_time time,
  opened_at timestamptz,
  opened_by uuid references public.profiles (id),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  opening_reason text,
  closing_reason text,
  reopened_at timestamptz,
  reopened_by uuid references public.profiles (id),
  reopen_expires_at timestamptz,
  aggregates jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, location_id, business_date)
);

create index idx_business_days_tenant on public.business_days (tenant_id);
create index idx_business_days_location on public.business_days (location_id);

create trigger set_business_days_updated_at
before update on public.business_days
for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. SALE NUMBERING
-- ============================================================================

create table public.sale_number_sequences (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  year integer not null,
  current_value bigint not null default 0,
  primary key (tenant_id, location_id, year)
);

-- ============================================================================
-- 4. SALES
-- ============================================================================

create type public.sale_status as enum ('open', 'locked', 'corrected', 'voided');

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  business_day_id uuid not null references public.business_days (id) on delete cascade,
  product_id uuid not null references public.products (id),
  sale_number text,
  barcode_reference text,
  product_name_snapshot text not null,
  product_image_snapshot text,
  expected_price_snapshot numeric(12, 2),
  actual_amount numeric(12, 2) not null check (actual_amount >= 0),
  quantity numeric(12, 2),
  notes text,
  recorded_by uuid not null references public.profiles (id),
  sale_date date not null,
  sale_time timestamptz not null default now(),
  status public.sale_status not null default 'open',
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, sale_number)
);

create index idx_sales_tenant on public.sales (tenant_id);
create index idx_sales_tenant_date on public.sales (tenant_id, sale_date);
create index idx_sales_tenant_product_date on public.sales (tenant_id, product_id, sale_date);
create index idx_sales_tenant_user_date on public.sales (tenant_id, recorded_by, sale_date);
create index idx_sales_business_day on public.sales (business_day_id);
create index idx_sales_location on public.sales (location_id);

create trigger set_sales_updated_at
before update on public.sales
for each row execute function public.set_updated_at();

-- Atomic sale-number assignment: a single INSERT ... ON CONFLICT ...
-- RETURNING serializes concurrent inserts for the same tenant/location/
-- year via row-level locking, without needing an explicit
-- SELECT ... FOR UPDATE. Small gaps on rollback are acceptable --
-- uniqueness within scope is what matters, not a gapless sequence. See
-- docs/08-sales-engine.md.
create or replace function public.assign_sale_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer;
  v_seq bigint;
begin
  if new.sale_number is not null then
    return new;
  end if;

  v_year := extract(year from new.sale_date);

  insert into public.sale_number_sequences (tenant_id, location_id, year, current_value)
  values (new.tenant_id, new.location_id, v_year, 1)
  on conflict (tenant_id, location_id, year)
  do update set current_value = public.sale_number_sequences.current_value + 1
  returning current_value into v_seq;

  new.sale_number := 'SALE-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  return new;
end;
$$;

create trigger set_sale_number
before insert on public.sales
for each row execute function public.assign_sale_number();

-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================

alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.business_days enable row level security;
alter table public.sale_number_sequences enable row level security;
alter table public.sales enable row level security;

-- ---- products / product_images --------------------------------------------
create policy products_select on public.products
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy products_insert on public.products
for insert to authenticated
with check (public.has_permission(tenant_id, 'products.create'));

create policy products_update on public.products
for update to authenticated
using (public.has_permission(tenant_id, 'products.edit'))
with check (public.has_permission(tenant_id, 'products.edit'));

-- No delete policy: products are archived (status = 'archived'), never
-- deleted -- historical sales keep their own snapshot regardless.

create policy product_images_select on public.product_images
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy product_images_write on public.product_images
for all to authenticated
using (public.has_permission(tenant_id, 'products.edit'))
with check (public.has_permission(tenant_id, 'products.edit'));

-- ---- business_days ----------------------------------------------------------
-- RLS covers "does this user hold ANY business-day permission" as a
-- coarse ceiling; SalesService/BusinessDayService enforce exactly which
-- one (open vs close vs reopen) a given action needs -- see
-- docs/02-system-architecture.md on RLS as defense-in-depth, not the
-- sole enforcement point for business-rule-shaped checks.
create policy business_days_select on public.business_days
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy business_days_write on public.business_days
for all to authenticated
using (
  public.has_permission(tenant_id, 'business_day.open')
  or public.has_permission(tenant_id, 'business_day.close')
  or public.has_permission(tenant_id, 'business_day.reopen')
)
with check (
  public.has_permission(tenant_id, 'business_day.open')
  or public.has_permission(tenant_id, 'business_day.close')
  or public.has_permission(tenant_id, 'business_day.reopen')
);

-- ---- sale_number_sequences ---------------------------------------------------
-- Internal counter table, never read/written directly by application
-- code (only the assign_sale_number trigger touches it, running as the
-- table owner). No policies -- authenticated gets no direct access.
-- ---- sales --------------------------------------------------------------------
create policy sales_select on public.sales
for select to authenticated
using (
  public.has_permission(tenant_id, 'sales.view_all')
  or (
    public.has_permission(tenant_id, 'sales.view_own')
    and recorded_by = auth.uid()
  )
);

create policy sales_insert on public.sales
for insert to authenticated
with check (public.has_permission(tenant_id, 'sales.create'));

-- Deliberately no UPDATE or DELETE policy: sales are never edited or
-- deleted directly (spec: VOID/CORRECT/REVERSE only). That flow is
-- Phase 2e/2g, built as its own dedicated mechanism -- not a raw UPDATE
-- policy bolted on now and reworked later.

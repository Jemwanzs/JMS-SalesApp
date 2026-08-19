-- ============================================================================
-- 0020_imports.sql
--
-- Phase 5 (Data Migration): import template generation -> validation
-- engine -> preview/resolve-errors -> confirm/import -> analytics
-- rebuild trigger (docs/12-imports-data-migration.md for `type =
-- 'sales_history'`, docs/10-products.md for `type = 'products'`,
-- docs/03-database-schema.md's imports/import_rows rows). One shared
-- schema/shape for both types -- ImportService's confirm step is what
-- actually differs per type, not this table layout.
--
-- Both tables get a SELECT policy (imports.manage) but ZERO write
-- policies. Unlike login_events (no session at all for some events),
-- the reason here is different: a single confirm step writes across
-- import_rows + business_days + sales together as one consistent bulk
-- operation for sales_history (or import_rows + products for
-- products), and creating historical business_days/sales rows needs to
-- bypass the live-capture-shaped business_day.open/sales.create RLS
-- checks entirely (a historical row is correctly 'closed', never
-- 'open', by design) -- so ImportService always runs on the
-- service-role client, with imports.manage checked explicitly in the
-- calling server action first, same two-step pattern as
-- TenantService.createTenant's bootstrap and UserService.inviteUser.
-- ============================================================================

insert into public.permissions (key, module, description, is_read_only) values
  ('imports.manage', 'imports', 'Upload, validate, and confirm bulk data imports', false);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  type text not null check (type in ('sales_history', 'products')),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'validating', 'validated', 'importing', 'completed', 'failed')),
  file_storage_path text not null,
  file_name text not null,
  uploaded_by uuid not null references public.profiles (id),
  confirmed_by uuid references public.profiles (id),
  confirmed_at timestamptz,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  error_rows integer not null default 0,
  imported_rows integer not null default 0,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_imports_tenant on public.imports (tenant_id, created_at desc);

create trigger set_imports_updated_at
before update on public.imports
for each row execute function public.set_updated_at();

alter table public.imports enable row level security;

create policy imports_select on public.imports
for select to authenticated
using (public.has_permission(tenant_id, 'imports.manage'));

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  import_id uuid not null references public.imports (id) on delete cascade,
  row_number integer not null,
  raw_data jsonb not null,
  status text not null default 'invalid' check (status in ('valid', 'invalid', 'imported', 'skipped')),
  errors jsonb,
  resolved_data jsonb,
  created_entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_import_rows_import on public.import_rows (import_id, row_number);
create index idx_import_rows_status on public.import_rows (import_id, status);

create trigger set_import_rows_updated_at
before update on public.import_rows
for each row execute function public.set_updated_at();

alter table public.import_rows enable row level security;

create policy import_rows_select on public.import_rows
for select to authenticated
using (public.has_permission(tenant_id, 'imports.manage'));

-- Private bucket -- an uploaded file may contain real historical
-- business data (amounts, product/customer names), unlike product-
-- images' deliberately-public bucket. Never fetched by a public URL;
-- only ImportService (always the service-role client, per this
-- migration's header) ever reads/writes it, so no storage.objects RLS
-- policy is needed at all -- same "service-role only, zero policies"
-- posture as the two tables above.
insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

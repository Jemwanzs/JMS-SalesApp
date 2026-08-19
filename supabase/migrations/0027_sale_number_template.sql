-- ============================================================================
-- 0027_sale_number_template.sql
--
-- Tenant-configurable sale-number template (docs/08-sales-engine.md's
-- "Sale numbering" section), deferred since migration 0005's own header
-- comment ("sale_number_sequences' template is NOT tenant-configurable
-- yet ... reading the format from tenant_settings is a fast-follow, not
-- blocking a working default").
--
-- Scope, deliberately: the doc lists 6 possible template variables
-- (business prefix, branch prefix, year/month/day, sequential number,
-- product prefix, user prefix), but its own three worked examples
-- (`SALE-{YYYY}-{000001}`, `ABC-{DDMMYYYY}-{00001}`, `BRANCH-{YYYYMMDD}-
-- {0001}`) only ever exercise a literal prefix, a date token, and the
-- sequence placeholder. Product/user-prefix tokens would need the
-- sequence counter itself re-scoped per product/user (the doc's own
-- "(tenant_id, location_id, scope_key, year)" phrasing hints at exactly
-- this) -- a materially bigger, riskier change than reading a format
-- string. This migration implements the three tokens the worked
-- examples actually use, plus {LOCATION} for "branch prefix" (a
-- location's own `code`, per-location by construction since the counter
-- is already scoped by location_id) -- product/user-prefix tokens are a
-- documented, deliberate follow-up, not silently dropped.
--
-- Sequence placeholder syntax is exactly what the doc's own examples
-- already imply: a brace group of ALL ZEROS (`{000001}`, `{0001}`, ...)
-- -- the digit count IS the padding width, so no separate token name is
-- needed. The counter's own scope/reset cadence (tenant_id, location_id,
-- year) is UNCHANGED -- a template that only shows a day-grain date
-- token still gets a year-wide monotonic sequence, not a daily reset;
-- "unique within scope," not "resets on whatever grain the format
-- happens to display," is the documented guarantee (migration 0005's
-- own comment), and this migration doesn't relitigate that.
--
-- Template VALIDATION (a real sequence placeholder present, only known
-- tokens used) happens at the application layer before a tenant's
-- template is ever saved (features/settings/actions/set-sale-number-
-- template.ts) -- this trigger still has a safe, sane fallback (append
-- a plain 6-digit sequence) if it somehow receives a template with no
-- recognizable sequence placeholder, so a malformed value already in
-- tenant_settings can never make sale recording start failing.
-- ============================================================================

create or replace function public.assign_sale_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer;
  v_seq bigint;
  v_template text;
  v_location_code text;
  v_seq_match text[];
  v_pad_width integer;
  v_result text;
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

  select (value #>> '{}') into v_template
  from public.tenant_settings
  where tenant_id = new.tenant_id and setting_key = 'sale_number_template';
  v_template := coalesce(v_template, 'SALE-{YYYY}-{000001}');

  select code into v_location_code from public.locations where id = new.location_id;

  v_result := v_template;
  v_result := replace(v_result, '{YYYY}', lpad(v_year::text, 4, '0'));
  v_result := replace(v_result, '{YY}', lpad((v_year % 100)::text, 2, '0'));
  v_result := replace(v_result, '{MM}', lpad(extract(month from new.sale_date)::text, 2, '0'));
  v_result := replace(v_result, '{DD}', lpad(extract(day from new.sale_date)::text, 2, '0'));
  v_result := replace(v_result, '{DDMMYYYY}', to_char(new.sale_date, 'DDMMYYYY'));
  v_result := replace(v_result, '{YYYYMMDD}', to_char(new.sale_date, 'YYYYMMDD'));
  v_result := replace(v_result, '{LOCATION}', coalesce(v_location_code, ''));

  select regexp_matches(v_result, '\{(0+)\}') into v_seq_match;
  if v_seq_match is not null then
    v_pad_width := length(v_seq_match[1]);
    v_result := replace(v_result, '{' || v_seq_match[1] || '}', lpad(v_seq::text, v_pad_width, '0'));
  else
    -- No recognizable sequence placeholder (a malformed template that
    -- somehow bypassed app-layer validation) -- append one rather than
    -- let sale recording start failing on a uniqueness violation.
    v_result := v_result || '-' || lpad(v_seq::text, 6, '0');
  end if;

  new.sale_number := v_result;
  return new;
end;
$$;

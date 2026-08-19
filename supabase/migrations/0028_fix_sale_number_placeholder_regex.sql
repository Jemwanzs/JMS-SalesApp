-- ============================================================================
-- 0028_fix_sale_number_placeholder_regex.sql
--
-- Fixes a real bug in migration 0027, caught during live verification
-- (not by inspection): the sequence-placeholder regex required the
-- brace group to be ALL zeros (`0+`), but docs/08-sales-engine.md's own
-- three worked examples -- `{000001}`, `{00001}`, `{0001}` -- all end in
-- a literal "1", not a zero. Read strictly, none of the spec's own
-- example templates matched the pattern this migration originally
-- shipped, so every sale number came out with the placeholder left
-- untouched and a fallback sequence appended instead (e.g.
-- "SALE-2026-{000001}-000001") -- wrong, though not silently wrong: the
-- number was still unique, just not what the template asked for.
--
-- Fix: widen the placeholder pattern from "all zeros" (`0+`) to "any
-- digits" (`\d+`) -- the brace-wrapped number's DIGIT COUNT is what sets
-- the padding width, regardless of which digits appear in it. This is
-- unambiguous given the current token set (no other supported token is
-- purely numeric) and makes every one of the doc's own literal examples
-- work exactly as written, not just a "cleaned up all-zeros" variant of
-- them. See lib/utils/sale-number-template.ts for the matching
-- TypeScript-side fix (validation + client preview).
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

  select regexp_matches(v_result, '\{(\d+)\}') into v_seq_match;
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

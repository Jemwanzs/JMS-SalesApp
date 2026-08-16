-- ============================================================================
-- 0015_queue_daily_report_job_and_corrections_report.sql
--
-- Fixes a real gap found while building Phase 3e: only the pg_cron sweep
-- (migration 0011's run_business_day_sweep, auto-close path) ever
-- inserted into report_jobs -- BusinessDayService.closeDay() (the manual
-- "Close" button, the far more commonly exercised path in testing so
-- far) never queued anything at all, so daily reports/insights silently
-- never got generated for a manually-closed day. report_jobs has RLS
-- enabled with zero policies (deliberately -- see migration 0011), so
-- the RLS-respecting client BusinessDayService uses has no direct write
-- path; queue_daily_report_job() is a narrow SECURITY DEFINER function
-- for exactly this one queuing operation, gated by is_tenant_member()
-- rather than left open to any authenticated caller.
-- ============================================================================

create or replace function public.queue_daily_report_job(p_business_day_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day public.business_days;
begin
  select * into v_day from public.business_days where id = p_business_day_id;
  if not found then
    raise exception 'Business day not found';
  end if;

  if not public.is_tenant_member(v_day.tenant_id) then
    raise exception 'Not authorized';
  end if;

  insert into public.report_jobs (tenant_id, job_type, payload)
  values (
    v_day.tenant_id, 'daily_business_day_report',
    jsonb_build_object('business_day_id', v_day.id, 'location_id', v_day.location_id)
  );
end;
$$;

revoke execute on function public.queue_daily_report_job(uuid) from public;
grant execute on function public.queue_daily_report_job(uuid) to authenticated;

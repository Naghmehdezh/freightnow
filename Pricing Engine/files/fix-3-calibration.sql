-- FIX 3: percentile_cont returns double precision; round(double, int) does not
-- exist in Postgres. Casts the percentile results to numeric.
-- Safe to run on the existing database.

create or replace function calibration_report(
  p_months  int default 12,
  p_min_n   int default 30,
  p_cap     numeric default 10
)
returns table (
  band_label   text,
  band_max     numeric,
  current_mk   numeric,
  n            bigint,
  median_mk    numeric,
  p25          numeric,
  p75          numeric,
  spread       numeric,
  reps         bigint,
  proposed_mk  numeric,
  status       text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare r pricing_rules%rowtype;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select * into r from pricing_rules where active;

  return query
  with bands as (
    select
      (b->>'max')::numeric as bmax,
      (b->>'mk')::numeric  as bmk,
      coalesce(lag((b->>'max')::numeric) over (order by (b->>'max')::numeric), 0) as bmin
    from jsonb_array_elements(r.bands) b
  ),
  obs as (
    select b.bmax, b.bmk, b.bmin, q.markup_pct, q.rep_id
    from bands b
    left join quotes q
      on q.cost > b.bmin and q.cost <= b.bmax
     and q.quoted_at > now() - make_interval(months => p_months)
     and (q.reason is null or q.reason not in ('contract','oneoff'))
  ),
  agg as (
    select
      bmax, bmk, bmin,
      count(markup_pct) as cnt,
      count(distinct rep_id) as rep_cnt,
      (percentile_cont(0.5)  within group (order by markup_pct))::numeric as med,
      (percentile_cont(0.25) within group (order by markup_pct))::numeric as q1,
      (percentile_cont(0.75) within group (order by markup_pct))::numeric as q3
    from obs group by bmax, bmk, bmin
  )
  select
    case when bmax > 99999999 then 'over $' || bmin::text
         else '$' || bmin::text || ' - $' || bmax::text end,
    bmax,
    bmk,
    cnt,
    round(med,1), round(q1,1), round(q3,1), round(q3-q1,1),
    rep_cnt,
    case when cnt >= p_min_n
         then bmk + greatest(-p_cap, least(p_cap, round(med) - bmk))
         else null end,
    case
      when cnt = 0            then 'no data'
      when cnt < p_min_n      then cnt || '/' || p_min_n || ' quotes'
      when rep_cnt = 1        then 'single rep - review before applying'
      when (q3-q1) > 60       then 'ready, but spread is wide'
      else 'ready'
    end
  from agg
  order by bmax;
end;
$$;

revoke all on function calibration_report from public;
grant execute on function calibration_report to authenticated;  -- gated by is_admin() inside

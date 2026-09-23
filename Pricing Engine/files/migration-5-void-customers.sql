-- =====================================================================
-- MIGRATION 5
--   1. Quotes can be voided (excluded everywhere, row kept)
--   2. Only admins create or edit customers
-- Run once, after migration 4.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Voiding
-- ---------------------------------------------------------------------
alter table quotes
  add column voided     boolean not null default false,
  add column voided_at  timestamptz,
  add column voided_by  uuid references profiles(id);

create or replace function void_quote(p_id uuid, p_undo boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_undo then
    update quotes set voided = false, voided_at = null, voided_by = null
     where id = p_id;
  else
    update quotes set voided = true, voided_at = now(), voided_by = auth.uid()
     where id = p_id;
  end if;
end;
$$;

revoke all on function void_quote from public;
grant execute on function void_quote to authenticated;

-- calibration must ignore voided rows
drop index if exists quotes_calibration_idx;
create index quotes_calibration_idx on quotes (cost, quoted_at)
  where not voided and (reason is null or reason not in ('contract','oneoff'));


-- ---------------------------------------------------------------------
-- 2. Reports exclude voided rows
-- ---------------------------------------------------------------------
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
     and not q.voided
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
    bmax, bmk, cnt,
    round(med,1), round(q1,1), round(q3,1), round(q3-q1,1),
    rep_cnt,
    case when cnt >= p_min_n
         then bmk + greatest(-p_cap, least(p_cap, round(med) - bmk))
         else null end,
    case
      when cnt = 0       then 'no data'
      when cnt < p_min_n then cnt || '/' || p_min_n || ' quotes'
      when rep_cnt = 1   then 'single rep - review before applying'
      when (q3-q1) > 60  then 'ready, but spread is wide'
      else 'ready'
    end
  from agg
  order by bmax;
end;
$$;

revoke all on function calibration_report from public;
grant execute on function calibration_report to authenticated;

create or replace view rep_consistency
with (security_invoker = true) as
select
  p.full_name,
  count(*) as quotes,
  round(percentile_cont(0.5) within group (order by q.markup_pct)::numeric, 1) as median_markup,
  round((percentile_cont(0.75) within group (order by q.markup_pct)
       - percentile_cont(0.25) within group (order by q.markup_pct))::numeric, 1) as spread,
  count(*) filter (where abs(q.final_sell - q.engine_sell) >= 0.01) as overrides,
  round(100.0 * count(*) filter (where abs(q.final_sell - q.engine_sell) >= 0.01) / count(*), 0) as override_pct
from quotes q join profiles p on p.id = q.rep_id
where q.quoted_at > now() - interval '6 months' and not q.voided
group by p.full_name
order by spread desc;

create or replace view customer_consistency
with (security_invoker = true) as
select
  c.name as customer,
  count(*) as quotes,
  count(distinct q.rep_id) as reps,
  round(percentile_cont(0.5) within group (order by q.markup_pct)::numeric, 1) as median_markup,
  round(percentile_cont(0.25) within group (order by q.markup_pct)::numeric, 1) as p25,
  round(percentile_cont(0.75) within group (order by q.markup_pct)::numeric, 1) as p75,
  round((percentile_cont(0.75) within group (order by q.markup_pct)
       - percentile_cont(0.25) within group (order by q.markup_pct))::numeric, 1) as spread,
  round(sum(q.final_sell - q.cost)::numeric, 2) as gross_margin
from quotes q
join customers c on c.id = q.customer_id
where q.quoted_at > now() - interval '12 months' and not q.voided
group by c.name
having count(*) >= 3
order by spread desc;


-- ---------------------------------------------------------------------
-- 3. Customers become an admin-managed list
-- ---------------------------------------------------------------------
drop policy if exists "reps add customers" on customers;
drop function if exists find_or_create_customer(text);

-- Reps still read the list; only admins change it.
-- ("everyone reads customers" and "admins manage customers" already exist.)

-- A quote should name an account. Existing rows are left alone; new ones
-- are enforced by the app, and this makes it visible in the data model.
comment on column quotes.customer_id is
  'Set by the app on every new quote. Older rows may be null.';

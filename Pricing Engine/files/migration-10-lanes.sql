-- =====================================================================
-- MIGRATION 10 — lane capture
--
-- Full postal codes are stored; the 3-character zone is derived from
-- them and is what the reports group on. A full Canadian postal code
-- often covers one side of one street, so grouping on it would give
-- every lane a sample size of one. FSA and 3-digit ZIP are the level
-- LTL carriers actually rate on.
--
-- None of this affects pricing. The fields are recorded and reported
-- on; price_quote is untouched.
-- Run after migration 9.
-- =====================================================================

create type delivery_type as enum ('commercial','residential','unknown');

alter table quotes
  add column if not exists origin_country  text,
  add column if not exists origin_region   text,     -- province / state, 2 letters
  add column if not exists origin_city     text,     -- readability only, never grouped on
  add column if not exists origin_postal   text,
  add column if not exists dest_country    text,
  add column if not exists dest_region     text,
  add column if not exists dest_city       text,
  add column if not exists dest_postal     text,
  add column if not exists dest_delivery   delivery_type not null default 'unknown';

-- Derived zones. Generated columns cannot drift from their source, so
-- there is no cleanup job and no mismatched spellings to reconcile.
alter table quotes
  add column if not exists origin_zone text
    generated always as (
      nullif(upper(left(regexp_replace(coalesce(origin_postal,''), '[^A-Za-z0-9]', '', 'g'), 3)), '')
    ) stored,
  add column if not exists dest_zone text
    generated always as (
      nullif(upper(left(regexp_replace(coalesce(dest_postal,''), '[^A-Za-z0-9]', '', 'g'), 3)), '')
    ) stored;

create index if not exists quotes_lane_zone_idx
  on quotes (origin_zone, dest_zone, mode, quoted_at desc)
  where not voided;
create index if not exists quotes_lane_region_idx
  on quotes (origin_region, dest_region, mode, quoted_at desc)
  where not voided;


-- ---------------------------------------------------------------------
-- lane_history — what have we seen on this lane before?
--
-- Answers at the most specific level that has data and says which level
-- it used, so a rep knows whether they are looking at eight matching
-- shipments or a regional average.
-- ---------------------------------------------------------------------
create or replace function lane_history(
  p_origin_postal text,
  p_dest_postal   text,
  p_origin_region text default null,
  p_dest_region   text default null,
  p_mode          quote_mode default null,
  p_months        int default 18
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  oz text; dz text;
  n int; lvl text;
  res jsonb;
begin
  oz := nullif(upper(left(regexp_replace(coalesce(p_origin_postal,''), '[^A-Za-z0-9]', '', 'g'), 3)), '');
  dz := nullif(upper(left(regexp_replace(coalesce(p_dest_postal,''),   '[^A-Za-z0-9]', '', 'g'), 3)), '');

  -- level 1: zone to zone
  if oz is not null and dz is not null then
    select count(*) into n from quotes
     where not voided and origin_zone = oz and dest_zone = dz
       and (p_mode is null or mode = p_mode)
       and quoted_at > now() - make_interval(months => p_months);
    if n >= 3 then lvl := 'zone'; end if;
  end if;

  -- level 2: province / state
  if lvl is null and p_origin_region is not null and p_dest_region is not null then
    select count(*) into n from quotes
     where not voided and origin_region = upper(p_origin_region) and dest_region = upper(p_dest_region)
       and (p_mode is null or mode = p_mode)
       and quoted_at > now() - make_interval(months => p_months);
    if n >= 3 then lvl := 'region'; end if;
  end if;

  if lvl is null then
    return jsonb_build_object('level','none','n',coalesce(n,0));
  end if;

  with obs as (
    select cost_cad, final_sell, markup_pct, actual_wt, chargeable_wt, quoted_at
    from quotes
    where not voided
      and (p_mode is null or mode = p_mode)
      and quoted_at > now() - make_interval(months => p_months)
      and case when lvl = 'zone'
               then origin_zone = oz and dest_zone = dz
               else origin_region = upper(p_origin_region) and dest_region = upper(p_dest_region)
          end
  )
  select jsonb_build_object(
    'level',        lvl,
    'n',            count(*),
    'median_cost',  round((percentile_cont(0.5) within group (order by cost_cad))::numeric, 2),
    'p25_cost',     round((percentile_cont(0.25) within group (order by cost_cad))::numeric, 2),
    'p75_cost',     round((percentile_cont(0.75) within group (order by cost_cad))::numeric, 2),
    'median_sell',  round((percentile_cont(0.5) within group (order by final_sell))::numeric, 2),
    'median_markup',round((percentile_cont(0.5) within group (order by markup_pct))::numeric, 1),
    'median_wt',    round((percentile_cont(0.5) within group (order by chargeable_wt))::numeric, 1),
    'last_quoted',  max(quoted_at)
  ) into res from obs;

  return res;
end;
$$;

revoke all on function lane_history from public;
grant execute on function lane_history to authenticated;


-- ---------------------------------------------------------------------
-- save_quote and update_quote carry the lane
-- ---------------------------------------------------------------------
drop function if exists save_quote(numeric,quote_scope,quote_mode,quote_pkg,jsonb,uuid,numeric,override_reason,text,text,numeric);

create or replace function save_quote(
  p_cost        numeric,
  p_scope       quote_scope,
  p_mode        quote_mode,
  p_packaging   quote_pkg,
  p_lines       jsonb,
  p_customer_id uuid    default null,
  p_final_sell  numeric default null,
  p_reason      override_reason default null,
  p_reference   text    default null,
  p_currency    text    default 'CAD',
  p_fx          numeric default null,
  p_lane        jsonb   default null      -- {origin_country, origin_region, ...}
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare q jsonb; final numeric; new_id uuid; L jsonb;
begin
  q := price_quote(p_cost, p_scope, p_mode, p_packaging, p_lines, p_currency, p_fx);
  final := coalesce(p_final_sell, (q->>'sell')::numeric);
  if abs(final - (q->>'sell')::numeric) >= 0.01 and p_reason is null then
    raise exception 'a reason is required when the final price differs from the recommendation';
  end if;
  L := coalesce(p_lane, '{}'::jsonb);

  insert into quotes (
    cost, scope, mode, packaging, lines, customer_id,
    pieces, actual_wt, chargeable_wt, cube_ft3, density_pcf, est_class,
    rules_version, engine_sell, final_sell, reason, reference,
    currency, fx_rate, cost_cad,
    origin_country, origin_region, origin_city, origin_postal,
    dest_country, dest_region, dest_city, dest_postal, dest_delivery
  ) values (
    p_cost, p_scope, p_mode, p_packaging, p_lines, p_customer_id,
    (q->>'pieces')::int, (q->>'actual_wt')::numeric, (q->>'chargeable_wt')::numeric,
    (q->>'cube_ft3')::numeric, (q->>'density_pcf')::numeric, (q->>'est_class')::numeric,
    (q->>'rules_version')::int, (q->>'sell')::numeric, final, p_reason, p_reference,
    p_currency, (q->>'fx_rate')::numeric, (q->>'cost_cad')::numeric,
    L->>'origin_country', upper(L->>'origin_region'), L->>'origin_city', upper(L->>'origin_postal'),
    L->>'dest_country',   upper(L->>'dest_region'),   L->>'dest_city',   upper(L->>'dest_postal'),
    coalesce((L->>'dest_delivery')::delivery_type, 'unknown')
  ) returning id into new_id;

  return q || jsonb_build_object('quote_id', new_id, 'final_sell', final);
end;
$$;

revoke all on function save_quote from public;
grant execute on function save_quote to authenticated;


drop function if exists update_quote(uuid,numeric,quote_scope,quote_mode,quote_pkg,jsonb,uuid,numeric,override_reason,text,text,numeric);

create or replace function update_quote(
  p_id          uuid,
  p_cost        numeric,
  p_scope       quote_scope,
  p_mode        quote_mode,
  p_packaging   quote_pkg,
  p_lines       jsonb,
  p_customer_id uuid    default null,
  p_final_sell  numeric default null,
  p_reason      override_reason default null,
  p_reference   text    default null,
  p_currency    text    default 'CAD',
  p_fx          numeric default null,
  p_lane        jsonb   default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare q jsonb; final numeric; owner uuid; gone boolean; L jsonb;
begin
  select rep_id, voided into owner, gone from quotes where id = p_id;
  if owner is null then raise exception 'that quote no longer exists'; end if;
  if not (owner = auth.uid() or is_admin()) then
    raise exception 'you can only edit your own quotes';
  end if;
  if gone then raise exception 'a voided quote cannot be edited - restore it first'; end if;

  q := price_quote(p_cost, p_scope, p_mode, p_packaging, p_lines, p_currency, p_fx);
  final := coalesce(p_final_sell, (q->>'sell')::numeric);
  if abs(final - (q->>'sell')::numeric) >= 0.01 and p_reason is null then
    raise exception 'a reason is required when the final price differs from the recommendation';
  end if;
  L := coalesce(p_lane, '{}'::jsonb);

  update quotes set
    cost=p_cost, scope=p_scope, mode=p_mode, packaging=p_packaging, lines=p_lines,
    customer_id=p_customer_id,
    pieces=(q->>'pieces')::int, actual_wt=(q->>'actual_wt')::numeric,
    chargeable_wt=(q->>'chargeable_wt')::numeric, cube_ft3=(q->>'cube_ft3')::numeric,
    density_pcf=(q->>'density_pcf')::numeric, est_class=(q->>'est_class')::numeric,
    rules_version=(q->>'rules_version')::int, engine_sell=(q->>'sell')::numeric,
    final_sell=final, reason=p_reason, reference=p_reference,
    currency=p_currency, fx_rate=(q->>'fx_rate')::numeric, cost_cad=(q->>'cost_cad')::numeric,
    origin_country=L->>'origin_country', origin_region=upper(L->>'origin_region'),
    origin_city=L->>'origin_city',       origin_postal=upper(L->>'origin_postal'),
    dest_country=L->>'dest_country',     dest_region=upper(L->>'dest_region'),
    dest_city=L->>'dest_city',           dest_postal=upper(L->>'dest_postal'),
    dest_delivery=coalesce((L->>'dest_delivery')::delivery_type,'unknown'),
    edited_at=now(), edited_by=auth.uid(), edit_count=edit_count+1
  where id = p_id;

  return q || jsonb_build_object('quote_id', p_id, 'final_sell', final);
end;
$$;

revoke all on function update_quote from public;
grant execute on function update_quote to authenticated;


-- ---------------------------------------------------------------------
-- Admin view: which lanes are building up enough history to be useful
-- ---------------------------------------------------------------------
create or replace view lane_summary
with (security_invoker = true) as
select
  origin_zone || ' → ' || dest_zone as lane,
  mode,
  count(*) as quotes,
  round((percentile_cont(0.5) within group (order by cost_cad))::numeric, 2)   as median_cost,
  round((percentile_cont(0.5) within group (order by markup_pct))::numeric, 1) as median_markup,
  round((percentile_cont(0.75) within group (order by cost_cad)
       - percentile_cont(0.25) within group (order by cost_cad))::numeric, 2)  as cost_spread,
  max(quoted_at)::date as last_quoted
from quotes
where not voided and origin_zone is not null and dest_zone is not null
  and quoted_at > now() - interval '18 months'
group by origin_zone, dest_zone, mode
having count(*) >= 2
order by count(*) desc;

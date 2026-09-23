-- =====================================================================
-- MIGRATION 7b — LCL ocean, USD pricing, saved exchange rate
-- Run AFTER 7a has completed.
--
-- Design notes:
--  * All margin logic runs in CAD. A USD shipment is converted to CAD to
--    pick the band, priced, then converted back for display. That keeps
--    one band table doing the work rather than two that drift apart.
--  * LCL is charged on W/M — the greater of cubic metres and metric
--    tonnes. That is the ocean equivalent of dim weight.
--  * quotes.cost_cad is what calibration groups on, so a USD shipment
--    lands in the right band alongside the domestic ones.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Settings — currently just the default exchange rate
-- ---------------------------------------------------------------------
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

alter table settings enable row level security;

create policy "everyone reads settings" on settings
  for select using (auth.uid() is not null);
create policy "admins write settings" on settings
  for all using (is_admin()) with check (is_admin());

insert into settings (key, value)
values ('usd_cad', '1.40'::jsonb)
on conflict (key) do nothing;

create or replace function set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  insert into settings (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update
    set value = excluded.value, updated_at = now(), updated_by = auth.uid();
end;
$$;
revoke all on function set_setting from public;
grant execute on function set_setting to authenticated;


-- ---------------------------------------------------------------------
-- 2. Quotes carry their currency
-- ---------------------------------------------------------------------
alter table quotes
  add column if not exists currency  text not null default 'CAD',
  add column if not exists fx_rate   numeric(10,4),
  add column if not exists cost_cad  numeric(10,2);

update quotes set cost_cad = cost where cost_cad is null;

alter table quotes drop constraint if exists packaging_matches_mode;
alter table quotes add constraint packaging_matches_mode check (
  (mode = 'ltl'     and packaging = 'Skid') or
  (mode = 'lcl'     and packaging = 'LCL')  or
  (mode = 'courier' and packaging in ('Envelope','Package'))
);

create index if not exists quotes_costcad_idx on quotes (cost_cad, quoted_at);


-- ---------------------------------------------------------------------
-- 3. Add an LCL floor to the active rules
-- ---------------------------------------------------------------------
update pricing_rules
   set floors = floors || '{"LCL":150}'::jsonb
 where floors->>'LCL' is null;


-- ---------------------------------------------------------------------
-- 4. price_quote — currency aware, LCL aware
-- ---------------------------------------------------------------------
drop function if exists price_quote(numeric,quote_scope,quote_mode,quote_pkg,jsonb);

create or replace function price_quote(
  p_cost      numeric,
  p_scope     quote_scope,
  p_mode      quote_mode,
  p_packaging quote_pkg,
  p_lines     jsonb,                      -- inches / lb
  p_currency  text    default 'CAD',
  p_fx        numeric default null         -- USD -> CAD; defaults to the saved rate
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r          pricing_rules%rowtype;
  ln         jsonb;
  qty        int;
  l numeric; w numeric; h numeric; wt numeric;
  cuin numeric; dim_wt numeric;
  pieces     int := 0;
  actual     numeric := 0;      -- lb
  cube       numeric := 0;      -- ft3
  chargeable numeric := 0;      -- lb, or revenue tons for LCL
  any_dim    boolean := false;
  density    numeric;
  cls        numeric;
  cbm        numeric;
  tonnes     numeric;
  wm         numeric;
  wm_basis   text;
  fx         numeric;
  cost_cad   numeric;
  base_mk    numeric;
  adj        numeric := 0;
  sell_cad   numeric;
  sell       numeric;
  floor_amt  numeric;
  floored    boolean := false;
  rnd        numeric;
  flags      text[] := '{}';
begin
  if p_cost is null or p_cost <= 0 then
    raise exception 'carrier cost is required';
  end if;
  if p_currency not in ('CAD','USD') then
    raise exception 'currency must be CAD or USD';
  end if;

  if p_mode = 'lcl' then
    if p_packaging <> 'LCL' then raise exception 'LCL shipments use LCL packaging'; end if;
  elsif (p_mode = 'ltl') <> (p_packaging = 'Skid') then
    raise exception 'packaging % is not valid for mode %', p_packaging, p_mode;
  end if;

  select * into r from pricing_rules where active;
  if not found then raise exception 'no active pricing rules'; end if;

  fx := coalesce(p_fx, (select value::text::numeric from settings where key = 'usd_cad'), 1.40);
  if p_currency = 'USD' then cost_cad := p_cost * fx; else cost_cad := p_cost; end if;

  for ln in select * from jsonb_array_elements(p_lines) loop
    qty := greatest(1, coalesce((ln->>'qty')::int, 1));
    l   := coalesce((ln->>'l')::numeric, 0);
    w   := coalesce((ln->>'w')::numeric, 0);
    h   := coalesce((ln->>'h')::numeric, 0);
    wt  := coalesce((ln->>'wt')::numeric, 0);

    cuin   := case when l>0 and w>0 and h>0 then l*w*h else 0 end;
    dim_wt := case when cuin>0 then cuin / r.dim_divisor else 0 end;

    pieces := pieces + qty;
    actual := actual + wt * qty;
    cube   := cube + (cuin / 1728.0) * qty;

    if p_mode = 'courier' then
      chargeable := chargeable + greatest(wt, dim_wt) * qty;
      if dim_wt > wt then any_dim := true; end if;
    end if;
  end loop;

  cbm     := cube / 35.3147;
  tonnes  := actual / 2204.62;
  density := case when cube > 0 then actual / cube else null end;

  if p_mode = 'ltl' then
    chargeable := actual;
    cls := case when density is not null then freight_class(density) else null end;
  elsif p_mode = 'lcl' then
    -- W/M: the carrier bills the greater of cubic metres and metric tonnes
    wm := greatest(cbm, tonnes);
    wm_basis := case when tonnes > cbm then 'weight' else 'measure' end;
    chargeable := round(wm, 3);
  end if;

  select (b->>'mk')::numeric into base_mk
  from jsonb_array_elements(r.bands) b
  where cost_cad <= (b->>'max')::numeric
  order by (b->>'max')::numeric limit 1;
  if base_mk is null then
    select (b->>'mk')::numeric into base_mk
    from jsonb_array_elements(r.bands) b
    order by (b->>'max')::numeric desc limit 1;
  end if;

  -- LCL is international by definition and its cost already reflects volume,
  -- so the density and multi-piece adjusters do not apply.
  if p_mode = 'lcl' then
    adj := adj + (r.adjusters->>'intl')::numeric;
  else
    if p_scope = 'xb'   then adj := adj + (r.adjusters->>'xb')::numeric;   end if;
    if p_scope = 'intl' then adj := adj + (r.adjusters->>'intl')::numeric; end if;
    if density is not null and density < 6 then
      adj := adj + (r.adjusters->>'low_density')::numeric;
    end if;
    if pieces >= 4 then adj := adj + (r.adjusters->>'multi')::numeric; end if;
  end if;

  sell_cad := cost_cad * (1 + (base_mk + adj) / 100.0);

  floor_amt := greatest(
    coalesce((r.floors->>p_packaging::text)::numeric, 0),
    cost_cad + (r.floors->>'min_gp')::numeric
  );
  if sell_cad < floor_amt then sell_cad := floor_amt; floored := true; end if;

  if p_currency = 'USD' then sell := sell_cad / fx; else sell := sell_cad; end if;
  rnd  := coalesce(nullif((r.floors->>'round')::numeric, 0), 1);
  sell := ceil(sell / rnd) * rnd;

  -- flags
  if cube = 0 then
    flags := array_append(flags, 'No dimensions entered - volume and density cannot be checked.');
  end if;
  if any_dim then
    flags := array_append(flags, 'Dim weight governs. The carrier bills on volume, not scale weight.');
  end if;
  if p_mode = 'courier' and density is not null and density < 6 then
    flags := array_append(flags, format('Density %s pcf - light and bulky. Reclass risk is real.', round(density,1)));
  end if;
  if p_mode = 'ltl' and density is not null and density < 6 then
    flags := array_append(flags, format('Density %s pcf - light and bulky. Reclass risk is real.', round(density,1)));
  end if;
  if p_mode = 'ltl' and cube > 350 and density is not null and density < 6 then
    flags := array_append(flags, format(
      'Large and light: %s ft3 at %s pcf. Many carriers apply a cubic capacity rule around this point. Confirm against your carrier tariff.',
      round(cube), round(density,1)));
  end if;
  if p_mode = 'ltl' and cube > 750 then
    flags := array_append(flags, format(
      'Shipment occupies %s ft3. Carrier cubic capacity rules commonly start near 750 ft3 - verify before quoting.', round(cube)));
  end if;
  if p_mode = 'ltl' and density is not null
     and freight_class(density*0.9) <> freight_class(density*1.1) then
    flags := array_append(flags, format(
      'Density sits near a class boundary - a 10%% measurement error moves this between class %s and %s.',
      freight_class(density*1.1), freight_class(density*0.9)));
  end if;

  if p_mode = 'lcl' then
    flags := array_append(flags, format(
      'W/M basis: %s. %s CBM against %s tonnes, so the carrier bills %s revenue tons.',
      wm_basis, round(cbm,3), round(tonnes,3), round(wm,3)));
    if wm < 1 then
      flags := array_append(flags, 'Under 1 CBM. Most consolidators apply a 1 CBM minimum - check the cost covers it.');
    end if;
    if tonnes > cbm then
      flags := array_append(flags, 'Weight governs rather than volume. Dense cargo - confirm the rate basis on the booking.');
    end if;
  end if;

  if pieces >= 4 and p_mode <> 'lcl' then
    flags := array_append(flags, format('Multi-piece - confirm the carrier quoted all %s pieces.', pieces));
  end if;
  if floored then
    flags := array_append(flags, 'Floored. Band markup landed below the minimum, so the floor set the price.');
  end if;
  if p_mode = 'lcl' then
    flags := array_append(flags, 'Ocean LCL - destination charges, THC and customs quote as separate lines.');
  elsif p_scope = 'intl' then
    flags := array_append(flags, 'International - duties, taxes and destination charges quote as separate lines.');
  elsif p_scope = 'xb' then
    flags := array_append(flags, 'Cross-border - customs entry and disbursement quote as separate lines.');
  end if;
  if p_currency = 'USD' then
    flags := array_append(flags, format('Priced in USD at %s. Margin bands were applied on the CAD equivalent of $%s.',
      fx, round(cost_cad,2)));
  end if;

  return jsonb_build_object(
    'sell',           sell,
    'cost',           p_cost,
    'currency',       p_currency,
    'fx_rate',        fx,
    'cost_cad',       round(cost_cad,2),
    'sell_cad',       round(sell_cad,2),
    'gross_margin',   sell - p_cost,
    'markup_pct',     round((sell / p_cost - 1) * 100, 1),
    'pieces',         pieces,
    'actual_wt',      round(actual, 1),
    'chargeable_wt',  round(chargeable, 3),
    'cube_ft3',       round(cube, 2),
    'cbm',            round(cbm, 3),
    'tonnes',         round(tonnes, 3),
    'wm_basis',       wm_basis,
    'density_pcf',    round(density, 1),
    'est_class',      cls,
    'dim_governs',    any_dim,
    'rules_version',  r.version,
    'flags',          to_jsonb(flags)
  );
end;
$$;

revoke all on function price_quote from public;
grant execute on function price_quote to authenticated;


-- ---------------------------------------------------------------------
-- 5. save_quote — records currency and the CAD equivalent
-- ---------------------------------------------------------------------
drop function if exists save_quote(numeric,quote_scope,quote_mode,quote_pkg,jsonb,uuid,numeric,override_reason,text);

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
  p_fx          numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare q jsonb; final numeric; new_id uuid;
begin
  q := price_quote(p_cost, p_scope, p_mode, p_packaging, p_lines, p_currency, p_fx);
  final := coalesce(p_final_sell, (q->>'sell')::numeric);

  if abs(final - (q->>'sell')::numeric) >= 0.01 and p_reason is null then
    raise exception 'a reason is required when the final price differs from the recommendation';
  end if;

  insert into quotes (
    cost, scope, mode, packaging, lines, customer_id,
    pieces, actual_wt, chargeable_wt, cube_ft3, density_pcf, est_class,
    rules_version, engine_sell, final_sell, reason, reference,
    currency, fx_rate, cost_cad
  ) values (
    p_cost, p_scope, p_mode, p_packaging, p_lines, p_customer_id,
    (q->>'pieces')::int, (q->>'actual_wt')::numeric, (q->>'chargeable_wt')::numeric,
    (q->>'cube_ft3')::numeric, (q->>'density_pcf')::numeric, (q->>'est_class')::numeric,
    (q->>'rules_version')::int, (q->>'sell')::numeric, final, p_reason, p_reference,
    p_currency, (q->>'fx_rate')::numeric, (q->>'cost_cad')::numeric
  ) returning id into new_id;

  return q || jsonb_build_object('quote_id', new_id, 'final_sell', final);
end;
$$;

revoke all on function save_quote from public;
grant execute on function save_quote to authenticated;


-- ---------------------------------------------------------------------
-- 6. Calibration bands on the CAD equivalent, not the face value
-- ---------------------------------------------------------------------
create or replace function calibration_report(
  p_months int default 12, p_min_n int default 30, p_cap numeric default 10
)
returns table (
  band_label text, band_max numeric, current_mk numeric, n bigint,
  median_mk numeric, p25 numeric, p75 numeric, spread numeric,
  reps bigint, proposed_mk numeric, status text
)
language plpgsql stable security definer set search_path = public as $$
declare r pricing_rules%rowtype;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select * into r from pricing_rules where active;

  return query
  with bands as (
    select (b->>'max')::numeric as bmax, (b->>'mk')::numeric as bmk,
           coalesce(lag((b->>'max')::numeric) over (order by (b->>'max')::numeric), 0) as bmin
    from jsonb_array_elements(r.bands) b
  ),
  obs as (
    select b.bmax, b.bmk, b.bmin, q.markup_pct, q.rep_id
    from bands b
    left join quotes q
      on coalesce(q.cost_cad, q.cost) > b.bmin
     and coalesce(q.cost_cad, q.cost) <= b.bmax
     and not q.voided
     and q.quoted_at > now() - make_interval(months => p_months)
     and (q.reason is null or q.reason not in ('contract','oneoff'))
  ),
  agg as (
    select bmax, bmk, bmin, count(markup_pct) as cnt, count(distinct rep_id) as rep_cnt,
      (percentile_cont(0.5)  within group (order by markup_pct))::numeric as med,
      (percentile_cont(0.25) within group (order by markup_pct))::numeric as q1,
      (percentile_cont(0.75) within group (order by markup_pct))::numeric as q3
    from obs group by bmax, bmk, bmin
  )
  select
    case when bmax > 99999999 then 'over $' || bmin::text
         else '$' || bmin::text || ' - $' || bmax::text end,
    bmax, bmk, cnt,
    round(med,1), round(q1,1), round(q3,1), round(q3-q1,1), rep_cnt,
    case when cnt >= p_min_n
         then bmk + greatest(-p_cap, least(p_cap, round(med) - bmk)) else null end,
    case
      when cnt = 0       then 'no data'
      when cnt < p_min_n then cnt || '/' || p_min_n || ' quotes'
      when rep_cnt = 1   then 'single rep - review before applying'
      when (q3-q1) > 60  then 'ready, but spread is wide'
      else 'ready'
    end
  from agg order by bmax;
end;
$$;

revoke all on function calibration_report from public;
grant execute on function calibration_report to authenticated;

-- =====================================================================
-- MIGRATION 8 — price_quote also returns the price in the other currency
--
-- A US-to-US move can be bought in USD and billed in CAD. The engine now
-- returns both figures so the rep does not do the conversion by hand.
-- Run after 7b.
-- =====================================================================

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
  alt_cur    text;
  alt_sell   numeric;
  alt_cost   numeric;
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

  -- the same price expressed in the other currency, for customers who are
  -- billed in one and quoted in the other. Rounded up the same way, so the
  -- two are close but not to the cent.
  if p_currency = 'USD' then
    alt_cur  := 'CAD';
    alt_sell := ceil((sell * fx) / rnd) * rnd;
    alt_cost := round(p_cost * fx, 2);
  else
    alt_cur  := 'USD';
    alt_sell := ceil((sell / fx) / rnd) * rnd;
    alt_cost := round(p_cost / fx, 2);
  end if;

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
    'alt_currency',   alt_cur,
    'alt_sell',       alt_sell,
    'alt_cost',       alt_cost,
    'alt_gross',      alt_sell - alt_cost,
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

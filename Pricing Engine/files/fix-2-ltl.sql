-- FIX 2: LTL no longer substitutes a volumetric weight. Chargeable weight
-- is the scale weight; density drives the class. Adds cubic-capacity warnings.
-- Safe to run on the existing database.

create or replace function price_quote(
  p_cost      numeric,
  p_scope     quote_scope,
  p_mode      quote_mode,
  p_packaging quote_pkg,
  p_lines     jsonb           -- [{"qty":1,"l":24,"w":24,"h":24,"wt":35}] inches/lb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r            pricing_rules%rowtype;
  ln           jsonb;
  qty          int;
  l            numeric; w numeric; h numeric; wt numeric;
  cuin         numeric; dim_wt numeric;
  pieces       int := 0;
  actual       numeric := 0;
  cube         numeric := 0;
  chargeable   numeric := 0;
  any_dim      boolean := false;
  density      numeric;
  cls          numeric;
  base_mk      numeric;
  adj          numeric := 0;
  sell         numeric;
  floor_amt    numeric;
  floored      boolean := false;
  rnd          numeric;
  flags        text[] := '{}';
begin
  if p_cost is null or p_cost <= 0 then
    raise exception 'carrier cost is required';
  end if;
  if (p_mode = 'ltl') <> (p_packaging = 'Skid') then
    raise exception 'packaging % is not valid for mode %', p_packaging, p_mode;
  end if;

  select * into r from pricing_rules where active;
  if not found then raise exception 'no active pricing rules'; end if;

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

    -- courier rates each piece on its own greater-of; LTL aggregates
    if p_mode = 'courier' then
      chargeable := chargeable + greatest(wt, dim_wt) * qty;
      if dim_wt > wt then any_dim := true; end if;
    else
      chargeable := chargeable + wt * qty;
    end if;
  end loop;

  -- LTL bills actual weight at a rate set by the freight class. There is no
  -- volumetric substitution, so chargeable weight stays as the scale weight
  -- and density drives the class instead.
  if p_mode = 'ltl' then
    chargeable := actual;
    any_dim := false;
  end if;

  density := case when cube > 0 then actual / cube else null end;
  cls     := case when density is not null then freight_class(density) else null end;

  -- band lookup: first band whose ceiling the cost fits under
  select (b->>'mk')::numeric into base_mk
  from jsonb_array_elements(r.bands) b
  where p_cost <= (b->>'max')::numeric
  order by (b->>'max')::numeric
  limit 1;
  if base_mk is null then
    select (b->>'mk')::numeric into base_mk
    from jsonb_array_elements(r.bands) b
    order by (b->>'max')::numeric desc limit 1;
  end if;

  if p_scope = 'xb'   then adj := adj + (r.adjusters->>'xb')::numeric;   end if;
  if p_scope = 'intl' then adj := adj + (r.adjusters->>'intl')::numeric; end if;
  if density is not null and density < 6 then
    adj := adj + (r.adjusters->>'low_density')::numeric;
  end if;
  if pieces >= 4 then adj := adj + (r.adjusters->>'multi')::numeric; end if;

  sell := p_cost * (1 + (base_mk + adj) / 100.0);

  floor_amt := greatest(
    coalesce((r.floors->>p_packaging::text)::numeric, 0),
    p_cost + (r.floors->>'min_gp')::numeric
  );
  if sell < floor_amt then sell := floor_amt; floored := true; end if;

  rnd  := coalesce(nullif((r.floors->>'round')::numeric, 0), 1);
  sell := ceil(sell / rnd) * rnd;

  -- flags: the operational value, safe to expose
  if cube = 0 then
    flags := array_append(flags, 'No dimensions entered — density, class and dim weight cannot be checked.');
  end if;
  if any_dim then
    flags := array_append(flags, 'Dim weight governs. The carrier bills on volume, not scale weight.');
  end if;
  if density is not null and density < 6 then
    flags := array_append(flags, format('Density %s pcf — light and bulky. Reclass risk is real.', round(density,1)));
  end if;
  if p_mode = 'ltl' and cube > 350 and density is not null and density < 6 then
    flags := array_append(flags, format(
      'Large and light: %s ft3 at %s pcf. Many carriers apply a cubic capacity rule around this point, which reprices the shipment. Confirm against your carrier tariff.',
      round(cube), round(density,1)));
  end if;
  if p_mode = 'ltl' and cube > 750 then
    flags := array_append(flags, format(
      'Shipment occupies %s ft3. Carrier cubic capacity rules commonly start near 750 ft3 - verify before quoting.', round(cube)));
  end if;
  if p_mode = 'ltl' and density is not null
     and freight_class(density*0.9) <> freight_class(density*1.1) then
    flags := array_append(flags, format('Density sits near a class boundary — a 10%% measurement error moves this between class %s and %s.',
                             freight_class(density*1.1), freight_class(density*0.9)));
  end if;
  if pieces >= 4 then
    flags := array_append(flags, format('Multi-piece — confirm the carrier quoted all %s pieces.', pieces));
  end if;
  if floored then
    flags := array_append(flags, 'Floored. Band markup landed below the minimum, so the floor set the price.');
  end if;
  if p_scope = 'xb' then
    flags := array_append(flags, 'Cross-border — customs entry and disbursement quote as separate lines.');
  end if;
  if p_scope = 'intl' then
    flags := array_append(flags, 'International — duties, taxes and destination charges quote as separate lines.');
  end if;

  return jsonb_build_object(
    'sell',           sell,
    'cost',           p_cost,
    'gross_margin',   sell - p_cost,
    'markup_pct',     round((sell / p_cost - 1) * 100, 1),
    'pieces',         pieces,
    'actual_wt',      round(actual, 1),
    'chargeable_wt',  round(chargeable, 1),
    'cube_ft3',       round(cube, 2),
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

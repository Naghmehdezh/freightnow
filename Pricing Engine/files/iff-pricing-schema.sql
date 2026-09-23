-- =====================================================================
-- IFF Cargo — Pricing Engine
-- Supabase / Postgres schema, RLS, pricing function, calibration
--
-- Design premise: reps never receive the rule table. They call
-- price_quote() and get back a number plus the derived figures and
-- flags. The bands live server-side and are readable by admins only.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. People
-- ---------------------------------------------------------------------
create type app_role as enum ('rep', 'admin');

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        app_role not null default 'rep',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- SECURITY DEFINER so the policies below can read roles without
-- recursing through profiles' own RLS.
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and active
  );
$$;

alter table profiles enable row level security;

create policy "read own profile" on profiles
  for select using (id = auth.uid());
create policy "admins read all profiles" on profiles
  for select using (is_admin());
create policy "admins write profiles" on profiles
  for all using (is_admin()) with check (is_admin());


-- ---------------------------------------------------------------------
-- 2. Rules — versioned, admin-only, never sent to the browser
-- ---------------------------------------------------------------------
create table pricing_rules (
  version      int primary key,
  bands        jsonb not null,   -- [{"max":40,"mk":175}, ...] ascending by max
  adjusters    jsonb not null,   -- {"xb":5,"intl":12,"low_density":10,"multi":5}
  floors       jsonb not null,   -- {"Envelope":105,"Package":135,"Skid":250,"min_gp":65,"round":5}
  dim_divisor  int  not null default 139,
  active       boolean not null default false,
  note         text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);

-- exactly one active version at a time
create unique index pricing_rules_one_active
  on pricing_rules ((active)) where active;

alter table pricing_rules enable row level security;

-- No rep policy at all. Reps cannot read this table, only call the
-- function below, which runs as definer and reads it on their behalf.
create policy "admins manage rules" on pricing_rules
  for all using (is_admin()) with check (is_admin());

insert into pricing_rules (version, bands, adjusters, floors, dim_divisor, active, note)
values (
  1,
  '[{"max":40,"mk":175},{"max":75,"mk":145},{"max":125,"mk":125},
    {"max":250,"mk":105},{"max":500,"mk":85},{"max":1000,"mk":70},
    {"max":999999999,"mk":55}]'::jsonb,
  '{"xb":5,"intl":12,"low_density":10,"multi":5}'::jsonb,
  '{"Envelope":105,"Package":135,"Skid":250,"min_gp":65,"round":5}'::jsonb,
  139, true,
  'Seeded from initial sample. Not calibrated — replace once real volume is logged.'
);


-- ---------------------------------------------------------------------
-- 3. Quotes — one pooled log across all reps
-- ---------------------------------------------------------------------
create type quote_scope   as enum ('dom','xb','intl');
create type quote_mode    as enum ('courier','ltl');
create type quote_pkg     as enum ('Envelope','Package','Skid');
create type quote_outcome as enum ('pending','won','lost');
create type override_reason as enum
  ('market','contract','incomplete','oneoff','handling');

create table quotes (
  id             uuid primary key default gen_random_uuid(),
  rep_id         uuid not null references profiles(id) default auth.uid(),
  quoted_at      timestamptz not null default now(),

  -- inputs
  cost           numeric(10,2) not null check (cost > 0),
  scope          quote_scope not null,
  mode           quote_mode  not null,
  packaging      quote_pkg   not null,
  lines          jsonb not null,          -- [{"qty":1,"l":24,"w":24,"h":24,"wt":35}]

  -- derived, stored so history stays reproducible
  pieces         int not null,
  actual_wt      numeric(10,2) not null,
  chargeable_wt  numeric(10,2) not null,
  cube_ft3       numeric(10,3),
  density_pcf    numeric(10,2),
  est_class      numeric(5,1),

  -- pricing
  rules_version  int not null references pricing_rules(version),
  engine_sell    numeric(10,2) not null,
  final_sell     numeric(10,2) not null check (final_sell > 0),
  markup_pct     numeric(10,2) generated always as
                   ((final_sell / cost - 1) * 100) stored,
  reason         override_reason,

  -- filled in later
  outcome        quote_outcome not null default 'pending',
  actual_cost    numeric(10,2),           -- carrier's real invoice
  reference      text,

  -- packaging must match mode
  constraint packaging_matches_mode check (
    (mode = 'ltl'     and packaging = 'Skid') or
    (mode = 'courier' and packaging in ('Envelope','Package'))
  ),
  -- a reason is required whenever the rep departed from the engine
  constraint reason_required_on_override check (
    abs(final_sell - engine_sell) < 0.01 or reason is not null
  )
);

create index quotes_calibration_idx on quotes (cost, quoted_at)
  where reason is null or reason not in ('contract','oneoff');
create index quotes_rep_idx on quotes (rep_id, quoted_at desc);

alter table quotes enable row level security;

create policy "reps insert own quotes" on quotes
  for insert with check (rep_id = auth.uid());
create policy "reps read own quotes" on quotes
  for select using (rep_id = auth.uid());
create policy "admins read all quotes" on quotes
  for select using (is_admin());
create policy "admins update quotes" on quotes
  for update using (is_admin()) with check (is_admin());
-- Nobody deletes. Corrections go through an admin update.


-- ---------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------
create or replace function freight_class(pcf numeric)
returns numeric language sql immutable as $$
  select case
    when pcf >= 50   then 50    when pcf >= 35   then 55
    when pcf >= 30   then 60    when pcf >= 22.5 then 65
    when pcf >= 15   then 70    when pcf >= 13.5 then 77.5
    when pcf >= 12   then 85    when pcf >= 10.5 then 92.5
    when pcf >= 9    then 100   when pcf >= 8    then 110
    when pcf >= 7    then 125   when pcf >= 6    then 150
    when pcf >= 5    then 175   when pcf >= 4    then 200
    when pcf >= 3    then 250   when pcf >= 2    then 300
    when pcf >= 1    then 400   else 500
  end;
$$;


-- ---------------------------------------------------------------------
-- 5. price_quote() — the only pricing surface reps touch
--
-- SECURITY DEFINER: reads pricing_rules on the caller's behalf without
-- granting them table access. Returns the price, the derived figures,
-- and the flags — never the bands.
-- ---------------------------------------------------------------------
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


-- ---------------------------------------------------------------------
-- 6. save_quote() — prices and logs atomically
--
-- The rep sends inputs only. The server re-prices rather than trusting
-- a number from the browser, so engine_sell is always the real
-- recommendation and overrides are honestly recorded.
-- ---------------------------------------------------------------------
create or replace function save_quote(
  p_cost       numeric,
  p_scope      quote_scope,
  p_mode       quote_mode,
  p_packaging  quote_pkg,
  p_lines      jsonb,
  p_final_sell numeric default null,
  p_reason     override_reason default null,
  p_reference  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q      jsonb;
  final  numeric;
  new_id uuid;
begin
  q := price_quote(p_cost, p_scope, p_mode, p_packaging, p_lines);
  final := coalesce(p_final_sell, (q->>'sell')::numeric);

  if abs(final - (q->>'sell')::numeric) >= 0.01 and p_reason is null then
    raise exception 'a reason is required when the final price differs from the recommendation';
  end if;

  insert into quotes (
    cost, scope, mode, packaging, lines,
    pieces, actual_wt, chargeable_wt, cube_ft3, density_pcf, est_class,
    rules_version, engine_sell, final_sell, reason, reference
  ) values (
    p_cost, p_scope, p_mode, p_packaging, p_lines,
    (q->>'pieces')::int, (q->>'actual_wt')::numeric, (q->>'chargeable_wt')::numeric,
    (q->>'cube_ft3')::numeric, (q->>'density_pcf')::numeric, (q->>'est_class')::numeric,
    (q->>'rules_version')::int, (q->>'sell')::numeric, final, p_reason, p_reference
  ) returning id into new_id;

  return q || jsonb_build_object('quote_id', new_id, 'final_sell', final);
end;
$$;

revoke all on function save_quote from public;
grant execute on function save_quote to authenticated;


-- ---------------------------------------------------------------------
-- 7. Calibration — admin only, proposes, never auto-applies
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


-- Publish a new version. Takes the full band array so the admin can
-- accept some proposals and not others.
create or replace function publish_rules(
  p_bands     jsonb,
  p_adjusters jsonb default null,
  p_floors    jsonb default null,
  p_note      text  default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare cur pricing_rules%rowtype; nv int;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select * into cur from pricing_rules where active;
  select coalesce(max(version),0) + 1 into nv from pricing_rules;

  update pricing_rules set active = false where active;

  insert into pricing_rules (version, bands, adjusters, floors, dim_divisor, active, note, created_by)
  values (nv, p_bands,
          coalesce(p_adjusters, cur.adjusters),
          coalesce(p_floors,    cur.floors),
          cur.dim_divisor, true, p_note, auth.uid());
  return nv;
end;
$$;

revoke all on function publish_rules from public;
grant execute on function publish_rules to authenticated;


-- ---------------------------------------------------------------------
-- 8. Admin views
-- ---------------------------------------------------------------------
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
where q.quoted_at > now() - interval '6 months'
group by p.full_name
order by spread desc;

create or replace view margin_realization
with (security_invoker = true) as
select
  date_trunc('month', quoted_at)::date as month,
  count(*) as quotes,
  count(actual_cost) as invoiced,
  round(avg(final_sell - cost), 2) as avg_quoted_gp,
  round(avg(final_sell - actual_cost) filter (where actual_cost is not null), 2) as avg_realized_gp,
  round(avg((final_sell - actual_cost) - (final_sell - cost))
        filter (where actual_cost is not null), 2) as avg_leakage
from quotes
group by 1 order by 1 desc;

-- security_invoker means both views run under the caller's RLS, so a rep
-- querying them sees only their own rows. Admins see everything.

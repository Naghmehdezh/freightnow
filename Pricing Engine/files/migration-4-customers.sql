-- =====================================================================
-- MIGRATION 4 — customers
-- Run once on the existing database, after fixes 1-3.
-- =====================================================================

create table customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code       text,                      -- your internal account code, optional
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- stops "Acme", "ACME Inc" and "acme  inc" becoming three customers
create unique index customers_name_unique
  on customers (lower(regexp_replace(name, '\s+', ' ', 'g')));

alter table customers enable row level security;

-- Reps need to see the list to quote, and to add one mid-quote rather
-- than being blocked waiting for you. Only admins can rename or retire.
create policy "everyone reads customers" on customers
  for select using (auth.uid() is not null);
create policy "reps add customers" on customers
  for insert with check (auth.uid() is not null);
create policy "admins manage customers" on customers
  for all using (is_admin()) with check (is_admin());

alter table quotes
  add column customer_id uuid references customers(id);

create index quotes_customer_idx on quotes (customer_id, quoted_at desc);


-- ---------------------------------------------------------------------
-- save_quote now takes a customer
-- ---------------------------------------------------------------------
drop function if exists save_quote(numeric,quote_scope,quote_mode,quote_pkg,jsonb,numeric,override_reason,text);

create or replace function save_quote(
  p_cost        numeric,
  p_scope       quote_scope,
  p_mode        quote_mode,
  p_packaging   quote_pkg,
  p_lines       jsonb,
  p_customer_id uuid    default null,
  p_final_sell  numeric default null,
  p_reason      override_reason default null,
  p_reference   text    default null
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
    cost, scope, mode, packaging, lines, customer_id,
    pieces, actual_wt, chargeable_wt, cube_ft3, density_pcf, est_class,
    rules_version, engine_sell, final_sell, reason, reference
  ) values (
    p_cost, p_scope, p_mode, p_packaging, p_lines, p_customer_id,
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
-- find_or_create_customer — so a rep never gets stuck mid-quote
-- ---------------------------------------------------------------------
create or replace function find_or_create_customer(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare cid uuid; clean text;
begin
  clean := trim(regexp_replace(p_name, '\s+', ' ', 'g'));
  if clean = '' then raise exception 'customer name is required'; end if;

  select id into cid from customers
   where lower(regexp_replace(name, '\s+', ' ', 'g')) = lower(clean);
  if found then return cid; end if;

  insert into customers (name) values (clean) returning id into cid;
  return cid;
end;
$$;

revoke all on function find_or_create_customer from public;
grant execute on function find_or_create_customer to authenticated;


-- ---------------------------------------------------------------------
-- Are we quoting each account the same way every time?
-- ---------------------------------------------------------------------
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
where q.quoted_at > now() - interval '12 months'
group by c.name
having count(*) >= 3
order by spread desc;

-- =====================================================================
-- MIGRATION 9 — quotes can be corrected after saving
--
-- The engine re-prices on every edit rather than trusting a figure from
-- the browser, so engine_sell always reflects the rules as they stand.
-- Edits are counted and timestamped so a quote that has been reworked
-- several times is visible as such.
-- Run after migration 8.
-- =====================================================================

alter table quotes
  add column if not exists edited_at  timestamptz,
  add column if not exists edited_by  uuid references profiles(id),
  add column if not exists edit_count int not null default 0;

-- Reps may correct their own, as long as it has not been voided.
drop policy if exists "reps update own quotes" on quotes;
create policy "reps update own quotes" on quotes
  for update using (rep_id = auth.uid() and not voided)
  with check (rep_id = auth.uid());


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
  p_fx          numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q      jsonb;
  final  numeric;
  owner  uuid;
  gone   boolean;
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

  update quotes set
    cost          = p_cost,
    scope         = p_scope,
    mode          = p_mode,
    packaging     = p_packaging,
    lines         = p_lines,
    customer_id   = p_customer_id,
    pieces        = (q->>'pieces')::int,
    actual_wt     = (q->>'actual_wt')::numeric,
    chargeable_wt = (q->>'chargeable_wt')::numeric,
    cube_ft3      = (q->>'cube_ft3')::numeric,
    density_pcf   = (q->>'density_pcf')::numeric,
    est_class     = (q->>'est_class')::numeric,
    rules_version = (q->>'rules_version')::int,
    engine_sell   = (q->>'sell')::numeric,
    final_sell    = final,
    reason        = p_reason,
    reference     = p_reference,
    currency      = p_currency,
    fx_rate       = (q->>'fx_rate')::numeric,
    cost_cad      = (q->>'cost_cad')::numeric,
    edited_at     = now(),
    edited_by     = auth.uid(),
    edit_count    = edit_count + 1
  where id = p_id;

  return q || jsonb_build_object('quote_id', p_id, 'final_sell', final);
end;
$$;

revoke all on function update_quote from public;
grant execute on function update_quote to authenticated;

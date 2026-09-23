-- =====================================================================
-- MIGRATION 6 — publish_rules can also set the dim divisor
-- Run once, after migration 5.
-- =====================================================================

drop function if exists publish_rules(jsonb, jsonb, jsonb, text);

create or replace function publish_rules(
  p_bands       jsonb,
  p_adjusters   jsonb default null,
  p_floors      jsonb default null,
  p_note        text  default null,
  p_dim_divisor int   default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare cur pricing_rules%rowtype; nv int; b jsonb; prev numeric := -1;
begin
  if not is_admin() then raise exception 'admins only'; end if;

  -- sanity: bands must be ascending and carry a markup
  for b in select * from jsonb_array_elements(p_bands) loop
    if (b->>'max') is null or (b->>'mk') is null then
      raise exception 'every band needs a max and an mk';
    end if;
    if (b->>'max')::numeric <= prev then
      raise exception 'band ceilings must increase: % came after %', b->>'max', prev;
    end if;
    prev := (b->>'max')::numeric;
  end loop;

  select * into cur from pricing_rules where active;
  select coalesce(max(version),0) + 1 into nv from pricing_rules;

  update pricing_rules set active = false where active;

  insert into pricing_rules (version, bands, adjusters, floors, dim_divisor, active, note, created_by)
  values (nv, p_bands,
          coalesce(p_adjusters,   cur.adjusters),
          coalesce(p_floors,      cur.floors),
          coalesce(p_dim_divisor, cur.dim_divisor),
          true, p_note, auth.uid());
  return nv;
end;
$$;

revoke all on function publish_rules from public;
grant execute on function publish_rules to authenticated;

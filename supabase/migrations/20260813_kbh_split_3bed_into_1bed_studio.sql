-- 2026-08-13 — KBH: the two 3-Bed units on every floor become three smaller units.
--
-- Owner's change on site: unit X-10 (1355 sqft, 3 Bed) and X-17 (1363 sqft, 3 Bed)
-- on Upper Ground .. 9th floor are each rebuilt as
--     A  419.19 sqft  1 Bed
--     B  488.08 sqft  Studio
--     C  441.13 sqft  1 Bed
--
-- Decisions taken with the owner before running this:
--  * SCOPE — "X" is the floor, so this is every floor UG..9th: 20 candidates.
--  * 3-17 and 6-10 are SOLD and carry a LIVE sale, so they are SKIPPED. Splitting
--    them would break that sale's schedule, payments, ledger and allotment letter.
--    18 parents are split -> 54 new units.
--  * Parents are marked DEAD / Cancelled rather than deleted, so history survives —
--    four of them (1-10, 2-17, 4-17, 5-17) carry cancelled-sale records.
--  * Studio is a NEW unit type for KBH (only 1/2/3 Bed existed).
--  * Price stays at the parents' proven rate of exactly PKR 10,000/sqft:
--    419.19 -> 4,191,900   488.08 -> 4,880,800   441.13 -> 4,411,300
--  * Note for the record: 419.19+488.08+441.13 = 1,348.40 sqft, i.e. 6.60 sqft less
--    than a 1355 parent and 14.60 less than a 1363 one (owner is aware).
do $$
declare
  KBH   constant uuid := '7f70ba90-130e-42b5-801b-4c9bafa82975';
  CO    constant uuid := '3249e3b5-c411-4f5f-ae48-0246304c9c87';
  T1BED constant uuid := 'fa27fc22-184d-4a20-b79b-6b66f25ff0c1';
  AVAIL constant uuid := 'acbd4e3d-9735-473d-8189-e0485840c206';
  DEADS constant uuid := 'e636aef7-bdb0-4bcd-9fae-d5b0217e3f2c';
  RATE  constant numeric := 10000;
  v_studio uuid; p record; v_children int := 0; v_parents int := 0;
begin
  perform set_config('rms.audit_reason','KBH 3-Bed split into 1 Bed + Studio + 1 Bed (owner-approved)', true);

  -- 1. Studio type for KBH (idempotent)
  select id into v_studio from public.category_unit_types
   where project_id=KBH and (type_code='STUDIO' or type_name ilike 'studio%') limit 1;
  if v_studio is null then
    insert into public.category_unit_types (company_id, project_id, type_code, type_name, description, sort_order, is_active)
    values (CO, KBH, 'STUDIO', 'Studio', 'Studio apartment', 0, true)
    returning id into v_studio;
  end if;

  -- 2. split each eligible parent into A / B / C
  for p in
    select u.* from public.units u
     where u.project_id=KBH
       and u.unit_no ~ '-(10|17)$'
       and u.unit_no not in ('3-17','6-10')          -- live sales
     order by u.floor_no, u.unit_no
  loop
    v_parents := v_parents + 1;

    insert into public.units
      (company_id, project_id, unit_no, unit_type_id, status_id, floor_no, floor_label, floor_id,
       area, area_unit, base_price, bedrooms, bathrooms, block, origin_type, notes)
    values
      (p.company_id, KBH, p.unit_no||'A', T1BED,    AVAIL, p.floor_no, p.floor_label, p.floor_id,
       419.19, coalesce(p.area_unit,'sqft'), round(419.19*RATE), 1, 1, p.block, 'fresh',
       'Created by splitting '||p.unit_no||' (was 3 Bed, '||p.area||' sqft)'),
      (p.company_id, KBH, p.unit_no||'B', v_studio, AVAIL, p.floor_no, p.floor_label, p.floor_id,
       488.08, coalesce(p.area_unit,'sqft'), round(488.08*RATE), 0, 1, p.block, 'fresh',
       'Created by splitting '||p.unit_no||' (was 3 Bed, '||p.area||' sqft)'),
      (p.company_id, KBH, p.unit_no||'C', T1BED,    AVAIL, p.floor_no, p.floor_label, p.floor_id,
       441.13, coalesce(p.area_unit,'sqft'), round(441.13*RATE), 1, 1, p.block, 'fresh',
       'Created by splitting '||p.unit_no||' (was 3 Bed, '||p.area||' sqft)')
    on conflict (project_id, unit_no) do nothing;
    v_children := v_children + 3;

    -- 3. retire the parent (kept for history, out of inventory)
    update public.units
       set status_id = DEADS,
           notes = trim(coalesce(notes,'') || ' | Split on ' || to_char(now(),'DD-MM-YYYY')
                        || ' into ' || p.unit_no || 'A/B/C — retired, not sellable'),
           updated_at = now()
     where id = p.id;
  end loop;

  if v_parents <> 18 then raise exception 'expected 18 parents, processed % — rolled back', v_parents; end if;
end $$;

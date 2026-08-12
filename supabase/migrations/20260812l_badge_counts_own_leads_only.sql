-- 2026-08-12 — the red "new leads" badge must mean "leads still waiting on ME".
-- It counted every unopened lead the caller could SEE, and a director sees the
-- whole company — so after handing all 186 leads out, Rashid still had a red 11
-- for leads that are now someone else's job. Scope the count to leads the caller
-- actually owns; the moment a lead is assigned it leaves the giver's badge and
-- lands in the receiver's.
do $$
declare d text; d2 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='list_my_deals';
  if position($a$m.stage NOT IN ('won','lost') AND m.owner_id = v_uid$a$ in d)=0 then
    if position($a$    count(*) FILTER (WHERE NOT m.checked AND m.stage NOT IN ('won','lost'))$a$ in d)=0 then
      raise exception 'list_my_deals unchecked anchor missing'; end if;
    d2 := replace(d, $a$    count(*) FILTER (WHERE NOT m.checked AND m.stage NOT IN ('won','lost'))$a$,
                     $a$    count(*) FILTER (WHERE NOT m.checked AND m.stage NOT IN ('won','lost') AND m.owner_id = v_uid)$a$);
    execute d2;
  end if;

  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='list_my_leads';
  if position($a$m.status NOT IN ('won','lost') AND m.owner_sales_user_id = v_uid$a$ in d)=0 then
    if position($a$    count(*) FILTER (WHERE NOT m.checked AND m.status NOT IN ('won','lost'))$a$ in d)=0 then
      raise exception 'list_my_leads unchecked anchor missing'; end if;
    d2 := replace(d, $a$    count(*) FILTER (WHERE NOT m.checked AND m.status NOT IN ('won','lost'))$a$,
                     $a$    count(*) FILTER (WHERE NOT m.checked AND m.status NOT IN ('won','lost') AND m.owner_sales_user_id = v_uid)$a$);
    execute d2;
  end if;
end $$;

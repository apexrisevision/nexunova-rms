-- 2026-08-12 — show the staff project tag wherever a staff name is rendered.
-- Each function is re-created from its OWN live definition with a single string
-- swapped, so nothing else can drift. Any missing anchor aborts the whole file.
do $$
declare
  d text; d2 text;
  procedure_patch record;
begin
  for procedure_patch in
    select * from (values
      -- fn, find, replace
      ('get_my_team',            $a$'id', a.id, 'name', a.full_name,$a$,            $b$'id', a.id, 'name', public._su_label(a.id),$b$),
      ('get_assignable_users',   $a$'id', su.id, 'name', su.full_name,$a$,          $b$'id', su.id, 'name', public._su_label(su.id),$b$),
      ('get_member_performance', $a$'success',true,'name',su.full_name,'role',su.role$a$, $b$'success',true,'name',public._su_label(p_member),'role',su.role$b$),
      ('get_member_leads',       $a$'owner_name', ow.full_name,$a$,                 $b$'owner_name', public._su_label(l.owner_sales_user_id),$b$),
      ('get_team_targets',       $a$'id', h.id, 'name', h.full_name,$a$,            $b$'id', h.id, 'name', public._su_label(h.id),$b$),
      ('list_my_leads',          $a$ow.full_name AS owner_name$a$,                  $b$public._su_label(l.owner_sales_user_id) AS owner_name$b$),
      ('list_sales_users_admin', $a$LEFT JOIN public.projects p ON p.id=su.project_id$a$,
                                 $b$LEFT JOIN public.projects p ON p.id=COALESCE(su.project_id, su.home_project_id)$b$),
      ('list_sales_users_admin', $a$'project_id', su.project_id, 'project_name', p.project_name,$a$,
                                 $b$'project_id', su.project_id, 'home_project_id', su.home_project_id, 'project_name', p.project_name,$b$)
    ) as t(fn, find_txt, repl_txt)
  loop
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=procedure_patch.fn
     limit 1;
    if d is null then raise exception 'function % not found', procedure_patch.fn; end if;
    if position(procedure_patch.find_txt in d) = 0 then
      raise exception 'anchor not found in % -> %', procedure_patch.fn, procedure_patch.find_txt;
    end if;
    d2 := replace(d, procedure_patch.find_txt, procedure_patch.repl_txt);
    execute d2;
  end loop;
end $$;

-- get_member_leads also returns the member's own name in the envelope
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_member_leads';
  if position($a$'success',true,'name',su.full_name$a$ in d) = 0 then
    raise exception 'get_member_leads envelope anchor not found';
  end if;
  execute replace(d, $a$'success',true,'name',su.full_name$a$, $b$'success',true,'name',public._su_label(p_member)$b$);
end $$;

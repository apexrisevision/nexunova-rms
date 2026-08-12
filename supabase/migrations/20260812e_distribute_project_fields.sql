-- 2026-08-12 — feed the Assign-leads screen what it needs for per-project tabs:
--   * list_my_leads        → project_id alongside project_name
--   * get_assignable_users → the member's home project (id + short tag)
-- Same anchor-swap technique as 20260812d: each function is rebuilt from its own
-- live definition so nothing else can drift.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='list_my_leads';
  if position($a$'unit_no', m.unit_no, 'project_name', m.project_name,$a$ in d)=0 then
    raise exception 'list_my_leads anchor not found';
  end if;
  execute replace(d, $a$'unit_no', m.unit_no, 'project_name', m.project_name,$a$,
                     $b$'unit_no', m.unit_no, 'project_name', m.project_name, 'project_id', m.project_id,$b$);
end $$;

do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_assignable_users';
  if position($a$'id', su.id, 'name', public._su_label(su.id), 'role', su.role, 'mine', true,$a$ in d)=0 then
    raise exception 'get_assignable_users anchor not found';
  end if;
  execute replace(d,
    $a$'id', su.id, 'name', public._su_label(su.id), 'role', su.role, 'mine', true,$a$,
    $b$'id', su.id, 'name', public._su_label(su.id), 'role', su.role, 'mine', true,
    'home_project_id', su.home_project_id,
    'project_tag', (SELECT COALESCE(p.short_code, p.project_name) FROM public.projects p WHERE p.id=su.home_project_id),$b$);
end $$;

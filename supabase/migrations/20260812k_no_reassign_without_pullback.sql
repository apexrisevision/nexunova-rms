-- 2026-08-12 — an already-handed-down lead cannot be handed down again.
-- Owner's rule: once a lead sits with a team member it must not be re-assigned,
-- not selectable for bulk assign, and not shown in the assign pool. The way to
-- move it is to pull it back first (pullback_lead), which is an explicit,
-- logged act — so nobody can quietly take a lead off a rep who is working it.
--
-- Enforced on the server so it holds for every caller, not just the UI.
do $$
declare d text; d2 text;
  guard_single constant text := $g$
  IF EXISTS (SELECT 1 FROM public.sales_users su2
              WHERE su2.id = v_owner AND su2.role NOT IN ('director','admin','cfo')) THEN
    RETURN jsonb_build_object('success',false,'error','already_assigned',
      'message','This lead is already with a team member. Pull it back first, then hand it over.');
  END IF;
$g$;
begin
  -- assign_lead: refuse outright
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='assign_lead';
  if position('already_assigned' in d)=0 then
    if position($a$  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;$a$ in d)=0 then
      raise exception 'assign_lead anchor missing'; end if;
    d2 := replace(d, $a$  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;$a$,
                     guard_single || $a$  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;$a$);
    execute d2;
  end if;

  -- assign_leads_bulk: skip them and report how many were skipped
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='assign_leads_bulk';
  if position('v_skipped' in d)=0 then
    if position($a$    IF EXISTS (SELECT 1 FROM public.leads WHERE id=v_lead
               AND ((v_companywide AND company_id=v_company) OR owner_sales_user_id=v_ses.sales_user_id)) THEN$a$ in d)=0 then
      raise exception 'assign_leads_bulk anchor missing'; end if;
    d2 := replace(d,
      $a$        v_company uuid; v_count int := 0; v_lead uuid; v_companywide boolean; v_trole text;$a$,
      $a$        v_company uuid; v_count int := 0; v_lead uuid; v_companywide boolean; v_trole text; v_skipped int := 0;$a$);
    d2 := replace(d2,
      $a$    IF EXISTS (SELECT 1 FROM public.leads WHERE id=v_lead
               AND ((v_companywide AND company_id=v_company) OR owner_sales_user_id=v_ses.sales_user_id)) THEN$a$,
      $a$    IF EXISTS (SELECT 1 FROM public.leads l
               JOIN public.sales_users ow ON ow.id = l.owner_sales_user_id
              WHERE l.id=v_lead AND ow.role NOT IN ('director','admin','cfo')) THEN
      v_skipped := v_skipped + 1;                 -- already with a team member: leave it alone
    ELSIF EXISTS (SELECT 1 FROM public.leads WHERE id=v_lead
               AND ((v_companywide AND company_id=v_company) OR owner_sales_user_id=v_ses.sales_user_id)) THEN$a$);
    d2 := replace(d2,
      $a$  RETURN jsonb_build_object('success',true,'assigned',v_count,'to_name',v_tname,'to_id',p_to_id);$a$,
      $a$  RETURN jsonb_build_object('success',true,'assigned',v_count,'skipped',v_skipped,
    'message', CASE WHEN v_skipped>0 THEN v_skipped||' already with a team member — pull them back first.' ELSE NULL END,
    'to_name',v_tname,'to_id',p_to_id);$a$);
    if d2 = d then raise exception 'assign_leads_bulk patch produced no change'; end if;
    execute d2;
  end if;
end $$;

-- 2026-08-12 — keep soft-deleted leads out of the deal-based stats too.
-- The lists already hide them (20260812f), but get_my_team / get_member_performance /
-- get_sales_performance count `deals` directly, and a deal outlives its lead's
-- soft delete — so a director would delete 50 leads and still see them in the
-- Team numbers. Each deal count now requires a live (non-deleted) lead.
do $$
declare d text; d2 text;
  c_alive constant text := ' AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id=d.lead_id AND l.deleted_at IS NULL)';
begin
  -- get_member_performance: 6 unaliased deal counts
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_member_performance';
  if position(c_alive in d)=0 then
    d2 := replace(d, 'FROM public.deals WHERE owner_sales_user_id=ANY(v_ids)',
                     'FROM public.deals d WHERE d.owner_sales_user_id=ANY(v_ids)'||c_alive);
    if d2 = d then raise exception 'get_member_performance deal anchor missing'; end if;
    execute d2;
  end if;

  -- get_my_team: per-head deal counts
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_my_team';
  if position(c_alive in d)=0 then
    d2 := replace(d, 'FROM public.deals d WHERE d.owner_sales_user_id IN (SELECT id FROM tree WHERE head=h.id)',
                     'FROM public.deals d WHERE d.owner_sales_user_id IN (SELECT id FROM tree WHERE head=h.id)'||c_alive);
    if d2 = d then raise exception 'get_my_team deal anchor missing'; end if;
    execute d2;
  end if;

  -- get_sales_performance: own + subtree pipeline
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_sales_performance';
  if position(c_alive in d)=0 then
    d2 := replace(d, 'WHERE d.owner_sales_user_id = ANY(v_ids)',
                     'WHERE d.owner_sales_user_id = ANY(v_ids)'||c_alive);
    if d2 = d then raise exception 'get_sales_performance deal anchor missing'; end if;
    execute d2;
  end if;
end $$;

-- 2026-08-12 — get_assignable_users: order by how many leads each member is
-- already holding (most first, as the owner asked), and stop counting
-- soft-deleted leads in that number.
do $$
declare d text; d2 text;
  c_open constant text := $x$(SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=su.id AND l.status NOT IN ('won','lost'))$x$;
  c_open_live constant text := $x$(SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=su.id AND l.deleted_at IS NULL AND l.status NOT IN ('won','lost'))$x$;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_assignable_users';

  if position('l.deleted_at IS NULL AND l.status' in d) = 0 then
    if position(c_open in d) = 0 then raise exception 'open_leads anchor missing'; end if;
    d := replace(d, c_open, c_open_live);          -- don't count deleted leads
  end if;

  if position('ORDER BY su.full_name)' in d) > 0 then
    d2 := replace(d, 'ORDER BY su.full_name)',
                     'ORDER BY '||c_open_live||' DESC, su.full_name)');   -- busiest first
  else
    d2 := d;                                        -- already re-ordered
  end if;
  execute d2;
end $$;

-- 2026-08-12 — flip the assignable-staff order: FEWEST leads first, so the
-- lightest-loaded member is on top and work spreads evenly (owner's call,
-- reversing 20260812h).
do $$
declare d text; d2 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_assignable_users';
  if position('l.status NOT IN (''won'',''lost'')) DESC, su.full_name)' in d) = 0 then
    if position('l.status NOT IN (''won'',''lost'')) ASC, su.full_name)' in d) > 0 then return; end if;  -- already flipped
    raise exception 'assignable order anchor missing';
  end if;
  d2 := replace(d, 'l.status NOT IN (''won'',''lost'')) DESC, su.full_name)',
                   'l.status NOT IN (''won'',''lost'')) ASC, su.full_name)');
  execute d2;
end $$;

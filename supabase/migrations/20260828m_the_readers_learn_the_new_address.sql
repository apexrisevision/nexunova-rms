-- The documents are moving out of the open bucket and into one that answers
-- nobody. The screens will ask for a short-lived link instead of using an
-- address, and to do that they need the PATH — so every function that already
-- hands out these three documents hands out the path beside the old URL.
--
-- The URL columns are left exactly as they are. While the move is in progress a
-- record may have one, the other, or both, and a screen that has only the old
-- URL must keep working: a half-finished migration must not blank a document an
-- administrator can legitimately see.
--
-- Each edit is made against a fragment that is asserted to exist first, so a
-- function that has since been rewritten elsewhere fails loudly instead of
-- being silently skipped.
do $$
declare
  v_src text;
  r record;
begin
  for r in
    select * from (values
      -- the office list of portal logins
      ('list_sales_users_admin',
       $a$'profile_photo_url', su.profile_photo_url, 'cnic_front_url', su.cnic_front_url, 'cnic_back_url', su.cnic_back_url,$a$,
       $a$'profile_photo_url', su.profile_photo_url, 'cnic_front_url', su.cnic_front_url, 'cnic_back_url', su.cnic_back_url,
    'profile_photo_path', su.profile_photo_path, 'cnic_front_path', su.cnic_front_path, 'cnic_back_path', su.cnic_back_path,$a$),

      -- the agent register
      ('list_agents',
       $a$      a.profile_photo_url, a.bank_name, a.bank_account_no,$a$,
       $a$      a.profile_photo_url, a.profile_photo_path,
      a.cnic_front_path, a.cnic_back_path,
      a.bank_name, a.bank_account_no,$a$),

      -- one agent, everything about them
      ('get_agent_360',
       $a$'profile_photo_url', a.profile_photo_url, 'cnic_front_url', a.cnic_front_url,
    'cnic_back_url', a.cnic_back_url,$a$,
       $a$'profile_photo_url', a.profile_photo_url, 'cnic_front_url', a.cnic_front_url,
    'cnic_back_url', a.cnic_back_url,
    'profile_photo_path', a.profile_photo_path, 'cnic_front_path', a.cnic_front_path,
    'cnic_back_path', a.cnic_back_path,$a$),

      -- what a person is shown about themselves in the portal
      ('get_my_profile',
       $a$'profile_photo_url', v_su.profile_photo_url,
    'cnic_front_url', v_su.cnic_front_url, 'cnic_back_url', v_su.cnic_back_url,$a$,
       $a$'profile_photo_url', v_su.profile_photo_url,
    'cnic_front_url', v_su.cnic_front_url, 'cnic_back_url', v_su.cnic_back_url,
    'profile_photo_path', v_su.profile_photo_path,
    'cnic_front_path', v_su.cnic_front_path, 'cnic_back_path', v_su.cnic_back_path,$a$),

      -- approval copies the signed-up person onto their agent row; the address
      -- of the document must travel with it or the agent screen loses the file
      ('admin_approve_sales_user',
       $a$      cnic_back_url      = COALESCE(NULLIF(TRIM(cnic_back_url),''),      v_su.cnic_back_url),$a$,
       $a$      cnic_back_url      = COALESCE(NULLIF(TRIM(cnic_back_url),''),      v_su.cnic_back_url),
      profile_photo_path = COALESCE(profile_photo_path, v_su.profile_photo_path),
      cnic_front_path    = COALESCE(cnic_front_path,    v_su.cnic_front_path),
      cnic_back_path     = COALESCE(cnic_back_path,     v_su.cnic_back_path),$a$),

      ('admin_approve_sales_user_grouped',
       $a$        cnic_back_url      = COALESCE(NULLIF(TRIM(cnic_back_url),''), v_su.cnic_back_url),$a$,
       $a$        cnic_back_url      = COALESCE(NULLIF(TRIM(cnic_back_url),''), v_su.cnic_back_url),
        profile_photo_path = COALESCE(profile_photo_path, v_su.profile_photo_path),
        cnic_front_path    = COALESCE(cnic_front_path,    v_su.cnic_front_path),
        cnic_back_path     = COALESCE(cnic_back_path,     v_su.cnic_back_path),$a$)
    ) as t(fn, old_txt, new_txt)
  loop
    select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = r.fn
    limit 1;

    if v_src is null then
      raise exception 'function % not found', r.fn;
    end if;
    if position(r.old_txt in v_src) = 0 then
      raise exception 'anchor missing in % — it has been rewritten, edit it by hand', r.fn;
    end if;
    if position('cnic_front_path' in v_src) > 0 or position('profile_photo_path' in v_src) > 0 then
      raise notice 'skipping % — already carries the path', r.fn;
      continue;
    end if;

    execute replace(v_src, r.old_txt, r.new_txt);
    raise notice 'taught % the new address', r.fn;
  end loop;
end $$;

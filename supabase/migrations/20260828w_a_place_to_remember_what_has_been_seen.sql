-- The notification centre is built from facts the portal already reads: a leave
-- that has been decided, a visit that has been decided, a letter that has been
-- issued, an announcement not yet opened. Nothing is written when those things
-- happen — they happen in the attendance system, which is a different database
-- and has no business reaching into this one.
--
-- So the only thing that has to be remembered here is the moment the person
-- last looked. Everything newer than that is unread; everything older is not.
alter table public.sales_users
  add column if not exists notifications_seen_at timestamptz;

create or replace function public.mark_notifications_seen(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid;
begin
  select su.id into v_uid
    from public.sales_sessions s
    join public.sales_users su on su.id = s.sales_user_id
   where s.session_token = p_session_token
     and s.expires_at > now()
     and su.is_active;

  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'session_expired');
  end if;

  update public.sales_users set notifications_seen_at = now() where id = v_uid;
  return jsonb_build_object('success', true, 'seen_at', now());
end $$;

revoke all on function public.mark_notifications_seen(text) from public;
grant execute on function public.mark_notifications_seen(text) to anon, authenticated;

-- get_my_profile hands the marker back
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_my_profile';
  if v_src is null then raise exception 'get_my_profile not found'; end if;
  if position('notifications_seen_at' in v_src) > 0 then return; end if;
  if position($a$'last_login_at', v_su.last_login_at$a$ in v_src) = 0 then
    raise exception 'anchor missing in get_my_profile';
  end if;
  execute replace(v_src,
    $a$'last_login_at', v_su.last_login_at$a$,
    $a$'notifications_seen_at', v_su.notifications_seen_at,
    'last_login_at', v_su.last_login_at$a$);
end $$;

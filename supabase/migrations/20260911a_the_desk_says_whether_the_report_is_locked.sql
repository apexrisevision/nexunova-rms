/* ══ THE SHARE SCREEN LEARNS ABOUT THE REPORT PASSWORD ═════════════════════
   Rashid: "Reserve Desk pe field bana do, mai khud set kar lunga, button bana
   do password change karnay ka."

   The password that opens the directors' room has been settable since
   20260910c, but only by an RPC no screen ever called — so in practice the
   only way to change it was to ask me, which is exactly the dependence he is
   trying to get out of.

   The screen where a director publishes the link is the right place for it:
   the room lives behind that link, and a person who can turn the link on and
   off should be able to set what guards the room behind it. That screen loads
   through list_availability_links, so this teaches that RPC to say, per
   project, whether the room is locked, when it was locked, and by whom.

   THE HASH IS NOT RETURNED AND NEITHER IS THE PASSWORD. Only a boolean, a
   timestamp and a name — enough to render a truthful line, and nothing that
   helps anyone get in.

   Patched in place rather than rewritten, so that anything else this function
   has grown since cannot be silently dropped; the patch refuses to apply if
   the text it expects is not there.
   ═══════════════════════════════════════════════════════════════════════════ */

DO $patch$
DECLARE
  v_src  text;
  v_old  text;
  v_new  text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname = 'list_availability_links';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'list_availability_links is not there to patch';
  END IF;

  v_old := $old$                            WHERE u.project_id = pr.id AND public._map_unit_state(u.id) = 'available')
           ) AS x$old$;

  v_new := $new$                            WHERE u.project_id = pr.id AND public._map_unit_state(u.id) = 'available'),
             'report_locked', pr.report_password_hash IS NOT NULL,
             'report_set_at', pr.report_password_set_at,
             'report_set_by', (SELECT su.full_name FROM public.sales_users su
                                WHERE su.id = pr.report_password_set_by)
           ) AS x$new$;

  IF position(v_old in v_src) = 0 THEN
    RAISE EXCEPTION 'list_availability_links no longer contains the text this patch expects';
  END IF;
  IF position('report_locked' in v_src) > 0 THEN
    RAISE NOTICE 'already patched — nothing to do';
    RETURN;
  END IF;

  EXECUTE replace(v_src, v_old, v_new);
END
$patch$;

/* CREATE OR REPLACE keeps the grants a function already had, so nothing is
   broadened here. These are restated only so the intended state is written
   down where the next person looks: the directors' screens reach this as a
   signed-in user, and the public link never touches it at all. */
REVOKE ALL ON FUNCTION public.list_availability_links(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_availability_links(text) TO anon, authenticated, service_role;

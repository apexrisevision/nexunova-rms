-- ===========================================================================
-- A Head of Department can write to everyone, not only a director.
--
-- Asked for: "aik Write email ka option jo k director aur HOD kar sake. Means
-- email ki aur sab k pass jai with Notification and alert." — and then,
-- importantly: "Email se mera matlab hai CRM k andar wala message system."
--
-- So nothing new is built here, because nothing new was needed. The message
-- system already does all of it: post_announcement takes a title, a body, a
-- priority, who it goes to, whether it must be acknowledged, attachments and a
-- schedule, and _announcement_push already sends the notification. The only
-- thing wrong with it was who was allowed to use it.
--
-- All four gates move together on purpose. A manager who can post but cannot
-- see who read it, cannot choose who it goes to, and cannot find what they
-- scheduled has been given a button, not a feature.
-- ===========================================================================

DO $do$
DECLARE
  fn text;
  v_src text; v_new text; n int; total int := 0;
BEGIN
  FOREACH fn IN ARRAY ARRAY['post_announcement','get_announce_targets',
                            'get_announcement_receipts','list_scheduled_announcements'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname='public' AND p.proname = fn;
    IF v_src IS NULL THEN RAISE EXCEPTION '% not found', fn; END IF;

    n := (length(v_src) - length(replace(v_src, '<> ''director''', ''))) / length('<> ''director''');
    IF n <> 1 THEN RAISE EXCEPTION 'expected exactly one director gate in %, found %', fn, n; END IF;

    v_new := replace(v_src, '<> ''director''', 'NOT IN (''director'',''marketing_manager'')');
    -- and the refusal should name who may, not who may not
    v_new := replace(v_new, 'Only a director can post announcements.',
                            'Only a director or a Head of Department can post announcements.');
    EXECUTE v_new;
    total := total + 1;
  END LOOP;

  IF total <> 4 THEN RAISE EXCEPTION 'expected 4 functions, changed %', total; END IF;
END $do$;

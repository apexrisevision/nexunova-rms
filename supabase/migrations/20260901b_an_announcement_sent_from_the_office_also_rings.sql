-- ===========================================================================
-- An announcement sent from the office app also rings.
--
-- There were two ways to send the same thing, and only one of them rang.
--
--   post_announcement        (the portal)     sets push_enabled, stamps
--                                             published_at, calls
--                                             _announcement_push
--   create_sales_announcement (the office app) did none of the three
--
-- push_enabled defaults to false and published_at has no default at all, so a
-- notice went out looking published while every phone stayed silent.
--
-- Found the honest way, not by reading code: a policy notice went to 27 people
-- at 22:42 and by 22:49 exactly one had opened it — because nobody had been
-- told it existed.
--
-- Quiet hours are respected on purpose. _announcement_push is called with
-- ignore_quiet = false, so a notice written outside 08:00–21:00 Karachi waits
-- and is picked up by crm-announcement-push in the morning, exactly as a
-- normal-priority message from the portal is. Only 'urgent' should wake
-- somebody, and this entry point has no urgency flag to offer.
-- ===========================================================================

DO $do$
DECLARE v_src text; v_new text; n int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
   WHERE n2.nspname='public' AND p.proname='create_sales_announcement';
  IF v_src IS NULL THEN RAISE EXCEPTION 'create_sales_announcement not found'; END IF;
  v_new := v_src;

  -- 1. record it as published, and mark it for push
  n := (length(v_new) - length(replace(v_new,
        'INSERT INTO public.sales_announcements(company_id, group_id, title, body, is_important, attachments, created_by)', ''))) /
       length('INSERT INTO public.sales_announcements(company_id, group_id, title, body, is_important, attachments, created_by)');
  IF n <> 1 THEN RAISE EXCEPTION 'insert column list anchor x%', n; END IF;
  v_new := replace(v_new,
    'INSERT INTO public.sales_announcements(company_id, group_id, title, body, is_important, attachments, created_by)',
    'INSERT INTO public.sales_announcements(company_id, group_id, title, body, is_important, attachments, created_by, push_enabled, published_at)');

  n := (length(v_new) - length(replace(v_new,
        '          coalesce(p_attachments,''[]''::jsonb), v_me.id)', ''))) /
       length('          coalesce(p_attachments,''[]''::jsonb), v_me.id)');
  IF n <> 1 THEN RAISE EXCEPTION 'insert values anchor x%', n; END IF;
  v_new := replace(v_new,
    '          coalesce(p_attachments,''[]''::jsonb), v_me.id)',
    '          coalesce(p_attachments,''[]''::jsonb), v_me.id, true, now())');

  -- 2. and actually send it
  n := (length(v_new) - length(replace(v_new,
        '  RETURN jsonb_build_object(''success'',true,''id'',v_id);', ''))) /
       length('  RETURN jsonb_build_object(''success'',true,''id'',v_id);');
  IF n <> 1 THEN RAISE EXCEPTION 'return anchor x%', n; END IF;
  v_new := replace(v_new,
    '  RETURN jsonb_build_object(''success'',true,''id'',v_id);',
    '  -- ring the phones. ignore_quiet = false: a late-night notice waits for' || chr(10) ||
    '  -- cron_announcement_push in the morning, like any normal-priority message.' || chr(10) ||
    '  PERFORM public._announcement_push(v_id, false);' || chr(10) ||
    '  RETURN jsonb_build_object(''success'',true,''id'',v_id);');

  EXECUTE v_new;
END $do$;

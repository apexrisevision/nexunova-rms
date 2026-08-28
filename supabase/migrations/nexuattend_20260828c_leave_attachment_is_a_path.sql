-- ══ NexuAttend project — a private document is a path, not an address ═══════
-- Applied to the NexuAttend Supabase project, not RMS.
--
-- Two problems, fixed together.
--
-- ONE: adding arguments with DEFAULTs creates a SECOND function rather than
-- replacing the first — nine arguments and eleven, side by side. PostgREST
-- resolves overloads by the keys in the request body, so a call that omitted
-- the new keys could land on the old function and silently drop the
-- attachment. Both old forms are dropped and exactly one is left.
--
-- TWO: attachment_url held a permanent public link. The bucket behind it is
-- private now and has no public address at all, so what is kept is the PATH
-- inside that bucket; a link is signed on demand, for two minutes, and only for
-- the person whose id is in the path.
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS attachment_path text;

COMMENT ON COLUMN public.leave_requests.attachment_url IS
  'Legacy: a public URL. No longer written. Use attachment_path with a signed link.';
COMMENT ON COLUMN public.leave_requests.attachment_path IS
  'Path inside the private employee-private bucket. Signed on demand by the bridge.';

DO $do$
DECLARE v_src text; v_old text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc
   WHERE proname='portal_apply_leave' AND pronamespace='public'::regnamespace AND pronargs = 11;
  IF v_src IS NULL THEN RAISE EXCEPTION 'the eleven-argument portal_apply_leave is not there'; END IF;

  v_old := 'p_attachment_url text DEFAULT NULL::text, p_attachment_name text DEFAULT NULL::text)';
  v_new := 'p_attachment_url text DEFAULT NULL::text, p_attachment_name text DEFAULT NULL::text, '
        || 'p_attachment_path text DEFAULT NULL::text)';
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'portal_apply_leave does not take the arguments this expects — refusing to guess';
  END IF;
  v_src := replace(v_src, v_old, v_new);

  v_old := 'submitted_at, attachment_url, attachment_name)';
  v_new := 'submitted_at, attachment_url, attachment_name, attachment_path)';
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'the INSERT column list is not what this expects — refusing to guess';
  END IF;
  v_src := replace(v_src, v_old, v_new);

  v_old := 'NULLIF(btrim(COALESCE(p_attachment_name, '''')), ''''))';
  v_new := 'NULLIF(btrim(COALESCE(p_attachment_name, '''')), ''''), '
        || 'NULLIF(btrim(COALESCE(p_attachment_path, '''')), ''''))';
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'the INSERT values are not what this expects — refusing to guess';
  END IF;
  v_src := replace(v_src, v_old, v_new);

  DROP FUNCTION IF EXISTS public.portal_apply_leave(text, uuid, text, uuid, date, date, text, text, text);
  DROP FUNCTION IF EXISTS public.portal_apply_leave(text, uuid, text, uuid, date, date, text, text, text, text, text);

  EXECUTE v_src;
END $do$;

REVOKE ALL ON FUNCTION public.portal_apply_leave(text, uuid, text, uuid, date, date, text, text, text, text, text, text)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_apply_leave(text, uuid, text, uuid, date, date, text, text, text, text, text, text)
  TO anon;

DO $do$
DECLARE v_src text; v_old text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='portal_my_file' AND pronamespace='public'::regnamespace;
  v_old := '''attachment_url'', l.attachment_url, ''attachment_name'', l.attachment_name,';
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'portal_my_file does not return the attachment the way this expects — refusing to guess';
  END IF;
  EXECUTE replace(v_src, v_old,
    '''attachment_url'', l.attachment_url, ''attachment_name'', l.attachment_name,
               ''attachment_path'', l.attachment_path,');
END $do$;

DO $do$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE proname='portal_apply_leave' AND pronamespace='public'::regnamespace;
  IF n <> 1 THEN RAISE EXCEPTION 'expected one portal_apply_leave, found %', n; END IF;
END $do$;

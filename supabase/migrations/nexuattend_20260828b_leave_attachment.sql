-- ══ NexuAttend project — a leave application may carry a document ═══════════
-- Applied to the NexuAttend Supabase project, not RMS. Kept here so the pair
-- can be read together; the bridge passes the address through.
--
-- Sick leave in particular is asked for with a certificate. The record holds
-- the file's address and its original name — the file itself lives in the
-- bucket the portal already uploads to, and HR opens it from the application.
--
-- Two columns, nullable: an application without a document is the normal case
-- and must stay valid.
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS attachment_url  text,
  ADD COLUMN IF NOT EXISTS attachment_name text;

DO $do$
DECLARE v_src text; v_old text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='portal_apply_leave' AND pronamespace='public'::regnamespace;
  IF v_src IS NULL THEN RAISE EXCEPTION 'portal_apply_leave is not there'; END IF;

  v_old := 'p_day_part text DEFAULT ''full''::text, p_contact text DEFAULT NULL::text)';
  v_new := 'p_day_part text DEFAULT ''full''::text, p_contact text DEFAULT NULL::text, '
        || 'p_attachment_url text DEFAULT NULL::text, p_attachment_name text DEFAULT NULL::text)';
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'portal_apply_leave does not take the arguments this expects — refusing to guess';
  END IF;
  v_src := replace(v_src, v_old, v_new);

  v_old := '     contact_during_leave, raised_by_self, submitted_at)';
  v_new := '     contact_during_leave, raised_by_self, submitted_at, attachment_url, attachment_name)';
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'the INSERT column list is not what this expects — refusing to guess';
  END IF;
  v_src := replace(v_src, v_old, v_new);

  v_old := '     NULLIF(btrim(COALESCE(p_contact, '''')), ''''), true, now())';
  v_new := '     NULLIF(btrim(COALESCE(p_contact, '''')), ''''), true, now(), '
        || 'NULLIF(btrim(COALESCE(p_attachment_url, '''')), ''''), '
        || 'NULLIF(btrim(COALESCE(p_attachment_name, '''')), ''''))';
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'the INSERT values are not what this expects — refusing to guess';
  END IF;
  v_src := replace(v_src, v_old, v_new);

  EXECUTE v_src;
END $do$;

-- and the file hands them back, so the detail view can show what was attached
DO $do$
DECLARE v_src text; v_old text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='portal_my_file' AND pronamespace='public'::regnamespace;

  v_old := '''raised_by_self'', l.raised_by_self,';
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'portal_my_file does not build leave_requests the way this expects — refusing to guess';
  END IF;
  EXECUTE replace(v_src, v_old,
    '''raised_by_self'', l.raised_by_self,
               ''attachment_url'', l.attachment_url, ''attachment_name'', l.attachment_name,');
END $do$;

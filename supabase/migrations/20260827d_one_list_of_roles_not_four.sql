-- ============================================================================
-- One list of roles, not four.
-- ----------------------------------------------------------------------------
-- The office roles were added to the CHECK constraint, to lead_role_config, to
-- the portal and to the admin picker — and three RPCs quietly kept a fourth
-- list of their own, written out by hand:
--
--   IF p_role NOT IN ('sale_rep','marketing_manager','admin','cfo','director',
--                     'lead_entry') THEN p_role := 'sale_rep'; END IF;
--
-- Two of those three do not reject an unknown role. They REPLACE it with
-- sale_rep and carry on. So approving somebody as Receptionist would have made
-- them a Sale Representative — silently, with no error on the screen — and a
-- Sale Representative is precisely the role that CAN hold leads. The one screen
-- built to keep leads away from the office would have handed them over.
--
-- Nobody hit it because the picker did not offer those roles until today. It
-- would have been hit this week: people are signing up now and their roles are
-- about to be set.
--
-- So the list stops being written by hand. lead_role_config already names every
-- role the portal has — it is what create_lead consults to decide whether a role
-- touches leads at all — and these three now ask it instead of remembering.
--
-- The bodies are otherwise untouched: each function is read back with
-- pg_get_functiondef, one predicate is swapped, and the result is re-executed.
-- Anything else in them stays byte for byte as it was, and the loop raises if a
-- function it expected to change did not.
--
-- A null role still falls through to sale_rep, which is the sensible default
-- for "the caller did not say" and the behaviour that was there before.
-- ============================================================================
DO $mig$
DECLARE
  r      record;
  v_def  text;
  v_new  text;
  v_done text := '';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('admin_approve_sales_user',
                         'admin_approve_sales_user_grouped',
                         'set_sales_user_role')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(
      v_def,
      $q$p_role NOT IN ('sale_rep','marketing_manager','admin','cfo','director','lead_entry')$q$,
      $q$NOT EXISTS (SELECT 1 FROM public.lead_role_config lrc WHERE lrc.role = p_role)$q$);

    IF v_new = v_def THEN
      RAISE EXCEPTION 'expected a hand-written role list in %, found none - check it by hand', r.proname;
    END IF;

    EXECUTE v_new;
    v_done := v_done || r.proname || ' ';
  END LOOP;

  IF v_done = '' THEN
    RAISE EXCEPTION 'none of the three role-setting functions were found';
  END IF;
  RAISE NOTICE 'role list now read from lead_role_config in: %', v_done;
END $mig$;

-- And the promise, checked: no function may still carry its own copy.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(proname, ', ') INTO v_bad
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND prosrc LIKE '%NOT IN (''sale_rep'',''marketing_manager'',''admin'',''cfo'',''director'',''lead_entry'')%';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'a hand-written role list survives in: %', v_bad;
  END IF;
END $$;

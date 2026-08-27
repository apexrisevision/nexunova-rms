-- ============================================================================
-- Looking at the inventory is not the same as selling it.
-- ----------------------------------------------------------------------------
-- The Units board is about to become everybody's screen. It is the one place
-- that already answers "what have we got and what is left" — project by
-- project, floor by floor — and there is no reason a receptionist or an
-- accountant should have to ring somebody to find out.
--
-- But that screen also books units. reserve_unit, save_unit_quote and
-- create_availability_link ask for a session and never ask what the session is
-- FOR: any signed-in portal user can reserve a unit by calling them directly.
-- Nobody has, because until today only sellers could reach the screen. Opening
-- the screen without closing these would be handing the keys over with the
-- house.
--
-- So the rule is stated once, in the place that already knows which roles are
-- the selling roles: lead_role_config. A role that cannot hold a lead cannot
-- book a unit either — in this business those are the same people, and one
-- table saying so beats three functions remembering it.
--
-- lead_entry keeps its own separate refusal inside reserve_unit. The operator
-- can hold leads and still must not book units, which is a different rule and
-- stays where it was.
--
-- The three functions are edited rather than retyped: read back with
-- pg_get_functiondef, the guard inserted immediately after the session check,
-- re-executed. The loop raises if any of them did not have the line it expected.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._sales_may_sell(p_session_token text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT lrc.can_have_leads
      FROM public.sales_sessions ss
      JOIN public.sales_users su       ON su.id  = ss.sales_user_id
      JOIN public.lead_role_config lrc ON lrc.role = su.role
     WHERE ss.session_token = p_session_token
       AND ss.expires_at > now()
     LIMIT 1), false);
$function$;

COMMENT ON FUNCTION public._sales_may_sell(text) IS
  'True when the session belongs to a selling role. Reads lead_role_config so the answer lives in one table rather than in each booking function.';

-- Internal helper: the SECURITY DEFINER functions that call it run as owner, so
-- nothing outside needs to reach it. REVOKE FROM PUBLIC, not just from anon —
-- anon inherits EXECUTE through PUBLIC.
REVOKE ALL ON FUNCTION public._sales_may_sell(text) FROM PUBLIC, anon, authenticated;

DO $mig$
DECLARE
  r      record;
  v_def  text;
  v_new  text;
  v_done text := '';
  c_anchor constant text :=
    E'  IF NOT FOUND THEN RETURN jsonb_build_object(''success'',false,''error'',''session_expired''); END IF;';
  c_guard constant text :=
    E'  IF NOT FOUND THEN RETURN jsonb_build_object(''success'',false,''error'',''session_expired''); END IF;\n'
    || E'  IF NOT public._sales_may_sell(p_session_token) THEN\n'
    || E'    RETURN jsonb_build_object(''success'',false,''error'',''role_cannot_sell'',\n'
    || E'      ''message'',''Your role does not book or sell units.''); END IF;';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('reserve_unit', 'save_unit_quote', 'create_availability_link')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position(c_anchor in v_def) = 0 THEN
      RAISE EXCEPTION 'the session check in % is not written as expected - add the guard by hand', r.proname;
    END IF;
    IF position('_sales_may_sell' in v_def) > 0 THEN
      CONTINUE;  -- already guarded, nothing to do
    END IF;
    v_new := replace(v_def, c_anchor, c_guard);
    EXECUTE v_new;
    v_done := v_done || r.proname || ' ';
  END LOOP;
  RAISE NOTICE 'booking now refuses non-selling roles in: %', v_done;
END $mig$;

-- All three, checked rather than assumed.
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(x, ', ') INTO v_missing
    FROM unnest(ARRAY['reserve_unit','save_unit_quote','create_availability_link']) x
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = x
        AND p.prosrc LIKE '%_sales_may_sell%');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'these can still be called by a non-selling role: %', v_missing;
  END IF;
END $$;

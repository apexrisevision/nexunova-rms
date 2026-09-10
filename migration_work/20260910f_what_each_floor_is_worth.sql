/* ══ WHAT EACH FLOOR IS WORTH ══════════════════════════════════════════════
   Rashid: "Also make a complete worth report floor wise."

   The floor block already carried what is TAKEN on each floor. A worth report
   is the other three quarters of the same sentence: what the floor is worth in
   total, how much of that is still on the shelf, how much is committed, and
   how big it is — because a floor's worth is its area times its rate, and a
   director comparing two floors is comparing those two things and not just the
   rupees.

   Nothing new is read; _rep already has every unit with its price and its
   area. Four sums and a count. */

DO $$
DECLARE v_src text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_availability_report';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'get_availability_report is not there to patch';
  END IF;

  v_new := replace(v_src,
$old$                   'units', count(*),
                   'available', count(*) FILTER (WHERE free),
                   'held', count(*) FILTER (WHERE NOT free),
                   'value_held', COALESCE(sum(price) FILTER (WHERE NOT free), 0),$old$,
$new$                   'units', count(*),
                   'available', count(*) FILTER (WHERE free),
                   'held', count(*) FILTER (WHERE NOT free),
                   'value_held', COALESCE(sum(price) FILTER (WHERE NOT free), 0),
                   /* WHAT THE FLOOR IS WORTH, whole and in parts. The rate
                      below is derived from these two, so they travel
                      together and cannot fall out of step. */
                   'value', COALESCE(sum(price), 0),
                   'value_free', COALESCE(sum(price) FILTER (WHERE free), 0),
                   'area', COALESCE(sum(area), 0),
                   'area_free', COALESCE(sum(area) FILTER (WHERE free), 0),$new$);
  IF v_new = v_src THEN
    RAISE EXCEPTION 'the floor object is not written the way this patch expects';
  END IF;

  EXECUTE v_new;
END $$;

REVOKE ALL ON FUNCTION public.get_availability_report(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_availability_report(text, text)
  TO anon, authenticated, service_role;

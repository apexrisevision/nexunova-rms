/* ══ A UNIT WITH NO STATUS ROW STILL HAS TO HAVE A WORD ════════════════════
   The report groups the held units by their kind, and jsonb_object_agg refuses
   a NULL key: `field name must not be null`. A unit whose status_id is NULL —
   never stamped, or stamped with a status that was later deleted — produced
   exactly that. It counts as not available (the dealer's page already draws it
   crossed out, because _public_unit_is_free needs is_available to be TRUE and
   NULL is not), so it reaches the grouping with no word to be grouped under,
   and the whole report fails rather than one row of it.

   Awami has no such unit today. The harness planted one on ZZTEST and the
   report stopped answering, which is what a harness is for.

   The word is 'Not available' — the same thing the dealer's page falls back to
   for a unit it cannot name. A report that says "Not available: 1" is a report
   somebody can go and look into; a report that will not open is not. */

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
$old$         CASE WHEN COALESCE(cs.is_available, false) THEN NULL
              ELSE COALESCE(NULLIF(TRIM(cs.public_label), ''), cs.status_name) END AS kind,$old$,
$new$         CASE WHEN COALESCE(cs.is_available, false) THEN NULL
              ELSE COALESCE(NULLIF(TRIM(cs.public_label), ''), cs.status_name,
                            'Not available') END AS kind,$new$);
  IF v_new = v_src THEN
    RAISE EXCEPTION 'the kind expression is not written the way this patch expects';
  END IF;

  EXECUTE v_new;
END $$;

REVOKE ALL ON FUNCTION public.get_availability_report(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_availability_report(text, text)
  TO anon, authenticated, service_role;

/* ══ THE REPORT CARRIES THE UNITS THEMSELVES ═══════════════════════════════
   The first cut of the directors' room answered in totals only, and a total is
   where a question starts rather than where it ends. Rashid: "jab mai kisi
   holder pe click karun to us ki detail ka page load ho jai k koun kounsa unit
   us ne hold sold pagri reserve etc kia howa hai. Aur us k holds etc kab kab
   expire honay walay hain."

   So the held units ride with the report — all of them, once. 154 rows for
   Awami, about 15 KB. Every page behind the password is then a slice of what
   is already in hand: the person, the kind, what runs out this week. No second
   call, and no second time the password has to be handed over.

   Short keys, the same reason the dealer's payload uses them: this is read on
   a phone. n unit · f floor · k kind · w on whose word · a area · v value ·
   e when it ends · h when it was taken. */

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
$old$    'totals', v_totals, 'by_status', v_status, 'by_floor', v_floors,
    'by_person', v_people, 'insights', v_ins)$old$,
$new$    'totals', v_totals, 'by_status', v_status, 'by_floor', v_floors,
    'by_person', v_people, 'insights', v_ins,
    /* every unit that is gone, so the pages behind this one are a slice of
       what is already in hand rather than another trip to the server */
    'units', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'n', unit_no, 'f', floor_label, 'k', kind,
                       'w', COALESCE(who, ''), 'a', area, 'v', price,
                       'e', expiry_date, 'h', held_at)
                     ORDER BY floor_no,
                              COALESCE(NULLIF(regexp_replace(unit_no,'[^0-9]','','g'),'')::bigint, 0),
                              unit_no), '[]'::jsonb)
                FROM _rep WHERE NOT free))$new$);
  IF v_new = v_src THEN
    RAISE EXCEPTION 'the output object is not written the way this patch expects';
  END IF;

  EXECUTE v_new;
END $$;

REVOKE ALL ON FUNCTION public.get_availability_report(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_availability_report(text, text)
  TO anon, authenticated, service_role;

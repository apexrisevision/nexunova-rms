/* ══ A DEALER MAY SEE WHAT KIND OF HOLD IT IS, AND ON WHOSE WORD ═══════════
   Until now the public link answered one of two things about every unit:
   available, or not. That was deliberate — a reserved unit and a sold one were
   the same answer, and nothing said who had it.

   Rashid has changed the requirement, and said why: "hamain zaroorat hai
   status ki proper k kia ye unit jo available nahi hai us ka status kia hai
   Sold hai, Hold hai, Pagri hai, Reserve etc hai… aur wo kis ne hold sold kia
   hai… aksar muje direct message kar dia jata hai to mai khud direct reserve
   karta hun magar us mai likhta hun k kis k kehnay pe howa."

   So two more fields ride with a unit, and ONLY when it is not available:

     k — what kind of hold, in the tenant's own public wording. The desk calls
         it "Sold - Entry Pending" and a dealer means "Sold"; public_label is
         where the tenant writes the second one, and it is already the wording
         the request sheet offers.
     w — on whose word. reservations.requested_by_name, which is the field the
         desk fills in for exactly this: the person who asked, whether they
         asked through their own link or by sending Rashid a message.

   WHAT STILL DOES NOT GO. The buyer's name, their phone, the amount, the
   token, the note, and who at the desk pressed the button. Those are on the
   reservation too and none of them are a dealer's business.

   A unit with an active sale and no reservation carries k and no w. A unit
   whose status row still says Available while a sale sits behind it — the two
   halves _public_unit_is_free asks about disagreeing — falls back to the word
   the mapping gives rather than to the status row's, which would say
   "Available" on a unit the page has just crossed out. */

DO $$
DECLARE v_src text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_public_availability';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'get_public_availability is not there to patch';
  END IF;

  /* 1. the two new fields, appended only to a unit that is not available */
  v_new := replace(v_src,
$old$                        't', ut.type_name
                      ) || CASE WHEN (SELECT p2.public_show_price$old$,
$new$                        't', ut.type_name
                      )
                      /* WHAT KIND OF HOLD, AND ON WHOSE WORD — see the
                         migration this came from. Nothing is added to a unit
                         that is free: a dealer reading the wire learns only
                         about the ones already gone. */
                      || CASE WHEN st.state = 'available' AND COALESCE(cs.is_available,false)
                              THEN '{}'::jsonb
                              ELSE jsonb_strip_nulls(jsonb_build_object(
                                     'k', CASE WHEN COALESCE(cs.is_available, true)
                                               THEN CASE st.state
                                                      WHEN 'sold'     THEN 'Sold'
                                                      WHEN 'reserved' THEN 'Reserved'
                                                      ELSE 'Not available' END
                                               ELSE COALESCE(NULLIF(TRIM(cs.public_label), ''),
                                                             cs.status_name) END,
                                     'w', NULLIF(TRIM(rq.requested_by_name), '')))
                         END
                      || CASE WHEN (SELECT p2.public_show_price$new$);
  IF v_new = v_src THEN
    RAISE EXCEPTION 'the unit object is not written the way this patch expects';
  END IF;
  v_src := v_new;

  /* 2. the live hold behind it, newest first — a unit can only have one
        active, but ORDER BY costs nothing and makes the answer definite */
  v_new := replace(v_src,
$old$      LEFT JOIN public.category_unit_types ut ON ut.id = u.unit_type_id$old$,
$new$      LEFT JOIN public.category_unit_types ut ON ut.id = u.unit_type_id
      LEFT JOIN LATERAL (
        SELECT r.requested_by_name
          FROM public.reservations r
         WHERE r.unit_id = u.id
           AND r.status = 'active'
           AND (r.expiry_date IS NULL OR r.expiry_date > now())
         ORDER BY r.created_at DESC
         LIMIT 1
      ) rq ON true$new$);
  IF v_new = v_src THEN
    RAISE EXCEPTION 'the unit-types join is not where this patch expects it';
  END IF;

  EXECUTE v_new;
END $$;

/* A REPLACED FUNCTION KEEPS ITS GRANTS, BUT THIS IS THE ONE ANONYMOUS DOOR
   INTO THE BUILDING and it is not worth assuming. Stated again, in full. */
REVOKE ALL ON FUNCTION public.get_public_availability(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_availability(text)
  TO anon, authenticated, service_role;

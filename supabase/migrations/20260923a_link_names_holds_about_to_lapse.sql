-- ═══════════════════════════════════════════════════════════════════════════
-- The link names the holds that lapse in the next two days  (2026-09-23)
--
-- get_public_availability gains one top-level list, `lapsing`: every active
-- reservation on the project whose expiry_date is within 48 hours, as
-- {n: unit_no, w: requested_by_name, x: expiry_date}. The page turns it into
-- an Attention strip under the legend: "Attention Waqar: unit LG-22 will be
-- released tomorrow at 12:29 PM. Kindly convert it to a sale."
--
-- Nothing new about a person goes on the wire: w is the same name each held
-- unit already carries. The unit rows are untouched (keys stay a,k,n,s,t,v,w).
-- Body copied from pg_get_functiondef() on live, not from the repo.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_public_availability(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_choices jsonb; v_out jsonb; v_floors jsonb;
        v_units text[]; v_unit text; v_lapsing jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  -- missing, revoked and expired answer identically: probing teaches nothing
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;

  UPDATE public.availability_links
     SET views = views + 1, last_viewed_at = now()
   WHERE id = v_link.id;

  /* ONE UNIT OF MEASURE, OR NONE.
     area_unit is sent once for the whole project rather than on every unit —
     1,467 copies of 'sqft' is 20 KB of nothing. That is only safe while the
     project really does have one. If it ever has two, this raises: a page that
     labels half its units in the wrong unit is worse than a page that does not
     load, and the person who mixed them needs to hear about it. */
  SELECT array_agg(DISTINCT COALESCE(u.area_unit, 'sqft'))
    INTO v_units
    FROM public.units u
   WHERE u.project_id = v_link.project_id
     AND public._map_unit_state(u.id) <> 'retired';

  IF v_units IS NOT NULL AND array_length(v_units, 1) > 1 THEN
    RAISE EXCEPTION
      'project % mixes area units (%) — the public availability page cannot label them',
      v_link.project_id, array_to_string(v_units, ', ')
      USING ERRCODE = 'data_exception';
  END IF;
  v_unit := COALESCE(v_units[1], 'sqft');

  SELECT jsonb_agg(f ORDER BY (f->>'floor_no')::int, f->>'floor_label') INTO v_floors
  FROM (
    SELECT jsonb_build_object(
             'floor_no', u.floor_no,
             'floor_label', COALESCE(u.floor_label, '—'),
             /* Counted here so the browser never walks 1,467 rows to put a
                number on a floor chip. */
             'available', count(*) FILTER (WHERE st.state = 'available'
                                             AND COALESCE(cs.is_available,false)),
             'total',     count(*),
             'units', jsonb_agg(jsonb_build_object(
                        'n', u.unit_no,
                        /* TWO states, and neither of them says who has it.
                           reserved and sold are the same answer to a dealer:
                           you cannot have this one. */
                        /* BOTH halves. st.state is "nobody has bought or held
                           it"; is_available is "the desk will let it be
                           booked". Offering a unit that answers yes to the
                           first and no to the second is a request that cannot
                           be approved. */
                        's', CASE WHEN st.state = 'available' AND COALESCE(cs.is_available,false)
                                  THEN 'available' ELSE 'not_available' END,
                        'a', u.area,
                        /* WHAT THE THING IS. The plan prints "SHOP" under the
                           number and a dealer reads the two together; the list
                           can say it in full. Public either way — a type is on
                           the printed sheet the office hands out. */
                        't', ut.type_name
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
                      || CASE WHEN (SELECT p2.public_show_price
                                        FROM public.projects p2
                                       WHERE p2.id = v_link.project_id)
                                THEN jsonb_build_object('v', u.base_price)
                                ELSE '{}'::jsonb END
                      /* Unit-wise, not alphabetical. A plain ORDER BY unit_no
                         puts SF-100 immediately after SF-10, so a dealer
                         scanning for SF-15 walks through a hundred others to
                         reach it. Read every digit in the code as one number and
                         fall back to the code for ties, which is the same rule
                         the daybook uses — they must not disagree about the
                         order of the same building. */
                      ORDER BY COALESCE(NULLIF(regexp_replace(u.unit_no, '[^0-9]', '', 'g'),'')::bigint, 0),
                               u.unit_no)
           ) AS f
      FROM public.units u
      LEFT JOIN public.category_unit_statuses cs ON cs.id = u.status_id
      LEFT JOIN public.category_unit_types ut ON ut.id = u.unit_type_id
      LEFT JOIN LATERAL (
        SELECT r.requested_by_name
          FROM public.reservations r
         WHERE r.unit_id = u.id
           AND r.status = 'active'
           AND (r.expiry_date IS NULL OR r.expiry_date > now())
         ORDER BY r.created_at DESC
         LIMIT 1
      ) rq ON true
      CROSS JOIN LATERAL (SELECT public._map_unit_state(u.id) AS state) st
     WHERE u.project_id = v_link.project_id
       AND st.state <> 'retired'
     GROUP BY u.floor_no, COALESCE(u.floor_label, '—')
  ) q;

  /* WHAT A DEALER MAY ASK FOR, decided by the tenant and not by the browser.
     Only statuses this project has flagged public_choice, which in turn can
     only be set on something the desk can actually apply (a nature). The
     label is the tenant's public wording: "Sold - Entry Pending" is our
     bookkeeping and "Sold" is what a dealer means.

     A permanent choice carries no days, and the page must not offer any. */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'label', COALESCE(NULLIF(TRIM(q.public_label),''), q.status_name),
           'nature', q.nature,
           'days', q.hold_days)
         ORDER BY q.sort_order), '[]'::jsonb)
    INTO v_choices
    FROM public.category_unit_statuses q
   WHERE q.project_id = v_link.project_id
     AND q.is_active
     AND NOT q.is_available
     AND q.nature IS NOT NULL
     AND q.public_choice;

  /* WHAT LAPSES IN THE NEXT TWO DAYS. Rashid: "jo unit release honay wala ho
     2 din jis mai reh jain wo ... dashboard pe batana shuru ho jai" -- so the
     person whose word a hold is on hears it is about to go back on the shelf
     while there is still time to turn it into a sale.

     Its own list, NOT a key on the unit: the unit keys are locked at
     a,k,n,s,t,v,w. Three facts per hold -- the unit, on whose word (the same
     requested_by_name the unit already carries as w) and when it lapses.
     Only holds with a date: a permanent tag has expiry_date NULL and never
     lapses, so it is left out on purpose. Rows already past are left out
     too; the cron retires them. */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'n', x.unit_no,
           'w', NULLIF(TRIM(x.requested_by_name), ''),
           'x', x.expiry_date)
         ORDER BY x.expiry_date,
                  COALESCE(NULLIF(regexp_replace(x.unit_no, '[^0-9]', '', 'g'),'')::bigint, 0),
                  x.unit_no), '[]'::jsonb)
    INTO v_lapsing
    FROM (
      SELECT DISTINCT ON (u.id) u.unit_no, r.requested_by_name, r.expiry_date
        FROM public.reservations r
        JOIN public.units u ON u.id = r.unit_id
       WHERE u.project_id = v_link.project_id
         AND r.status = 'active'
         AND r.expiry_date IS NOT NULL
         AND r.expiry_date >  now()
         AND r.expiry_date <= now() + interval '2 days'
       ORDER BY u.id, r.created_at DESC
    ) x;

  SELECT jsonb_build_object(
    'success', true,
    'project', pr.project_name,
    'company', COALESCE(c.display_name, c.company_name),
    'area_unit', v_unit,
    'show_price', COALESCE(pr.public_show_price, false),
    'floors',  COALESCE(v_floors, '[]'::jsonb),
    'choices', COALESCE(v_choices, '[]'::jsonb),
    'lapsing', COALESCE(v_lapsing, '[]'::jsonb)
  ) INTO v_out
  FROM public.projects pr
  JOIN public.companies c ON c.id = pr.company_id
  WHERE pr.id = v_link.project_id;

  RETURN v_out;
END $function$;

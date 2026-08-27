-- ============================================================================
-- The numbers come from the inventory, not from a paragraph.
-- ----------------------------------------------------------------------------
-- The project profile was dictated, and one line of it was a count: thirty
-- apartments a floor, twenty-six on the third and the sixth. RMS disagrees, and
-- RMS is where the units actually live:
--
--   Upper Ground to 9th   32 a floor, except the 3rd and 6th which have 29
--   Ground                8 units - one of 1,619 sqft and seven of 300-483,
--                         which is the mart and the seven shops, exactly as
--                         described
--   Altogether            322 units: 314 apartments and 8 commercial
--   Right now             130 available, 174 sold, 18 dead or cancelled
--
-- A hand-typed count is wrong the moment a unit is split, sold or cancelled —
-- and KBH has had all three this year. So the counts stop being written down.
-- get_project_profiles now returns them live beside the description: totals, a
-- line per status, a line per unit type with its real area range, and a line
-- per floor with how many are still available.
--
-- Nothing here interprets. Statuses are grouped by whatever they are called in
-- category_unit_statuses rather than by a list of names this migration guesses
-- at, so renaming a status on the admin side does not quietly drop a column
-- here.
--
-- The dictated line about per-floor counts is removed from the profile in the
-- same breath. Two answers to one question, one of them stale, is worse than
-- the question.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_project_profiles(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_group uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;

  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;

  RETURN jsonb_build_object('success', true, 'projects', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'project_id',   p.id,
             'project_name', p.project_name,
             'short_code',   p.short_code,
             'city',         p.city,
             'location',     p.location,
             'status',       p.status,
             'profile',      pp.profile,
             -- Counted at the moment of asking. A split, a sale or a
             -- cancellation is reflected here without anybody editing prose.
             'inventory', jsonb_build_object(
               'total',     (SELECT count(*) FROM public.units u WHERE u.project_id = p.id),
               'available', (SELECT count(*) FROM public.units u
                               JOIN public.category_unit_statuses s ON s.id = u.status_id
                              WHERE u.project_id = p.id AND s.is_available),
               'statuses', COALESCE((
                 SELECT jsonb_agg(x ORDER BY (x->>'units')::int DESC) FROM (
                   SELECT jsonb_build_object(
                            'name',      COALESCE(s.status_name, 'Not set'),
                            'available', COALESCE(s.is_available, false),
                            'units',     count(*)) AS x
                     FROM public.units u
                     LEFT JOIN public.category_unit_statuses s ON s.id = u.status_id
                    WHERE u.project_id = p.id
                    GROUP BY s.status_name, s.is_available) q), '[]'::jsonb),
               'types', COALESCE((
                 SELECT jsonb_agg(x ORDER BY (x->>'units')::int DESC) FROM (
                   SELECT jsonb_build_object(
                            'name',     COALESCE(t.type_name, 'Commercial / other'),
                            'units',    count(*),
                            'min_area', min(u.area)::int,
                            'max_area', max(u.area)::int,
                            'unit',     max(u.area_unit)) AS x
                     FROM public.units u
                     LEFT JOIN public.category_unit_types t ON t.id = u.unit_type_id
                    WHERE u.project_id = p.id
                    GROUP BY t.type_name) q), '[]'::jsonb),
               'floors', COALESCE((
                 SELECT jsonb_agg(x ORDER BY (x->>'sort')::int) FROM (
                   SELECT jsonb_build_object(
                            'name',      COALESCE(u.floor_label, 'Not set'),
                            'sort',      COALESCE(min(u.floor_no), 99),
                            'units',     count(*),
                            'available', count(*) FILTER (WHERE s.is_available)) AS x
                     FROM public.units u
                     LEFT JOIN public.category_unit_statuses s ON s.id = u.status_id
                    WHERE u.project_id = p.id
                    GROUP BY u.floor_label) q), '[]'::jsonb)))
           ORDER BY p.project_name)
      FROM public.project_profile pp
      JOIN public.projects  p ON p.id = pp.project_id
      JOIN public.companies c ON c.id = p.company_id
     WHERE (v_group IS NOT NULL AND c.dealer_group_id = v_group)
        OR c.id = v_ses.company_id), '[]'::jsonb));
END $function$;

-- The dictated per-floor count goes, now that the real one is beside it.
UPDATE public.project_profile pp
   SET profile = jsonb_set(
         pp.profile,
         '{sections}',
         (SELECT jsonb_agg(
                   CASE WHEN s->>'key' = 'floors'
                        THEN jsonb_set(s, '{items}',
                               (SELECT jsonb_agg(i) FROM jsonb_array_elements(s->'items') i
                                 WHERE i->>'title' <> 'Apartments per floor'))
                        ELSE s END)
            FROM jsonb_array_elements(pp.profile->'sections') s)),
       updated_at = now()
 FROM public.projects p
WHERE p.id = pp.project_id AND p.short_code = 'KBH';

DO $$
DECLARE v_left integer;
BEGIN
  SELECT count(*) INTO v_left
    FROM public.project_profile pp,
         jsonb_array_elements(pp.profile->'sections') s,
         jsonb_array_elements(s->'items') i
   WHERE i->>'title' = 'Apartments per floor';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'the hand-typed per-floor count is still in the profile';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Price revision, per sq ft  (2026-09-22)
--
-- The Projects page "Price revision" asked for "New Price (PKR/sqft)" and then
-- wrote that number into units.base_price as the TOTAL, for every Available
-- unit of the chosen type on every floor. On Awami one revision of
-- "Retail Shop" would have given 574 shops across seven floors the same total
-- (40,000 per sq ft typed = a shop priced at 40,000 rupees). It had never been
-- used by any tenant, so nothing depends on the old behaviour. See finding R.
--
-- Now: base_price = round(area × rate), narrowed by type, floor and a unit range
-- (the same ordering the link's price tool uses: every digit in the code read as
-- one number). By default only units that are really free change. The same
-- test the link tool and the public page use. Directors can choose every status
-- instead. A preview call returns what WOULD change and writes nothing.
-- Units with no area are skipped and counted, never priced at zero.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.project_price_revisions
  ADD COLUMN IF NOT EXISTS floor_label   text,
  ADD COLUMN IF NOT EXISTS unit_from     text,
  ADD COLUMN IF NOT EXISTS unit_to       text,
  ADD COLUMN IF NOT EXISTS all_statuses  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS units_skipped integer,
  ADD COLUMN IF NOT EXISTS value_before  numeric,
  ADD COLUMN IF NOT EXISTS value_after   numeric,
  ADD COLUMN IF NOT EXISTS per_sqft      boolean NOT NULL DEFAULT false;
-- old_price / new_price hold RATES on per_sqft rows (old = the average rate the
-- changed units had), so the generated change_amount / change_percent read as a
-- change in rate, which is what the screen's "PKR/sqft" column heads say.

CREATE OR REPLACE FUNCTION public.add_price_revision_rate(
  p_project_id     uuid,
  p_rate           numeric,
  p_unit_type_id   uuid    DEFAULT NULL,
  p_floor          text    DEFAULT NULL,
  p_from           text    DEFAULT NULL,
  p_to             text    DEFAULT NULL,
  p_all_statuses   boolean DEFAULT false,
  p_effective_date date    DEFAULT CURRENT_DATE,
  p_reason         text    DEFAULT NULL,
  p_revised_by     text    DEFAULT NULL,
  p_preview        boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me       public.app_users;
  v_company  uuid;
  v_from_k   bigint; v_to_k bigint; v_swap bigint;
  v_changed  int := 0; v_skipped int := 0;
  v_before   numeric := 0; v_after numeric := 0; v_old_rate numeric;
  v_sample   jsonb; v_row public.project_price_revisions;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  -- the company comes from the project, never from the caller
  SELECT company_id INTO v_company FROM public.projects WHERE id = p_project_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_project');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(v_me.is_super_admin, false) OR v_me.role IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- a rate has to be a rate: zero would empty the building's worth in one tap
  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 10000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rate',
      'message', 'Enter a rate per sq ft greater than zero.');
  END IF;
  IF NOT p_preview AND (NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL
                        OR NULLIF(TRIM(COALESCE(p_revised_by, '')), '') IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'required',
      'message', 'Reason and Revised By are required.');
  END IF;

  IF NULLIF(TRIM(COALESCE(p_from, '')), '') IS NOT NULL
     AND NULLIF(TRIM(COALESCE(p_to, '')), '') IS NOT NULL THEN
    v_from_k := COALESCE(NULLIF(regexp_replace(p_from, '[^0-9]', '', 'g'), '')::bigint, 0);
    v_to_k   := COALESCE(NULLIF(regexp_replace(p_to,   '[^0-9]', '', 'g'), '')::bigint, 0);
    IF v_from_k > v_to_k THEN v_swap := v_from_k; v_from_k := v_to_k; v_to_k := v_swap; END IF;
  ELSIF NULLIF(TRIM(COALESCE(p_from, '')), '') IS NOT NULL
     OR NULLIF(TRIM(COALESCE(p_to, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'range',
      'message', 'Give both ends of the unit range, or neither.');
  END IF;

  -- a preview followed by a save in one transaction must not collide
  DROP TABLE IF EXISTS _prr;
  CREATE TEMP TABLE _prr ON COMMIT DROP AS
  SELECT u.id, u.unit_no, COALESCE(u.area, 0)::numeric AS area,
         COALESCE(u.base_price, 0)::numeric AS was,
         round(COALESCE(u.area, 0)::numeric * p_rate) AS now_is
    FROM public.units u
    LEFT JOIN public.category_unit_statuses cs ON cs.id = u.status_id
   WHERE u.project_id = p_project_id
     AND (p_unit_type_id IS NULL OR u.unit_type_id = p_unit_type_id)
     AND (NULLIF(TRIM(COALESCE(p_floor, '')), '') IS NULL OR COALESCE(u.floor_label, '—') = p_floor)
     AND (v_from_k IS NULL OR
          COALESCE(NULLIF(regexp_replace(u.unit_no, '[^0-9]', '', 'g'), '')::bigint, 0)
            BETWEEN v_from_k AND v_to_k)
     AND (p_all_statuses OR
          (public._map_unit_state(u.id) = 'available' AND COALESCE(cs.is_available, false)));

  SELECT count(*) FILTER (WHERE area > 0), count(*) FILTER (WHERE area <= 0),
         COALESCE(sum(was)    FILTER (WHERE area > 0), 0),
         COALESCE(sum(now_is) FILTER (WHERE area > 0), 0),
         round(sum(was) FILTER (WHERE area > 0) / NULLIF(sum(area) FILTER (WHERE area > 0), 0))
    INTO v_changed, v_skipped, v_before, v_after, v_old_rate
    FROM _prr;

  SELECT jsonb_agg(s ORDER BY k) INTO v_sample FROM (
    SELECT jsonb_build_object('n', unit_no, 'a', area, 'was', was, 'now', now_is) AS s,
           COALESCE(NULLIF(regexp_replace(unit_no, '[^0-9]', '', 'g'), '')::bigint, 0) AS k
      FROM _prr WHERE area > 0 ORDER BY k LIMIT 5) q;

  IF p_preview OR v_changed = 0 THEN
    RETURN jsonb_build_object('success', true, 'preview', true,
      'units_changed', v_changed, 'units_skipped', v_skipped,
      'value_before', v_before, 'value_after', v_after,
      'old_rate', v_old_rate, 'new_rate', p_rate, 'sample', COALESCE(v_sample, '[]'::jsonb));
  END IF;

  UPDATE public.units u
     SET base_price = t.now_is, updated_at = now()
    FROM _prr t
   WHERE u.id = t.id AND t.area > 0;

  INSERT INTO public.project_price_revisions
    (company_id, project_id, unit_type_id, old_price, new_price, effective_date,
     reason, revised_by, units_updated, floor_label, unit_from, unit_to,
     all_statuses, units_skipped, value_before, value_after, per_sqft)
  VALUES
    (v_company, p_project_id, p_unit_type_id, COALESCE(v_old_rate, 0), p_rate,
     COALESCE(p_effective_date, CURRENT_DATE), TRIM(p_reason), TRIM(p_revised_by),
     v_changed, NULLIF(TRIM(COALESCE(p_floor, '')), ''), NULLIF(TRIM(COALESCE(p_from, '')), ''),
     NULLIF(TRIM(COALESCE(p_to, '')), ''), COALESCE(p_all_statuses, false), v_skipped,
     v_before, v_after, true)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('success', true, 'preview', false, 'id', v_row.id,
    'units_changed', v_changed, 'units_skipped', v_skipped,
    'value_before', v_before, 'value_after', v_after,
    'old_rate', v_old_rate, 'new_rate', p_rate, 'sample', COALESCE(v_sample, '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.add_price_revision_rate(uuid, numeric, uuid, text, text, text, boolean, date, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_price_revision_rate(uuid, numeric, uuid, text, text, text, boolean, date, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_price_revision_rate(uuid, numeric, uuid, text, text, text, boolean, date, text, text, boolean) TO authenticated;

-- The flat-total version is retired rather than dropped: same signature, so any
-- old tab still holding the page gets a clear refusal instead of a flattening.
CREATE OR REPLACE FUNCTION public.add_price_revision(p_company_id uuid, p_project_id uuid,
  p_unit_type_id uuid, p_new_price numeric, p_effective_date date, p_reason text, p_revised_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN jsonb_build_object('success', false, 'error', 'replaced',
    'message', 'Price revisions are now per sq ft. Reload the page and try again.');
END;
$function$;

-- The history screen reads the new columns too.
CREATE OR REPLACE FUNCTION public.get_price_revisions(p_company_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',             r.id,
      'unit_type_id',   r.unit_type_id,
      'unit_type_name', COALESCE(t.type_name, 'All Types'),
      'old_price',      r.old_price,
      'new_price',      r.new_price,
      'change_amount',  r.change_amount,
      'change_percent', ROUND(r.change_percent, 2),
      'effective_date', r.effective_date,
      'reason',         r.reason,
      'revised_by',     r.revised_by,
      'units_updated',  r.units_updated,
      'created_at',     r.created_at,
      'per_sqft',       r.per_sqft,
      'floor_label',    r.floor_label,
      'unit_from',      r.unit_from,
      'unit_to',        r.unit_to,
      'all_statuses',   r.all_statuses,
      'units_skipped',  r.units_skipped,
      'value_before',   r.value_before,
      'value_after',    r.value_after
    ) ORDER BY r.effective_date DESC, r.created_at DESC
  ), '[]'::JSONB) INTO v_rows
  FROM project_price_revisions r
  LEFT JOIN category_unit_types t ON t.id = r.unit_type_id
  WHERE r.company_id = p_company_id
    AND r.project_id = p_project_id;

  RETURN jsonb_build_object('success', true, 'revisions', v_rows);
END;
$function$;

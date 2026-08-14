-- Phase 5 — Unit Map, part 3: the RPC layer.
--
-- TWO SURFACES, TWO AUTH SYSTEMS — this is the shape of the whole feature:
--
--   Editor  → RMS back office. Auth is app_users via auth.uid(), guarded by
--             _rms_is_admin(). Measured before choosing: NO sales_user carries the
--             'admin' role (15 sale_rep, 4 director, 2 lead_entry), so an
--             "admin-only" editor inside the sales portal would have been
--             unusable by every single person in the company.
--   Viewer  → Sales portal. Auth is sales_sessions, same as every other portal RPC,
--             because the reserve button must call reserve_unit(p_session_token,…).
--
-- Draft plans are invisible to the portal. A half-drawn floor never reaches a
-- sales member; the editor sees everything.
--
-- Colour is never computed here or in JS — every read calls _map_unit_state.

BEGIN;

-- ═══ EDITOR (back office, _rms_is_admin) ═══════════════════════════════════

-- The floor's real slots come from INVENTORY, never from the drawing. The artwork
-- prints "X10A" on both split clusters; the right-hand one is really 17A/B/C. The
-- dropdown is built from units, so the drawing being wrong cannot put a polygon on
-- the wrong unit.
CREATE OR REPLACE FUNCTION public.get_map_editor_plan(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller(); v_plan public.unit_map_plans;
        v_art public.unit_map_artworks; v_slots jsonb; v_shapes jsonb;
BEGIN
  IF v_me.id IS NULL OR NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT * INTO v_plan FROM public.unit_map_plans WHERE id = p_plan_id AND company_id = v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_plan.artwork_id IS NULL THEN
    RETURN jsonb_build_object('success',true,'status',v_plan.status,'artwork',NULL,
      'floor_label',v_plan.floor_label,'slots','[]'::jsonb,'shapes','[]'::jsonb); END IF;
  SELECT * INTO v_art FROM public.unit_map_artworks WHERE id = v_plan.artwork_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'slot', regexp_replace(u.unit_no, '^[^-]+-', ''),
           'unit_no', u.unit_no, 'unit_id', u.id,
           'type', COALESCE(t.type_name,'—'), 'area', u.area,
           'state', public._map_unit_state(u.id)
         ) ORDER BY regexp_replace(u.unit_no, '^[^-]+-', '')), '[]'::jsonb)
    INTO v_slots
    FROM public.units u
    LEFT JOIN public.category_unit_types t ON t.id = u.unit_type_id
   WHERE u.project_id = v_plan.project_id
     AND u.floor_label = v_plan.floor_label
     AND public._map_unit_state(u.id) <> 'retired';   -- split parents are never drawn

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'slot_code', s.slot_code, 'points', s.points,
           'label_x', s.label_x, 'label_y', s.label_y, 'zone_group', s.zone_group
         ) ORDER BY s.slot_code), '[]'::jsonb)
    INTO v_shapes FROM public.unit_map_shapes s WHERE s.artwork_id = v_art.id;

  RETURN jsonb_build_object('success',true,'status',v_plan.status,
    'floor_label',v_plan.floor_label,'unit_prefix',v_plan.unit_prefix,
    'artwork', jsonb_build_object('id',v_art.id,'key',v_art.artwork_key,
      'image_path',v_art.image_path,'w',v_art.image_w,'h',v_art.image_h),
    'slots',v_slots,'shapes',v_shapes);
END $$;

CREATE OR REPLACE FUNCTION public.save_map_shape(
  p_artwork_id uuid, p_slot_code text, p_points jsonb,
  p_label_x numeric DEFAULT NULL, p_label_y numeric DEFAULT NULL, p_zone_group text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller(); v_art public.unit_map_artworks;
        v_slot text; v_pt jsonb; v_id uuid;
BEGIN
  IF v_me.id IS NULL OR NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden',
      'message','Only an owner or admin can draw the floor plan.'); END IF;

  SELECT * INTO v_art FROM public.unit_map_artworks WHERE id = p_artwork_id AND company_id = v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  v_slot := upper(NULLIF(TRIM(COALESCE(p_slot_code,'')),''));
  IF v_slot IS NULL THEN RETURN jsonb_build_object('success',false,'error','slot_required'); END IF;

  IF jsonb_typeof(p_points) <> 'array' OR jsonb_array_length(p_points) < 3 THEN
    RETURN jsonb_build_object('success',false,'error','bad_points',
      'message','A unit needs at least three corners.'); END IF;

  -- Every vertex must be inside the drawing. A point outside 0..1 means the editor
  -- sent screen pixels instead of normalised coordinates — reject it here rather
  -- than store a polygon that renders somewhere off the page.
  FOR v_pt IN SELECT * FROM jsonb_array_elements(p_points) LOOP
    IF jsonb_typeof(v_pt) <> 'array' OR jsonb_array_length(v_pt) <> 2
       OR (v_pt->>0)::numeric < 0 OR (v_pt->>0)::numeric > 1
       OR (v_pt->>1)::numeric < 0 OR (v_pt->>1)::numeric > 1 THEN
      RETURN jsonb_build_object('success',false,'error','bad_points',
        'message','Corners must be normalised 0..1 inside the drawing.'); END IF;
  END LOOP;

  INSERT INTO public.unit_map_shapes (company_id, artwork_id, slot_code, points, label_x, label_y, zone_group, created_by)
  VALUES (v_me.company_id, p_artwork_id, v_slot, p_points, p_label_x, p_label_y,
          NULLIF(TRIM(COALESCE(p_zone_group,'')),''), v_me.id)
  ON CONFLICT (artwork_id, slot_code) DO UPDATE
    SET points = EXCLUDED.points, label_x = EXCLUDED.label_x, label_y = EXCLUDED.label_y,
        zone_group = EXCLUDED.zone_group, updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'id',v_id,'slot_code',v_slot,
    'drawn',(SELECT count(*) FROM public.unit_map_shapes WHERE artwork_id = p_artwork_id));
END $$;

CREATE OR REPLACE FUNCTION public.delete_map_shape(p_artwork_id uuid, p_slot_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller(); v_n int;
BEGIN
  IF v_me.id IS NULL OR NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  DELETE FROM public.unit_map_shapes
   WHERE artwork_id = p_artwork_id AND slot_code = upper(TRIM(p_slot_code))
     AND company_id = v_me.company_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success',true,'deleted',v_n);
END $$;

-- ═══ VIEWER (sales portal, sales_sessions) ═════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_map_floors(p_session_token text, p_project_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ses public.sales_sessions; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'floor_label', p.floor_label, 'floor_no', p.floor_no,
      'status', p.status, 'ready', (p.status = 'published'),
      'units', (SELECT count(*) FROM public.units u
                 WHERE u.project_id=p.project_id AND u.floor_label=p.floor_label
                   AND public._map_unit_state(u.id) <> 'retired')
    ) ORDER BY p.sort_order), '[]'::jsonb) INTO v_rows
  FROM public.unit_map_plans p
  WHERE p.company_id = v_ses.company_id
    AND (p_project_id IS NULL OR p.project_id = p_project_id);
  RETURN jsonb_build_object('success',true,'floors',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.get_map_plan(p_session_token text, p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ses public.sales_sessions; v_plan public.unit_map_plans;
        v_art public.unit_map_artworks; v_units jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_plan FROM public.unit_map_plans WHERE id=p_plan_id AND company_id=v_ses.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  -- A floor without a drawing is a normal state, not a failure. success stays true
  -- so the viewer renders a waiting card instead of an error toast.
  IF v_plan.status <> 'published' THEN
    RETURN jsonb_build_object('success',true,'ready',false,'status',v_plan.status,
      'floor_label',v_plan.floor_label,
      'message', CASE WHEN v_plan.status='coming_soon'
                      THEN 'This floor plan is on its way.'
                      ELSE 'This floor plan is still being prepared.' END);
  END IF;

  SELECT * INTO v_art FROM public.unit_map_artworks WHERE id=v_plan.artwork_id;

  -- shapes joined to THIS floor's units through slot_code + the floor's prefix
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'slot_code', s.slot_code, 'points', s.points,
      'label_x', s.label_x, 'label_y', s.label_y, 'zone_group', s.zone_group,
      'unit_id', u.id, 'unit_no', u.unit_no,
      'type', COALESCE(t.type_name,'—'), 'area', u.area,
      'price', u.base_price,
      'rate_pending', (COALESCE(u.base_price,0) = 0),
      'state', public._map_unit_state(u.id)
    ) ORDER BY s.slot_code), '[]'::jsonb) INTO v_units
  FROM public.unit_map_shapes s
  JOIN public.units u
    ON u.project_id = v_plan.project_id
   AND u.unit_no = v_plan.unit_prefix || '-' || s.slot_code
  LEFT JOIN public.category_unit_types t ON t.id = u.unit_type_id
  WHERE s.artwork_id = v_art.id
    AND public._map_unit_state(u.id) <> 'retired';

  RETURN jsonb_build_object('success',true,'ready',true,'status',v_plan.status,
    'floor_label',v_plan.floor_label,
    'artwork', jsonb_build_object('image_path',v_art.image_path,'w',v_art.image_w,'h',v_art.image_h),
    'units', v_units);
END $$;

COMMIT;

-- Phase 5 — the map reads across the dealer group, exactly as reserve_unit already does.
--
-- The inconsistency this fixes was mine: reserve_unit spans the group, but the map's
-- read RPCs were scoped to the session's own company. So an Awami rep — whose home
-- project is already KHUSHAL BAGH HEIGHTS, in a different company of the same group —
-- could reserve a KBH unit but could not see the KBH floor to find it.
--
-- The rule is COPIED from reserve_unit rather than reinvented, so the two can never
-- drift apart:
--     v_span := (companies.dealer_group_id IS NOT NULL AND sales_users.is_umbrella)
-- Group membership alone is not enough; the user must also be flagged umbrella. All 13
-- Awami reps are, which is why reserve already works for them.
--
-- Scope stays inside the one group. A company with no dealer_group_id, or a user
-- without the umbrella flag, sees only their own company — unchanged behaviour.
--
-- Role-based detail is untouched: get_map_unit_detail still decides on the server, so
-- a rep sees "Sold" and a director sees the buyer, whichever project the unit is in.

BEGIN;

-- One definition of "which companies may this session read", mirroring reserve_unit.
CREATE OR REPLACE FUNCTION public._map_scope_companies(p_session_token text)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_group uuid; v_out uuid[];
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;
  IF v_group IS NOT NULL AND COALESCE(v_su.is_umbrella,false) THEN
    SELECT array_agg(id) INTO v_out FROM public.companies WHERE dealer_group_id = v_group;
    RETURN v_out;
  END IF;
  RETURN ARRAY[v_ses.company_id];
END $$;

COMMENT ON FUNCTION public._map_scope_companies(text) IS
  'Which companies this portal session may read on the map. Mirrors reserve_unit''s '
  'span rule exactly (dealer group + is_umbrella) so read and write can never disagree.';

CREATE OR REPLACE FUNCTION public.get_map_floors(p_session_token text, p_project_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ses public.sales_sessions; v_rows jsonb; v_cos uuid[];
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_cos := public._map_scope_companies(p_session_token);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'floor_label', p.floor_label, 'floor_no', p.floor_no,
      'status', p.status, 'ready', (p.status = 'published'),
      'project_id', p.project_id,
      'project_name', pr.project_name,                                  -- rep picks the project here
      'units', (SELECT count(*) FROM public.units u
                 WHERE u.project_id=p.project_id AND u.floor_label=p.floor_label
                   AND public._map_unit_state(u.id) <> 'retired')
    ) ORDER BY pr.project_name, p.sort_order), '[]'::jsonb) INTO v_rows
  FROM public.unit_map_plans p
  JOIN public.projects pr ON pr.id = p.project_id
  WHERE p.company_id = ANY(v_cos)
    AND (p_project_id IS NULL OR p.project_id = p_project_id);

  RETURN jsonb_build_object('success',true,'floors',v_rows,
    'scope', CASE WHEN array_length(v_cos,1) > 1 THEN 'group' ELSE 'company' END);
END $$;

CREATE OR REPLACE FUNCTION public.get_map_plan(p_session_token text, p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ses public.sales_sessions; v_plan public.unit_map_plans;
        v_art public.unit_map_artworks; v_units jsonb; v_cos uuid[];
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_cos := public._map_scope_companies(p_session_token);

  SELECT * INTO v_plan FROM public.unit_map_plans WHERE id=p_plan_id AND company_id = ANY(v_cos);
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  IF v_plan.status <> 'published' THEN
    RETURN jsonb_build_object('success',true,'ready',false,'status',v_plan.status,
      'floor_label',v_plan.floor_label,
      'message', CASE WHEN v_plan.status='coming_soon'
                      THEN 'This floor plan is on its way.'
                      ELSE 'This floor plan is still being prepared.' END);
  END IF;

  SELECT * INTO v_art FROM public.unit_map_artworks WHERE id=v_plan.artwork_id;

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
    'project_name',(SELECT pr.project_name FROM public.projects pr WHERE pr.id=v_plan.project_id),
    'artwork', jsonb_build_object('image_path',v_art.image_path,'w',v_art.image_w,'h',v_art.image_h),
    'units', v_units);
END $$;

-- get_map_unit_detail: same widening, so a rep can open a group unit they can see.
-- The ROLE split inside it is unchanged.
CREATE OR REPLACE FUNCTION public.get_map_unit_detail(p_session_token text, p_unit_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ses public.sales_sessions; v_role text; v_priv boolean; v_cos uuid[];
        v_u public.units; v_state text; v_out jsonb; v_sale record; v_res record;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_cos := public._map_scope_companies(p_session_token);

  SELECT * INTO v_u FROM public.units WHERE id = p_unit_id AND company_id = ANY(v_cos);
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT role INTO v_role FROM public.sales_users WHERE id = v_ses.sales_user_id;
  v_priv  := v_role IN ('director','admin','cfo');
  v_state := public._map_unit_state(p_unit_id);

  v_out := jsonb_build_object(
    'success', true, 'unit_id', v_u.id, 'unit_no', v_u.unit_no,
    'state', v_state, 'area', v_u.area, 'floor_label', v_u.floor_label,
    'price', v_u.base_price, 'rate_pending', (COALESCE(v_u.base_price,0) = 0),
    'type', (SELECT t.type_name FROM public.category_unit_types t WHERE t.id = v_u.unit_type_id),
    'can_reserve', (v_state = 'available' AND COALESCE(v_u.base_price,0) > 0),
    'privileged', v_priv);

  IF NOT v_priv THEN
    RETURN v_out || jsonb_build_object('label',
      CASE v_state WHEN 'sold' THEN 'Sold' WHEN 'reserved' THEN 'Reserved' ELSE 'Available' END);
  END IF;

  IF v_state = 'sold' THEN
    SELECT s.id, s.sale_number, s.net_amount, s.sale_date, c.full_name AS client_name, c.phone_primary AS phone,
           COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.sale_id = s.id AND p.status <> 'cancelled'),0) AS paid
      INTO v_sale
      FROM public.sales s LEFT JOIN public.clients c ON c.id = s.client_id
     WHERE s.unit_id = p_unit_id AND s.status = 'active' LIMIT 1;
    IF v_sale.id IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('sale', jsonb_build_object(
        'sale_number', v_sale.sale_number, 'client_name', v_sale.client_name,
        'client_phone', v_sale.phone, 'sale_date', v_sale.sale_date,
        'net_amount', v_sale.net_amount, 'paid', v_sale.paid,
        'outstanding', COALESCE(v_sale.net_amount,0) - v_sale.paid,
        'overdue', COALESCE((SELECT sum(i.amount_due - COALESCE(i.amount_paid,0))
                               FROM public.installments i
                              WHERE i.sale_id = v_sale.id AND i.due_date < current_date
                                AND COALESCE(i.amount_paid,0) < i.amount_due),0)));
    END IF;
  ELSIF v_state = 'reserved' THEN
    SELECT r.client_name, r.client_phone, r.expiry_date, r.token_amount, su.full_name AS by_name
      INTO v_res
      FROM public.reservations r LEFT JOIN public.sales_users su ON su.id = r.reserved_by
     WHERE r.unit_id = p_unit_id AND r.status = 'active' ORDER BY r.created_at DESC LIMIT 1;
    IF v_res.expiry_date IS NOT NULL OR v_res.client_name IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('reservation', jsonb_build_object(
        'client_name', v_res.client_name, 'client_phone', v_res.client_phone,
        'expires_at', v_res.expiry_date, 'token_amount', v_res.token_amount,
        'reserved_by', v_res.by_name));
    END IF;
  END IF;

  RETURN v_out;
END $$;

COMMIT;

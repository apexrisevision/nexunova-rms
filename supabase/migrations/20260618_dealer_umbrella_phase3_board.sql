-- ════════════════════════════════════════════════════════════════════════════
-- DEALER UMBRELLA — Phase 3: group-aware availability board.
-- get_availability_board now spans ALL member companies when the dealer's company
-- is in a group (else just the dealer's own company — unchanged). Each project also
-- carries its company_id + company_name so the portal can group/label by company.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_availability_board(p_session_token text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_scope uuid; v_group uuid; v_companies uuid[]; v_result jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_scope := COALESCE(v_ses.project_id, p_project_id);

  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_ses.company_id;
  IF v_group IS NOT NULL THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies WHERE dealer_group_id=v_group AND status='active';
  ELSE
    v_companies := ARRAY[v_ses.company_id];
  END IF;

  SELECT jsonb_build_object('success',true,'scope_project_id',v_ses.project_id,
           'grouped', (v_group IS NOT NULL),
           'projects', COALESCE(jsonb_agg(proj ORDER BY proj->>'company_name', proj->>'project_name'), '[]'::jsonb))
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'project_id', p.id, 'project_name', p.project_name,
      'company_id', p.company_id, 'company_name', co.company_name,
      'counts', jsonb_build_object(
        'available', count(*) FILTER (WHERE st.is_available),
        'reserved',  count(*) FILTER (WHERE st.status_code='RESERVED'),
        'sold',      count(*) FILTER (WHERE st.status_code='SOLD'),
        'total',     count(*)),
      'units', COALESCE(jsonb_agg(jsonb_build_object(
        'unit_id', u.id, 'unit_no', u.unit_no,
        'area', u.area, 'area_unit', COALESCE(u.area_unit,'sqft'),
        'base_price', u.base_price,
        'floor_label', COALESCE(NULLIF(u.floor_label,''), 'Floor '||COALESCE(u.floor_no::text,'-')),
        'floor_no', COALESCE(u.floor_no, 0),
        'floor_rank', COALESCE(f.sort_order, u.floor_no, 999),
        'status_code', st.status_code, 'status_name', st.status_name,
        'color_hex', st.color_hex, 'is_available', COALESCE(st.is_available,false),
        'reservation', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object(
             'reserved_by_name', su.full_name, 'expiry_date', r.expiry_date) ELSE NULL END,
        'sold_by', CASE WHEN st.status_code='SOLD'
                        THEN COALESCE(ag.full_name, seller.full_name) ELSE NULL END
      ) ORDER BY COALESCE(f.sort_order, u.floor_no, 999),
                 COALESCE(NULLIF(substring(u.unit_no FROM '(\d+)$'),'')::int, 0),
                 u.unit_no), '[]'::jsonb)
    ) AS proj
    FROM public.projects p
    JOIN public.companies co ON co.id=p.company_id
    JOIN public.units u ON u.project_id=p.id AND u.company_id=p.company_id
    LEFT JOIN public.floors f ON f.id=u.floor_id
    LEFT JOIN public.category_unit_statuses st ON st.id=u.status_id
    LEFT JOIN public.reservations r ON r.unit_id=u.id AND r.status='active'
    LEFT JOIN public.sales_users su ON su.id=r.reserved_by
    LEFT JOIN LATERAL (
      SELECT s.agent_id FROM public.sales s
      WHERE s.unit_id=u.id AND s.company_id=p.company_id AND s.status='active'
      ORDER BY s.sale_date DESC NULLS LAST LIMIT 1
    ) sale ON true
    LEFT JOIN public.agents ag ON ag.id=sale.agent_id
    LEFT JOIN LATERAL (
      SELECT su2.full_name FROM public.reservations r2
      JOIN public.sales_users su2 ON su2.id=r2.reserved_by
      WHERE r2.unit_id=u.id AND r2.status='converted'
      ORDER BY r2.updated_at DESC LIMIT 1
    ) seller ON true
    WHERE p.company_id = ANY(v_companies) AND (v_scope IS NULL OR p.id=v_scope)
    GROUP BY p.id, p.project_name, p.company_id, co.company_name
  ) q;

  RETURN v_result;
END; $function$;

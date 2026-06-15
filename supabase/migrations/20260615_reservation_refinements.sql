-- ============================================================================
-- NEXUNOVA RMS — AVAILABILITY & RESERVATION — REFINEMENTS (pre-commit)
-- 2026-06-15.  Three owner-required refinements. Additive (CREATE OR REPLACE).
-- ----------------------------------------------------------------------------
-- R1 TWO-WAY SYNC: the board reads units.status_id LIVE on every call (single
--    source of truth), so an RMS sale (create_sale_with_schedule flips the unit
--    to SOLD) shows on the board immediately, and a board reserve shows in the
--    RMS Units page. No server-side cache. (Verified, not a code change.)
-- R2 RESERVED-CARD PRIVACY: get_availability_board (sales-facing) returns the
--    SALES PERSON name on a reserved unit but NO client identity. Client name /
--    phone are returned ONLY by get_reservations_admin (admin) and
--    get_my_reservations (the owner of that reservation). Anti client-poaching.
-- R3 FLOOR SORT: order by the curated floors.sort_order (Ground, Upper Ground,
--    1st … 9th) + NATURAL unit number (1-2 before 1-10), everywhere. floor_no
--    alone is 0 for both Ground and Upper Ground, so we join floors.
-- ============================================================================

-- ── get_availability_board: strip client identity + proper floor/unit order ─
CREATE OR REPLACE FUNCTION public.get_availability_board(p_session_token text, p_project_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ses public.sales_sessions; v_scope uuid; v_result jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_scope := COALESCE(v_ses.project_id, p_project_id);

  SELECT jsonb_build_object('success',true,'scope_project_id',v_ses.project_id,
           'projects', COALESCE(jsonb_agg(proj ORDER BY proj->>'project_name'), '[]'::jsonb))
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'project_id', p.id, 'project_name', p.project_name,
      'counts', jsonb_build_object(
        'available', count(*) FILTER (WHERE st.is_available),
        'reserved',  count(*) FILTER (WHERE st.status_code='RESERVED'),
        'sold',      count(*) FILTER (WHERE st.status_code='SOLD'),
        'total',     count(*)),
      'units', COALESCE(jsonb_agg(jsonb_build_object(
        'unit_id', u.id, 'unit_no', u.unit_no,
        'floor_label', COALESCE(NULLIF(u.floor_label,''), 'Floor '||COALESCE(u.floor_no::text,'-')),
        'floor_no', COALESCE(u.floor_no, 0),
        'floor_rank', COALESCE(f.sort_order, u.floor_no, 999),
        'status_code', st.status_code, 'status_name', st.status_name,
        'color_hex', st.color_hex, 'is_available', COALESCE(st.is_available,false),
        -- ★ PRIVACY: sales person name ONLY — never the client identity ★
        'reservation', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object(
             'reserved_by_name', su.full_name, 'expiry_date', r.expiry_date) ELSE NULL END
      ) ORDER BY COALESCE(f.sort_order, u.floor_no, 999),
                 COALESCE(NULLIF(substring(u.unit_no FROM '(\d+)$'),'')::int, 0),
                 u.unit_no), '[]'::jsonb)
    ) AS proj
    FROM public.projects p
    JOIN public.units u ON u.project_id=p.id AND u.company_id=v_ses.company_id
    LEFT JOIN public.floors f ON f.id=u.floor_id
    LEFT JOIN public.category_unit_statuses st ON st.id=u.status_id
    LEFT JOIN public.reservations r ON r.unit_id=u.id AND r.status='active'
    LEFT JOIN public.sales_users su ON su.id=r.reserved_by
    WHERE p.company_id=v_ses.company_id AND (v_scope IS NULL OR p.id=v_scope)
    GROUP BY p.id, p.project_name
  ) q;

  RETURN v_result;
END; $$;

-- ── get_reservations_admin: full client (admin) + floor order ───────────────
CREATE OR REPLACE FUNCTION public.get_reservations_admin(
  p_company_id uuid, p_project_id uuid DEFAULT NULL, p_status text DEFAULT 'active')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_res jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'unit_id', r.unit_id, 'unit_no', u.unit_no, 'project_name', p.project_name,
    'reserved_by_name', su.full_name, 'reserved_by_phone', su.phone,
    'client_name', r.client_name, 'client_phone', r.client_phone,
    'token_received', r.token_received, 'token_amount', r.token_amount, 'note', r.note,
    'status', r.status, 'expiry_date', r.expiry_date, 'created_at', r.created_at,
    'converted_sale_id', r.converted_sale_id
  ) ORDER BY COALESCE(f.sort_order, u.floor_no, 999),
             COALESCE(NULLIF(substring(u.unit_no FROM '(\d+)$'),'')::int, 0), u.unit_no), '[]'::jsonb) INTO v_res
  FROM public.reservations r
  JOIN public.units u ON u.id=r.unit_id
  LEFT JOIN public.floors f ON f.id=u.floor_id
  LEFT JOIN public.projects p ON p.id=r.project_id
  LEFT JOIN public.sales_users su ON su.id=r.reserved_by
  WHERE r.company_id=p_company_id
    AND (p_project_id IS NULL OR r.project_id=p_project_id)
    AND (p_status IS NULL OR p_status='all' OR r.status=p_status);
  RETURN jsonb_build_object('success',true,'reservations',v_res);
END; $$;

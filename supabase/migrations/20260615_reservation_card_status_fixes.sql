-- ============================================================================
-- NEXUNOVA RMS — AVAILABILITY & RESERVATION — CARD/STATUS FIXES
-- 2026-06-15.  Five owner fixes (additive / CREATE OR REPLACE).
-- ----------------------------------------------------------------------------
-- F1 Reserved card shows the SALES PERSON name (already returned as
--    reserved_by_name) — UI change only.
-- F2 No-orphan trigger: when an admin changes a unit's status AWAY from
--    RESERVED (to anything that is not RESERVED/SOLD), any active reservation
--    on that unit is cancelled — unit status & reservation status stay
--    consistent. (Release already works via admin_cancel_reservation.)
-- F3 get_availability_board now returns `sold_by` for SOLD units = the sale's
--    AGENT name, falling back to the prior reserver (converted reservation).
--    Still NO client identity on the sales-facing board (R2 privacy holds).
-- F4 sales_register: dedup is already (company, phone) across ALL statuses;
--    message sharpened to "This mobile number is already registered."
-- F5 (register project picker) — UI only; no project list is exposed server-side.
-- ============================================================================

-- ── F2: keep unit status and reservation status consistent ─────────────────
CREATE OR REPLACE FUNCTION public._sync_reservation_on_unit_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_code text;
BEGIN
  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    SELECT upper(status_code) INTO v_code FROM public.category_unit_statuses WHERE id=NEW.status_id;
    -- Moving to anything that is NOT a hold and NOT a sale frees the unit:
    -- cancel the live reservation so nothing points at a now-available unit.
    -- (RESERVED is the reserve action itself; SOLD is owned by the sale/convert flow.)
    IF COALESCE(v_code,'') NOT IN ('RESERVED','SOLD') THEN
      UPDATE public.reservations
        SET status='cancelled', cancelled_at=now(), updated_at=now()
      WHERE unit_id=NEW.id AND status='active';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_reservation_on_unit_status ON public.units;
CREATE TRIGGER trg_sync_reservation_on_unit_status
  AFTER UPDATE OF status_id ON public.units
  FOR EACH ROW EXECUTE FUNCTION public._sync_reservation_on_unit_status();

-- ── F3 + F1: board adds sold_by (agent → prior reserver), keeps privacy + sort
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
        -- PRIVACY: staff names only, never client identity
        'reservation', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object(
             'reserved_by_name', su.full_name, 'expiry_date', r.expiry_date) ELSE NULL END,
        -- SOLD attribution: sale's agent, else the prior reserver (both are STAFF names)
        'sold_by', CASE WHEN st.status_code='SOLD'
                        THEN COALESCE(ag.full_name, seller.full_name) ELSE NULL END
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
    LEFT JOIN LATERAL (
      SELECT s.agent_id FROM public.sales s
      WHERE s.unit_id=u.id AND s.company_id=v_ses.company_id AND s.status='active'
      ORDER BY s.sale_date DESC NULLS LAST LIMIT 1
    ) sale ON true
    LEFT JOIN public.agents ag ON ag.id=sale.agent_id
    LEFT JOIN LATERAL (
      SELECT su2.full_name FROM public.reservations r2
      JOIN public.sales_users su2 ON su2.id=r2.reserved_by
      WHERE r2.unit_id=u.id AND r2.status='converted'
      ORDER BY r2.updated_at DESC LIMIT 1
    ) seller ON true
    WHERE p.company_id=v_ses.company_id AND (v_scope IS NULL OR p.id=v_scope)
    GROUP BY p.id, p.project_name
  ) q;

  RETURN v_result;
END; $$;

-- ── F4: stricter message (dedup already covers any status, company-wide) ────
CREATE OR REPLACE FUNCTION public.sales_register(p_signup_token text, p_name text, p_phone text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE v_co public.companies; v_pending int; v_phone text;
BEGIN
  IF TRIM(COALESCE(p_signup_token,''))='' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_link'); END IF;
  SELECT * INTO v_co FROM public.companies WHERE sales_signup_token=p_signup_token AND status='active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','invalid_link',
      'message','This signup link is invalid or has been disabled. Ask your office for the current link.'); END IF;
  IF TRIM(COALESCE(p_name,''))='' OR TRIM(COALESCE(p_phone,''))='' THEN
    RETURN jsonb_build_object('success',false,'error','name_phone_required','message','Please enter your name and phone.'); END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_pin','message','Choose a PIN of 4 to 6 digits.'); END IF;

  v_phone := lower(trim(p_phone));
  -- ONE MOBILE = ONE SALES PERSON per company (any status: pending/active/inactive/rejected)
  IF EXISTS (SELECT 1 FROM public.sales_users WHERE company_id=v_co.id AND lower(phone)=v_phone) THEN
    RETURN jsonb_build_object('success',false,'error','phone_already_registered',
      'message','This mobile number is already registered. If you are awaiting approval please wait; if already approved, just sign in.'); END IF;

  SELECT count(*) INTO v_pending FROM public.sales_users WHERE company_id=v_co.id AND status='pending';
  IF v_pending >= 100 THEN
    RETURN jsonb_build_object('success',false,'error','too_many_pending',
      'message','Registrations are temporarily full. Please contact your office.'); END IF;

  INSERT INTO public.sales_users (company_id, project_id, full_name, phone, pin_hash, status, is_active)
  VALUES (v_co.id, NULL, TRIM(p_name), TRIM(p_phone), crypt(p_pin, gen_salt('bf',8)), 'pending', false);

  RETURN jsonb_build_object('success',true,'status','pending','company_name',v_co.company_name);
END; $$;

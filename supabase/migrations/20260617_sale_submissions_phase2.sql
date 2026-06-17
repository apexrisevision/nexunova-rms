-- ============================================================================
-- NEXUNOVA RMS — SALE AGENT SELF-SERVICE — P2.2 (step A): submission substrate
-- 2026-06-17.  Plan = SALE_AGENT_SELF_SERVICE_PLAN.md.
-- ----------------------------------------------------------------------------
-- From a reserved unit, the agent submits a COMPLETE sale package (client + sale
-- + schedule). Nothing real lands in RMS yet — it sits in sale_submissions as
-- 'pending' for admin review (P3). The unit shows a new "Under Sale Review"
-- status; the reservation stays active (so the unit stays locked) and is frozen
-- against auto-expiry while a submission is pending.
-- ============================================================================

-- ── 1. "Under Sale Review" unit status: seed for new + backfill existing ─────
CREATE OR REPLACE FUNCTION public.seed_default_categories(p_company_id uuid, p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  INSERT INTO public.category_unit_types (company_id, project_id, type_code, type_name, sort_order, is_active) VALUES
    (p_company_id, p_project_id, 'STUDIO',    'Studio Apartment',    1,  true),
    (p_company_id, p_project_id, '1BHK',      '1 Bed Apartment',     2,  true),
    (p_company_id, p_project_id, '2BHK',      '2 Bed Apartment',     3,  true),
    (p_company_id, p_project_id, '3BHK',      '3 Bed Apartment',     4,  true),
    (p_company_id, p_project_id, 'PENT',      'Penthouse',           5,  true),
    (p_company_id, p_project_id, 'SHOP',      'Retail Shop',         6,  true),
    (p_company_id, p_project_id, 'OFFICE',    'Office Unit',         7,  true),
    (p_company_id, p_project_id, 'PLOT_5M',   '5 Marla Plot',        8,  true),
    (p_company_id, p_project_id, 'PLOT_10M',  '10 Marla Plot',       9,  true),
    (p_company_id, p_project_id, 'WAREHOUSE', 'Warehouse / Storage', 10, true)
  ON CONFLICT (company_id, project_id, type_code) DO NOTHING;

  INSERT INTO public.category_unit_statuses (company_id, project_id, status_code, status_name, color_hex, sort_order, is_active, is_available) VALUES
    (p_company_id, p_project_id, 'AVAILABLE',   'Available',         '#10b981', 1,  true, true),
    (p_company_id, p_project_id, 'BOOKED',      'Booked',            '#6366f1', 2,  true, false),
    (p_company_id, p_project_id, 'SOLD',        'Sold',              '#8b5cf6', 3,  true, false),
    (p_company_id, p_project_id, 'RESERVED',    'Reserved',          '#f59e0b', 4,  true, false),
    (p_company_id, p_project_id, 'INSTALLMENT', 'On Installment',    '#06b6d4', 5,  true, false),
    (p_company_id, p_project_id, 'MORTGAGED',   'Mortgaged',         '#f97316', 6,  true, false),
    (p_company_id, p_project_id, 'TRANSFER',    'Under Transfer',    '#a855f7', 7,  true, false),
    (p_company_id, p_project_id, 'HOLD',        'On Hold',           '#64748b', 8,  true, false),
    (p_company_id, p_project_id, 'POSSESSION',  'Possession Given',  '#0ea5e9', 9,  true, false),
    (p_company_id, p_project_id, 'DEAD',        'Dead / Cancelled',  '#ef4444', 10, true, false),
    (p_company_id, p_project_id, 'SALE_REVIEW', 'Under Sale Review', '#d946ef', 11, true, false)
  ON CONFLICT (company_id, project_id, status_code) DO NOTHING;
END $function$;

-- backfill SALE_REVIEW into every existing project
INSERT INTO public.category_unit_statuses (company_id, project_id, status_code, status_name, color_hex, sort_order, is_active, is_available)
SELECT DISTINCT s.company_id, s.project_id, 'SALE_REVIEW', 'Under Sale Review', '#d946ef',
       (SELECT COALESCE(MAX(sort_order),10)+1 FROM public.category_unit_statuses x WHERE x.company_id=s.company_id AND x.project_id=s.project_id),
       true, false
FROM public.category_unit_statuses s
WHERE NOT EXISTS (SELECT 1 FROM public.category_unit_statuses y
                  WHERE y.company_id=s.company_id AND y.project_id=s.project_id AND y.status_code='SALE_REVIEW');

-- ── 2. sale_submissions — the pending package ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sale_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL,
  unit_id           uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  reservation_id    uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  submitted_by      uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,
  agent_id          uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  client_payload    jsonb NOT NULL,
  sale_payload      jsonb NOT NULL,
  schedule_payload  jsonb NOT NULL,
  matched_client_id uuid,                       -- admin links a dup client at review
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','withdrawn')),
  reject_reason     text,
  created_client_id uuid,                        -- set on approval (P3)
  created_sale_id   uuid,                        -- set on approval (P3)
  decided_by        uuid,
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sale_submissions_company_status_idx ON public.sale_submissions (company_id, status);
CREATE INDEX IF NOT EXISTS sale_submissions_reservation_idx    ON public.sale_submissions (reservation_id);
-- at most ONE pending submission per reservation
CREATE UNIQUE INDEX IF NOT EXISTS sale_submissions_one_pending_per_resv
  ON public.sale_submissions (reservation_id) WHERE status='pending';
ALTER TABLE public.sale_submissions ENABLE ROW LEVEL SECURITY;  -- deny-all; DEFINER RPCs only

-- ── 3. submit_sale (portal, session-gated) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_sale(
  p_session_token text, p_reservation_id uuid,
  p_client jsonb, p_sale jsonb, p_schedule jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ses public.sales_sessions; v_res public.reservations; v_unit public.units;
        v_su public.sales_users; v_review uuid; v_sub uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  -- the reservation must be active AND owned by the caller
  SELECT * INTO v_res FROM public.reservations
   WHERE id=p_reservation_id AND company_id=v_ses.company_id
     AND reserved_by=v_ses.sales_user_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found_or_not_yours',
    'message','This reservation is not active or not yours.'); END IF;

  IF EXISTS (SELECT 1 FROM public.sale_submissions WHERE reservation_id=p_reservation_id AND status='pending') THEN
    RETURN jsonb_build_object('success',false,'error','already_submitted',
      'message','You have already submitted this sale — it is awaiting office approval.'); END IF;

  -- light validation (the portal validates fully; this guards the substrate)
  IF TRIM(COALESCE(p_client->>'full_name',''))='' THEN
    RETURN jsonb_build_object('success',false,'error','client_required','message','Client name is required.'); END IF;
  IF COALESCE((p_sale->>'area_sqft')::numeric,0) <= 0 OR COALESCE((p_sale->>'price_per_sqft')::numeric,0) <= 0 THEN
    RETURN jsonb_build_object('success',false,'error','price_required','message','Enter the unit price and area.'); END IF;
  IF p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'array' OR jsonb_array_length(p_schedule) = 0 THEN
    RETURN jsonb_build_object('success',false,'error','schedule_required','message','Add at least one payment in the schedule.'); END IF;

  SELECT * INTO v_unit FROM public.units WHERE id=v_res.unit_id AND company_id=v_ses.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','unit_not_found'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;

  INSERT INTO public.sale_submissions
    (company_id, project_id, unit_id, reservation_id, submitted_by, agent_id,
     client_payload, sale_payload, schedule_payload, status)
  VALUES
    (v_ses.company_id, v_res.project_id, v_res.unit_id, v_res.id, v_ses.sales_user_id, v_su.agent_id,
     p_client, p_sale, p_schedule, 'pending')
  RETURNING id INTO v_sub;

  -- unit -> Under Sale Review (reservation stays active = still locked + frozen)
  SELECT id INTO v_review FROM public.category_unit_statuses
   WHERE company_id=v_ses.company_id AND project_id=v_res.project_id AND status_code='SALE_REVIEW' AND is_active LIMIT 1;
  IF v_review IS NOT NULL THEN
    UPDATE public.units SET status_id=v_review, updated_at=now() WHERE id=v_res.unit_id; END IF;

  RETURN jsonb_build_object('success',true,'submission_id',v_sub);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'error','already_submitted',
    'message','You have already submitted this sale — it is awaiting office approval.');
END; $$;

-- ── 4. get_my_submissions (portal) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_submissions(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ses public.sales_sessions; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'unit_no', u.unit_no, 'project_name', p.project_name,
    'client_name', s.client_payload->>'full_name',
    'status', s.status, 'reject_reason', s.reject_reason,
    'created_at', s.created_at, 'reservation_id', s.reservation_id
  ) ORDER BY s.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.sale_submissions s
  JOIN public.units u ON u.id=s.unit_id
  LEFT JOIN public.projects p ON p.id=s.project_id
  WHERE s.company_id=v_ses.company_id AND s.submitted_by=v_ses.sales_user_id;
  RETURN jsonb_build_object('success',true,'submissions',v_rows);
END; $$;

-- ── 5. cancel_my_submission (portal — withdraw a pending one) ────────────────
CREATE OR REPLACE FUNCTION public.cancel_my_submission(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ses public.sales_sessions; v_sub public.sale_submissions; v_resv_status uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_sub FROM public.sale_submissions
   WHERE id=p_id AND company_id=v_ses.company_id AND submitted_by=v_ses.sales_user_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found_or_not_pending'); END IF;

  UPDATE public.sale_submissions SET status='withdrawn', updated_at=now() WHERE id=p_id;

  -- reservation is still active -> put the unit back to Reserved
  IF EXISTS (SELECT 1 FROM public.reservations WHERE id=v_sub.reservation_id AND status='active') THEN
    SELECT id INTO v_resv_status FROM public.category_unit_statuses
     WHERE company_id=v_sub.company_id AND project_id=v_sub.project_id
       AND (LOWER(status_code)='reserved' OR status_name ILIKE '%reserved%') AND is_active
     ORDER BY sort_order LIMIT 1;
    IF v_resv_status IS NOT NULL THEN
      UPDATE public.units SET status_id=v_resv_status, updated_at=now() WHERE id=v_sub.unit_id; END IF;
  END IF;
  RETURN jsonb_build_object('success',true);
END; $$;

-- ── 6. cron_expire_reservations — FREEZE reservations under review ───────────
CREATE OR REPLACE FUNCTION public.cron_expire_reservations()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_res public.reservations%ROWTYPE; v_avail uuid; v_count int := 0;
BEGIN
  FOR v_res IN
    SELECT * FROM public.reservations r
    WHERE r.status='active' AND r.expiry_date < now()
      AND NOT EXISTS (SELECT 1 FROM public.sale_submissions s
                      WHERE s.reservation_id=r.id AND s.status='pending')
  LOOP
    UPDATE public.reservations SET status='expired', updated_at=now() WHERE id=v_res.id;
    SELECT id INTO v_avail FROM public.category_unit_statuses
     WHERE company_id=v_res.company_id AND project_id=v_res.project_id AND is_available AND is_active
     ORDER BY sort_order LIMIT 1;
    IF v_avail IS NOT NULL THEN
      UPDATE public.units SET status_id=v_avail, updated_at=now()
       WHERE id=v_res.unit_id AND company_id=v_res.company_id;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('success',true,'expired_count',v_count,'ran_at',now());
END; $$;

-- ── 7. Grants ────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.submit_sale(text,uuid,jsonb,jsonb,jsonb)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_submissions(text)                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_my_submission(text,uuid)            FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_sale(text,uuid,jsonb,jsonb,jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_submissions(text)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_my_submission(text,uuid)         TO anon, authenticated;

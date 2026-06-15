-- ============================================================================
-- NEXUNOVA RMS — AVAILABILITY & RESERVATION — PHASE 2
-- 2026-06-15.  Additive only. Plan = AVAILABILITY_RESERVATION_PLAN.md.
-- ----------------------------------------------------------------------------
-- (1) CONVERT reservation -> sale (ADMIN-only, owner-locked). Reuses the
--     EXISTING create_sale_with_schedule (no parallel sale path): the admin
--     opens New Sale PREFILLED from the reservation (unit + client + token as
--     CONTEXT) and records the real deal there. Two thin RPCs:
--       - convert_reservation_prefill : validates (active + unit not already
--         sold) and returns the prefill bundle.
--       - mark_reservation_converted  : after the sale is created, flips the
--         reservation to 'converted' (+converted_sale_id). FOR UPDATE row-lock
--         + status='active' guard => double-convert is impossible.
--     The token is NOT posted as a payment — it stays record-only; the admin
--     records actual payments through the normal RMS / QuickBooks flow.
-- (2) AUTO-EXPIRY cron (cron_expire_reservations) — modelled on
--     cron_expire_subscriptions: hourly, idempotent, dedup-safe. An active
--     reservation past expiry_date -> 'expired' + unit back to AVAILABLE, so
--     inventory is never falsely locked. Touches ONLY reservations + unit
--     status. Converted/cancelled rows are skipped (status='active' filter).
-- (3) RELEASE is already shipped in Phase 1 (admin_cancel_reservation) — no
--     change; it sets 'cancelled' + unit -> AVAILABLE and frees the lock.
-- ============================================================================

-- ── 1. Convert prefill (admin) — guard before opening New Sale ──────────────
CREATE OR REPLACE FUNCTION public.convert_reservation_prefill(p_reservation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_res public.reservations; v_unit public.units;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;

  SELECT * INTO v_res FROM public.reservations
   WHERE id=p_reservation_id AND company_id=v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_res.status <> 'active' THEN
    RETURN jsonb_build_object('success',false,'error','not_active',
      'message','This reservation is '||v_res.status||' and can no longer be converted.'); END IF;

  SELECT * INTO v_unit FROM public.units WHERE id=v_res.unit_id AND company_id=v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','unit_not_found'); END IF;

  -- "already sold" guard: a live sale already exists on this unit
  IF EXISTS (SELECT 1 FROM public.sales
             WHERE unit_id=v_res.unit_id AND company_id=v_me.company_id AND status='active') THEN
    RETURN jsonb_build_object('success',false,'error','already_sold',
      'message','This unit already has an active sale — release this reservation instead.'); END IF;

  RETURN jsonb_build_object('success',true,'reservation', jsonb_build_object(
    'reservation_id', v_res.id, 'unit_id', v_res.unit_id, 'unit_no', v_unit.unit_no,
    'project_id', v_res.project_id, 'client_id', v_res.client_id,
    'client_name', v_res.client_name, 'client_phone', v_res.client_phone,
    'token_received', v_res.token_received, 'token_amount', v_res.token_amount));
END; $$;

-- ── 2. Mark converted (admin) — called after the sale is created ────────────
CREATE OR REPLACE FUNCTION public.mark_reservation_converted(p_reservation_id uuid, p_sale_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_res public.reservations;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;

  -- row-lock serialises any double-convert race; the status guard is the gate
  SELECT * INTO v_res FROM public.reservations
   WHERE id=p_reservation_id AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_res.status <> 'active' THEN
    RETURN jsonb_build_object('success',false,'error','not_active',
      'message','This reservation is already '||v_res.status||'.'); END IF;

  UPDATE public.reservations
    SET status='converted', converted_sale_id=p_sale_id, updated_at=now()
   WHERE id=p_reservation_id;
  RETURN jsonb_build_object('success',true);
END; $$;

-- ── 3. Auto-expiry cron (modelled on cron_expire_subscriptions) ─────────────
CREATE OR REPLACE FUNCTION public.cron_expire_reservations()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_res public.reservations%ROWTYPE; v_avail uuid; v_count int := 0;
BEGIN
  FOR v_res IN
    SELECT * FROM public.reservations
    WHERE status='active' AND expiry_date < now()
  LOOP
    UPDATE public.reservations SET status='expired', updated_at=now() WHERE id=v_res.id;
    -- return the unit to its project's AVAILABLE status (frees the lock for a new reservation)
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

-- ── 4. Grants + schedule ────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.convert_reservation_prefill(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_reservation_converted(uuid,uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.cron_expire_reservations() FROM anon, authenticated;

-- Hourly sweep (UTC), offset from the subscription cron. Idempotent + dedup-safe.
DO $$ BEGIN
  PERFORM cron.unschedule('expire-reservations');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'expire-reservations',
  '13 * * * *',
  $$ SET search_path = public; SELECT public.cron_expire_reservations(); $$
);

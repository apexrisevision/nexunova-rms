-- ─────────────────────────────────────────────────────────────────────────────
-- SALE APPROVAL: THE DIRECTOR SIGNS ON THE RESERVE DESK  (2026-10-13)
--
-- 20261013a put the whole SAF in the RMS. Rashid's refinement: the director's
-- approval belongs on his Reserve Desk (the reservation link and the CRM desk
-- tab), where he already decides every hold:
--
--   Accounts (RMS)          prepares and submits                 unchanged
--   Rashid (Reserve Desk)   approves = digital signature, or sends back
--   Filing (RMS)            prints + keeps the PDF, files, makes the sale
--
-- The desk gate is the one every reservation write already uses:
-- _may_authorize_reservation(session token). The signer is the CRM user
-- (sales_users), so the PDF reads "Approved by Rashid Manzoor".
--
-- The RMS's own approve / reject doors are dropped: one place to sign, so the
-- hierarchy cannot be gone around. The RMS owner/admin still SEES submitted and
-- approved forms, read-only.
--
-- The approved PDF is stored by Filing on first open (the desk has no RMS
-- storage session). The PDF is deterministic, so its fingerprint is the same
-- whoever draws it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. the signer is a desk (CRM) user ───────────────────────────────────────
ALTER TABLE public.sale_approval_forms
  ADD COLUMN IF NOT EXISTS approved_by_sales_user uuid REFERENCES public.sales_users(id),
  ADD COLUMN IF NOT EXISTS rejected_by_sales_user uuid REFERENCES public.sales_users(id);

-- ── 2. the RMS no longer signs ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.saf_approve(uuid);
DROP FUNCTION IF EXISTS public.saf_reject(uuid, text);

-- ── 3. who is at the desk ───────────────────────────────────────────────────
-- NULL unless the session may authorize a reservation AND its company has the
-- SAF switched on.
CREATE OR REPLACE FUNCTION public._saf_desk(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_su public.sales_users;
BEGIN
  IF NOT public._may_authorize_reservation(p_session_token) THEN RETURN NULL; END IF;
  SELECT su.* INTO v_su FROM public.sales_sessions ss JOIN public.sales_users su ON su.id = ss.sales_user_id
   WHERE ss.session_token = p_session_token AND ss.expires_at > now();
  IF v_su.id IS NULL OR NOT public._saf_on(v_su.company_id) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('sales_user_id', v_su.id, 'company_id', v_su.company_id, 'name', v_su.full_name);
END $$;

-- ── 4. the desk's doors ─────────────────────────────────────────────────────
-- what is waiting for the signature, and what was decided lately
CREATE OR REPLACE FUNCTION public.saf_desk_list(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_desk(p_session_token); v_co uuid;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  v_co := (c->>'company_id')::uuid;
  RETURN jsonb_build_object('success', true, 'me', c,
    'waiting', (SELECT count(*) FROM public.sale_approval_forms WHERE company_id = v_co AND status IN ('submitted','verified')),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'saf_no', f.saf_no, 'status', f.status, 'unit_code', f.unit_code, 'floor_label', f.floor_label,
               'buyer_name', f.buyer_name, 'agent_name', f.agent_name, 'net_price', f.net_price,
               'total_received', f.total_received, 'prepared_by_name', f.prepared_by_name,
               'submitted_at', f.submitted_at, 'approved_at', f.approved_at, 'rejected_at', f.rejected_at,
               'filed_at', f.filed_at, 'reject_reason', f.reject_reason,
               'sale_number', (SELECT s.sale_number FROM public.sales s WHERE s.id = f.sale_id),
               'flags', jsonb_array_length(public._saf_flags(to_jsonb(f))))
             ORDER BY (f.status IN ('submitted','verified')) DESC, COALESCE(f.submitted_at, f.updated_at) DESC)
        FROM public.sale_approval_forms f
       WHERE f.company_id = v_co
         AND (f.status IN ('submitted','verified')
              OR (f.status IN ('approved','rejected','superseded') AND f.updated_at > now() - interval '60 days'))), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.saf_desk_get(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_desk(p_session_token); v_status text;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT status INTO v_status FROM public.sale_approval_forms WHERE id = p_id AND company_id = (c->>'company_id')::uuid;
  IF v_status IS NULL OR v_status IN ('draft','cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id), 'me', c);
END $$;

-- approve = the digital signature. Unit and money must still be what Accounts
-- submitted; the whole form is sealed with its sha256.
CREATE OR REPLACE FUNCTION public.saf_desk_approve(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_desk(p_session_token); v_row public.sale_approval_forms;
        v_blk jsonb; v_m jsonb; v_snap jsonb; v_now timestamptz := now();
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status NOT IN ('submitted','verified') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_submitted',
      'message', 'Only a form Accounts has submitted can be approved. This one is ' || v_row.status || '.'); END IF;
  IF EXISTS (SELECT 1 FROM public.sales s WHERE s.unit_id = v_row.unit_id AND s.status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_sold', 'message', 'This unit already has an active sale.'); END IF;

  v_blk := public._saf_unit_block(v_row.unit_id);
  v_m   := public._saf_money(v_row.company_id, v_row.unit_code);
  IF (v_blk->>'base_price')::numeric IS DISTINCT FROM v_row.base_price
     OR (v_blk->>'area_sqft')::numeric IS DISTINCT FROM v_row.area_sqft THEN
    RETURN jsonb_build_object('success', false, 'error', 'unit_changed',
      'message', 'The unit''s price or area changed after Accounts submitted this form. Send it back so Accounts can make a new one.'); END IF;
  IF (v_m->>'total')::numeric IS DISTINCT FROM v_row.total_received OR v_m->'receipts' IS DISTINCT FROM v_row.receipts THEN
    RETURN jsonb_build_object('success', false, 'error', 'money_changed',
      'message', 'NexuFinance shows different money for this unit than Accounts submitted. Send it back so Accounts can check and resubmit.'); END IF;

  IF v_row.supersedes_id IS NOT NULL THEN
    UPDATE public.sale_approval_forms SET status = 'superseded', superseded_by = v_row.id, updated_at = v_now
     WHERE id = v_row.supersedes_id AND status IN ('approved','rejected') AND sale_id IS NULL;
  END IF;

  v_snap := (to_jsonb(v_row) || jsonb_build_object(
               'approved_by', NULL, 'approved_by_sales_user', c->>'sales_user_id',
               'approved_by_name', c->>'name', 'approved_at', v_now))
            - ARRAY['snapshot','snapshot_hash','pdf_sha256','pdf_path','sale_id','superseded_by','updated_at','status',
                    'filed_by','filed_by_name','filed_at'];
  UPDATE public.sale_approval_forms SET status = 'approved',
    approved_by = NULL, approved_by_sales_user = (c->>'sales_user_id')::uuid,
    approved_by_name = c->>'name', approved_at = v_now, updated_at = v_now,
    snapshot = v_snap, snapshot_hash = encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex')
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- send back to Accounts, with a reason
CREATE OR REPLACE FUNCTION public.saf_desk_reject(p_session_token text, p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_desk(p_session_token); v_row public.sale_approval_forms;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reason_required', 'message', 'Say why it is sent back.'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status NOT IN ('submitted','verified') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_submitted'); END IF;
  UPDATE public.sale_approval_forms SET status = 'rejected',
    rejected_by = NULL, rejected_by_sales_user = (c->>'sales_user_id')::uuid, rejected_by_name = c->>'name',
    rejected_at = now(), reject_reason = btrim(p_reason), updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- ── 5. who may call what ────────────────────────────────────────────────────
-- The desk runs on the anon key with a sales session token; the token is the
-- gate inside every door. Helpers stay closed.
REVOKE ALL ON FUNCTION public._saf_desk(text) FROM PUBLIC, anon, authenticated;
DO $g$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'saf\_desk\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
  END LOOP;
END
$g$;

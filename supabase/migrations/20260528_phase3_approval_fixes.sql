-- ================================================================
-- NEXUNOVA RMS — PHASE 3 APPROVAL WORKFLOW FIXES
-- Migration: 20260528_phase3_approval_fixes.sql  |  2026-05-28
-- ================================================================
-- Note: get_approval_history was audited and is CORRECT as-is.
--   It already handles request_id with an early-return path that
--   returns {request, comments} — no patch needed.
--
-- New RPC: cancel_approval_request
--   - Caller must be the original requester (requested_by)
--   - Only cancellable when status = 'pending'
--   - Sets status = 'cancelled', inserts cancellation comment
-- ================================================================

CREATE OR REPLACE FUNCTION public.cancel_approval_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me  public.app_users;
  v_req RECORD;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_session');
  END IF;

  SELECT id, company_id, requested_by, status
  INTO v_req
  FROM public.approval_requests
  WHERE id = p_request_id AND company_id = v_me.company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF v_req.requested_by != v_me.id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized',
      'message', 'Only the original requester can cancel this request.');
  END IF;

  IF v_req.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_cancellable',
      'message', 'Only pending requests can be cancelled.');
  END IF;

  UPDATE public.approval_requests
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.approval_request_comments (request_id, author_id, action, comment)
  VALUES (p_request_id, v_me.id, 'cancelled', 'Request cancelled by requester.');

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_approval_request(uuid) TO authenticated;

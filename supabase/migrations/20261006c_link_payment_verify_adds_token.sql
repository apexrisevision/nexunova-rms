-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-06c · Verifying a link payment adds it to the unit's hold token
--
-- Rashid, 2026-10-06: "ab jin jin units pe payments ya token received hain
-- unhe update karo" - and, asked what to update, chose: on Verify, add the
-- amount to the unit's standing hold (token received + amount), so T.R and
-- the Token Received report move at once. This REPLACES the earlier choice
-- (20261006a) that Verify is a mark only.
--
-- On Verify, inside the same transaction and under the hold's row lock:
--   · the unit's ACTIVE reservation gets token_received = true and
--     token_amount = its token + this receipt's amount;
--   · the receipt remembers which hold it was added to (applied_reservation_id,
--     applied_amount) so it is never added twice and can be traced;
--   · with no active hold on the unit, nothing is added - the receipt is still
--     verified, and the answer says so, so the desk can tell the director.
-- Reject adds nothing. The reservations audit trigger records the change, so
-- the unit trail shows "Token on the hold X -> Y".
--
-- Known consequence, accepted: until Accounts posts the same money in
-- NexuFinance, the Token Received report's reservations total will run ahead
-- of the books (its "difference" line).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.link_payment_receipts
  ADD COLUMN IF NOT EXISTS applied_reservation_id uuid REFERENCES public.reservations(id),
  ADD COLUMN IF NOT EXISTS applied_amount numeric(14,2);

CREATE OR REPLACE FUNCTION public.decide_link_payment(p_session_token text, p_id uuid, p_action text, p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_group uuid; v_companies uuid[];
        v_span boolean; v_row public.link_payment_receipts; v_act text;
        v_hold public.reservations; v_before numeric; v_after numeric;
BEGIN
  PERFORM public._rms_actor_session(p_session_token);
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF COALESCE(public._sales_role_of(p_session_token), '') <> 'director' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden',
      'message', 'Only a director can verify a payment from the link.'); END IF;
  v_act := lower(btrim(COALESCE(p_action, '')));
  IF v_act NOT IN ('verify', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_action'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;
  v_span := (v_group IS NOT NULL AND COALESCE(v_su.is_umbrella, false));
  IF v_span THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies WHERE dealer_group_id = v_group AND status = 'active';
  ELSE v_companies := ARRAY[v_ses.company_id]; END IF;

  SELECT * INTO v_row FROM public.link_payment_receipts
   WHERE id = p_id AND company_id = ANY (v_companies) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_decided', 'status', v_row.status,
      'message', 'That entry has already been ' || v_row.status || '.'); END IF;

  /* VERIFIED MONEY JOINS THE HOLD. The unit's standing hold is locked and its
     token raised by this amount; the receipt keeps which hold, so it can
     never be added twice. No standing hold, nothing to add to. */
  IF v_act = 'verify' AND v_row.applied_reservation_id IS NULL THEN
    SELECT * INTO v_hold FROM public.reservations
     WHERE unit_id = v_row.unit_id AND status = 'active'
     ORDER BY created_at DESC LIMIT 1
     FOR UPDATE;
    IF FOUND THEN
      v_before := COALESCE(v_hold.token_amount, 0);
      v_after  := v_before + v_row.amount;
      UPDATE public.reservations
         SET token_received = true, token_amount = v_after, updated_at = now()
       WHERE id = v_hold.id;
    END IF;
  END IF;

  UPDATE public.link_payment_receipts
     SET status = CASE v_act WHEN 'verify' THEN 'verified' ELSE 'rejected' END,
         decided_by = v_ses.sales_user_id, decided_by_name = v_su.full_name, decided_at = now(),
         decision_note = NULLIF(left(btrim(COALESCE(p_note, '')), 300), ''),
         applied_reservation_id = CASE WHEN v_hold.id IS NOT NULL THEN v_hold.id ELSE applied_reservation_id END,
         applied_amount = CASE WHEN v_hold.id IS NOT NULL THEN v_row.amount ELSE applied_amount END
   WHERE id = v_row.id
   RETURNING * INTO v_row;
  RETURN jsonb_build_object('success', true, 'status', v_row.status, 'ref', v_row.ref,
                            'decided_by', v_row.decided_by_name, 'decided_at', v_row.decided_at,
                            'hold_updated', v_hold.id IS NOT NULL,
                            'hold_token_before', v_before, 'hold_token_after', v_after,
                            'held_by', v_hold.requested_by_name);
END
$function$;

REVOKE ALL ON FUNCTION public.decide_link_payment(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_link_payment(text, uuid, text, text) TO anon, authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-09-29d · get_unallocated_tokens_desk says, in itself, who it answers
--
-- No change in behaviour. The body is identical to 20260929c; only a comment
-- inside it and a COMMENT ON FUNCTION are added, so whoever reads the function
-- next — in the repo or in the live database — learns that access is pinned
-- to ONE USER ID, not to a role.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_unallocated_tokens_desk(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_co uuid;
BEGIN
  /* ACCESS IS PINNED TO ONE USER ID, NOT TO A ROLE.
     _may_authorize_reservation answers true for exactly one sales_users.id —
     Rashid Manzoor, 015effd0-7ac7-4939-a1b3-dd2826ab8fba — plus the internal
     ZZTEST tenant so the suites can run. Being a director does NOT grant it.
     Giving another person access is a CODE CHANGE to
     _may_authorize_reservation (which also governs who may reserve), not a
     settings or role change. A NULL, expired, unknown or other user's
     session gets 'forbidden' with no amounts and no names.
     Every row's reason is the NexuFinance voucher memo, read live — never
     typed twice, so correcting the memo corrects the desk. */
  IF NOT public._may_authorize_reservation(p_session_token) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  SELECT company_id INTO v_co FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF v_co IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  RETURN jsonb_build_object('success', true) || public._nf_unallocated_tokens_body(v_co);
END
$function$;

COMMENT ON FUNCTION public.get_unallocated_tokens_desk(text) IS
  'Reserve Desk reader for NexuFinance 21150 (token money not allocated to a unit). '
  'ACCESS IS PINNED TO ONE USER ID (Rashid Manzoor, sales_users 015effd0-7ac7-4939-a1b3-dd2826ab8fba) '
  'via _may_authorize_reservation, not to a role: another director gets forbidden. '
  'Granting anyone else is a code change to _may_authorize_reservation, not a settings change. '
  'Reasons are the live voucher memos. Reads through _nf_unallocated_tokens_body, shared with '
  'nf_unallocated_tokens; scripts/verify-unallocated-tokens.js fails if the two ever differ.';

-- grants unchanged by CREATE OR REPLACE; restated so the file stands alone
REVOKE ALL ON FUNCTION public.get_unallocated_tokens_desk(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unallocated_tokens_desk(text) TO anon, authenticated;

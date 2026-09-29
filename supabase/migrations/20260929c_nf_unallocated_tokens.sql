-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance · 2026-09-29c · Token money NOT allocated to a unit (21150)
--
-- 21150 "Token Money - Not Allocated" holds token money that is deliberately
-- NOT against a live unit booking (a resale whose first buyer is unsettled,
-- units missing from the list, a buyer not yet named). 21100 stays equal to
-- sum(reservations.token_amount) for active, received reservations; this
-- account is everything else. Nothing here writes — three read-only
-- functions, no table, no data change, no placeholder unit, nothing put on a
-- reservation.
--
-- ONE READER, TWO DOORS. The legs are read in exactly one place,
-- _nf_unallocated_tokens_body, so the NexuFinance screen and the Reserve Desk
-- cannot quietly disagree: a filter added there reaches both.
--   nf_unallocated_tokens(company)           NexuFinance app — Supabase login,
--                                             nf_require_role, authenticated only.
--   get_unallocated_tokens_desk(session)     Sales Portal — phone+PIN session,
--                                             so it reaches the database as anon.
--                                             Answers ONLY a session that may
--                                             authorise a reservation
--                                             (_may_authorize_reservation:
--                                             Rashid, and ZZTEST for the suites).
--                                             Everyone else gets 'forbidden' and
--                                             no amounts, no names.
-- The standing check scripts/verify-unallocated-tokens.js calls both and
-- fails if their totals or rows differ, or if a rep session gets anything.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._nf_unallocated_tokens_body(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH legs AS (
    SELECT l.party_id, pt.name AS party_name, l.memo,
           COALESCE(l.credit, 0) - COALESCE(l.debit, 0) AS amt, v.voucher_date
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
     WHERE l.company_id = p_company_id
       AND l.account_code = '21150'
       AND v.status = 'POSTED'
  ), parties AS (
    SELECT party_id, COALESCE(max(party_name), '(no party)') AS name,
           sum(amt) AS amount,
           string_agg(DISTINCT NULLIF(TRIM(memo), ''), '; ') AS reason,
           max(voucher_date) AS last_date
      FROM legs
     GROUP BY party_id
  )
  SELECT jsonb_build_object(
    'account', '21150',
    'total', (SELECT COALESCE(sum(amt), 0) FROM legs),
    'parties', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'name', name, 'amount', amount, 'reason', reason, 'last_date', last_date)
                 ORDER BY amount DESC, name)
                 FROM parties WHERE amount <> 0), '[]'::jsonb));
$function$;

REVOKE ALL ON FUNCTION public._nf_unallocated_tokens_body(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.nf_unallocated_tokens(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  RETURN public._nf_unallocated_tokens_body(p_company_id);
END
$function$;

REVOKE ALL ON FUNCTION public.nf_unallocated_tokens(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nf_unallocated_tokens(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.nf_unallocated_tokens(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_unallocated_tokens_desk(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_co uuid;
BEGIN
  IF NOT public._may_authorize_reservation(p_session_token) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  SELECT company_id INTO v_co FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF v_co IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  RETURN jsonb_build_object('success', true) || public._nf_unallocated_tokens_body(v_co);
END
$function$;

-- the portal has no Supabase login: its calls arrive as anon, and the session
-- token plus _may_authorize_reservation is the gate, as on every desk RPC
REVOKE ALL ON FUNCTION public.get_unallocated_tokens_desk(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unallocated_tokens_desk(text) TO anon, authenticated;

COMMIT;

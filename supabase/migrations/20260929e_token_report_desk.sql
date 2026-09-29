-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-09-29e · Reserve Desk "Token Received" report
--
-- Read-only. No table, no data change, no placeholder unit.
--
-- get_token_report_desk(session) — same door and same gate as
-- get_unallocated_tokens_desk: the portal reaches the DB as anon, so the
-- session token is the gate, and _may_authorize_reservation pins it to ONE
-- USER ID (Rashid), not to a role. Everyone else: 'forbidden', no amounts,
-- no names.
--
-- NexuFinance reads live in ONE internal function, _nf_money_position_body,
-- and the 21150 figure is taken from _nf_unallocated_tokens_body — the very
-- function the "Other — not allocated" block reads — so the two can never
-- disagree. scripts/verify-unallocated-tokens.js checks both.
--
-- Four blocks:
--  1 agree     reservations (active, token_received) vs NF 21100, their
--              difference (shown even at 0), 21150, total held
--  2 received  one row per unit with a received token, largest first
--  3 missing   units off the market (status not available) with no received
--              token; each says whether a reservation is active, ended, or
--              never existed
--  4 money     cash, bank, in hand; received and paid to date on the cash and
--              bank accounts, EXCLUDING vouchers whose every leg is a cash or
--              bank account (our own transfers — e.g. the 13,140,000 deposit)
--
-- Units are the session's project (as the desk). NexuFinance keeps one book
-- per COMPANY; 'company_projects' is returned so the screen can say so when a
-- company ever has more than one project.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._nf_money_position_body(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH cb AS (                -- the cash and bank accounts
    SELECT a.code, (COALESCE(a.via, '') = 'Bank') AS is_bank
      FROM public.nf_accounts a
     WHERE a.company_id = p_company_id AND a.qb_type = 'Bank'
  ), legs AS (
    SELECT l.voucher_id, l.account_code,
           COALESCE(l.debit, 0) AS dr, COALESCE(l.credit, 0) AS cr
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id AND v.status = 'POSTED'
  ), own AS (                 -- every leg is cash/bank: money moved between our own accounts
    SELECT voucher_id FROM legs
     GROUP BY voucher_id
    HAVING bool_and(account_code IN (SELECT code FROM cb))
  )
  SELECT jsonb_build_object(
    't21100',   (SELECT COALESCE(sum(cr - dr), 0) FROM legs WHERE account_code = '21100'),
    'cash',     (SELECT COALESCE(sum(dr - cr), 0) FROM legs l JOIN cb ON cb.code = l.account_code AND NOT cb.is_bank),
    'bank',     (SELECT COALESCE(sum(dr - cr), 0) FROM legs l JOIN cb ON cb.code = l.account_code AND cb.is_bank),
    'in_hand',  (SELECT COALESCE(sum(dr - cr), 0) FROM legs l JOIN cb ON cb.code = l.account_code),
    'received', (SELECT COALESCE(sum(dr), 0) FROM legs l JOIN cb ON cb.code = l.account_code
                  WHERE l.voucher_id NOT IN (SELECT voucher_id FROM own)),
    'paid',     (SELECT COALESCE(sum(cr), 0) FROM legs l JOIN cb ON cb.code = l.account_code
                  WHERE l.voucher_id NOT IN (SELECT voucher_id FROM own)),
    'own_transfers', (SELECT count(*) FROM own));
$function$;

REVOKE ALL ON FUNCTION public._nf_money_position_body(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_token_report_desk(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER   -- builds a temp table; reads only
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_ses public.sales_sessions; v_pr uuid; v_pname text; v_nprojects int;
        v_nf jsonb; v_un jsonb; v_res numeric; v_recv jsonb; v_miss jsonb;
        v_no_active int; v_never int;
BEGIN
  /* ACCESS IS PINNED TO ONE USER ID, NOT TO A ROLE — see
     get_unallocated_tokens_desk. Giving anyone else this report is a code
     change to _may_authorize_reservation, not a settings change. */
  IF NOT public._may_authorize_reservation(p_session_token) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;

  -- the desk's own rule for which project: the session's, else the company's first
  v_pr := v_ses.project_id;
  IF v_pr IS NULL THEN
    SELECT p.id INTO v_pr FROM public.projects p
     WHERE p.company_id = v_ses.company_id ORDER BY p.project_name LIMIT 1;
  END IF;
  SELECT project_name INTO v_pname FROM public.projects WHERE id = v_pr;
  SELECT count(*) INTO v_nprojects FROM public.projects WHERE company_id = v_ses.company_id;

  v_nf := public._nf_money_position_body(v_ses.company_id);
  v_un := public._nf_unallocated_tokens_body(v_ses.company_id);

  CREATE TEMP TABLE _tr ON COMMIT DROP AS
  SELECT u.id, u.unit_no,
         COALESCE(NULLIF(u.floor_label, ''), 'Floor ' || COALESCE(u.floor_no::text, '-')) AS floor,
         COALESCE(f.sort_order, u.floor_no, 999) AS fsort,
         COALESCE(NULLIF(substring(u.unit_no FROM '([0-9]+)$'), '')::int, 0) AS nsort,
         cs.status_name AS status, COALESCE(cs.is_available, false) AS free,
         u.base_price AS price,
         r.id AS rid, r.client_name AS buyer,
         COALESCE(NULLIF(TRIM(r.requested_by_name), ''), su.full_name) AS sold_by,
         CASE WHEN r.token_received AND COALESCE(r.token_amount, 0) > 0
              THEN r.token_amount ELSE 0 END AS token,
         EXISTS (SELECT 1 FROM public.reservations x WHERE x.unit_id = u.id) AS ever
    FROM public.units u
    LEFT JOIN public.floors f ON f.id = u.floor_id
    LEFT JOIN public.category_unit_statuses cs ON cs.id = u.status_id
    LEFT JOIN LATERAL (
      SELECT r2.* FROM public.reservations r2
       WHERE r2.unit_id = u.id AND r2.status = 'active'
       ORDER BY r2.created_at DESC LIMIT 1) r ON true
    LEFT JOIN public.sales_users su ON su.id = r.requested_by_sales_user_id
   WHERE u.project_id = v_pr;

  -- block 1's reservation side counts every active received token in the
  -- project, not only the newest per unit, so it is the invariant as defined
  SELECT COALESCE(sum(r.token_amount), 0) INTO v_res
    FROM public.reservations r JOIN public.units u ON u.id = r.unit_id
   WHERE u.project_id = v_pr AND r.status = 'active' AND r.token_received;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit', unit_no, 'floor', floor, 'status', status, 'buyer', buyer,
           'sold_by', sold_by, 'token', token, 'price', price)
         ORDER BY token DESC, fsort, nsort, unit_no), '[]'::jsonb)
    INTO v_recv FROM _tr WHERE token > 0;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit', unit_no, 'floor', floor, 'status', status, 'sold_by', sold_by,
           'price', price,
           'reservation', CASE WHEN rid IS NOT NULL THEN 'active'
                               WHEN ever THEN 'ended' ELSE 'none' END)
         ORDER BY fsort, nsort, unit_no), '[]'::jsonb),
         count(*) FILTER (WHERE rid IS NULL),
         count(*) FILTER (WHERE rid IS NULL AND NOT ever)
    INTO v_miss, v_no_active, v_never
    FROM _tr WHERE NOT free AND token = 0;

  DROP TABLE IF EXISTS _tr;

  RETURN jsonb_build_object(
    'success', true,
    'project', v_pname, 'company_projects', v_nprojects, 'as_of', now(),
    'agree', jsonb_build_object(
       'reservations', v_res,
       'nf_21100',     v_nf->'t21100',
       'difference',   v_res - (v_nf->>'t21100')::numeric,
       'nf_21150',     v_un->'total',
       'total_held',   (v_nf->>'t21100')::numeric + (v_un->>'total')::numeric),
    'received', jsonb_build_object(
       'rows', v_recv, 'count', jsonb_array_length(v_recv),
       'total', (SELECT COALESCE(sum((x->>'token')::numeric), 0) FROM jsonb_array_elements(v_recv) x)),
    'missing', jsonb_build_object(
       'rows', v_miss, 'count', jsonb_array_length(v_miss),
       'no_active_reservation', v_no_active, 'never_reserved', v_never),
    'money', v_nf - 't21100');
END
$function$;

COMMENT ON FUNCTION public.get_token_report_desk(text) IS
  'Reserve Desk Token Received report. ACCESS IS PINNED TO ONE USER ID (Rashid Manzoor, '
  'sales_users 015effd0-7ac7-4939-a1b3-dd2826ab8fba) via _may_authorize_reservation, not to a role. '
  'NexuFinance figures come from _nf_money_position_body and _nf_unallocated_tokens_body (shared '
  'with the not-allocated block); scripts/verify-unallocated-tokens.js checks they agree.';

REVOKE ALL ON FUNCTION public.get_token_report_desk(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_token_report_desk(text) TO anon, authenticated;

COMMIT;

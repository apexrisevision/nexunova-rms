-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19o · Journal vouchers —
-- the entry path for everything that is not a cash movement
--
-- NOT YET APPLIED — awaiting explicit go-ahead. Creates three new functions;
-- changes nothing that exists.
--
-- Why this exists (docs/PLAN.md §32.1, found by driving the real workflow):
-- the daily-closing screen can only produce a two-leg voucher with one
-- Cash/Petty/Bank leg. Measured against the real book that leaves two shapes
-- with no entry path at all — a cost paid on Awami's behalf by FMH, KBH or a
-- director (ALL 64 real imported vouchers are this shape; not one has a
-- cash/bank leg) and a voucher with more than two legs (7 of 64, up to 10).
-- Part B of the blueprint calls the first of those the very reason a
-- single-entry cash book cannot serve this business.
--
-- The engine for it already existed and was already correct:
-- nf_post_voucher takes N legs, requires ≥2, refuses an unbalanced voucher
-- before writing anything, checks the caller's role, and takes p_day_id as
-- NULL. It simply had no caller other than the history import. These three
-- functions are the safe, named surface a screen can use.
--
--   nf_jv_save    create a journal voucher. Forces p_day_id NULL, so a JV can
--                 never attach itself to a daily closing and disturb the cash
--                 sheet or the director report — the nf_lines view the sheet
--                 reads already excludes no-via vouchers, and this keeps that
--                 true by construction rather than by luck. Refuses the four
--                 cash-book prefixes (CRV/BRV/CPV/BPV) so a journal voucher
--                 can never masquerade as a cash voucher in the journal.
--   nf_jv_list    read them back with their legs, newest first, plus the next
--                 free JV-#### so the screen can suggest a number.
--   nf_jv_delete  remove one. Carries the SAME export lock as nf_delete_line
--                 (20260919k): once a voucher is in QuickBooks it cannot be
--                 deleted here, because IIF cannot push the correction — the
--                 right action is a new correcting voucher.
--
-- There is deliberately no EDIT. Part C: "corrections are new entries or
-- explicitly logged edits, never silent overwrites." Re-shaping a multi-leg
-- voucher in place is the easiest way to lose an audit trail; delete (which
-- the audit trigger records in full) and re-post is the honest path.
--
-- Grants locked to `authenticated` from the first version, per the standing
-- rule, and no new tables — so nothing for SEC-TABLE-* to catch.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── create ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nf_jv_save(
  p_company_id uuid, p_voucher_no text, p_voucher_date date, p_narration text, p_legs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key   text := upper(btrim(COALESCE(p_voucher_no, '')));
  v_id    uuid;
  v_leg   jsonb;
  v_legs  jsonb := '[]'::jsonb;
  v_name  text;
  v_party uuid;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  -- A journal voucher must not look like a cash-book voucher. The daily sheet
  -- owns those four prefixes and enforces them in nf_save_line; claiming one
  -- here would put a non-cash entry under a cash voucher number.
  IF v_key ~ '^(CRV|BRV|CPV|BPV)-' THEN
    RAISE EXCEPTION 'NF:VOUCHER_PREFIX_IS_CASHBOOK' USING DETAIL = v_key;
  END IF;

  -- nf_post_voucher takes a party_id; the screen only knows the NAME the
  -- person picked or typed. Resolve each leg the same way nf_save_line
  -- already does (exact match after normalising, else create) so the
  -- search-first field's "add new" path produces a real party-master record
  -- here too, not a second way of spelling one. A leg that already carries a
  -- party_id is left exactly as it is.
  IF p_legs IS NOT NULL AND jsonb_typeof(p_legs) = 'array' THEN
    FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
      v_name := NULLIF(btrim(v_leg->>'party_name'), '');
      IF v_name IS NOT NULL AND NULLIF(v_leg->>'party_id', '') IS NULL THEN
        v_party := public.nf_resolve_party(p_company_id, v_name);
        IF v_party IS NULL THEN
          v_party := (public.nf_create_party(p_company_id, v_name, 'customer')->>'id')::uuid;
        END IF;
        v_leg := (v_leg - 'party_name') || jsonb_build_object('party_id', v_party::text);
      ELSE
        v_leg := v_leg - 'party_name';
      END IF;
      v_legs := v_legs || jsonb_build_array(v_leg);
    END LOOP;
  ELSE
    v_legs := p_legs;
  END IF;

  -- p_day_id is NULL, always and deliberately: see the header.
  v_id := public.nf_post_voucher(p_company_id, NULL, p_voucher_no, p_voucher_date, p_narration, 0, v_legs);

  RETURN (SELECT jsonb_build_object(
            'id', v.id, 'voucher_no', v.voucher_no, 'voucher_date', v.voucher_date,
            'narration', v.narration, 'status', v.status,
            'legs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'line_no', l.line_no, 'account_code', l.account_code, 'account_name', a.name,
                       'floor_code', l.floor_code, 'party', pt.name, 'party_id', l.party_id,
                       'debit', l.debit, 'credit', l.credit, 'memo', l.memo) ORDER BY l.line_no)
                     FROM public.nf_voucher_legs l
                     JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
                     LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
                    WHERE l.voucher_id = v.id), '[]'::jsonb))
            FROM public.nf_vouchers v WHERE v.id = v_id);
END
$function$;

-- ── read ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nf_jv_list(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_next integer;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  -- next free JV-#### — the screen suggests it; the unique index is still the
  -- thing that actually decides, so a race just gets NF:DUPLICATE_VOUCHER.
  SELECT COALESCE(max(NULLIF(regexp_replace(voucher_key, '^JV-', ''), '')::integer), 0) + 1
    INTO v_next
    FROM public.nf_vouchers
   WHERE company_id = p_company_id AND voucher_key ~ '^JV-[0-9]+$';

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'next_voucher_no', 'JV-' || lpad(v_next::text, 4, '0'),
    'vouchers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'voucher_no', v.voucher_no, 'voucher_date', v.voucher_date,
               'narration', v.narration,
               'exported', EXISTS (SELECT 1 FROM public.nf_iif_batch_vouchers b WHERE b.voucher_id = v.id),
               'total', (SELECT COALESCE(sum(l.debit), 0) FROM public.nf_voucher_legs l WHERE l.voucher_id = v.id),
               'legs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'line_no', l.line_no, 'account_code', l.account_code, 'account_name', a.name,
                          'floor_code', l.floor_code, 'party', pt.name,
                          'debit', l.debit, 'credit', l.credit, 'memo', l.memo) ORDER BY l.line_no)
                        FROM public.nf_voucher_legs l
                        JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
                        LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
                       WHERE l.voucher_id = v.id), '[]'::jsonb))
             ORDER BY v.voucher_date DESC, v.voucher_no DESC)
        FROM public.nf_vouchers v
       WHERE v.company_id = p_company_id AND v.day_id IS NULL AND v.status = 'POSTED'
         AND (p_from IS NULL OR v.voucher_date >= p_from)
         AND (p_to   IS NULL OR v.voucher_date <= p_to)), '[]'::jsonb));
END
$function$;

-- ── delete ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nf_jv_delete(p_voucher_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voucher public.nf_vouchers;
  v_exported_at timestamptz;
BEGIN
  SELECT * INTO v_voucher FROM public.nf_vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(v_voucher.company_id, ARRAY['accountant','director']);
  -- a daily-closing line is not this function's business; it has its own path
  -- with its own day-locked guard
  IF v_voucher.day_id IS NOT NULL THEN RAISE EXCEPTION 'NF:NOT_A_JOURNAL_VOUCHER'; END IF;

  SELECT b.exported_at INTO v_exported_at FROM public.nf_iif_batch_vouchers b
   WHERE b.voucher_id = v_voucher.id ORDER BY b.exported_at DESC LIMIT 1;
  IF v_exported_at IS NOT NULL THEN
    RAISE EXCEPTION 'NF:VOUCHER_ALREADY_EXPORTED'
      USING DETAIL = json_build_object('voucher', v_voucher.voucher_no, 'exported_at', v_exported_at)::text;
  END IF;

  DELETE FROM public.nf_voucher_legs WHERE voucher_id = v_voucher.id;
  DELETE FROM public.nf_vouchers WHERE id = v_voucher.id;
  RETURN jsonb_build_object('deleted', v_voucher.voucher_no);
END
$function$;

REVOKE ALL ON FUNCTION public.nf_jv_save(uuid, text, date, text, jsonb)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_jv_list(uuid, date, date)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_jv_delete(uuid)                          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_jv_save(uuid, text, date, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_jv_list(uuid, date, date)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_jv_delete(uuid)                        TO authenticated;

COMMIT;

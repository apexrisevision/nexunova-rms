-- ─────────────────────────────────────────────────────────────────────────
-- NexuFinance — Stage A of the voucher-popup work (owner, 2026-09-21).
-- docs/PLAN.md §44.
--
-- 1. The CASH COUNT is removed ("cash count portion hatao, no need of
--    that").
--    - nf_checks no longer reports "not counted" or "short/over", so neither
--      blocks Submit or Close day any more.
--    - nf_save_count now refuses, so nothing can write a count through a side
--      door.
--    - The columns (denominations, counted_cash, variance) stay: dropping
--      them would rewrite closed history for no gain. A day with no count has
--      NULL there, so nf_days_guard computes variance = NULL on close
--      (nf_count_total(NULL) is NULL) and the audit row says CLOSE, not
--      CLOSE_WITH_VARIANCE.
--
-- 2. Every voucher carries TWO numbers (owner, 2026-09-21: "har voucher ko
--    system generated number milna chahiye ... taakay ham osay jab zaroorat
--    ho retrieve kar sakain. Aur aik number hai manual."):
--
--    SYSTEM number, in nf_vouchers.voucher_no:
--    - Given by NexuFinance the moment a line is saved: CRV-000001,
--      BRV-000001, CPV-000001, BPV-000001, one sequence per type per
--      company (nf_voucher_counters).
--    - Never typed, never changed, never reused (the counter only ever goes
--      up; a deleted voucher leaves a gap).
--    - The number embeds the type, so a saved line cannot move between types
--      (Cash↔Bank, receipt↔payment): NF:VOUCHER_TYPE_FIXED. Delete and
--      re-enter it instead. Cash↔Petty stays within CRV/CPV and is allowed.
--
--    MANUAL number, in nf_vouchers.manual_no (new):
--    - The number on the paper voucher. Written in any form ("CPV-117" or
--      "117"), stored trimmed and in capitals, never repeated within its
--      type (NF:DUPLICATE_VOUCHER, same code and wording as before).
--    - Optional when the line is saved, because the closing is made before
--      the paper voucher is written.
--    - Compulsory before the day closes: nf_days_numbers_guard refuses the
--      transition to CLOSED while any receipt/payment of the day has none
--      (NF:VOUCHER_NUMBERS_PENDING, with the list in DETAIL). A trigger, not
--      a check inside nf_close_day, so no path around it exists. Submit is
--      NOT blocked: the owner's rule is about closing.
--    - It is the DOCNUM QuickBooks receives (scripts/nf/iif-export.js);
--      owner, 2026-09-21: "manual DOCNUM mai".
--
--    nf_save_line keeps its exact argument list: p_voucher_no now carries the
--    MANUAL number (blank = not written yet). Existing day vouchers had their
--    typed number as their only number; it becomes their manual number, and
--    stays their system number too. Live Awami has no day vouchers (its 64
--    are imported history, source IMPORT, untouched).
--
-- nf_save_line, nf_checks, nf_save_count, nf_day_json and nf_get_report keep
-- their argument lists, so CREATE OR REPLACE keeps their grants and leaves no
-- stale overload. The new functions and the new table are REVOKEd from
-- PUBLIC/anon/authenticated. A fresh table in this project is otherwise
-- created with RLS off and full anon grants — a different hole class from
-- function EXECUTE, closed here explicitly.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- deferred constraint triggers on nf_vouchers would otherwise refuse the
-- ALTER with 55006 (found the hard way in 20260920a)
SET CONSTRAINTS ALL IMMEDIATE;

-- ═════════════════════════════════════════════════════════════════════════
-- 1 · the cash count
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.nf_checks(p_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d public.nf_days;
  r record;
  out jsonb := '[]'::jsonb;
  v_label text; v_close numeric;
BEGIN
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  SELECT * INTO r FROM public.nf_position_row(p_day_id);

  FOR v_label, v_close IN
    SELECT a.via_label, CASE a.via WHEN 'Cash' THEN r.close_cash WHEN 'Petty' THEN r.close_petty ELSE r.close_bank END
      FROM public.nf_accounts a
     WHERE a.company_id = d.company_id AND a.via IS NOT NULL
     ORDER BY CASE a.via WHEN 'Cash' THEN 1 WHEN 'Petty' THEN 2 ELSE 3 END
  LOOP
    IF v_close < 0 THEN
      out := out || jsonb_build_object('key', 'negative', 'text',
        format('%s is negative by Rs %s. A payment cannot exceed the money available.', v_label, public.nf_fmt(-v_close)));
    END IF;
  END LOOP;

  -- The two cash-count checks that used to follow were removed on
  -- 2026-09-21 with the count itself (docs/PLAN.md §44).
  RETURN out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_save_count(p_day_id uuid, p_denoms jsonb, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- The cash count was removed (docs/PLAN.md §44). Refuse rather than store
  -- a figure nothing reads any more.
  RAISE EXCEPTION 'NF:CASH_COUNT_REMOVED';
END
$function$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2 · two numbers per voucher
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public.nf_vouchers ADD COLUMN IF NOT EXISTS manual_no text;
ALTER TABLE public.nf_vouchers DROP CONSTRAINT IF EXISTS nf_vouchers_manual_no_shape;
ALTER TABLE public.nf_vouchers ADD CONSTRAINT nf_vouchers_manual_no_shape
  CHECK (manual_no IS NULL OR (manual_no = upper(btrim(manual_no)) AND manual_no <> ''));
COMMENT ON COLUMN public.nf_vouchers.manual_no IS
  'The number written on the paper voucher. voucher_no is the SYSTEM number. May be NULL while the day is open; the day cannot close with a receipt/payment lacking one (nf_days_numbers_guard). Never repeated within a type. It is the IIF DOCNUM. docs/PLAN.md §44.';

-- existing day receipts/payments: their typed number was their only number,
-- and it was the paper number — it becomes the manual number as well
UPDATE public.nf_vouchers
   SET manual_no = upper(btrim(voucher_no))
 WHERE manual_no IS NULL AND day_id IS NOT NULL
   AND upper(split_part(voucher_no, '-', 1)) IN ('CRV','BRV','CPV','BPV');

DROP INDEX IF EXISTS public.nf_vouchers_manual_unique;
CREATE UNIQUE INDEX nf_vouchers_manual_unique
  ON public.nf_vouchers (company_id, upper(split_part(voucher_no, '-', 1)), manual_no)
  WHERE manual_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.nf_voucher_counters (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vtype      text NOT NULL CHECK (vtype IN ('CRV','BRV','CPV','BPV','JV')),
  last_no    integer NOT NULL DEFAULT 0 CHECK (last_no >= 0),
  PRIMARY KEY (company_id, vtype)
);
COMMENT ON TABLE public.nf_voucher_counters IS
  'The last SYSTEM voucher number given per type per company. Only ever incremented, by nf__next_voucher_no. docs/PLAN.md §44.';
ALTER TABLE public.nf_voucher_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nf_voucher_counters FROM PUBLIC, anon, authenticated;

-- The next system number of a type. The counter row is locked by the UPSERT
-- until the caller's transaction ends, so two saves at once get two numbers.
-- Skips any number that already exists (e.g. one typed by hand before this
-- scheme), so it can never collide.
CREATE OR REPLACE FUNCTION public.nf__next_voucher_no(p_company_id uuid, p_type text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n integer; v_no text;
BEGIN
  LOOP
    INSERT INTO public.nf_voucher_counters (company_id, vtype, last_no) VALUES (p_company_id, p_type, 1)
    ON CONFLICT (company_id, vtype) DO UPDATE SET last_no = public.nf_voucher_counters.last_no + 1
    RETURNING last_no INTO v_n;
    v_no := p_type || '-' || lpad(v_n::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.nf_vouchers WHERE company_id = p_company_id AND voucher_key = v_no);
  END LOOP;
  RETURN v_no;
END
$function$;
REVOKE ALL ON FUNCTION public.nf__next_voucher_no(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.nf_save_line(p_day_id uuid, p_line_id uuid, p_side text, p_voucher_no text, p_description text, p_head text, p_floor text, p_via text, p_amount numeric, p_version integer, p_party_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  v_via_code text;
  v_type text;
  v_manual text := upper(btrim(COALESCE(p_voucher_no, '')));
  v_system text;
  v_existing_head public.nf_voucher_legs;
  v_existing_via  public.nf_voucher_legs;
  v_voucher public.nf_vouchers;
  v_new_id uuid;
  v_bdate date;
  v_sort integer;
  v_party_id uuid;
  v_requires_party boolean;
  v_exported_at timestamptz;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  IF p_side IS NULL OR p_side NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'NF:SIDE_REQUIRED'; END IF;
  IF p_head  IS NULL OR btrim(p_head)  = '' THEN RAISE EXCEPTION 'NF:HEAD_REQUIRED';  END IF;
  IF p_floor IS NULL OR btrim(p_floor) = '' THEN RAISE EXCEPTION 'NF:FLOOR_REQUIRED'; END IF;
  IF p_via   IS NULL OR btrim(p_via)   = '' THEN RAISE EXCEPTION 'NF:VIA_REQUIRED';   END IF;
  IF p_via NOT IN ('Cash','Petty','Bank') THEN RAISE EXCEPTION 'NF:VIA_UNKNOWN' USING DETAIL = p_via; END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;

  -- The voucher's TYPE follows from its side and via; the system number
  -- carries it. p_voucher_no is the MANUAL (paper) number: blank, or only
  -- the type prefix the screen pre-fills ("CPV-"), means not written yet.
  v_type := CASE WHEN p_side = 'IN' THEN CASE WHEN p_via = 'Bank' THEN 'BRV' ELSE 'CRV' END
                 ELSE CASE WHEN p_via = 'Bank' THEN 'BPV' ELSE 'CPV' END END;
  IF v_manual = '' OR v_manual ~ '^(CRV|BRV|CPV|BPV)-?$' THEN v_manual := NULL; END IF;

  SELECT requires_party INTO v_requires_party FROM public.nf_accounts WHERE company_id = v_company AND code = btrim(p_head);
  IF NULLIF(btrim(p_party_name), '') IS NOT NULL THEN
    -- an explicit, deliberate choice — resolve an existing party by name/
    -- alias, or create a new one. Applies whether or not the head actually
    -- requires a party: a caller that bothered to pass one meant it.
    v_party_id := public.nf_resolve_party(v_company, p_party_name);
    IF v_party_id IS NULL THEN
      v_party_id := (public.nf_create_party(v_company, p_party_name, 'customer')->>'id')::uuid;
    END IF;
  ELSIF v_requires_party AND NULLIF(btrim(p_description), '') IS NOT NULL THEN
    -- no explicit name — match the description against something already
    -- registered, never mint a new party from unattended free text (see
    -- header). NULL here just means NF:PARTY_REQUIRED fires below, same as
    -- if no description had been typed at all.
    v_party_id := public.nf_resolve_party(v_company, p_description);
  END IF;

  SELECT a.code INTO v_via_code FROM public.nf_accounts a WHERE a.company_id = v_company AND a.via = p_via;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VIA_NOT_CONFIGURED' USING DETAIL = p_via; END IF;

  SELECT business_date INTO v_bdate FROM public.nf_days WHERE id = p_day_id;

  IF p_line_id IS NOT NULL THEN
    SELECT * INTO v_existing_head FROM public.nf_voucher_legs WHERE id = p_line_id AND line_no = 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
    SELECT * INTO v_voucher FROM public.nf_vouchers WHERE id = v_existing_head.voucher_id AND day_id = p_day_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
    -- the system number is permanent and names the type
    IF upper(split_part(v_voucher.voucher_no, '-', 1)) <> v_type THEN
      RAISE EXCEPTION 'NF:VOUCHER_TYPE_FIXED'
        USING DETAIL = json_build_object('voucher', v_voucher.voucher_no, 'is', upper(split_part(v_voucher.voucher_no, '-', 1)), 'asked', v_type)::text,
              HINT   = 'A saved voucher keeps its type. Delete it and enter it again as the other type.';
    END IF;
  END IF;

  -- a manual number is never repeated within its type — checked here for a
  -- clear message; nf_vouchers_manual_unique is the backstop under a race
  IF v_manual IS NOT NULL THEN
    DECLARE v_used public.nf_vouchers; BEGIN
      SELECT * INTO v_used FROM public.nf_vouchers x
       WHERE x.company_id = v_company AND x.manual_no = v_manual
         AND upper(split_part(x.voucher_no, '-', 1)) = v_type
         AND x.id IS DISTINCT FROM v_voucher.id
       LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER'
          USING DETAIL = json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no)::text;
      END IF;
    END;
  END IF;

  IF p_line_id IS NULL THEN
    v_system := public.nf__next_voucher_no(v_company, v_type);
    SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_vouchers WHERE day_id = p_day_id;
    v_new_id := public.nf_post_voucher(v_company, p_day_id, v_system, v_bdate, p_description, v_sort,
      CASE WHEN p_side = 'IN' THEN
        jsonb_build_array(
          jsonb_build_object('account_code', btrim(p_head), 'floor_code', btrim(p_floor), 'party_id', v_party_id::text, 'credit', p_amount),
          jsonb_build_object('account_code', v_via_code,     'floor_code', btrim(p_floor), 'debit',  p_amount))
      ELSE
        jsonb_build_array(
          jsonb_build_object('account_code', btrim(p_head), 'floor_code', btrim(p_floor), 'party_id', v_party_id::text, 'debit',  p_amount),
          jsonb_build_object('account_code', v_via_code,     'floor_code', btrim(p_floor), 'credit', p_amount))
      END);
    IF v_manual IS NOT NULL THEN
      BEGIN
        UPDATE public.nf_vouchers SET manual_no = v_manual WHERE id = v_new_id;
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
      END;
    END IF;
  ELSE
    SELECT b.exported_at INTO v_exported_at FROM public.nf_iif_batch_vouchers b
     WHERE b.voucher_id = v_voucher.id ORDER BY b.exported_at DESC LIMIT 1;
    IF v_exported_at IS NOT NULL THEN
      RAISE EXCEPTION 'NF:VOUCHER_ALREADY_EXPORTED'
        USING DETAIL = json_build_object('voucher', v_voucher.voucher_no, 'exported_at', v_exported_at)::text;
    END IF;

    PERFORM public.nf_check_version(p_version, v_voucher.version);
    SELECT * INTO v_existing_via FROM public.nf_voucher_legs WHERE voucher_id = v_voucher.id AND line_no = 2;

    BEGIN
      UPDATE public.nf_vouchers
         SET manual_no = v_manual, narration = NULLIF(btrim(p_description), ''),
             version = version + 1, updated_by = auth.uid(), updated_at = now()
       WHERE id = v_voucher.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
    END;

    -- p_party_name/description NULL, or no match found, must not erase a
    -- party set by an earlier save — only overwrite when this save
    -- actually resolved one.
    IF p_side = 'IN' THEN
      UPDATE public.nf_voucher_legs SET account_code = btrim(p_head), floor_code = btrim(p_floor),
        party_id = COALESCE(v_party_id, v_existing_head.party_id),
        debit = 0, credit = p_amount WHERE id = v_existing_head.id;
      UPDATE public.nf_voucher_legs SET account_code = v_via_code, floor_code = btrim(p_floor),
        debit = p_amount, credit = 0 WHERE id = v_existing_via.id;
    ELSE
      UPDATE public.nf_voucher_legs SET account_code = btrim(p_head), floor_code = btrim(p_floor),
        party_id = COALESCE(v_party_id, v_existing_head.party_id),
        debit = p_amount, credit = 0 WHERE id = v_existing_head.id;
      UPDATE public.nf_voucher_legs SET account_code = v_via_code, floor_code = btrim(p_floor),
        debit = 0, credit = p_amount WHERE id = v_existing_via.id;
    END IF;
  END IF;

  RETURN public.nf_day_json(p_day_id);
END
$function$;

-- The day cannot close while a receipt/payment on it has no manual number.
-- BEFORE UPDATE OF status, so it fires only on a transition; ordered by name
-- it runs before nf_days_guard, and it changes nothing — it only refuses.
CREATE OR REPLACE FUNCTION public.nf_days_numbers_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_list jsonb;
BEGIN
  IF public.nf_purging(NEW.company_id) THEN RETURN NEW; END IF;
  IF NEW.status = 'CLOSED' AND OLD.status IS DISTINCT FROM 'CLOSED' THEN
    SELECT jsonb_agg(jsonb_build_object('voucher_no', v.voucher_no, 'narration', v.narration) ORDER BY v.sort)
      INTO v_list
      FROM public.nf_vouchers v
     WHERE v.day_id = NEW.id AND v.status = 'POSTED' AND v.manual_no IS NULL
       AND upper(split_part(v.voucher_no, '-', 1)) IN ('CRV','BRV','CPV','BPV');
    IF v_list IS NOT NULL THEN
      RAISE EXCEPTION 'NF:VOUCHER_NUMBERS_PENDING'
        USING DETAIL = v_list::text,
              HINT   = 'Enter the manual voucher number of every voucher listed, then close the day.';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.nf_days_numbers_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nf_days_numbers_guard ON public.nf_days;
CREATE TRIGGER nf_days_numbers_guard BEFORE UPDATE OF status ON public.nf_days
  FOR EACH ROW EXECUTE FUNCTION public.nf_days_numbers_guard();

-- nf_day_json: each line's manual number, and whether it is still missing.
-- Everything else is unchanged.
CREATE OR REPLACE FUNCTION public.nf_day_json(p_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d public.nf_days;
  v_checks jsonb;
  r record;
BEGIN
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  v_checks := public.nf_checks(p_day_id);
  SELECT * INTO r FROM public.nf_position_row(p_day_id);
  RETURN jsonb_build_object(
    'day', jsonb_build_object(
      'id', d.id, 'company_id', d.company_id, 'business_date', d.business_date, 'closing_no', d.closing_no,
      'status', d.status, 'is_first_day', d.is_first_day,
      'typed_open_cash', d.typed_open_cash, 'typed_open_petty', d.typed_open_petty, 'typed_open_bank', d.typed_open_bank,
      'transfer_to_bank', NULLIF(r.trf_bank, 0), 'transfer_to_petty', NULLIF(r.trf_petty, 0),
      'denominations', d.denominations, 'counted_cash', d.counted_cash, 'remarks', d.remarks,
      'prepared_by_name', d.prepared_by_name,
      'submitted_at', d.submitted_at, 'closed_at', d.closed_at,
      'closed_by_name', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = d.company_id AND m.user_id = d.closed_by),
      'variance', d.variance, 'variance_reason', d.variance_reason,
      'last_return_reason', d.last_return_reason, 'reopen_count', d.reopen_count,
      'is_latest', NOT EXISTS (SELECT 1 FROM public.nf_days x WHERE x.company_id = d.company_id AND x.business_date > d.business_date),
      'version', d.version),
    'position', public.nf_position(p_day_id),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'side', l.side, 'voucher_no', l.voucher_no, 'description', l.description,
               'head_code', l.head_code, 'head_name', a.name, 'floor_code', l.floor_code, 'via', l.via,
               'amount', l.amount, 'sort', l.sort, 'version', l.version,
               'party_id', vl.party_id, 'party_name', pt.name,
               'manual_no', vv.manual_no, 'number_pending', vv.manual_no IS NULL) ORDER BY l.sort)
        FROM public.nf_lines l
        JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.head_code
        LEFT JOIN public.nf_voucher_legs vl ON vl.id = l.id
        LEFT JOIN public.nf_vouchers vv ON vv.id = vl.voucher_id
        LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = vl.party_id
       WHERE l.day_id = p_day_id), '[]'::jsonb),
    'pdcs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'direction', p.direction, 'cheque_no', p.cheque_no, 'party', p.party, 'bank', p.bank,
               'due_date', p.due_date, 'amount', p.amount, 'entered_here', p.entered_day_id = p_day_id,
               'version', p.version))
        FROM public.nf_pdcs_as_of(p_day_id) p), '[]'::jsonb),
    'checks', v_checks,
    'balanced', jsonb_array_length(v_checks) = 0);
END
$function$;

-- nf_get_report: each line's manual number, for the Director Report's
-- Voucher column. Everything else is unchanged.
CREATE OR REPLACE FUNCTION public.nf_get_report(p_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  d public.nf_days;
  s public.nf_settings;
  pos jsonb;
  v_checks jsonb;
  v_counted boolean;
  v_diff numeric;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director','viewer']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  SELECT * INTO s FROM public.nf_settings WHERE company_id = v_company;
  IF s.company_id IS NULL THEN RAISE EXCEPTION 'NF:NOT_SEEDED'; END IF;
  pos := public.nf_position(p_day_id);
  v_checks := public.nf_checks(p_day_id);
  v_counted := d.denominations IS NOT NULL;
  v_diff := CASE WHEN v_counted THEN (SELECT (x->>'closing')::numeric FROM jsonb_array_elements(pos->'rows') x
                                      WHERE x->>'via' = 'Cash') - d.counted_cash END;

  RETURN jsonb_build_object(
    'business_date', d.business_date,
    'day_name',      to_char(d.business_date, 'FMDay'),
    'closing_no',    d.closing_no,
    'status',        d.status,
    'balanced',      jsonb_array_length(v_checks) = 0,
    'checks',        v_checks,
    'company_line',  s.company_line,
    'report_title',  s.report_title,
    'mark',          s.mark,
    'accounts', (SELECT jsonb_agg(jsonb_build_object('via', x->>'via', 'label', x->>'label',
                                                     'opening', (x->>'opening')::numeric,
                                                     'received', (x->>'received')::numeric,
                                                     'paid', (x->>'paid')::numeric,
                                                     'transfers', (x->>'transfers')::numeric,
                                                     'closing', (x->>'closing')::numeric) ORDER BY o)
                   FROM jsonb_array_elements(pos->'rows') WITH ORDINALITY AS t(x, o)),
    'total_open',  (pos->'total'->>'opening')::numeric,
    'total_close', (pos->'total'->>'closing')::numeric,
    'total_in',    (pos->'total'->>'received')::numeric,
    'total_out',   (pos->'total'->>'paid')::numeric,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'side', l.side, 'voucher_no', l.voucher_no, 'manual_no', vv.manual_no, 'description', l.description,
               'head_code', l.head_code, 'head_name', a.name, 'floor_code', l.floor_code,
               'floor_name', f.qb_class, 'via', l.via,
               'amount', l.amount, 'sort', l.sort) ORDER BY l.side, l.sort)
        FROM public.nf_lines l
        JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.head_code
        JOIN public.nf_floors f ON f.company_id = l.company_id AND f.code = l.floor_code
        LEFT JOIN public.nf_voucher_legs vl ON vl.id = l.id
        LEFT JOIN public.nf_vouchers vv ON vv.id = vl.voucher_id
       WHERE l.day_id = p_day_id), '[]'::jsonb),
    'other_balances', public.nf_other_balances(v_company, d.business_date),
    'in_categories',  public.nf_report_groups(p_day_id, 'IN'),
    'out_categories', public.nf_report_groups(p_day_id, 'OUT'),
    'large_threshold', s.large_payment_threshold,
    'large_payments', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'description', l.description,
                'category', public.nf_category(v_company, 'OUT', l.head_code),
                'by', CASE WHEN l.via = 'Bank' THEN 'bank' ELSE 'cash' END,
                'amount', l.amount) ORDER BY l.amount DESC, l.sort)
         FROM public.nf_lines l
        WHERE l.day_id = p_day_id AND l.side = 'OUT' AND l.amount >= s.large_payment_threshold), '[]'::jsonb),
    'counted', v_counted,
    'count_diff', v_diff,
    'variance_reason', d.variance_reason,
    'negatives', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', x->>'label', 'amount', (x->>'closing')::numeric))
                             FROM jsonb_array_elements(pos->'rows') x WHERE (x->>'closing')::numeric < 0), '[]'::jsonb),
    'transfer_to_bank', (SELECT (x->>'transfers')::numeric FROM jsonb_array_elements(pos->'rows') x WHERE x->>'via' = 'Bank'),
    'bank_label', (SELECT via_label FROM public.nf_accounts WHERE company_id = v_company AND via = 'Bank'),
    'other_issue_count', (SELECT count(*) FROM jsonb_array_elements(v_checks) c
                           WHERE c->>'key' NOT IN ('negative','not_counted','count_mismatch')),
    'pdc_due_days', s.pdc_due_days,
    'pdc_due', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('direction', p.direction, 'amount', p.amount, 'party', p.party,
                                           'due_date', p.due_date)
                        ORDER BY CASE p.direction WHEN 'RECEIVED' THEN 1 ELSE 2 END, p.created_at, p.id)
         FROM public.nf_pdcs_as_of(p_day_id) p
        WHERE p.due_date BETWEEN d.business_date AND d.business_date + s.pdc_due_days), '[]'::jsonb),
    'pdc_pending', jsonb_build_object(
       'received', (SELECT COALESCE(sum(amount), 0) FROM public.nf_pdcs_as_of(p_day_id) WHERE direction = 'RECEIVED'),
       'issued',   (SELECT COALESCE(sum(amount), 0) FROM public.nf_pdcs_as_of(p_day_id) WHERE direction = 'ISSUED')),
    'prepared_by_name', d.prepared_by_name);
END
$function$;

COMMIT;

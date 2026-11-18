-- ══ NexuFinance: one Daily Closing, two logins — Head Office Cash and Site Cash (20261118i) ══
-- NOT APPLIED until the owner says yes.
--
-- Owner, 18-Nov-2026 (mockup D:\Claude Cowork\Ek closing do login\, approved; no cash count — answer "c"):
--   * one closing per date; head office and the site accountant (Sharose) each sign in with their own login;
--   * every member has a cash box: head office = Cash in Hand (10100, via Cash), the site = Petty Cash (10200,
--     via Petty). A member's cash lines, withdrawals and transfers can only use HIS box (or the bank). A
--     director is not limited;
--   * a voucher is changed or deleted only by whoever entered it (a director: any) — Sharose sees head
--     office's lines but cannot touch them, and the other way round;
--   * the day itself (submit / close; either login may start the next day), PDCs, the IIF and voucher texts by number stay with head
--     office: the site cash box login cannot run them; nor the reports (owner: the site sees the Daily
--     Closing only — its own printed day report stays);
--   * each line and JV in the day carries who entered it and his cash box ('by_name', 'by_box', 'mine'); the
--     context carries the caller's box ('cash_via').
-- Sharose: NexuFinance role 'site' -> 'accountant' on the site box. The 62 vouchers posted from his Excel on
-- 18-Nov (manual numbers S-CRV-… / S-CPV-…, entered by the director) are recorded as entered by him.
-- QuickBooks account names do not change.

ALTER TABLE public.nf_members ADD COLUMN cash_via text NOT NULL DEFAULT 'Cash'
  CONSTRAINT nf_members_cash_via_check CHECK (cash_via IN ('Cash', 'Petty'));

CREATE OR REPLACE FUNCTION public.nf_member_cash_box(p_company_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
  -- NULL for a director (not limited) or a non-member
  SELECT CASE WHEN m.role = 'director' THEN NULL ELSE m.cash_via END
    FROM public.nf_members m WHERE m.company_id = p_company_id AND m.user_id = auth.uid() AND m.active;
$f$;

CREATE OR REPLACE FUNCTION public.nf_assert_cash_box(p_company_id uuid, p_via text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE v_box text := public.nf_member_cash_box(p_company_id);
BEGIN
  IF v_box IS NOT NULL AND p_via IN ('Cash', 'Petty') AND p_via <> v_box THEN
    RAISE EXCEPTION 'NF:NOT_YOUR_CASH_BOX' USING DETAIL = json_build_object('yours', v_box, 'asked', p_via)::text;
  END IF;
END $f$;

CREATE OR REPLACE FUNCTION public.nf_assert_cash_box_either(p_company_id uuid, p_from text, p_to text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE v_box text := public.nf_member_cash_box(p_company_id);
BEGIN
  IF v_box IS NOT NULL AND p_from IS DISTINCT FROM v_box AND p_to IS DISTINCT FROM v_box THEN
    RAISE EXCEPTION 'NF:NOT_YOUR_CASH_BOX' USING DETAIL = json_build_object('yours', v_box, 'asked', p_from || ' -> ' || p_to)::text;
  END IF;
END $f$;

CREATE OR REPLACE FUNCTION public.nf_assert_own_voucher(p_voucher_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE v public.nf_vouchers;
BEGIN
  SELECT * INTO v FROM public.nf_vouchers WHERE id = p_voucher_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF public.nf_role(v.company_id) = 'director' OR v.created_by = auth.uid() THEN RETURN; END IF;
  RAISE EXCEPTION 'NF:NOT_YOUR_ENTRY' USING DETAIL = json_build_object('voucher', COALESCE(v.manual_no, v.voucher_no),
    'by', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by))::text;
END $f$;

CREATE OR REPLACE FUNCTION public.nf_assert_head_office(p_company_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
BEGIN
  IF public.nf_member_cash_box(p_company_id) = 'Petty' THEN RAISE EXCEPTION 'NF:HEAD_OFFICE_ONLY'; END IF;
END $f$;

REVOKE ALL ON FUNCTION public.nf_member_cash_box(uuid), public.nf_assert_cash_box(uuid, text),
  public.nf_assert_cash_box_either(uuid, text, text), public.nf_assert_own_voucher(uuid),
  public.nf_assert_head_office(uuid) FROM PUBLIC, anon, authenticated;

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
  PERFORM public.nf_assert_cash_box(v_company, p_via);  -- own cash box (20261118i)
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
    PERFORM public.nf_assert_own_voucher(v_voucher.id);  -- only its own entrant edits it (20261118i)
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
          USING DETAIL = json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no,
            'by', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v_used.company_id AND m.user_id = v_used.created_by))::text;
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

CREATE OR REPLACE FUNCTION public.nf_save_withdrawal(p_day_id uuid, p_voucher_no text, p_from text, p_to text, p_amount numeric, p_cheque_no text, p_description text, p_real_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  v_manual  text := upper(btrim(COALESCE(p_voucher_no, '')));
  v_cheque  text := regexp_replace(COALESCE(p_cheque_no, ''), '[^0-9]', '', 'g');
  v_bank text; v_to text; v_floor text; v_bdate date; v_sort integer; v_system text; v_id uuid;
  v_narr text; v_used public.nf_vouchers;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  PERFORM public.nf_assert_cash_box(v_company, p_to);  -- own cash box (20261118i)
  IF p_from IS DISTINCT FROM 'Bank' THEN RAISE EXCEPTION 'NF:WITHDRAWAL_FROM_BANK_ONLY' USING DETAIL = COALESCE(p_from, '(none)'); END IF;
  IF p_to IS NULL OR p_to NOT IN ('Cash','Petty') THEN RAISE EXCEPTION 'NF:WITHDRAWAL_TO_CASH_OR_PETTY' USING DETAIL = COALESCE(p_to, '(none)'); END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  IF length(v_cheque) < 4 THEN RAISE EXCEPTION 'NF:CHEQUE_REQUIRED'; END IF;
  -- the day the cheque was really cashed, not the open day's date
  IF p_real_date IS NULL THEN RAISE EXCEPTION 'NF:REAL_DATE_REQUIRED'; END IF;
  IF p_real_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'NF:REAL_DATE_FUTURE'; END IF;
  IF v_manual = '' OR v_manual ~ '^BPV-?$' THEN v_manual := NULL; END IF;

  SELECT code INTO v_bank FROM public.nf_accounts WHERE company_id = v_company AND via = 'Bank';
  SELECT code INTO v_to   FROM public.nf_accounts WHERE company_id = v_company AND via = p_to;
  IF v_bank IS NULL OR v_to IS NULL THEN RAISE EXCEPTION 'NF:VIA_NOT_CONFIGURED'; END IF;

  -- a cheque is cashed once: refuse a second withdrawal on the same cheque
  SELECT v.* INTO v_used FROM public.nf_vouchers v
   WHERE v.company_id = v_company
     AND regexp_replace(COALESCE(v.narration, ''), '[^0-9#]', '', 'g') ~ ('#' || v_cheque || '($|[^0-9])')
     AND EXISTS (SELECT 1 FROM public.nf_voucher_legs a WHERE a.voucher_id = v.id AND a.account_code = v_bank AND a.credit > 0)
     AND EXISTS (SELECT 1 FROM public.nf_voucher_legs b JOIN public.nf_accounts x
                   ON x.company_id = b.company_id AND x.code = b.account_code
                  WHERE b.voucher_id = v.id AND b.debit > 0 AND x.via IN ('Cash','Petty'))
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'NF:DUPLICATE_CHEQUE'
      USING DETAIL = json_build_object('cheque', v_cheque, 'voucher', COALESCE(v_used.manual_no, v_used.voucher_no))::text;
  END IF;

  IF v_manual IS NOT NULL AND EXISTS (SELECT 1 FROM public.nf_vouchers x
       WHERE x.company_id = v_company AND x.manual_no = v_manual AND upper(split_part(x.voucher_no, '-', 1)) = 'BPV') THEN
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
  END IF;

  v_narr := COALESCE(NULLIF(btrim(p_description), ''),
                     CASE p_to WHEN 'Cash' THEN 'Cash withdrawn from bank into cash in hand'
                               ELSE 'Cash withdrawn from bank into the site cash box' END);
  IF position(v_cheque IN regexp_replace(v_narr, '[^0-9]', '', 'g')) = 0 THEN
    v_narr := v_narr || ' — BOP chq #' || v_cheque;
  END IF;

  SELECT business_date INTO v_bdate FROM public.nf_days WHERE id = p_day_id;
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_company ORDER BY sort LIMIT 1;
  SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_vouchers WHERE day_id = p_day_id;
  v_system := public.nf__next_voucher_no(v_company, 'BPV');
  v_id := public.nf_post_voucher(v_company, p_day_id, v_system, v_bdate, v_narr, v_sort,
    jsonb_build_array(
      jsonb_build_object('account_code', v_to,   'floor_code', v_floor, 'debit',  p_amount),
      jsonb_build_object('account_code', v_bank, 'floor_code', v_floor, 'credit', p_amount)));
  BEGIN
    UPDATE public.nf_vouchers SET manual_no = v_manual, real_date = p_real_date WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
  END;
  RETURN public.nf_day_json(p_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_save_transfer(p_day_id uuid, p_from text, p_to text, p_amount numeric, p_real_date date, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  v_from text; v_to text; v_floor text; v_bdate date; v_sort integer; v_system text; v_id uuid;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  PERFORM public.nf_assert_cash_box_either(v_company, p_from, p_to);  -- own cash box (20261118i)
  IF p_from IS NULL OR p_to IS NULL OR p_from NOT IN ('Cash','Petty') OR p_to NOT IN ('Cash','Petty') OR p_from = p_to THEN
    RAISE EXCEPTION 'NF:TRANSFER_CASH_AND_SITE_BOX_ONLY' USING DETAIL = COALESCE(p_from, '(none)') || ' -> ' || COALESCE(p_to, '(none)');
  END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  IF p_real_date IS NULL THEN RAISE EXCEPTION 'NF:REAL_DATE_REQUIRED'; END IF;
  IF p_real_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'NF:REAL_DATE_FUTURE'; END IF;
  SELECT code INTO v_from FROM public.nf_accounts WHERE company_id = v_company AND via = p_from;
  SELECT code INTO v_to   FROM public.nf_accounts WHERE company_id = v_company AND via = p_to;
  IF v_from IS NULL OR v_to IS NULL THEN RAISE EXCEPTION 'NF:VIA_NOT_CONFIGURED'; END IF;
  SELECT business_date INTO v_bdate FROM public.nf_days WHERE id = p_day_id;
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_company
   ORDER BY (code = 'P-W') DESC, sort LIMIT 1;
  SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_vouchers WHERE day_id = p_day_id;
  -- its own sequence, XFR-SITE-n: the voucher counters hold the four day types and JV only,
  -- and the old per-day transfers are keyed XFR-PETTY-<day> / XFR-BANK-<day>
  PERFORM pg_advisory_xact_lock(hashtext('nf_xfr_site:' || v_company::text));
  SELECT 'XFR-SITE-' || (COALESCE(max(NULLIF(substring(voucher_no FROM '^XFR-SITE-([0-9]+)$'), '')::int), 0) + 1)
    INTO v_system FROM public.nf_vouchers WHERE company_id = v_company AND voucher_no LIKE 'XFR-SITE-%';
  v_id := public.nf_post_voucher(v_company, p_day_id, v_system, v_bdate,
    COALESCE(NULLIF(btrim(p_description), ''),
             CASE p_to WHEN 'Petty' THEN 'Cash moved from HO cash to the site cash box'
                       ELSE 'Cash moved from the site cash box to HO cash' END), v_sort,
    jsonb_build_array(
      jsonb_build_object('account_code', v_to,   'floor_code', v_floor, 'debit',  p_amount),
      jsonb_build_object('account_code', v_from, 'floor_code', v_floor, 'credit', p_amount)));
  UPDATE public.nf_vouchers SET real_date = p_real_date WHERE id = v_id;
  RETURN public.nf_day_json(p_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_delete_line(p_line_id uuid, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_head public.nf_voucher_legs;
  v_voucher public.nf_vouchers;
  v_exported_at timestamptz;
BEGIN
  SELECT * INTO v_head FROM public.nf_voucher_legs WHERE id = p_line_id AND line_no = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
  SELECT * INTO v_voucher FROM public.nf_vouchers WHERE id = v_head.voucher_id FOR UPDATE;
  PERFORM public.nf_require_role(v_voucher.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_own_voucher(v_voucher.id);  -- only its own entrant (20261118i)

  SELECT b.exported_at INTO v_exported_at FROM public.nf_iif_batch_vouchers b
   WHERE b.voucher_id = v_voucher.id ORDER BY b.exported_at DESC LIMIT 1;
  IF v_exported_at IS NOT NULL THEN
    RAISE EXCEPTION 'NF:VOUCHER_ALREADY_EXPORTED'
      USING DETAIL = json_build_object('voucher', v_voucher.voucher_no, 'exported_at', v_exported_at)::text;
  END IF;

  PERFORM public.nf_check_version(p_version, v_voucher.version);
  DELETE FROM public.nf_voucher_legs WHERE voucher_id = v_voucher.id;
  DELETE FROM public.nf_vouchers WHERE id = v_voucher.id;
  RETURN public.nf_day_json(v_voucher.day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_set_manual_no(p_voucher_id uuid, p_manual_no text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v public.nf_vouchers;
  v_type text;
  v_manual text := upper(btrim(COALESCE(p_manual_no, '')));
  v_status text;
  v_latest_closed date;
  v_used public.nf_vouchers;
BEGIN
  SELECT * INTO v FROM public.nf_vouchers x
   WHERE x.id = p_voucher_id
     AND EXISTS (SELECT 1 FROM public.nf_members m WHERE m.company_id = x.company_id AND m.user_id = auth.uid() AND m.active)
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(v.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_own_voucher(v.id);  -- only its own entrant (20261118i)

  v_type := upper(split_part(v.voucher_no, '-', 1));
  IF v.source = 'IMPORT' OR v_type NOT IN ('CRV','BRV','CPV','BPV','JV') THEN
    RAISE EXCEPTION 'NF:IMPORTED_LOCKED' USING DETAIL = v.voucher_no;
  END IF;
  IF v_manual = '' OR v_manual ~ '^(CRV|BRV|CPV|BPV|JV)-?$' THEN v_manual := NULL; END IF;
  IF v_type = 'JV' AND v_manual ~ '^(CRV|BRV|CPV|BPV)-' THEN
    RAISE EXCEPTION 'NF:VOUCHER_PREFIX_IS_CASHBOOK' USING DETAIL = v_manual;
  END IF;

  IF EXISTS (SELECT 1 FROM public.nf_iif_batch_vouchers b WHERE b.voucher_id = v.id) THEN
    RAISE EXCEPTION 'NF:VOUCHER_ALREADY_EXPORTED' USING DETAIL = json_build_object('voucher', v.voucher_no)::text;
  END IF;
  IF v.day_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.nf_days WHERE id = v.day_id;
    IF v_status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED' USING DETAIL = v_status; END IF;
  ELSE
    SELECT max(business_date) INTO v_latest_closed FROM public.nf_days WHERE company_id = v.company_id AND status = 'CLOSED';
    IF v_latest_closed IS NOT NULL AND v.voucher_date <= v_latest_closed THEN
      RAISE EXCEPTION 'NF:PERIOD_CLOSED' USING DETAIL = json_build_object('voucher_date', v.voucher_date, 'latest_closed', v_latest_closed)::text;
    END IF;
  END IF;
  PERFORM public.nf_check_version(p_version, v.version);

  IF v_manual IS NOT NULL THEN
    SELECT * INTO v_used FROM public.nf_vouchers x
     WHERE x.company_id = v.company_id AND x.manual_no = v_manual
       AND upper(split_part(x.voucher_no, '-', 1)) = v_type AND x.id <> v.id
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER'
        USING DETAIL = json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no)::text;
    END IF;
  END IF;

  BEGIN
    UPDATE public.nf_vouchers
       SET manual_no = v_manual, version = version + 1, updated_by = auth.uid(), updated_at = now()
     WHERE id = v.id
    RETURNING * INTO v;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
  END;
  RETURN jsonb_build_object('id', v.id, 'voucher_no', v.voucher_no, 'manual_no', v.manual_no, 'version', v.version);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_jv_delete(p_voucher_id uuid, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voucher public.nf_vouchers;
  v_exported_at timestamptz;
  v_latest_closed date;
BEGIN
  SELECT * INTO v_voucher FROM public.nf_vouchers v
   WHERE v.id = p_voucher_id
     AND EXISTS (SELECT 1 FROM public.nf_members m
                  WHERE m.company_id = v.company_id AND m.user_id = auth.uid() AND m.active)
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(v_voucher.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_own_voucher(v_voucher.id);  -- only its own entrant (20261118i)
  -- a daily-closing line is not this function's business; it has its own path
  -- with its own day-locked guard
  IF v_voucher.day_id IS NOT NULL THEN RAISE EXCEPTION 'NF:NOT_A_JOURNAL_VOUCHER'; END IF;

  -- A database-level fact, not a UI omission (docs/AUDIT_REPORT.md
  -- CRITICAL-3): an imported historical voucher is never deletable through
  -- this path, whether or not nf_jv_list would have offered it.
  IF v_voucher.source <> 'JV' THEN
    RAISE EXCEPTION 'NF:IMPORTED_LOCKED' USING DETAIL = v_voucher.voucher_no;
  END IF;

  SELECT b.exported_at INTO v_exported_at FROM public.nf_iif_batch_vouchers b
   WHERE b.voucher_id = v_voucher.id ORDER BY b.exported_at DESC LIMIT 1;
  IF v_exported_at IS NOT NULL THEN
    RAISE EXCEPTION 'NF:VOUCHER_ALREADY_EXPORTED'
      USING DETAIL = json_build_object('voucher', v_voucher.voucher_no, 'exported_at', v_exported_at)::text;
  END IF;

  SELECT max(business_date) INTO v_latest_closed
    FROM public.nf_days WHERE company_id = v_voucher.company_id AND status = 'CLOSED';
  IF v_latest_closed IS NOT NULL AND v_voucher.voucher_date <= v_latest_closed THEN
    RAISE EXCEPTION 'NF:PERIOD_CLOSED' USING DETAIL = json_build_object('voucher_date', v_voucher.voucher_date, 'latest_closed', v_latest_closed)::text;
  END IF;

  PERFORM public.nf_check_version(p_version, v_voucher.version);

  DELETE FROM public.nf_voucher_legs WHERE voucher_id = v_voucher.id;
  DELETE FROM public.nf_vouchers WHERE id = v_voucher.id;
  RETURN jsonb_build_object('deleted', v_voucher.voucher_no);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_close_day(p_day_id uuid, p_version integer, p_variance_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  d public.nf_days;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(v_company);  -- not the site cash box login (20261118i)
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  UPDATE public.nf_days
     SET status = 'CLOSED',
         variance_reason = NULLIF(btrim(p_variance_reason), ''),
         prepared_by = COALESCE(d.prepared_by, auth.uid()),
         prepared_by_name = COALESCE(d.prepared_by_name, public.nf_actor_name(v_company))
   WHERE id = p_day_id;
  RETURN public.nf_day_json(p_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_submit_day(p_day_id uuid, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  d public.nf_days;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(v_company);  -- not the site cash box login (20261118i)
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  UPDATE public.nf_days
     SET status = 'SUBMITTED', prepared_by = auth.uid(), prepared_by_name = public.nf_actor_name(v_company)
   WHERE id = p_day_id;
  RETURN public.nf_day_json(p_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_set_remarks(p_day_id uuid, p_remarks text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_days;
BEGIN
  PERFORM public.nf_require_role(public.nf_day_company(p_day_id), ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(public.nf_day_company(p_day_id));  -- not the site cash box login (20261118i)
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  UPDATE public.nf_days SET remarks = NULLIF(btrim(p_remarks), '') WHERE id = p_day_id;
  RETURN public.nf_day_json(p_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_set_transfers(p_day_id uuid, p_to_bank numeric, p_to_petty numeric, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  d public.nf_days;
  v_cash_code text; v_bank_code text; v_petty_code text; v_floor text;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(v_company);  -- not the site cash box login (20261118i)
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  PERFORM public.nf_check_amount(p_to_bank,  'transfer_to_bank',  true);
  PERFORM public.nf_check_amount(p_to_petty, 'transfer_to_petty', true);
  IF p_to_bank < 0 OR p_to_petty < 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;

  SELECT code INTO v_cash_code  FROM public.nf_accounts WHERE company_id = v_company AND via = 'Cash';
  SELECT code INTO v_bank_code  FROM public.nf_accounts WHERE company_id = v_company AND via = 'Bank';
  SELECT code INTO v_petty_code FROM public.nf_accounts WHERE company_id = v_company AND via = 'Petty';
  -- a transfer has no natural floor (moving cash between tills is not a
  -- floor's activity) and the single-entry model never captured one
  -- either; the company's first floor by sort order is the fixed,
  -- disclosed convention — same one 20260918d uses migrating the one real
  -- transfer that exists live today.
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_company ORDER BY sort LIMIT 1;

  PERFORM public.nf__upsert_transfer_voucher(v_company, p_day_id, d.business_date,
    'XFR-BANK-'  || p_day_id::text, v_bank_code,  v_cash_code, v_floor, p_to_bank);
  PERFORM public.nf__upsert_transfer_voucher(v_company, p_day_id, d.business_date,
    'XFR-PETTY-' || p_day_id::text, v_petty_code, v_cash_code, v_floor, p_to_petty);

  UPDATE public.nf_days SET remarks = remarks WHERE id = p_day_id;  -- bump the shared version, see header note
  RETURN public.nf_day_json(p_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_save_pdc(p_day_id uuid, p_pdc_id uuid, p_direction text, p_cheque_no text, p_party text, p_bank text, p_due_date date, p_amount numeric, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  p public.nf_pdcs;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(v_company);  -- not the site cash box login (20261118i)
  IF p_direction IS NULL OR p_direction NOT IN ('RECEIVED','ISSUED') THEN RAISE EXCEPTION 'NF:DIRECTION_REQUIRED'; END IF;
  IF p_cheque_no IS NULL OR btrim(p_cheque_no) = '' THEN RAISE EXCEPTION 'NF:CHEQUE_NO_REQUIRED'; END IF;
  IF p_due_date IS NULL THEN RAISE EXCEPTION 'NF:DUE_DATE_REQUIRED'; END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;

  IF p_pdc_id IS NULL THEN
    INSERT INTO public.nf_pdcs (company_id, direction, cheque_no, party, bank, due_date, amount,
                                entered_day_id, status, created_by)
    VALUES (v_company, p_direction, btrim(p_cheque_no), NULLIF(btrim(p_party), ''), NULLIF(btrim(p_bank), ''),
            p_due_date, p_amount, p_day_id, 'PENDING', auth.uid());
  ELSE
    SELECT * INTO p FROM public.nf_pdcs WHERE id = p_pdc_id AND company_id = v_company;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:PDC_NOT_FOUND'; END IF;
    PERFORM public.nf_check_version(p_version, p.version);
    UPDATE public.nf_pdcs
       SET direction = p_direction, cheque_no = btrim(p_cheque_no), party = NULLIF(btrim(p_party), ''),
           bank = NULLIF(btrim(p_bank), ''), due_date = p_due_date, amount = p_amount
     WHERE id = p_pdc_id;
  END IF;
  RETURN public.nf_day_json(p_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_delete_pdc(p_pdc_id uuid, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p public.nf_pdcs;
BEGIN
  SELECT * INTO p FROM public.nf_pdcs WHERE id = p_pdc_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:PDC_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(p.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(p.company_id);  -- not the site cash box login (20261118i)
  PERFORM public.nf_check_version(p_version, p.version);
  DELETE FROM public.nf_pdcs WHERE id = p_pdc_id;
  RETURN public.nf_day_json(p.entered_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_resolve_pdc(p_day_id uuid, p_pdc_id uuid, p_status text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  p public.nf_pdcs;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(v_company);  -- not the site cash box login (20261118i)
  IF p_status IS NULL OR p_status NOT IN ('PENDING','CLEARED','BOUNCED','CANCELLED') THEN
    RAISE EXCEPTION 'NF:STATUS_REQUIRED';
  END IF;
  SELECT * INTO p FROM public.nf_pdcs WHERE id = p_pdc_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:PDC_NOT_FOUND'; END IF;
  PERFORM public.nf_check_version(p_version, p.version);
  UPDATE public.nf_pdcs
     SET status = p_status, resolved_day_id = CASE WHEN p_status = 'PENDING' THEN NULL ELSE p_day_id END
   WHERE id = p_pdc_id;
  RETURN public.nf_day_json(p_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_iif_record_batch(p_company_id uuid, p_file_name text, p_from date, p_to date, p_qb_chart_file text, p_qb_chart_checksum text, p_voucher_ids uuid[], p_reexports jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_batch_id uuid;
  v_id uuid;
  v_reason text;
  v_already_exported uuid[];
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)
  IF p_voucher_ids IS NULL OR array_length(p_voucher_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NF:IIF_NO_VOUCHERS';
  END IF;

  -- every voucher must be real, POSTED, exportable, and in this company
  IF EXISTS (
    SELECT 1 FROM unnest(p_voucher_ids) x(id)
    LEFT JOIN public.nf_vouchers v ON v.id = x.id AND v.company_id = p_company_id
    WHERE v.id IS NULL OR v.status <> 'POSTED' OR NOT v.iif_exportable
  ) THEN
    RAISE EXCEPTION 'NF:IIF_VOUCHER_NOT_EXPORTABLE';
  END IF;

  -- any voucher already exported must appear in p_reexports with a reason
  SELECT array_agg(bv.voucher_id) INTO v_already_exported
    FROM public.nf_iif_batch_vouchers bv
   WHERE bv.voucher_id = ANY(p_voucher_ids);

  IF v_already_exported IS NOT NULL THEN
    FOR v_id IN SELECT unnest(v_already_exported) LOOP
      v_reason := (SELECT r->>'reason' FROM jsonb_array_elements(p_reexports) r WHERE (r->>'voucher_id')::uuid = v_id);
      IF v_reason IS NULL OR btrim(v_reason) = '' THEN
        RAISE EXCEPTION 'NF:IIF_ALREADY_EXPORTED' USING DETAIL = v_id::text;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.nf_iif_batches (company_id, created_by, file_name, date_from, date_to, qb_chart_file, qb_chart_checksum)
  VALUES (p_company_id, v_uid, p_file_name, p_from, p_to, p_qb_chart_file, p_qb_chart_checksum)
  RETURNING id INTO v_batch_id;

  INSERT INTO public.nf_iif_batch_vouchers (batch_id, voucher_id, company_id, is_reexport, reason)
  SELECT v_batch_id, x.id, p_company_id,
         x.id = ANY(COALESCE(v_already_exported, ARRAY[]::uuid[])),
         (SELECT r->>'reason' FROM jsonb_array_elements(p_reexports) r WHERE (r->>'voucher_id')::uuid = x.id)
    FROM unnest(p_voucher_ids) x(id);

  RETURN jsonb_build_object('batch_id', v_batch_id, 'voucher_count', array_length(p_voucher_ids, 1));
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_set_voucher_text(p_company_id uuid, p_manual_no text, p_narration text, p_memo_replace jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_v public.nf_vouchers;
  v_pair jsonb;
  v_n int := 0;
  v_actor text;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)
  IF NULLIF(btrim(p_narration),'') IS NULL THEN RAISE EXCEPTION 'NF:NARRATION_REQUIRED'; END IF;

  SELECT * INTO v_v FROM public.nf_vouchers
   WHERE company_id = p_company_id AND manual_no = btrim(p_manual_no) AND status = 'POSTED'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND' USING DETAIL = p_manual_no; END IF;

  v_actor := public.nf_actor_name(p_company_id);

  UPDATE public.nf_vouchers SET narration = btrim(p_narration) WHERE id = v_v.id;

  IF p_memo_replace IS NOT NULL AND jsonb_typeof(p_memo_replace) = 'array' THEN
    FOR v_pair IN SELECT * FROM jsonb_array_elements(p_memo_replace) LOOP
      UPDATE public.nf_voucher_legs
         SET memo = replace(memo, v_pair->>0, v_pair->>1)
       WHERE voucher_id = v_v.id AND memo LIKE '%' || (v_pair->>0) || '%';
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('manual_no', v_v.manual_no, 'old_narration', v_v.narration,
                            'new_narration', btrim(p_narration), 'by', v_actor, 'reason', p_reason);
END $function$;

CREATE OR REPLACE FUNCTION public.nf_director_summary(p_company_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
  v_as_of date := COALESCE(p_as_of, (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_m_from date := date_trunc('month', COALESCE(p_as_of, (now() AT TIME ZONE 'Asia/Karachi')::date))::date;
  v_ledger jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)
  v_ledger := public._nf_token_ledger_body(p_company_id, NULL, v_as_of);

  WITH posted AS (
    SELECT l.voucher_id, l.account_code, l.party_id, l.debit, l.credit, v.voucher_date
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id
       AND v.status = 'POSTED'
       AND v.voucher_date <= v_as_of
  ),
  -- a voucher that only moves money between our own cash/bank accounts is a
  -- transfer, not money coming in or going out
  moneybox AS (
    SELECT code FROM public.nf_accounts
     WHERE company_id = p_company_id AND via IS NOT NULL
  ),
  transfers AS (
    SELECT voucher_id FROM posted
     GROUP BY voucher_id
    HAVING bool_and(account_code IN (SELECT code FROM moneybox))
  ),
  cost AS (
    SELECT a.parent_code, a.code, a.name, sum(p.debit - p.credit) AS amount
      FROM posted p JOIN public.nf_accounts a
        ON a.company_id = p_company_id AND a.code = p.account_code
     WHERE left(a.code, 1) = '5'
     GROUP BY a.parent_code, a.code, a.name
    HAVING sum(p.debit - p.credit) <> 0
  ),
  -- token money per voucher across 21100 + 21150: a voucher that takes money
  -- OUT of both is a refund; one that only moves it between buyers, units or
  -- the two accounts nets to 0 and is not
  tokvouch AS (
    SELECT voucher_id, sum(credit - debit) AS net
      FROM posted WHERE account_code IN ('21100', '21150')
     GROUP BY voucher_id
  ),
  tokparty AS (
    SELECT p.party_id
      FROM posted p JOIN public.nf_parties pt ON pt.company_id = p_company_id AND pt.id = p.party_id
     WHERE p.account_code = '21100' AND NOT public._nf_is_placeholder_party(pt.name)
     GROUP BY p.party_id
    HAVING sum(p.credit - p.debit) <> 0
  )
  SELECT jsonb_build_object(
    'as_of', v_as_of,

    'spent_on_project', COALESCE((SELECT sum(amount) FROM cost), 0),
    'spent_breakdown', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('code', code, 'label', name, 'amount', amount)
                        ORDER BY amount DESC) FROM cost), '[]'::jsonb),
    'office_expenses', COALESCE((
       SELECT sum(p.debit - p.credit) FROM posted p
        JOIN public.nf_accounts a ON a.company_id = p_company_id AND a.code = p.account_code
        WHERE left(a.code, 1) IN ('6','7','8')), 0),

    'money_with_us', COALESCE((
       SELECT sum(p.debit - p.credit) FROM posted p
        WHERE p.account_code IN (SELECT code FROM moneybox)), 0),
    'owed_to_group', COALESCE((
       SELECT sum(p.credit - p.debit) FROM posted p
        JOIN public.nf_accounts a ON a.company_id = p_company_id AND a.code = p.account_code
        WHERE a.parent_code = '22000'), 0),
    'due_from_directors', COALESCE((
       SELECT sum(p.debit - p.credit) FROM posted p
        JOIN public.nf_accounts a ON a.company_id = p_company_id AND a.code = p.account_code
        WHERE a.parent_code = '12600'), 0),

    'tokens', jsonb_build_object(
       'held', COALESCE((SELECT sum(p.credit - p.debit) FROM posted p
                          WHERE p.account_code = '21100'), 0),
       'not_allocated', COALESCE((SELECT sum(p.credit - p.debit) FROM posted p
                          WHERE p.account_code = '21150'), 0),
       'total_held', COALESCE((SELECT sum(p.credit - p.debit) FROM posted p
                          WHERE p.account_code IN ('21100', '21150')), 0),
       'buyers', (SELECT count(*) FROM tokparty),
       'unit_bookings', (SELECT count(*) FROM jsonb_array_elements(v_ledger->'units') u
                          WHERE (u->>'net')::numeric > 0),
       'refunded', COALESCE((SELECT sum(-net) FROM tokvouch WHERE net < 0), 0)),

    'month', jsonb_build_object(
       'from', v_m_from, 'to', v_as_of,
       'received', COALESCE((SELECT sum(p.debit) FROM posted p
                              WHERE p.account_code IN (SELECT code FROM moneybox)
                                AND p.voucher_date >= v_m_from
                                AND p.voucher_id NOT IN (SELECT voucher_id FROM transfers)), 0),
       'paid', COALESCE((SELECT sum(p.credit) FROM posted p
                          WHERE p.account_code IN (SELECT code FROM moneybox)
                            AND p.voucher_date >= v_m_from
                            AND p.voucher_id NOT IN (SELECT voucher_id FROM transfers)), 0))
  ) INTO v_out;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_balance_sheet(p_company_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
  v_current_earnings numeric;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)

  -- Same net-income calculation as nf_get_pl, from inception (no p_from)
  -- through p_as_of — the plug that makes the sheet balance without a
  -- formal period-end closing entry ever having been posted.
  SELECT COALESCE(sum(CASE WHEN a.qb_type = 'Income' THEN l.credit - l.debit
                           WHEN a.qb_type IN ('Cost of Goods Sold', 'Expense') THEN -(l.debit - l.credit)
                           ELSE 0 END), 0)
    INTO v_current_earnings
    FROM public.nf_voucher_legs l
    JOIN public.nf_vouchers v ON v.id = l.voucher_id
    JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
   WHERE l.company_id = p_company_id AND v.status = 'POSTED'
     AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)
     AND a.qb_type IN ('Income', 'Cost of Goods Sold', 'Expense');

  WITH bal AS (
    SELECT a.code, a.name, a.qb_type, a.parent_code,
           COALESCE(sum(CASE WHEN a.qb_type IN ('Accounts Payable','Other Current Liability','Long Term Liability','Equity')
                              THEN l.credit - l.debit ELSE l.debit - l.credit END) FILTER (
             WHERE v.status = 'POSTED' AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)), 0) AS amount
      FROM public.nf_accounts a
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = a.company_id AND l.account_code = a.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE a.company_id = p_company_id
       AND a.qb_type IN ('Bank','Accounts Receivable','Other Current Asset','Fixed Asset','Other Asset',
                          'Accounts Payable','Other Current Liability','Long Term Liability','Equity')
     GROUP BY a.code, a.name, a.qb_type, a.parent_code
    HAVING COALESCE(sum(CASE WHEN a.qb_type IN ('Accounts Payable','Other Current Liability','Long Term Liability','Equity')
                              THEN l.credit - l.debit ELSE l.debit - l.credit END) FILTER (
             WHERE v.status = 'POSTED' AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)), 0) <> 0
  ), totals AS (
    SELECT
      COALESCE((SELECT sum(amount) FROM bal WHERE qb_type IN ('Bank','Accounts Receivable','Other Current Asset','Fixed Asset','Other Asset')), 0) AS total_assets,
      COALESCE((SELECT sum(amount) FROM bal WHERE qb_type IN ('Accounts Payable','Other Current Liability','Long Term Liability')), 0) AS total_liabilities,
      COALESCE((SELECT sum(amount) FROM bal WHERE qb_type = 'Equity'), 0) AS total_posted_equity
  )
  SELECT jsonb_build_object(
    'as_of', p_as_of,
    'assets',      COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent_code', parent_code, 'amount', amount) ORDER BY code) FROM bal WHERE qb_type IN ('Bank','Accounts Receivable','Other Current Asset','Fixed Asset','Other Asset')), '[]'::jsonb),
    'liabilities', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent_code', parent_code, 'amount', amount) ORDER BY code) FROM bal WHERE qb_type IN ('Accounts Payable','Other Current Liability','Long Term Liability')), '[]'::jsonb),
    'equity',      COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent_code', parent_code, 'amount', amount) ORDER BY code) FROM bal WHERE qb_type = 'Equity'), '[]'::jsonb),
    'current_earnings', jsonb_build_object('name', 'Current Earnings', 'amount', v_current_earnings, 'is_computed', true),
    'total_assets',      (SELECT total_assets FROM totals),
    'total_liabilities', (SELECT total_liabilities FROM totals),
    'total_equity',      (SELECT total_posted_equity FROM totals) + v_current_earnings,
    'total_liabilities_and_equity', (SELECT total_liabilities + total_posted_equity FROM totals) + v_current_earnings)
    INTO v_out;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_cash_bank_movement(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out   jsonb;
  v_first date;
  lp      record;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)

  SELECT business_date INTO v_first
    FROM public.nf_days WHERE company_id = p_company_id AND is_first_day;
  -- the sheet's own opening, asked for the start of this report's window
  SELECT * INTO lp FROM public.nf_ledger_position(p_company_id, COALESCE(p_from, v_first));

  WITH accts AS (
    SELECT a.code, a.name, a.via FROM public.nf_accounts a
     WHERE a.company_id = p_company_id AND a.qb_type = 'Bank' AND a.active
       AND (a.is_head OR a.via IS NOT NULL)
  ), opening AS (
    SELECT ac.code,
           CASE
             WHEN ac.via = 'Cash'  THEN lp.cash
             WHEN ac.via = 'Petty' THEN lp.petty
             WHEN ac.via = 'Bank'  THEN lp.bank
             -- a Bank-typed head with no via: no typed opening exists for it
             ELSE COALESCE((SELECT sum(l2.debit - l2.credit)
                              FROM public.nf_voucher_legs l2
                              JOIN public.nf_vouchers v2 ON v2.id = l2.voucher_id
                             WHERE l2.company_id = p_company_id AND l2.account_code = ac.code
                               AND v2.status = 'POSTED'
                               AND p_from IS NOT NULL AND v2.voucher_date < p_from), 0)
           END AS opening
      FROM accts ac
  ), period AS (
    SELECT ac.code,
           COALESCE(sum(l.debit) FILTER (WHERE v.status = 'POSTED'
             AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)), 0) AS total_in,
           COALESCE(sum(l.credit) FILTER (WHERE v.status = 'POSTED'
             AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)), 0) AS total_out
      FROM accts ac
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = p_company_id AND l.account_code = ac.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id
     GROUP BY ac.code
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'accounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'code', ac.code, 'name', ac.name, 'opening', o.opening, 'total_in', pd.total_in,
                 'total_out', pd.total_out, 'closing', o.opening + pd.total_in - pd.total_out) ORDER BY ac.code)
                FROM accts ac JOIN opening o ON o.code = ac.code JOIN period pd ON pd.code = ac.code), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_floor_summary(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)

  WITH tagged AS (
    SELECT l.floor_code, f.qb_class AS floor_name, a.qb_type, l.debit, l.credit
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
      JOIN public.nf_floors f ON f.company_id = l.company_id AND f.code = l.floor_code
     WHERE l.company_id = p_company_id AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
  ), byfloor AS (
    SELECT floor_code, max(floor_name) AS floor_name,
           COALESCE(sum(debit - credit) FILTER (WHERE qb_type IN ('Cost of Goods Sold', 'Expense')), 0) AS cost,
           COALESCE(sum(credit - debit) FILTER (WHERE qb_type = 'Income'), 0) AS income
      FROM tagged
     GROUP BY floor_code
  ), token AS (
    SELECT l.floor_code, COALESCE(sum(l.credit - l.debit), 0) AS token_collected
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id AND l.account_code = '21100' AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
     GROUP BY l.floor_code
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'floors', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'floor_code', b.floor_code, 'floor_name', b.floor_name, 'cost', b.cost, 'income', b.income,
                 'token_collected', COALESCE(t.token_collected, 0))
                 ORDER BY (b.floor_code = 'P-W'), b.floor_code)
               FROM byfloor b LEFT JOIN token t ON t.floor_code = b.floor_code), '[]'::jsonb),
    'total_cost', (SELECT COALESCE(sum(cost), 0) FROM byfloor),
    'total_income', (SELECT COALESCE(sum(income), 0) FROM byfloor),
    'total_token_collected', (SELECT COALESCE(sum(token_collected), 0) FROM token))
    INTO v_out;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_group_balances(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)
  WITH acc AS (
    SELECT a.code, a.name, a.parent_code,
           CASE WHEN a.parent_code = '22000' THEN 'group' ELSE 'director' END AS kind
      FROM public.nf_accounts a
     WHERE a.company_id = p_company_id AND a.parent_code IN ('22000', '12600')
  ), mv AS (
    SELECT l.account_code,
           COALESCE(sum(COALESCE(l.debit, 0) - COALESCE(l.credit, 0)) FILTER (WHERE p_from IS NOT NULL AND v.voucher_date < p_from), 0) AS opening,
           COALESCE(sum(COALESCE(l.debit, 0)) FILTER (WHERE p_from IS NULL OR v.voucher_date >= p_from), 0) AS given,
           COALESCE(sum(COALESCE(l.credit, 0)) FILTER (WHERE p_from IS NULL OR v.voucher_date >= p_from), 0) AS received
      FROM public.nf_voucher_legs l JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id AND v.status = 'POSTED'
       AND (p_to IS NULL OR v.voucher_date <= p_to)
       AND l.account_code IN (SELECT code FROM acc)
     GROUP BY l.account_code
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'accounts', COALESCE(jsonb_agg(jsonb_build_object(
        'code', a.code, 'name', a.name, 'kind', a.kind,
        'opening', COALESCE(m.opening, 0),
        'given', COALESCE(m.given, 0), 'received', COALESCE(m.received, 0),
        -- + = they owe the company, − = the company owes them
        'closing', COALESCE(m.opening, 0) + COALESCE(m.given, 0) - COALESCE(m.received, 0))
      ORDER BY CASE a.kind WHEN 'group' THEN 1 ELSE 2 END, a.code), '[]'::jsonb))
    INTO v_out
    FROM acc a LEFT JOIN mv m ON m.account_code = a.code;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_journal(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total_debit numeric;
  v_total_credit numeric;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)

  SELECT COALESCE(sum(l.debit), 0), COALESCE(sum(l.credit), 0)
    INTO v_total_debit, v_total_credit
    FROM public.nf_voucher_legs l
    JOIN public.nf_vouchers v ON v.id = l.voucher_id
   WHERE v.company_id = p_company_id AND v.status = 'POSTED'
     AND (p_from IS NULL OR v.voucher_date >= p_from)
     AND (p_to   IS NULL OR v.voucher_date <= p_to);

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total_debit', v_total_debit, 'total_credit', v_total_credit,
    'vouchers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'voucher_no', v.voucher_no, 'voucher_date', v.voucher_date,
               'narration', v.narration,
               'legs', (SELECT jsonb_agg(jsonb_build_object(
                                 'account_code', l.account_code, 'account_name', a.name,
                                 'floor_code', l.floor_code, 'floor_name', f.qb_class,
                                 'party', p.name, 'debit', l.debit, 'credit', l.credit,
                                 'memo', l.memo) ORDER BY l.line_no)
                          FROM public.nf_voucher_legs l
                          JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
                          JOIN public.nf_floors f ON f.company_id = l.company_id AND f.code = l.floor_code
                          LEFT JOIN public.nf_parties p ON p.company_id = l.company_id AND p.id = l.party_id
                         WHERE l.voucher_id = v.id))
             ORDER BY v.voucher_date, v.sort, v.created_at)
        FROM public.nf_vouchers v
       WHERE v.company_id = p_company_id AND v.status = 'POSTED'
         AND (p_from IS NULL OR v.voucher_date >= p_from)
         AND (p_to   IS NULL OR v.voucher_date <= p_to)), '[]'::jsonb));
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_ledger(p_company_id uuid, p_account_code text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_account public.nf_accounts;
  v_opening numeric;
  v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)
  SELECT * INTO v_account FROM public.nf_accounts WHERE company_id = p_company_id AND code = p_account_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:ACCOUNT_NOT_FOUND' USING DETAIL = p_account_code; END IF;

  v_opening := CASE WHEN p_from IS NULL THEN 0 ELSE (
    SELECT COALESCE(sum(l.debit - l.credit), 0)
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id AND l.account_code = p_account_code
       AND v.status = 'POSTED' AND v.voucher_date < p_from) END;

  WITH entries AS (
    SELECT v.voucher_date, v.voucher_no, v.narration, l.memo, l.floor_code, f.qb_class AS floor_name,
           pt.name AS party, l.debit, l.credit, l.line_no,
           v_opening + sum(l.debit - l.credit) OVER (ORDER BY v.voucher_date, v.sort, v.created_at, l.line_no
                                                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      JOIN public.nf_floors f ON f.company_id = l.company_id AND f.code = l.floor_code
      LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
     WHERE l.company_id = p_company_id AND l.account_code = p_account_code AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
     ORDER BY v.voucher_date, v.sort, v.created_at, l.line_no
  )
  SELECT jsonb_build_object(
    'account', jsonb_build_object('code', v_account.code, 'name', v_account.name, 'qb_type', v_account.qb_type),
    'from', p_from, 'to', p_to,
    'opening', v_opening,
    'closing', v_opening + COALESCE((SELECT sum(debit - credit) FROM entries), 0),
    'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'voucher_date', voucher_date, 'voucher_no', voucher_no, 'narration', narration, 'memo', memo,
                 'floor_code', floor_code, 'floor_name', floor_name, 'party', party,
                 'debit', debit, 'credit', credit, 'running_balance', running_balance) ORDER BY voucher_date, line_no)
               FROM entries), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_monthly_trend(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)

  WITH tagged AS (
    SELECT to_char(v.voucher_date, 'YYYY-MM') AS ym, a.qb_type, l.debit, l.credit
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
     WHERE l.company_id = p_company_id AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
  ), bymonth AS (
    SELECT ym,
           COALESCE(sum(debit - credit) FILTER (WHERE qb_type IN ('Cost of Goods Sold', 'Expense')), 0) AS cost,
           COALESCE(sum(credit - debit) FILTER (WHERE qb_type = 'Income'), 0) AS income
      FROM tagged
     GROUP BY ym
  ), token AS (
    SELECT to_char(v.voucher_date, 'YYYY-MM') AS ym, COALESCE(sum(l.credit - l.debit), 0) AS token_collected
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id AND l.account_code = '21100' AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
     GROUP BY ym
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'months', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'ym', b.ym, 'cost', b.cost, 'income', b.income, 'token_collected', COALESCE(t.token_collected, 0))
                ORDER BY b.ym)
              FROM bymonth b LEFT JOIN token t ON t.ym = b.ym), '[]'::jsonb),
    'total_cost', (SELECT COALESCE(sum(cost), 0) FROM bymonth),
    'total_income', (SELECT COALESCE(sum(income), 0) FROM bymonth),
    'total_token_collected', (SELECT COALESCE(sum(token_collected), 0) FROM token))
    INTO v_out;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_party_statement(p_company_id uuid, p_party_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_party public.nf_parties;
  v_opening numeric;
  v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)
  SELECT * INTO v_party FROM public.nf_parties WHERE company_id = p_company_id AND id = p_party_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:PARTY_NOT_FOUND' USING DETAIL = p_party_id::text; END IF;

  v_opening := CASE WHEN p_from IS NULL THEN 0 ELSE (
    SELECT COALESCE(sum(l.debit - l.credit), 0)
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id AND l.party_id = p_party_id
       AND v.status = 'POSTED' AND v.voucher_date < p_from) END;

  WITH entries AS (
    SELECT v.voucher_date, v.voucher_no, v.narration, l.memo, l.account_code, a.name AS account_name,
           l.floor_code, f.qb_class AS floor_name, l.debit, l.credit, l.line_no,
           v_opening + sum(l.debit - l.credit) OVER (ORDER BY v.voucher_date, v.sort, v.created_at, l.line_no
                                                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
      JOIN public.nf_floors f ON f.company_id = l.company_id AND f.code = l.floor_code
     WHERE l.company_id = p_company_id AND l.party_id = p_party_id AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
     ORDER BY v.voucher_date, v.sort, v.created_at, l.line_no
  )
  SELECT jsonb_build_object(
    'party', jsonb_build_object('id', v_party.id, 'name', v_party.name, 'kind', v_party.kind),
    'from', p_from, 'to', p_to,
    'opening', v_opening,
    'closing', v_opening + COALESCE((SELECT sum(debit - credit) FROM entries), 0),
    'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'voucher_date', voucher_date, 'voucher_no', voucher_no, 'narration', narration, 'memo', memo,
                 'account_code', account_code, 'account_name', account_name,
                 'floor_code', floor_code, 'floor_name', floor_name,
                 'debit', debit, 'credit', credit, 'running_balance', running_balance) ORDER BY voucher_date, line_no)
               FROM entries), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_pl(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)

  WITH bal AS (
    SELECT a.code, a.name, a.qb_type, a.parent_code,
           COALESCE(sum(CASE WHEN a.qb_type = 'Income' THEN l.credit - l.debit ELSE l.debit - l.credit END) FILTER (
             WHERE v.status = 'POSTED' AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)), 0) AS amount
      FROM public.nf_accounts a
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = a.company_id AND l.account_code = a.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE a.company_id = p_company_id AND a.qb_type IN ('Income', 'Cost of Goods Sold', 'Expense')
     GROUP BY a.code, a.name, a.qb_type, a.parent_code
    HAVING COALESCE(sum(CASE WHEN a.qb_type = 'Income' THEN l.credit - l.debit ELSE l.debit - l.credit END) FILTER (
             WHERE v.status = 'POSTED' AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)), 0) <> 0
  ), totals AS (
    SELECT
      COALESCE((SELECT sum(amount) FROM bal WHERE qb_type = 'Income'), 0) AS total_income,
      COALESCE((SELECT sum(amount) FROM bal WHERE qb_type = 'Cost of Goods Sold'), 0) AS total_cogs,
      COALESCE((SELECT sum(amount) FROM bal WHERE qb_type = 'Expense'), 0) AS total_expense
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'income',   COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent_code', parent_code, 'amount', amount) ORDER BY code) FROM bal WHERE qb_type = 'Income'), '[]'::jsonb),
    'cogs',     COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent_code', parent_code, 'amount', amount) ORDER BY code) FROM bal WHERE qb_type = 'Cost of Goods Sold'), '[]'::jsonb),
    'expense',  COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent_code', parent_code, 'amount', amount) ORDER BY code) FROM bal WHERE qb_type = 'Expense'), '[]'::jsonb),
    'total_income',  (SELECT total_income FROM totals),
    'total_cogs',    (SELECT total_cogs FROM totals),
    'gross_profit',  (SELECT total_income - total_cogs FROM totals),
    'total_expense', (SELECT total_expense FROM totals),
    'net_income',    (SELECT (total_income - total_cogs) - total_expense FROM totals))
    INTO v_out;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_project_cost_summary(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)

  WITH tagged AS (
    SELECT COALESCE(pa.code, a.code) AS category_code, COALESCE(pa.name, a.name) AS category_name,
           a.qb_type, l.debit, l.credit
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
      LEFT JOIN public.nf_accounts pa ON pa.company_id = a.company_id AND pa.code = a.parent_code
     WHERE l.company_id = p_company_id AND v.status = 'POSTED'
       AND a.qb_type IN ('Cost of Goods Sold', 'Expense')
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
  ), bycat AS (
    SELECT category_code, category_name, max(qb_type) AS qb_type, COALESCE(sum(debit - credit), 0) AS cost
      FROM tagged
     GROUP BY category_code, category_name
    HAVING COALESCE(sum(debit - credit), 0) <> 0
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'categories', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'category_code', category_code, 'category_name', category_name, 'qb_type', qb_type, 'cost', cost)
                    ORDER BY cost DESC) FROM bycat), '[]'::jsonb),
    'total_cost', (SELECT COALESCE(sum(cost), 0) FROM bycat))
    INTO v_out;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_receipt_register(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pfx text[];
  v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)
  SELECT COALESCE(array_agg(DISTINCT substring(v.voucher_no FROM '^([A-Z]+)-')), '{}') INTO v_pfx
    FROM public.nf_vouchers v WHERE v.company_id = p_company_id AND v.voucher_no ~ '^[A-Z]+-';

  WITH legs AS (
    SELECT l.id, l.voucher_id, v.voucher_no, NULLIF(btrim(v.manual_no), '') AS manual_no,
           v.voucher_date, v.narration, l.memo, l.line_no, l.account_code,
           COALESCE(l.credit, 0) - COALESCE(l.debit, 0) AS amt, pt.name AS party,
           row_number() OVER (ORDER BY v.voucher_date, v.sort, v.created_at, v.id, l.line_no) AS ord
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
     WHERE l.company_id = p_company_id AND l.account_code IN ('21100', '21150') AND v.status = 'POSTED'
       AND (p_to IS NULL OR v.voucher_date <= p_to)
  ),
  vouch AS (
    SELECT voucher_id, min(voucher_no) AS voucher_no, min(manual_no) AS manual_no, min(voucher_date) AS d,
           min(narration) AS narration, sum(amt) AS net, min(ord) AS ord
      FROM legs GROUP BY voucher_id
  ),
  -- money that came INTO token money from outside: a token receipt
  rcpt AS (
    SELECT vo.*, COALESCE(vo.manual_no, vo.voucher_no) AS vno,
           COALESCE(
             (public._nf_receipt_nos(vo.narration))[1],
             (SELECT (public._nf_receipt_nos(l.memo))[1] FROM legs l
               WHERE l.voucher_id = vo.voucher_id AND cardinality(public._nf_receipt_nos(l.memo)) > 0
               ORDER BY l.line_no LIMIT 1)) AS own_no,
           ARRAY(SELECT k FROM unnest(
                   CASE WHEN cardinality(public._nf_unit_keys(vo.narration, v_pfx)) > 0
                        THEN public._nf_unit_keys(vo.narration, v_pfx)
                        ELSE ARRAY(SELECT DISTINCT a.ukey FROM public._nf_token_alloc(p_company_id, p_to) a
                                    WHERE a.voucher_id = vo.voucher_id AND a.ukey IS NOT NULL) END) k
                 ORDER BY k) AS ukeys,
           (SELECT string_agg(DISTINCT l.party, ', ') FROM legs l
             WHERE l.voucher_id = vo.voucher_id AND l.amt > 0 AND NOT public._nf_is_placeholder_party(l.party)) AS own_buyer
      FROM vouch vo
     WHERE vo.net > 0
  ),
  -- later vouchers that only move token money (net 0) and name a number
  moves AS (
    SELECT l.*, (public._nf_receipt_nos(l.memo))[1] AS no1,
           public._nf_receipt_nos(l.memo) AS allnos,
           public._nf_voucher_refs(l.memo, v_pfx) AS refs,
           ARRAY(SELECT k FROM unnest(public._nf_unit_keys(l.memo, v_pfx)) k ORDER BY k) AS ukeys
      FROM legs l JOIN vouch vo ON vo.voucher_id = l.voucher_id
     WHERE vo.net <= 0 AND l.amt > 0
  ),
  by_ref AS (   -- "Receipt #146 — LG-56/99 (BRV-0013)"
    SELECT DISTINCT ON (r.voucher_id) r.voucher_id, m.no1, m.party, COALESCE(m.manual_no, m.voucher_no) AS via
      FROM rcpt r JOIN moves m ON m.no1 IS NOT NULL
       AND (r.manual_no = ANY (m.refs) OR r.voucher_no = ANY (m.refs))
     ORDER BY r.voucher_id, m.ord DESC
  ),
  by_units AS ( -- "Receipt #151 Ishtiaq — GF-51/52/53/54": the same units, no number yet
    SELECT DISTINCT ON (r.voucher_id) r.voucher_id, m.no1, m.party, COALESCE(m.manual_no, m.voucher_no) AS via
      FROM rcpt r JOIN moves m ON m.no1 IS NOT NULL AND cardinality(m.refs) = 0
       AND cardinality(m.ukeys) > 0 AND m.ukeys = r.ukeys AND m.voucher_date >= r.d
     WHERE r.own_no IS NULL AND NOT EXISTS (SELECT 1 FROM by_ref b WHERE b.voucher_id = r.voucher_id)
     ORDER BY r.voucher_id, m.ord
  ),
  numbered AS (
    SELECT r.*,
           COALESCE(br.no1, r.own_no, bu.no1) AS no,
           COALESCE(br.via, CASE WHEN r.own_no IS NULL THEN bu.via END) AS via,
           NULLIF(concat_ws(', ', r.own_buyer,
                    CASE WHEN br.no1 IS NOT NULL AND NOT public._nf_is_placeholder_party(br.party) THEN br.party END,
                    CASE WHEN br.no1 IS NULL AND r.own_no IS NULL AND NOT public._nf_is_placeholder_party(bu.party) THEN bu.party END), '') AS buyer_raw
      FROM rcpt r
      LEFT JOIN by_ref br ON br.voucher_id = r.voucher_id
      LEFT JOIN by_units bu ON bu.voucher_id = r.voucher_id
  ),
  inrange AS (
    SELECT * FROM numbered WHERE p_from IS NULL OR d >= p_from
  ),
  -- names given later for a number ("Token #140 buyer confirmed: Abdul Qahar")
  later_names AS (
    SELECT DISTINCT q AS no, m.party
      FROM moves m, unnest(m.allnos) q
     WHERE NOT public._nf_is_placeholder_party(m.party) AND m.party IS NOT NULL
  ),
  buyers AS (
    SELECT no, string_agg(DISTINCT b, ', ' ORDER BY b) AS buyers, count(DISTINCT b) AS nb
      FROM (
        SELECT i.no, btrim(x) AS b FROM inrange i, unnest(string_to_array(i.buyer_raw, ',')) x WHERE i.no IS NOT NULL
        UNION
        SELECT ln.no, ln.party FROM later_names ln WHERE ln.no IN (SELECT no FROM inrange WHERE no IS NOT NULL)
      ) z WHERE b IS NOT NULL AND b <> ''
     GROUP BY no
  ),
  -- buyers per voucher, for the duplicate test: the same number on two
  -- vouchers that belong to different buyers
  vbuy AS (
    SELECT i.no, i.voucher_id, btrim(x) AS b
      FROM inrange i, unnest(string_to_array(COALESCE(i.buyer_raw, ''), ',')) x
     WHERE i.no IS NOT NULL AND btrim(x) <> ''
  ),
  dup AS (
    SELECT no FROM inrange WHERE no IS NOT NULL GROUP BY no
    HAVING count(DISTINCT voucher_id) > 1
       AND (SELECT count(DISTINCT b) FROM vbuy WHERE vbuy.no = inrange.no) > 1
  ),
  ul AS (
    SELECT DISTINCT ON (k) k, u.unit_no
      FROM public.units u JOIN public.projects p ON p.id = u.project_id AND p.company_id = p_company_id
      CROSS JOIN LATERAL (SELECT public._nf_unit_no_key(u.unit_no) AS k) kk
     WHERE kk.k IS NOT NULL ORDER BY k, u.created_at
  ),
  per_no AS (
    SELECT i.no, min(i.d) AS first_date, max(i.d) AS last_date,
           jsonb_agg(jsonb_build_object('voucher_no', i.vno, 'system_no', i.voucher_no, 'date', i.d,
                                        'amount', i.net, 'via', i.via) ORDER BY i.ord) AS vouchers,
           sum(i.net) AS amount,
           (SELECT string_agg(DISTINCT COALESCE(ul.unit_no,
                      split_part(uk.key, '|', 1) || '-' || split_part(uk.key, '|', 2)
                      || CASE WHEN split_part(uk.key, '|', 3) <> '' THEN '-' || split_part(uk.key, '|', 3) ELSE '' END), ', ')
              FROM inrange i2 CROSS JOIN LATERAL unnest(i2.ukeys) AS uk(key) LEFT JOIN ul ON ul.k = uk.key
             WHERE i2.no = i.no) AS units
      FROM inrange i WHERE i.no IS NOT NULL GROUP BY i.no
  ),
  span AS (SELECT min(no) AS lo, max(no) AS hi FROM per_no)
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'numbers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'no', p.no, 'first_date', p.first_date, 'last_date', p.last_date,
                 'vouchers', p.vouchers, 'buyer', b.buyers, 'units', p.units, 'amount', p.amount,
                 'duplicate', p.no IN (SELECT no FROM dup)) ORDER BY p.no)
               FROM per_no p LEFT JOIN buyers b ON b.no = p.no), '[]'::jsonb),
    'duplicates', COALESCE((SELECT jsonb_agg(no ORDER BY no) FROM dup), '[]'::jsonb),
    'gaps', COALESCE((SELECT jsonb_agg(g ORDER BY g) FROM span, generate_series(span.lo, span.hi) g
                      WHERE g NOT IN (SELECT no FROM per_no)), '[]'::jsonb),
    'lowest', (SELECT lo FROM span), 'highest', (SELECT hi FROM span),
    'no_number', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'voucher_no', i.vno, 'system_no', i.voucher_no, 'date', i.d, 'amount', i.net,
                   'buyer', i.own_buyer, 'narration', i.narration) ORDER BY i.ord)
                 FROM inrange i WHERE i.no IS NULL), '[]'::jsonb),
    'totals', jsonb_build_object(
       'receipts', (SELECT count(*) FROM inrange),
       'numbers', (SELECT count(*) FROM per_no),
       'amount', (SELECT COALESCE(sum(net), 0) FROM inrange),
       'no_number_amount', (SELECT COALESCE(sum(net), 0) FROM inrange WHERE no IS NULL)))
    INTO v_out;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_token_register(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)
  RETURN public._nf_token_ledger_body(p_company_id, p_from, p_to);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_trial_balance(p_company_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)

  WITH bal AS (
    SELECT a.code, a.name, a.qb_type, a.parent_code,
           COALESCE(sum(l.debit - l.credit) FILTER (
             WHERE v.status = 'POSTED' AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)), 0) AS net
      FROM public.nf_accounts a
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = a.company_id AND l.account_code = a.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE a.company_id = p_company_id
     GROUP BY a.code, a.name, a.qb_type, a.parent_code
    HAVING COALESCE(sum(l.debit - l.credit) FILTER (
             WHERE v.status = 'POSTED' AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)), 0) <> 0
  )
  SELECT jsonb_build_object(
    'as_of', p_as_of,
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'code', code, 'name', name, 'qb_type', qb_type, 'parent_code', parent_code,
               'debit', GREATEST(net, 0), 'credit', GREATEST(-net, 0)) ORDER BY code)
             FROM bal), '[]'::jsonb),
    'total_debit',  (SELECT COALESCE(sum(GREATEST(net, 0)), 0) FROM bal),
    'total_credit', (SELECT COALESCE(sum(GREATEST(-net, 0)), 0) FROM bal))
    INTO v_out;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_iif_list_candidates(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box login (20261118i)

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', v.id, 'voucher_no', v.voucher_no, 'voucher_date', v.voucher_date, 'narration', v.narration)
           ORDER BY v.voucher_date, v.sort), '[]'::jsonb)
    INTO v_out
    FROM public.nf_vouchers v
   WHERE v.company_id = p_company_id AND v.status = 'POSTED' AND v.iif_exportable
     AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
     AND NOT EXISTS (SELECT 1 FROM public.nf_iif_batch_vouchers bv WHERE bv.voucher_id = v.id);
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_review(p_site_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(d.company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(d.company_id);  -- not the site cash box login (20261118i)
  RETURN public.nf_site_day_json(d.id) || jsonb_build_object(
    'review', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'line_id', l.id, 'line_no', l.line_no, 'side', l.side, 'doc_no', l.doc_no, 'party', l.party_name,
        'units', l.unit_codes, 'token_no', l.token_no, 'head', l.head_code, 'via', l.via, 'amount', l.amount,
        'bank_ref', l.bank_ref, 'remarks', l.remarks, 'version', l.version,
        'status', l.match_status, 'reason', l.match_reason, 'proposal', l.proposal, 'ho_head', l.ho_head_code,
        'resolution', l.resolution, 'resolved_at', l.resolved_at,
        'ho', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object(
                 'id', v.id, 'voucher_no', v.voucher_no, 'manual_no', v.manual_no, 'narration', v.narration,
                 'real_date', public._nf_voucher_real_date(v.narration, v.real_date, v.created_at),
                 'legs', (SELECT jsonb_agg(jsonb_build_object('account', g.account_code, 'debit', g.debit, 'credit', g.credit)
                                           ORDER BY g.line_no) FROM public.nf_voucher_legs g WHERE g.voucher_id = v.id)) END,
        'posted', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id', p.id, 'voucher_no', p.voucher_no, 'manual_no', p.manual_no) END)
      ORDER BY l.side, l.line_no)
      FROM public.nf_site_lines l
      LEFT JOIN public.nf_vouchers v ON v.id = l.matched_voucher_id
      LEFT JOIN public.nf_vouchers p ON p.id = l.posted_voucher_id
     WHERE l.site_day_id = d.id), '[]'::jsonb));
END
$function$;

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
               'voucher_id', vv.id, 'manual_no', vv.manual_no, 'number_pending', vv.manual_no IS NULL,
               'by_name', bm.display_name, 'by_box', bm.cash_via, 'mine', l.created_by = auth.uid()) ORDER BY l.sort)
        FROM public.nf_lines l
        JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.head_code
        LEFT JOIN public.nf_voucher_legs vl ON vl.id = l.id
        LEFT JOIN public.nf_vouchers vv ON vv.id = vl.voucher_id
        LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = vl.party_id
        LEFT JOIN public.nf_members bm ON bm.company_id = l.company_id AND bm.user_id = l.created_by
       WHERE l.day_id = p_day_id), '[]'::jsonb),
    'jvs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'voucher_no', v.voucher_no, 'manual_no', v.manual_no, 'number_pending', v.manual_no IS NULL,
               'narration', v.narration, 'version', v.version, 'mine', v.created_by = auth.uid(),
               'by_name', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by),
               'by_box', (SELECT m.cash_via FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by),
               'total', (SELECT COALESCE(sum(l.debit), 0) FROM public.nf_voucher_legs l WHERE l.voucher_id = v.id))
             ORDER BY v.created_at)
        FROM public.nf_vouchers v
       WHERE v.company_id = d.company_id AND v.day_id IS NULL AND v.source = 'JV'
         AND v.status = 'POSTED' AND v.voucher_date = d.business_date), '[]'::jsonb),
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

CREATE OR REPLACE FUNCTION public.nf_get_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NF:NOT_SIGNED_IN'; END IF;
  RETURN jsonb_build_object(
    'user_id', auth.uid(),
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'company_id', m.company_id,
               'company_name', COALESCE(c.display_name, c.company_name),
               'role', m.role, 'display_name', m.display_name, 'cash_via', m.cash_via,
               'settings', jsonb_build_object(
                  'large_payment_threshold', s.large_payment_threshold, 'pdc_due_days', s.pdc_due_days,
                  'company_line', s.company_line, 'report_title', s.report_title, 'mark', s.mark))
             ORDER BY c.company_name)
        FROM public.nf_members m
        JOIN public.companies c ON c.id = m.company_id
        LEFT JOIN public.nf_settings s ON s.company_id = m.company_id
       WHERE m.user_id = auth.uid() AND m.active), '[]'::jsonb));
END
$function$;

-- Sharose: the site cash box, as an accountant; and the entries posted from his Excel are his
DO $d$
DECLARE co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'; sh uuid; n int;
BEGIN
  SELECT auth_user_id INTO sh FROM public.app_users WHERE company_id = co AND username = 'sharose' AND status = 'active';
  IF sh IS NULL THEN RAISE EXCEPTION 'Sharose login not found'; END IF;
  UPDATE public.nf_members SET role = 'accountant', cash_via = 'Petty', display_name = 'Sharose'
   WHERE company_id = co AND user_id = sh AND role = 'site';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'Sharose site membership: % rows', n; END IF;
  UPDATE public.nf_vouchers SET created_by = sh
   WHERE company_id = co AND manual_no ~ '^S-C[RP]V-[0-9]{4}$' AND narration LIKE '%site cash, Sharose%';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 62 THEN RAISE EXCEPTION 'expected 62 site vouchers, % matched', n; END IF;
  -- the screen's names for Awami's two cash boxes (display label only; the account names and the
  -- QuickBooks names stay as they are)
  UPDATE public.nf_accounts SET via_label = CASE via WHEN 'Cash' THEN 'Head Office Cash' ELSE 'Site Cash' END
   WHERE company_id = co AND via IN ('Cash', 'Petty');
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 2 THEN RAISE EXCEPTION 'expected 2 cash accounts, % matched', n; END IF;
END $d$;

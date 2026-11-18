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
--     office: the site cash box login cannot run them;
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
END $d$;

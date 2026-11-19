-- ══ NexuFinance: cash moved between Head Office Cash and Site Cash, from the voucher popups (20261119h) ══
-- NOT APPLIED until the owner says yes.
--
-- Owner, 19-Nov: "headoffice cash jab mai site accountant ko dun to entry nahi hoti" — there is no way on the
-- screen to move cash from Head Office Cash to Site Cash, or back. (The Head Office sheet's old "given to Site
-- Cash" box is one-way, has no paper number, and the site login cannot use it.)
--
-- nf_save_cash_transfer: one voucher, Dr the box that got the cash / Cr the box that gave it. Like a deposit
-- (docs/PLAN.md §53) it is a transfer, never money received or paid: both legs are cash boxes, so nf_lines
-- leaves it out and it shows under Transfers.
--   p_type 'CPV' — entered by the box that GAVE the cash (Cash payment popup: "Cash given to …")
--   p_type 'CRV' — entered by the box that GOT the cash (Cash receipt popup: "Cash received from …")
-- A box login may enter it only from its own side (CPV from its box, CRV into its box); a director either.
-- The paper number is needed before Close day like any CPV / CRV.
-- No double booking: if the OTHER login already has this transfer (same two boxes, same direction, same
-- amount, within a day either side), it is refused — the site box is told only "Head Office has it".

CREATE OR REPLACE FUNCTION public.nf_save_cash_transfer(p_day_id uuid, p_type text, p_voucher_no text, p_from text, p_to text,
  p_amount numeric, p_description text, p_real_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  v_type text := upper(btrim(COALESCE(p_type, '')));
  v_manual text := upper(btrim(COALESCE(p_voucher_no, '')));
  v_from text; v_to text; v_from_label text; v_to_label text; v_floor text; v_bdate date; v_sort integer;
  v_system text; v_id uuid; v_narr text; v_used public.nf_vouchers; v_dup record;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  IF v_type NOT IN ('CPV', 'CRV') THEN RAISE EXCEPTION 'NF:BAD_VOUCHER_TYPE' USING DETAIL = COALESCE(p_type, '(none)'); END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from NOT IN ('Cash', 'Petty') OR p_to NOT IN ('Cash', 'Petty') OR p_from = p_to THEN
    RAISE EXCEPTION 'NF:TRANSFER_CASH_AND_SITE_BOX_ONLY' USING DETAIL = COALESCE(p_from, '(none)') || ' -> ' || COALESCE(p_to, '(none)');
  END IF;
  -- a box login enters only its own side: the cash it gave (CPV) or the cash it got (CRV)
  PERFORM public.nf_assert_cash_box(v_company, CASE v_type WHEN 'CPV' THEN p_from ELSE p_to END);
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  IF p_real_date IS NULL THEN RAISE EXCEPTION 'NF:REAL_DATE_REQUIRED'; END IF;
  IF p_real_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'NF:REAL_DATE_FUTURE'; END IF;
  IF v_manual = '' OR v_manual ~ ('^(S-)?' || v_type || '-?$') THEN v_manual := NULL; END IF;

  SELECT code, COALESCE(via_label, name) INTO v_from, v_from_label FROM public.nf_accounts WHERE company_id = v_company AND via = p_from;
  SELECT code, COALESCE(via_label, name) INTO v_to, v_to_label FROM public.nf_accounts WHERE company_id = v_company AND via = p_to;
  IF v_from IS NULL OR v_to IS NULL THEN RAISE EXCEPTION 'NF:VIA_NOT_CONFIGURED'; END IF;

  -- the same transfer, already booked by the other login (either side of it)
  SELECT v.id, COALESCE(v.manual_no, v.voucher_no) AS no, COALESCE(v.real_date, v.voucher_date) AS rd,
         (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v_company AND m.user_id = v.created_by) AS by_name
    INTO v_dup
    FROM public.nf_vouchers v
   WHERE v.company_id = v_company AND v.status = 'POSTED' AND v.created_by IS DISTINCT FROM auth.uid()
     AND COALESCE(v.real_date, v.voucher_date) BETWEEN p_real_date - 1 AND p_real_date + 1
     AND (SELECT count(*) FROM public.nf_voucher_legs g WHERE g.voucher_id = v.id) = 2
     AND EXISTS (SELECT 1 FROM public.nf_voucher_legs g WHERE g.voucher_id = v.id AND g.account_code = v_to   AND g.debit  = p_amount)
     AND EXISTS (SELECT 1 FROM public.nf_voucher_legs g WHERE g.voucher_id = v.id AND g.account_code = v_from AND g.credit = p_amount)
   ORDER BY abs(COALESCE(v.real_date, v.voucher_date) - p_real_date) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'NF:DUPLICATE_ENTRY' USING DETAIL = (CASE WHEN public.nf_member_cash_box(v_company) = 'Petty'
      THEN json_build_object('by', 'Head Office', 'hidden', true)
      ELSE json_build_object('voucher', v_dup.no, 'by', v_dup.by_name, 'date', v_dup.rd, 'amount', p_amount, 'key', 'same transfer') END)::text;
  END IF;
  IF v_manual IS NOT NULL THEN
    SELECT * INTO v_used FROM public.nf_vouchers x
     WHERE x.company_id = v_company AND x.manual_no = v_manual AND upper(split_part(x.voucher_no, '-', 1)) = v_type LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = (CASE WHEN public.nf_member_cash_box(v_company) = 'Petty' AND v_used.created_by IS DISTINCT FROM auth.uid()
        THEN json_build_object('voucher', v_manual, 'by', 'Head Office', 'hidden', true)::text
        ELSE json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no)::text END);
    END IF;
  END IF;

  v_narr := COALESCE(NULLIF(btrim(p_description), ''),
    CASE v_type WHEN 'CPV' THEN 'Cash given to ' || v_to_label || ' from ' || v_from_label
                ELSE 'Cash received in ' || v_to_label || ' from ' || v_from_label END);
  SELECT business_date INTO v_bdate FROM public.nf_days WHERE id = p_day_id;
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_company ORDER BY (code = 'P-W') DESC, sort LIMIT 1;
  SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_vouchers WHERE day_id = p_day_id;
  v_system := public.nf__next_voucher_no(v_company, v_type);
  v_id := public.nf_post_voucher(v_company, p_day_id, v_system, v_bdate, v_narr, v_sort,
    jsonb_build_array(
      jsonb_build_object('account_code', v_to,   'floor_code', v_floor, 'debit',  p_amount),
      jsonb_build_object('account_code', v_from, 'floor_code', v_floor, 'credit', p_amount)));
  BEGIN
    UPDATE public.nf_vouchers SET manual_no = v_manual, real_date = p_real_date WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
  END;
  RETURN public.nf_day_json(p_day_id);
END $function$;

REVOKE ALL ON FUNCTION public.nf_save_cash_transfer(uuid, text, text, text, text, numeric, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_save_cash_transfer(uuid, text, text, text, text, numeric, text, date) TO authenticated;

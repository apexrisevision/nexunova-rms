-- ══ NexuFinance — Site Closing: receipt / voucher number and name required on every line ══
-- NOT APPLIED. For the owner to read first (19-Nov).
--
-- nf_site_save_line refuses a line without its paper number (NF:SITE_DOC_NO_REQUIRED) or without
-- who the money came from / went to (NF:SITE_PARTY_REQUIRED), so the screen's own check cannot be
-- bypassed. Everything else is the function exactly as applied in 20261118a — including a paper
-- number repeating on lines of the same day (posted as n/1, n/2) and never on another day.
-- Lines already saved are not touched; the rule bites on the next save of a line.

CREATE OR REPLACE FUNCTION public.nf_site_save_line(
  p_company_id uuid, p_business_date date, p_line_id uuid, p_side text, p_doc_no text,
  p_party_name text, p_unit_codes text, p_token_no integer, p_head_code text, p_via text,
  p_amount numeric, p_bank_ref text, p_remarks text, p_attachment_url text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d public.nf_site_days;
  l public.nf_site_lines;
  v_head public.nf_accounts;
  v_id uuid;
  v_doc text := NULLIF(upper(btrim(p_doc_no)), '');
  v_other date;
BEGIN
  -- only the site accountant: the site record stays exactly as he entered it.
  -- HO returns the day with a reason, or corrects head/party on the HO
  -- voucher when it accepts the line.
  PERFORM public.nf_require_role(p_company_id, ARRAY['site']);
  IF p_side IS NULL OR p_side NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'NF:SIDE_REQUIRED'; END IF;
  IF p_via  IS NULL OR p_via  NOT IN ('SITE_CASH','BANK') THEN RAISE EXCEPTION 'NF:VIA_UNKNOWN' USING DETAIL = COALESCE(p_via, '(none)'); END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  -- a head HO uses; or, for a site-cash line only, the bank itself: "Bank to Cash"
  -- (IN, a withdrawal into the box) or "Cash to Bank" (OUT, a deposit)
  SELECT * INTO v_head FROM public.nf_accounts
   WHERE company_id = p_company_id AND code = btrim(COALESCE(p_head_code, '')) AND active
     AND ((is_head AND via IS NULL) OR (via = 'Bank' AND p_via = 'SITE_CASH'));
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:HEAD_REQUIRED' USING DETAIL = COALESCE(p_head_code, '(none)'); END IF;
  IF v_head.code = '21100' AND p_token_no IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_TOKEN_NO_REQUIRED' USING HINT = 'Token money needs the token number.';
  END IF;
  -- every line carries its paper number and a name (owner, 19-Nov). A paper number may still
  -- repeat on lines of the SAME day (one voucher, two heads -> n/1, n/2 when posted).
  IF NULLIF(btrim(p_doc_no), '') IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_DOC_NO_REQUIRED' USING HINT = 'Write the receipt or voucher number from the book.';
  END IF;
  IF NULLIF(btrim(p_party_name), '') IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_PARTY_REQUIRED' USING HINT = 'Write who the money came from or went to.';
  END IF;

  IF p_line_id IS NOT NULL THEN
    SELECT * INTO l FROM public.nf_site_lines WHERE id = p_line_id AND company_id = p_company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
    PERFORM public.nf_check_version(p_version, l.version);
    IF l.posted_voucher_id IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_POSTED'; END IF;
    IF l.resolved_by IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_RESOLVED'; END IF;
    SELECT * INTO d FROM public.nf_site_days WHERE id = l.site_day_id FOR UPDATE;
    IF d.business_date <> p_business_date THEN RAISE EXCEPTION 'NF:SITE_LINE_OTHER_DAY'; END IF;
  ELSE
    d := public._nf_site_day_for(p_company_id, p_business_date);
  END IF;
  IF d.status NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'NF:SITE_DAY_LOCKED' USING DETAIL = d.status; END IF;

  -- a paper receipt / voucher number belongs to one day: several lines of that
  -- day may carry it (one voucher, two heads), another day may not
  IF v_doc IS NOT NULL THEN
    SELECT sd.business_date INTO v_other
      FROM public.nf_site_lines x JOIN public.nf_site_days sd ON sd.id = x.site_day_id
     WHERE x.company_id = p_company_id AND x.side = p_side AND upper(btrim(x.doc_no)) = v_doc
       AND x.site_day_id <> d.id
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'NF:DUPLICATE_DOC_NO'
        USING DETAIL = json_build_object('doc_no', btrim(p_doc_no), 'side', p_side, 'used_on', v_other)::text;
    END IF;
  END IF;

  IF p_line_id IS NULL THEN
    INSERT INTO public.nf_site_lines (company_id, site_day_id, line_no, side, doc_no, party_name, unit_codes,
                                      token_no, head_code, via, amount, bank_ref, remarks, attachment_url,
                                      created_by, updated_by)
    VALUES (p_company_id, d.id,
            (SELECT COALESCE(max(line_no), 0) + 1 FROM public.nf_site_lines WHERE site_day_id = d.id),
            p_side, NULLIF(btrim(p_doc_no), ''), NULLIF(btrim(p_party_name), ''), NULLIF(btrim(p_unit_codes), ''),
            p_token_no, v_head.code, p_via, p_amount, NULLIF(btrim(p_bank_ref), ''), NULLIF(btrim(p_remarks), ''),
            NULLIF(btrim(p_attachment_url), ''), auth.uid(), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    -- a changed line is a new claim: whatever matching said about it is void
    UPDATE public.nf_site_lines
       SET side = p_side, doc_no = NULLIF(btrim(p_doc_no), ''), party_name = NULLIF(btrim(p_party_name), ''),
           unit_codes = NULLIF(btrim(p_unit_codes), ''), token_no = p_token_no, head_code = v_head.code,
           via = p_via, amount = p_amount, bank_ref = NULLIF(btrim(p_bank_ref), ''),
           remarks = NULLIF(btrim(p_remarks), ''), attachment_url = NULLIF(btrim(p_attachment_url), ''),
           match_status = 'NEW', matched_voucher_id = NULL, match_reason = NULL, proposal = NULL,
           ho_head_code = NULL, matched_at = NULL,
           version = version + 1, updated_by = auth.uid(), updated_at = now()
     WHERE id = l.id;
  END IF;

  -- the day's version moves with its lines, so a screen that has not seen a
  -- line cannot submit the day
  UPDATE public.nf_site_days SET version = version + 1, updated_by = auth.uid(), updated_at = now() WHERE id = d.id;
  PERFORM public._nf_site_assert_not_negative(p_company_id, d.business_date);
  RETURN public.nf_site_day_json(d.id);
END
$function$;

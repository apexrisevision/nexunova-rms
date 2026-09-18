-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · g · party fallback from description
--
-- Found post-apply by verify-nf-golden-ui.js, which drives the REAL screen
-- (nexufinance.html) with Puppeteer, not a direct RPC call: entering the
-- golden day's real Token Money line ("Token from Muhammad Ali, shop
-- GF-12", head 21100) through the actual UI failed with NF:PARTY_REQUIRED
-- — js/nf/nf-sheet.js has no field to type a party name into, and correctly
-- doesn't; that field is explicitly next-pass scope (docs/PLAN.md §11).
-- This is a real, demonstrated break of "the daily closing screen works
-- end to end unchanged for the cashier" for the single most common
-- transaction type this business has (a real-estate developer collecting
-- token money from unit buyers) — not hypothetical.
--
-- Fix: when no p_party_name is given AND the head actually requires one,
-- nf_save_line resolves/creates the party from the line's own p_description
-- instead of refusing outright. A cashier already writes the buyer's name
-- there for exactly this line type — the golden sample itself proves it
-- ("Token from Muhammad Ali, shop GF-12"). This needs zero UI/JS/HTML
-- changes: nexufinance.html and js/nf/nf-sheet.js are untouched, byte for
-- byte, keeping the actual DoD promise instead of the letter of it.
--
-- Disclosed, not pretended clean: the description is unparsed free text,
-- not a curated customer name — "Token from Muhammad Ali, shop GF-12"
-- becomes the party's name verbatim, not "Muhammad Ali" alone. Real name
-- hygiene (parsing, matching, a proper picker) is exactly what the
-- party-entry screen (next pass) is for. Only heads that requires_party
-- ever touch this path — an ordinary expense line's description never
-- creates a party record, checked explicitly (v_requires_party) rather
-- than assumed.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_save_line(p_day_id uuid, p_line_id uuid, p_side text, p_voucher_no text, p_description text, p_head text, p_floor text, p_via text, p_amount numeric, p_version integer, p_party_name text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  v_via_code text;
  v_voucher_key text := upper(btrim(p_voucher_no));
  v_existing_head public.nf_voucher_legs;
  v_existing_via  public.nf_voucher_legs;
  v_voucher public.nf_vouchers;
  v_bdate date;
  v_sort integer;
  v_party_id uuid;
  v_party_source text;
  v_requires_party boolean;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  IF p_side IS NULL OR p_side NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'NF:SIDE_REQUIRED'; END IF;
  IF p_voucher_no IS NULL OR btrim(p_voucher_no) = '' THEN RAISE EXCEPTION 'NF:VOUCHER_REQUIRED'; END IF;
  IF p_head  IS NULL OR btrim(p_head)  = '' THEN RAISE EXCEPTION 'NF:HEAD_REQUIRED';  END IF;
  IF p_floor IS NULL OR btrim(p_floor) = '' THEN RAISE EXCEPTION 'NF:FLOOR_REQUIRED'; END IF;
  IF p_via   IS NULL OR btrim(p_via)   = '' THEN RAISE EXCEPTION 'NF:VIA_REQUIRED';   END IF;
  IF p_via NOT IN ('Cash','Petty','Bank') THEN RAISE EXCEPTION 'NF:VIA_UNKNOWN' USING DETAIL = p_via; END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;

  SELECT requires_party INTO v_requires_party FROM public.nf_accounts WHERE company_id = v_company AND code = btrim(p_head);
  IF v_requires_party THEN
    v_party_source := COALESCE(NULLIF(btrim(p_party_name), ''), NULLIF(btrim(p_description), ''));
    IF v_party_source IS NOT NULL THEN
      v_party_id := public.nf_resolve_party(v_company, v_party_source);
      IF v_party_id IS NULL THEN
        v_party_id := (public.nf_create_party(v_company, v_party_source, 'customer')->>'id')::uuid;
      END IF;
    END IF;
  ELSIF NULLIF(btrim(p_party_name), '') IS NOT NULL THEN
    -- an explicit name was still given for a non-party-required head (a
    -- future screen's caller, say) — honor it, same resolve-or-create
    v_party_id := public.nf_resolve_party(v_company, p_party_name);
    IF v_party_id IS NULL THEN
      v_party_id := (public.nf_create_party(v_company, p_party_name, 'customer')->>'id')::uuid;
    END IF;
  END IF;

  -- same voucher-numbering conventions the old table CHECKs enforced,
  -- now asserted explicitly since the physical table's constraints no
  -- longer sit directly on what the client calls "nf_lines"
  IF NOT ((p_side = 'IN'  AND v_voucher_key ~ '^(CRV|BRV)-\S+$') OR
          (p_side = 'OUT' AND v_voucher_key ~ '^(CPV|BPV)-\S+$')) THEN
    RAISE EXCEPTION 'NF:VOUCHER_PREFIX';
  END IF;
  IF (left(v_voucher_key, 1) = 'C') <> (p_via IN ('Cash','Petty')) THEN
    RAISE EXCEPTION 'NF:VOUCHER_VIA_MISMATCH';
  END IF;

  SELECT a.code INTO v_via_code FROM public.nf_accounts a WHERE a.company_id = v_company AND a.via = p_via;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VIA_NOT_CONFIGURED' USING DETAIL = p_via; END IF;

  SELECT business_date INTO v_bdate FROM public.nf_days WHERE id = p_day_id;

  IF p_line_id IS NULL THEN
    SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_vouchers WHERE day_id = p_day_id;
    PERFORM public.nf_post_voucher(v_company, p_day_id, p_voucher_no, v_bdate, p_description, v_sort,
      CASE WHEN p_side = 'IN' THEN
        jsonb_build_array(
          jsonb_build_object('account_code', btrim(p_head), 'floor_code', btrim(p_floor), 'party_id', v_party_id::text, 'credit', p_amount),
          jsonb_build_object('account_code', v_via_code,     'floor_code', btrim(p_floor), 'debit',  p_amount))
      ELSE
        jsonb_build_array(
          jsonb_build_object('account_code', btrim(p_head), 'floor_code', btrim(p_floor), 'party_id', v_party_id::text, 'debit',  p_amount),
          jsonb_build_object('account_code', v_via_code,     'floor_code', btrim(p_floor), 'credit', p_amount))
      END);
  ELSE
    SELECT * INTO v_existing_head FROM public.nf_voucher_legs WHERE id = p_line_id AND line_no = 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
    SELECT * INTO v_voucher FROM public.nf_vouchers WHERE id = v_existing_head.voucher_id AND day_id = p_day_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
    PERFORM public.nf_check_version(p_version, v_voucher.version);
    SELECT * INTO v_existing_via FROM public.nf_voucher_legs WHERE voucher_id = v_voucher.id AND line_no = 2;

    BEGIN
      UPDATE public.nf_vouchers
         SET voucher_no = upper(btrim(p_voucher_no)), narration = NULLIF(btrim(p_description), ''),
             version = version + 1, updated_by = auth.uid(), updated_at = now()
       WHERE id = v_voucher.id;
    EXCEPTION WHEN unique_violation THEN
      DECLARE v_used date; BEGIN
        SELECT v.voucher_date INTO v_used FROM public.nf_vouchers v
         WHERE v.company_id = v_company AND v.voucher_key = v_voucher_key AND v.id <> v_voucher.id;
        RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER'
          USING DETAIL = json_build_object('voucher', v_voucher_key, 'used_on', v_used)::text;
      END;
    END;

    -- p_party_name/description NULL (most calls today) must not erase a
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

COMMIT;

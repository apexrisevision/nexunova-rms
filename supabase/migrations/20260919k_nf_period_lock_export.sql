-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19k · Period locking tied to
-- export (go-live blocker #2, §27.3) — voucher-level, not day-level
--
-- NOT YET APPLIED — awaiting explicit go-ahead. Alters two existing write
-- paths (nf_save_line's edit branch, nf_delete_line) — one of the standing
-- always-ask conditions on its own, and the highest-stakes kind: a refusal
-- this migration adds where none existed before.
--
-- The gap, as flagged in §27.3: nf_reopen_day has no check at all against
-- export status. A director can reopen a day and edit or delete a voucher
-- already exported to QuickBooks (nf_iif_batch_vouchers), with nothing to
-- prevent or flag it — NexuFinance and QuickBooks silently diverge from
-- that point on, and nothing in either system says so.
--
-- Deliberately scoped to the VOUCHER, not the day. nf_reopen_day itself is
-- left untouched — reopening a day to post one more receipt that never made
-- it in is normal and should stay easy; the risk the owner actually named is
-- editing/deleting a voucher QuickBooks already has, not reopening the day
-- around it. So: nf_save_line's EDIT branch (p_line_id IS NOT NULL — an
-- existing voucher's legs) and nf_delete_line both now refuse outright if
-- the voucher has any row in nf_iif_batch_vouchers, regardless of the day's
-- own OPEN/CLOSED status. Creating a brand-new voucher (nf_save_line with
-- p_line_id NULL) is completely unaffected, on a reopened day or otherwise.
--
-- A hard refusal, not an override-with-reason — deliberately. The IIF
-- export system already has a real re-export/reason mechanism
-- (nf_iif_record_batch's is_reexport/reason, 20260919h) for the case where
-- Awami's own books need to correct something QuickBooks already has; that
-- is the owner's existing channel for a deliberate correction, so this
-- migration does not duplicate it with a second, weaker one on the entry
-- screen. If the owner wants an in-screen override later, that's a real,
-- separate design conversation, not assumed here.
--
-- New error code: NF:VOUCHER_ALREADY_EXPORTED, DETAIL carries the voucher
-- number and when it was exported, so the screen can say something useful
-- rather than a bare refusal.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_save_line(p_day_id uuid, p_line_id uuid, p_side text, p_voucher_no text, p_description text, p_head text, p_floor text, p_via text, p_amount numeric, p_version integer, p_party_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  v_requires_party boolean;
  v_exported_at timestamptz;
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

COMMIT;

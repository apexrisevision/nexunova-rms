-- ══ NexuFinance: duplicate guard on save + RMS token sync (20261119a) ══
-- NOT APPLIED until the owner says yes.
--
-- 1. DUPLICATE GUARD. Before a receipt, payment or bank withdrawal is saved, nf_dup_check looks at the vouchers
--    the OTHER login entered (any login that is not the caller), dated within ±3 days:
--      BLOCK  the same cheque (full number or its last 4+ digits) on a voucher that moved the bank the same way,
--             the same bank / Raast / TT / IBFT / slip reference on such a voucher, or the same token / receipt
--             number on a token-head voucher in the same direction;
--      WARN   the same amount and direction, within ±2 days, with the same party (4+ letters) or the same head.
--    A block is refused by the database (NF:DUPLICATE_ENTRY, naming the voucher, who entered it and when). A
--    warning is shown by the voucher popup, which saves only after "Yes, this is a different payment".
--    The keys come from the line's description (and party), read with the Stage 2 helpers (_nf_cheques,
--    _nf_cheque_hit, _nf_receipt_nos, _nf_letters). A voucher's date is real_date, else voucher_date.
-- 2. RMS TOKEN SYNC. A token line (head 21100) saved in NexuFinance by either login moves the token on the RMS
--    hold of the unit(s) its description names ("Unit SF-208", "Units GF-250-251", "LG 20, LG 21 …"), split
--    equally: a receipt adds, a return takes away, an edit first gives back the old amount, a delete gives it
--    back. Through rms_set_reservation_token (which writes the RMS audit as the NexuFinance person). A save never
--    fails because of it: a unit with no active hold, or no unit at all, is written to nf_audit
--    (entity rms_token; nf_audit allows only its fixed actions, so UPDATE) and listed by nf_token_sync_list.
-- 3. BACKFILL as the director: S-CRV-0003 (#317 Riaz Ahmad SF-208, 1,00,000) and S-CRV-0004 (#210 Ali Haider
--    GF-250/GF-251, 50,000). S-CRV-0001 (#205 Muhammad Tahir, 10,000) names no unit — listed, not guessed.

CREATE OR REPLACE FUNCTION public.nf_dup_check(p_company_id uuid, p_kind text, p_via text, p_head text, p_amount numeric,
  p_description text, p_party_name text, p_date date, p_exclude uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE
  c_bank text; v_chqs text[]; v_refs text[]; v_toks int[]; v_party text;
  v_bankish boolean := p_via = 'Bank' OR p_kind IN ('WDL', 'DEP');
  v_block jsonb := '[]'; v_warn jsonb := '[]'; h record; v_key text;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  SELECT code INTO c_bank FROM public.nf_accounts WHERE company_id = p_company_id AND via = 'Bank';
  v_chqs := public._nf_cheques(p_description);
  SELECT COALESCE(array_agg(DISTINCT upper(x[1])), '{}') INTO v_refs
    FROM regexp_matches(COALESCE(p_description, ''), '(?:ref|raast|tt|ibft|slip|stan|tid|trx|txn)\s*(?:no\.?)?\s*[:#]?\s*([A-Za-z0-9]{6,})', 'gi') x;
  v_toks := CASE WHEN p_head = '21100' THEN public._nf_receipt_nos(p_description) ELSE '{}' END;
  v_party := public._nf_letters(p_party_name);

  FOR h IN
    WITH v0 AS (
      SELECT v.id, COALESCE(v.manual_no, v.voucher_no) AS no, v.narration, v.created_by,
             COALESCE(v.real_date, v.voucher_date) AS rd
        FROM public.nf_vouchers v
       WHERE v.company_id = p_company_id AND v.status = 'POSTED' AND v.source = 'DAY'
         AND v.id IS DISTINCT FROM p_exclude AND v.created_by IS DISTINCT FROM auth.uid()
         AND COALESCE(v.real_date, v.voucher_date) BETWEEN p_date - 3 AND p_date + 3)
    SELECT v0.*, (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = p_company_id AND m.user_id = v0.created_by) AS by_name,
           COALESCE(sum(g.debit), 0) AS amt,
           COALESCE(sum(g.debit)  FILTER (WHERE g.account_code = c_bank), 0) AS bank_dr,
           COALESCE(sum(g.credit) FILTER (WHERE g.account_code = c_bank), 0) AS bank_cr,
           COALESCE(sum(g.debit)  FILTER (WHERE a.via IS NOT NULL), 0) AS via_dr,
           COALESCE(sum(g.credit) FILTER (WHERE a.via IS NOT NULL), 0) AS via_cr,
           count(*) FILTER (WHERE a.via IS NULL) AS nonvia,
           (array_agg(g.account_code ORDER BY g.line_no) FILTER (WHERE a.via IS NULL))[1] AS head,
           bool_or(g.account_code = '21100') AS has_token,
           string_agg(p.name, ' ') AS parties,
           public._nf_cheques(v0.narration) AS cheques, public._nf_receipt_nos(v0.narration) AS tokens,
           upper(regexp_replace(COALESCE(v0.narration, ''), '[^A-Za-z0-9]', '', 'g')) AS alnum,
           public._nf_letters(v0.narration) AS letters
      FROM v0
      JOIN public.nf_voucher_legs g ON g.voucher_id = v0.id
      JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
      LEFT JOIN public.nf_parties p ON p.id = g.party_id
     GROUP BY v0.id, v0.no, v0.narration, v0.created_by, v0.rd
  LOOP
    v_key := NULL;
    -- the same direction: money in / out of a box or the bank; a withdrawal is bank out, a deposit bank in
    IF NOT (CASE p_kind WHEN 'IN'  THEN h.nonvia > 0 AND h.via_dr > 0
                       WHEN 'OUT' THEN h.nonvia > 0 AND h.via_cr > 0
                       WHEN 'WDL' THEN h.bank_cr > 0
                       WHEN 'DEP' THEN h.bank_dr > 0 ELSE false END) THEN CONTINUE; END IF;
    -- BLOCK: a cheque or a reference is the same bank event only on a voucher that moved the bank
    IF v_bankish AND (h.bank_dr > 0 OR h.bank_cr > 0) THEN
      SELECT 'cheque ' || c INTO v_key FROM unnest(v_chqs) c WHERE public._nf_cheque_hit(c, h.cheques) LIMIT 1;
      IF v_key IS NULL THEN
        SELECT 'reference ' || r INTO v_key FROM unnest(v_refs) r WHERE position(r IN h.alnum) > 0 LIMIT 1;
      END IF;
    END IF;
    IF v_key IS NULL AND h.has_token AND cardinality(v_toks) > 0 THEN
      SELECT 'token #' || t INTO v_key FROM unnest(v_toks) t WHERE t = ANY (h.tokens) LIMIT 1;
    END IF;
    IF v_key IS NOT NULL THEN
      v_block := v_block || jsonb_build_object('voucher', h.no, 'by', h.by_name, 'date', h.rd, 'amount', h.amt, 'key', v_key, 'narration', left(h.narration, 120));
      CONTINUE;
    END IF;
    -- WARN: same amount, near date, same party or same head
    IF h.amt = p_amount AND abs(h.rd - p_date) <= 2
       AND ((length(v_party) >= 4 AND (position(v_party IN h.letters) > 0 OR position(v_party IN public._nf_letters(h.parties)) > 0))
            OR (p_head IS NOT NULL AND h.head = p_head)) THEN
      v_warn := v_warn || jsonb_build_object('voucher', h.no, 'by', h.by_name, 'date', h.rd, 'amount', h.amt,
        'key', CASE WHEN p_head IS NOT NULL AND h.head = p_head THEN 'same amount and head' ELSE 'same amount and party' END,
        'narration', left(h.narration, 120));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('block', v_block, 'warn', v_warn);
END $f$;
REVOKE ALL ON FUNCTION public.nf_dup_check(uuid, text, text, text, numeric, text, text, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_dup_check(uuid, text, text, text, numeric, text, text, date, uuid) TO authenticated;

-- the unit codes a description names: "Unit SF-208", "Units GF-250-251", "FF 108/184", "LG 20, LG 21 and LG 23"
CREATE OR REPLACE FUNCTION public._nf_units_in(p text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE m text[]; n text[]; pre text; out text[] := '{}';
BEGIN
  FOR m IN SELECT regexp_matches(upper(COALESCE(p, '')),
      '(?:^|[^A-Z0-9])(LG|UG|GF|FF|SF|TF|[0-9]F)[ -]?([0-9]{1,3}[A-Z]?)((?:[ ]*(?:,|/|-|&|AND)[ ]*(?:(?:LG|UG|GF|FF|SF|TF|[0-9]F)[ -]?)?[0-9]{1,3}[A-Z]?(?![0-9A-Z-]*-(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)))*)', 'g') LOOP
    pre := m[1];
    out := out || (pre || '-' || m[2]);
    FOR n IN SELECT regexp_matches(COALESCE(m[3], ''), '(?:(LG|UG|GF|FF|SF|TF|[0-9]F)[ -]?)?([0-9]{1,3}[A-Z]?)', 'g') LOOP
      IF n[1] IS NOT NULL THEN pre := n[1]; END IF;
      out := out || (pre || '-' || n[2]);
    END LOOP;
  END LOOP;
  RETURN (SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), '{}') FROM unnest(out) u);
END $f$;

CREATE OR REPLACE FUNCTION public._nf_rms_token_sync(p_company_id uuid, p_voucher_id uuid, p_description text, p_side text,
  p_amount numeric, p_sign int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE
  v_units text[] := public._nf_units_in(p_description);
  v_n int := cardinality(public._nf_units_in(p_description));
  v_share numeric; v_left numeric; u text; i int := 0; v_res public.reservations; v_new numeric; v_out jsonb := '[]';
  v_party text := NULLIF(btrim(split_part(regexp_replace(COALESCE(p_description, ''), '^.*?(?:Token|Receipt)\s*#?\s*[0-9]+\s*(?:returned)?\s*[—-]\s*', '', 'i'), ',', 1)), '');
  v_dir numeric := CASE WHEN p_side = 'IN' THEN 1 ELSE -1 END * p_sign;
  v_no text := (SELECT COALESCE(manual_no, voucher_no) FROM public.nf_vouchers WHERE id = p_voucher_id);
BEGIN
  IF v_n = 0 THEN
    v_out := jsonb_build_array(jsonb_build_object('unit', NULL, 'result', 'no unit named — not synced'));
  ELSE
    v_left := p_amount;
    FOREACH u IN ARRAY v_units LOOP
      i := i + 1;
      v_share := CASE WHEN i = v_n THEN v_left ELSE round(p_amount / v_n, 2) END;
      v_left := v_left - v_share;
      SELECT r.* INTO v_res FROM public.reservations r JOIN public.units un ON un.id = r.unit_id JOIN public.projects pj ON pj.id = un.project_id
       WHERE pj.company_id = p_company_id AND upper(un.unit_code) = u AND r.status = 'active' ORDER BY r.created_at DESC LIMIT 1;
      IF NOT FOUND THEN
        v_out := v_out || jsonb_build_object('unit', u, 'share', v_share * v_dir, 'result', 'no active hold in RMS — not synced');
        CONTINUE;
      END IF;
      v_new := greatest(0, COALESCE(v_res.token_amount, 0) + v_share * v_dir);
      BEGIN
        PERFORM public.rms_set_reservation_token(p_company_id, u, v_new, CASE WHEN v_dir > 0 THEN v_party END,
          format('NexuFinance %s: token %s%s', v_no, CASE WHEN v_dir > 0 THEN '+' ELSE '−' END, public.nf_fmt(v_share)));
        v_out := v_out || jsonb_build_object('unit', u, 'share', v_share * v_dir, 'from', v_res.token_amount, 'to', v_new, 'result', 'synced');
      EXCEPTION WHEN OTHERS THEN
        v_out := v_out || jsonb_build_object('unit', u, 'share', v_share * v_dir, 'result', SQLERRM);
      END;
    END LOOP;
  END IF;
  INSERT INTO public.nf_audit (company_id, day_id, entity, entity_id, action, actor, actor_name, before, after, reason)
  VALUES (p_company_id, (SELECT day_id FROM public.nf_vouchers WHERE id = p_voucher_id), 'rms_token', p_voucher_id::text,
          'UPDATE', auth.uid(), public.nf_actor_name(p_company_id), NULL,
          jsonb_build_object('voucher', v_no, 'side', p_side, 'amount', p_amount, 'sign', p_sign, 'units', v_out),
          left(p_description, 200));
  RETURN v_out;
END $f$;
REVOKE ALL ON FUNCTION public._nf_rms_token_sync(uuid, uuid, text, text, numeric, int), public._nf_units_in(text) FROM PUBLIC, anon, authenticated;

-- what did not reach RMS: token lines whose sync found no unit or no active hold (director / accountant)
CREATE OR REPLACE FUNCTION public.nf_token_sync_list(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(p_company_id);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('at', a.at, 'by', a.actor_name, 'voucher', a.after->>'voucher',
            'amount', a.after->'amount', 'units', a.after->'units', 'description', a.reason) ORDER BY a.at DESC)
      FROM public.nf_audit a WHERE a.company_id = p_company_id AND a.entity = 'rms_token'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.after->'units') x WHERE x->>'result' <> 'synced')), '[]');
END $f$;
REVOKE ALL ON FUNCTION public.nf_token_sync_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_token_sync_list(uuid) TO authenticated;

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
  v_dup jsonb; v_old_narr text; v_old_amt numeric;  -- 20261119a
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

  -- the other login may already have booked this (20261119a): refuse the same cheque / reference / token
  v_dup := public.nf_dup_check(v_company, p_side, p_via, btrim(p_head), p_amount, p_description, p_party_name, v_bdate, v_voucher.id);
  IF jsonb_array_length(v_dup->'block') > 0 THEN
    RAISE EXCEPTION 'NF:DUPLICATE_ENTRY' USING DETAIL = (v_dup->'block'->0)::text;
  END IF;
  -- an edited token line first gives back what it had put on the RMS hold (20261119a)
  IF p_line_id IS NOT NULL AND v_existing_head.account_code = '21100' THEN
    v_old_narr := v_voucher.narration; v_old_amt := v_existing_head.debit + v_existing_head.credit;
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

  -- RMS token sync (20261119a)
  IF v_old_amt IS NOT NULL THEN
    PERFORM public._nf_rms_token_sync(v_company, v_voucher.id, v_old_narr, p_side, v_old_amt, -1);
  END IF;
  IF btrim(p_head) = '21100' THEN
    PERFORM public._nf_rms_token_sync(v_company, COALESCE(v_new_id, v_voucher.id), p_description, p_side, p_amount, 1);
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
  PERFORM public.nf_assert_own_voucher(v_voucher.id);  -- only its own entrant (20261118i)

  SELECT b.exported_at INTO v_exported_at FROM public.nf_iif_batch_vouchers b
   WHERE b.voucher_id = v_voucher.id ORDER BY b.exported_at DESC LIMIT 1;
  IF v_exported_at IS NOT NULL THEN
    RAISE EXCEPTION 'NF:VOUCHER_ALREADY_EXPORTED'
      USING DETAIL = json_build_object('voucher', v_voucher.voucher_no, 'exported_at', v_exported_at)::text;
  END IF;

  PERFORM public.nf_check_version(p_version, v_voucher.version);
  IF v_head.account_code = '21100' THEN  -- RMS token sync (20261119a)
    PERFORM public._nf_rms_token_sync(v_voucher.company_id, v_voucher.id, v_voucher.narration,
      CASE WHEN v_head.credit > 0 THEN 'IN' ELSE 'OUT' END, v_head.debit + v_head.credit, -1);
  END IF;
  DELETE FROM public.nf_voucher_legs WHERE voucher_id = v_voucher.id;
  DELETE FROM public.nf_vouchers WHERE id = v_voucher.id;
  RETURN public.nf_day_json(v_voucher.day_id);
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
  DECLARE v_dup jsonb; BEGIN  -- 20261119a
    v_dup := public.nf_dup_check(v_company, 'WDL', 'Bank', NULL, p_amount,
      COALESCE(p_description, '') || ' chq #' || regexp_replace(COALESCE(p_cheque_no, ''), '[^0-9]', '', 'g'), NULL, p_real_date, NULL);
    IF jsonb_array_length(v_dup->'block') > 0 THEN
      RAISE EXCEPTION 'NF:DUPLICATE_ENTRY' USING DETAIL = (v_dup->'block'->0)::text;
    END IF;
  END;
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

-- backfill, as the director
DO $b$
DECLARE co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'; v record;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '315f2852-852f-4653-9253-a5a27a7828c8', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '315f2852-852f-4653-9253-a5a27a7828c8', true);
  FOR v IN SELECT id, narration, manual_no FROM public.nf_vouchers WHERE company_id = co AND manual_no IN ('S-CRV-0001', 'S-CRV-0003', 'S-CRV-0004') ORDER BY manual_no LOOP
    PERFORM public._nf_rms_token_sync(co, v.id, v.narration, 'IN',
      (SELECT sum(credit) FROM public.nf_voucher_legs WHERE voucher_id = v.id AND account_code = '21100'), 1);
  END LOOP;
END $b$;

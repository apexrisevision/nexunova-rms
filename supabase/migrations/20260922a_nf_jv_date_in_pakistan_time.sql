-- ─────────────────────────────────────────────────────────────────────────
-- NexuFinance — finding Q (docs/findings/2026-09-22-Q-jv-future-date-uses-utc.md),
-- fixed on the owner's instruction ("fix", 2026-09-22).
--
-- nf_jv_save refused any date after CURRENT_DATE. The database runs in UTC
-- and the business in Pakistan (UTC+5), so from 00:00 to 05:00 PKT a JV dated
-- "today" was refused as a future date (NF:DATE_FUTURE). It now compares
-- against Pakistan's date. Nothing else in the function changes; the body is
-- 20260921o's exactly, with that one line. Same signature, so the grants are
-- kept.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_jv_save(p_company_id uuid, p_voucher_no text, p_voucher_date date, p_narration text, p_legs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manual text := upper(btrim(COALESCE(p_voucher_no, '')));
  v_system text;
  v_id    uuid;
  v_leg   jsonb;
  v_legs  jsonb := '[]'::jsonb;
  v_name  text;
  v_party uuid;
  v_latest_closed date;
  v_used  public.nf_vouchers;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  -- p_voucher_no is the MANUAL number (docs/PLAN.md §45); blank or only the
  -- prefix means not written yet.
  IF v_manual = '' OR v_manual ~ '^JV-?$' THEN v_manual := NULL; END IF;
  -- A journal voucher must not look like a cash-book voucher. The daily sheet
  -- owns those four prefixes; claiming one here would put a non-cash entry
  -- under a cash voucher number.
  IF v_manual ~ '^(CRV|BRV|CPV|BPV)-' THEN
    RAISE EXCEPTION 'NF:VOUCHER_PREFIX_IS_CASHBOOK' USING DETAIL = v_manual;
  END IF;

  -- Period gate, checked before any party is resolved/created below — a
  -- rejected voucher must not have a side effect. "Latest CLOSED day" is the
  -- boundary of what is already locked (nf_days_one_unclosed guarantees at
  -- most one non-CLOSED day per company, so this needs no separate "period"
  -- concept of its own).
  IF p_voucher_date IS NOT NULL THEN
    -- Pakistan's date, not the server's UTC one: between 00:00 and 05:00 PKT the
    -- two differ, and "today" on the screen was refused as a future date
    -- (docs/findings/2026-09-22-Q-jv-future-date-uses-utc.md).
    IF p_voucher_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN
      RAISE EXCEPTION 'NF:DATE_FUTURE' USING DETAIL = p_voucher_date::text;
    END IF;
    SELECT max(business_date) INTO v_latest_closed
      FROM public.nf_days WHERE company_id = p_company_id AND status = 'CLOSED';
    IF v_latest_closed IS NOT NULL AND p_voucher_date <= v_latest_closed THEN
      RAISE EXCEPTION 'NF:PERIOD_CLOSED' USING DETAIL = json_build_object('voucher_date', p_voucher_date, 'latest_closed', v_latest_closed)::text;
    END IF;
  END IF;

  -- a manual number is never repeated within JV — also before any side effect
  IF v_manual IS NOT NULL THEN
    SELECT * INTO v_used FROM public.nf_vouchers x
     WHERE x.company_id = p_company_id AND x.manual_no = v_manual
       AND upper(split_part(x.voucher_no, '-', 1)) = 'JV'
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER'
        USING DETAIL = json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no)::text;
    END IF;
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

  -- the SYSTEM number (docs/PLAN.md §44/§45)
  v_system := public.nf__next_voucher_no(p_company_id, 'JV');
  -- p_day_id is NULL, always and deliberately: a JV is not a cash-book line.
  v_id := public.nf_post_voucher(p_company_id, NULL, v_system, p_voucher_date, p_narration, 0, v_legs);
  IF v_manual IS NOT NULL THEN
    BEGIN
      UPDATE public.nf_vouchers SET manual_no = v_manual WHERE id = v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
    END;
  END IF;

  RETURN (SELECT jsonb_build_object(
            'id', v.id, 'voucher_no', v.voucher_no, 'manual_no', v.manual_no, 'voucher_date', v.voucher_date,
            'narration', v.narration, 'status', v.status, 'version', v.version,
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

COMMIT;

#!/usr/bin/env node
/* Writes supabase/migrations/20261119f_nf_cash_deposit_to_bank.sql (owner, 19-Nov: "jab Sharose cash ko bank mai
   deposit karta hai to us k pass cash payment mai head mai BOP ya bank nahi aa raha"). A deposit is a transfer
   (cash box → bank), not an expense, so it never was a head. This adds:
     * nf_save_deposit — cash from the caller's own box into the bank, a CPV with its own paper number and slip;
     * the day's transfers in nf_day_json (they are not cash-book lines), with who entered each;
     * the site box sees only its own transfers there (Head Office's stay in "site" as date and amount);
     * NF:DUPLICATE_CHEQUE no longer names a Head Office voucher to the site box.
   Patched from LIVE definitions with asserted insertions. Usage: node <this> */
const fs = require('fs'), path = require('path');
const { q } = require('../_sbq');
(async () => {
  const def = async n => {
    const r = await q(`select pg_get_functiondef(p.oid) d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '${n}'`);
    if (r.length !== 1) throw new Error(n + ': ' + r.length);
    return r[0].d;
  };
  const once = (s, find, repl, what) => {
    const parts = s.split(find);
    if (parts.length !== 2) throw new Error(what + ': found ' + (parts.length - 1) + ' times');
    return parts.join(repl);
  };
  let dj = await def('nf_day_json');
  dj = once(dj, "    'checks', v_checks,\n",
`    -- the day's transfers between a cash box and the bank or the other box (they are not cash-book lines) (20261119f)
    'transfers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'voucher_id', v.id, 'line_id', (SELECT g.id FROM public.nf_voucher_legs g WHERE g.voucher_id = v.id AND g.line_no = 1),
               'voucher_no', v.voucher_no, 'manual_no', v.manual_no, 'number_pending', v.manual_no IS NULL,
               'narration', v.narration, 'real_date', COALESCE(v.real_date, v.voucher_date), 'version', v.version,
               'amount', (SELECT sum(g.debit) FROM public.nf_voucher_legs g WHERE g.voucher_id = v.id),
               'from', (SELECT COALESCE(a.via_label, a.name) FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                         WHERE g.voucher_id = v.id AND g.credit > 0 ORDER BY g.line_no LIMIT 1),
               'to', (SELECT COALESCE(a.via_label, a.name) FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                       WHERE g.voucher_id = v.id AND g.debit > 0 ORDER BY g.line_no LIMIT 1),
               'by_name', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by),
               'by_box', (SELECT m.cash_via FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by),
               'mine', v.created_by = auth.uid()) ORDER BY v.sort)
        FROM public.nf_vouchers v
       WHERE v.day_id = p_day_id AND v.status = 'POSTED'
         AND NOT EXISTS (SELECT 1 FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                          WHERE g.voucher_id = v.id AND a.via IS NULL)), '[]'::jsonb),
    'checks', v_checks,
`, 'day_json transfers');
  let sv = await def('_nf_site_view_day');
  sv = once(sv, "         'jvs', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(p_json->'jvs') x WHERE (x->>'mine')::boolean), '[]'),\n",
    "         'jvs', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(p_json->'jvs') x WHERE (x->>'mine')::boolean), '[]'),\n" +
    "         'transfers', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(p_json->'transfers') x WHERE (x->>'mine')::boolean), '[]'),  -- his own (20261119f)\n", 'site_view transfers');
  let wd = await def('nf_save_withdrawal');
  wd = once(wd, "      USING DETAIL = json_build_object('cheque', v_cheque, 'voucher', COALESCE(v_used.manual_no, v_used.voucher_no))::text;",
    "      USING DETAIL = (CASE WHEN public.nf_member_cash_box(v_company) = 'Petty' AND v_used.created_by IS DISTINCT FROM auth.uid()\n" +
    "                           THEN json_build_object('cheque', v_cheque, 'by', 'Head Office', 'hidden', true)::text  -- 20261119f\n" +
    "                           ELSE json_build_object('cheque', v_cheque, 'voucher', COALESCE(v_used.manual_no, v_used.voucher_no))::text END);", 'withdrawal cheque');

  const sql = `-- ══ NexuFinance: cash deposited in the bank, from a cash box (20261119f) ══
-- NOT APPLIED until the owner says yes.
--
-- Owner, 19-Nov: "jab Sharose cash ko bank mai deposit karta hai to us k pass cash payment mai head mai BOP ya bank
-- nahi aa raha". A deposit is a transfer (cash box → bank), not an expense, so the bank was never a head — and the
-- site login had no way to record one at all. Added:
--   * nf_save_deposit(day, paper no., from 'Cash' | 'Petty', amount, slip / reference, description, real date):
--     the caller's OWN box only (a director: either); a CPV (cash out), Dr bank / Cr box; the slip is required and
--     goes into the narration so the duplicate guard can read it; the same deposit by the other login is refused.
--     The screen offers it as "Cash deposited in BOP (bank)" in the Cash payment popup; "Cash withdrawn from BOP
--     (bank)" in the Cash receipt popup uses the existing nf_save_withdrawal.
--   * nf_day_json: the day's transfers (cash ↔ bank, cash box ↔ cash box), each with who entered it — they are not
--     cash-book lines, so they had no place on the sheet. The site box gets only its own (Head Office's remain in
--     "site", date and amount).
--   * NF:DUPLICATE_CHEQUE tells the site box only "Head Office".

CREATE OR REPLACE FUNCTION public.nf_save_deposit(p_day_id uuid, p_voucher_no text, p_from text, p_amount numeric,
  p_reference text, p_description text, p_real_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  v_manual text := upper(btrim(COALESCE(p_voucher_no, '')));
  v_ref text := btrim(COALESCE(p_reference, ''));
  v_bank text; v_box text; v_label text; v_floor text; v_bdate date; v_sort integer; v_system text; v_id uuid;
  v_narr text; v_used public.nf_vouchers; v_dup jsonb;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  PERFORM public.nf_assert_cash_box(v_company, p_from);
  IF p_from IS NULL OR p_from NOT IN ('Cash', 'Petty') THEN RAISE EXCEPTION 'NF:DEPOSIT_FROM_CASH_OR_PETTY' USING DETAIL = COALESCE(p_from, '(none)'); END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  IF length(regexp_replace(v_ref, '[^A-Za-z0-9]', '', 'g')) < 3 THEN RAISE EXCEPTION 'NF:REFERENCE_REQUIRED'; END IF;
  IF p_real_date IS NULL THEN RAISE EXCEPTION 'NF:REAL_DATE_REQUIRED'; END IF;
  IF p_real_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'NF:REAL_DATE_FUTURE'; END IF;
  IF v_manual = '' OR v_manual ~ '^(S-)?CPV-?$' THEN v_manual := NULL; END IF;

  SELECT code INTO v_bank FROM public.nf_accounts WHERE company_id = v_company AND via = 'Bank';
  SELECT code, COALESCE(via_label, name) INTO v_box, v_label FROM public.nf_accounts WHERE company_id = v_company AND via = p_from;
  IF v_bank IS NULL OR v_box IS NULL THEN RAISE EXCEPTION 'NF:VIA_NOT_CONFIGURED'; END IF;

  v_narr := COALESCE(NULLIF(btrim(p_description), ''), 'Cash deposited in BOP from ' || v_label);
  -- the slip as letters and digits only, so the duplicate guard reads it as one reference (DS-77123 → DS77123)
  v_narr := v_narr || ' — slip ' || regexp_replace(v_ref, '[^A-Za-z0-9]', '', 'g');
  -- the same deposit, already booked by the other login
  v_dup := public.nf_dup_check(v_company, 'DEP', 'Bank', NULL, p_amount, v_narr, NULL, p_real_date, NULL);
  IF jsonb_array_length(v_dup->'block') > 0 THEN
    RAISE EXCEPTION 'NF:DUPLICATE_ENTRY' USING DETAIL = (v_dup->'block'->0)::text;
  END IF;
  IF v_manual IS NOT NULL THEN
    SELECT * INTO v_used FROM public.nf_vouchers x
     WHERE x.company_id = v_company AND x.manual_no = v_manual AND upper(split_part(x.voucher_no, '-', 1)) = 'CPV' LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = (CASE WHEN public.nf_member_cash_box(v_company) = 'Petty' AND v_used.created_by IS DISTINCT FROM auth.uid()
        THEN json_build_object('voucher', v_manual, 'by', 'Head Office', 'hidden', true)::text
        ELSE json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no)::text END);
    END IF;
  END IF;

  SELECT business_date INTO v_bdate FROM public.nf_days WHERE id = p_day_id;
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_company ORDER BY (code = 'P-W') DESC, sort LIMIT 1;
  SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_vouchers WHERE day_id = p_day_id;
  v_system := public.nf__next_voucher_no(v_company, 'CPV');
  v_id := public.nf_post_voucher(v_company, p_day_id, v_system, v_bdate, v_narr, v_sort,
    jsonb_build_array(
      jsonb_build_object('account_code', v_bank, 'floor_code', v_floor, 'debit',  p_amount),
      jsonb_build_object('account_code', v_box,  'floor_code', v_floor, 'credit', p_amount)));
  BEGIN
    UPDATE public.nf_vouchers SET manual_no = v_manual, real_date = p_real_date WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
  END;
  RETURN public.nf_day_json(p_day_id);
END $f$;
REVOKE ALL ON FUNCTION public.nf_save_deposit(uuid, text, text, numeric, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_save_deposit(uuid, text, text, numeric, text, text, date) TO authenticated;

${dj.trim()};

${sv.trim()};

${wd.trim()};
`;
  const f = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261119f_nf_cash_deposit_to_bank.sql');
  fs.writeFileSync(f, sql);
  console.log('written', f);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

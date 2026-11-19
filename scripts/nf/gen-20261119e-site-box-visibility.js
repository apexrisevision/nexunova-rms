#!/usr/bin/env node
/* Writes supabase/migrations/20261119e_nf_site_box_visibility.sql (brief of 19-Nov; owner to approve):
   a member whose cash box is Site Cash (via Petty) sees his own closing only — his own vouchers, the Site Cash box,
   transfers from / to Head Office as amount and date — and nothing of Head Office through any table, view or RPC.
   Head office and the director see everything as today. Functions are patched from their LIVE definitions with
   asserted insertions. Usage: node scripts/nf/gen-20261119e-site-box-visibility.js */
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
  const out = [];
  const SITE = (co) => `public.nf_member_cash_box(${co}) = 'Petty'`;

  // ── nf_day_json: the day as the caller may see it ──
  let dj = await def('nf_day_json');
  dj = once(dj, '  r record;\n', '  r record;\n  v_out jsonb;  -- 20261119e\n', 'day_json declare');
  dj = once(dj, '  RETURN jsonb_build_object(\n    \'day\', jsonb_build_object(', '  v_out := jsonb_build_object(\n    \'day\', jsonb_build_object(', 'day_json start');
  dj = once(dj, "    'balanced', jsonb_array_length(v_checks) = 0);\nEND",
    "    'balanced', jsonb_array_length(v_checks) = 0);\n  RETURN public._nf_site_view_day(v_out, d.company_id, p_day_id);  -- the site box sees its own (20261119e)\nEND", 'day_json end');
  out.push(dj);

  // ── nf_list_days: no Head Office totals for the site box ──
  let ld = await def('nf_list_days');
  ld = once(ld, "'close_total', d.close_cash + d.close_petty + d.close_bank,\n                            'variance', d.variance)",
    `'close_total', CASE WHEN ${SITE('p_company_id')} THEN d.close_petty ELSE d.close_cash + d.close_petty + d.close_bank END,\n                            'variance', CASE WHEN ${SITE('p_company_id')} THEN NULL ELSE d.variance END)`, 'list_days');
  out.push(ld);

  // ── nf_jv_list: the site box lists its own JVs only ──
  let jl = await def('nf_jv_list');
  jl = once(jl, "       WHERE v.company_id = p_company_id AND v.day_id IS NULL AND v.status = 'POSTED'\n         AND v.source = 'JV'\n",
    `       WHERE v.company_id = p_company_id AND v.day_id IS NULL AND v.status = 'POSTED'\n         AND v.source = 'JV'\n         AND (public.nf_member_cash_box(p_company_id) IS DISTINCT FROM 'Petty' OR v.created_by = auth.uid())  -- 20261119e\n`, 'jv_list');
  out.push(jl);

  // ── Head Office only: the printed day report, the unallocated tokens, the retired site-closing functions ──
  const ROLE = /(  PERFORM public\.nf_require_role\(([^;]+?), ARRAY\[[^\]]+\]\);\n)/;
  for (const n of ['nf_get_report_day', 'nf_unallocated_tokens', 'nf_site_accept', 'nf_site_accept_new', 'nf_site_delete_line', 'nf_site_get_day',
                   'nf_site_link', 'nf_site_list_days', 'nf_site_list_heads', 'nf_site_list_units', 'nf_site_mark_duplicate', 'nf_site_match',
                   'nf_site_reject', 'nf_site_reopen', 'nf_site_return', 'nf_site_save_line', 'nf_site_start_first_day', 'nf_site_submit']) {
    let d = await def(n);
    const m = ROLE.exec(d); if (!m) throw new Error(n + ': no role check');
    out.push(once(d, m[1], m[1] + `  PERFORM public.nf_assert_head_office(${m[2]});  -- not the site cash box (20261119e)\n`, n));
  }

  // ── duplicate details never reach the site box ──
  let dc = await def('nf_dup_check');
  dc = once(dc, "  RETURN jsonb_build_object('block', v_block, 'warn', v_warn);\nEND",
    `  -- the site box is told only that Head Office has it (20261119e)
  IF ${SITE('p_company_id')} THEN
    RETURN jsonb_build_object(
      'block', CASE WHEN jsonb_array_length(v_block) > 0 THEN '[{"by": "Head Office", "hidden": true}]'::jsonb ELSE '[]'::jsonb END,
      'warn',  CASE WHEN jsonb_array_length(v_warn)  > 0 THEN '[{"by": "Head Office", "hidden": true}]'::jsonb ELSE '[]'::jsonb END);
  END IF;
  RETURN jsonb_build_object('block', v_block, 'warn', v_warn);
END`, 'dup_check');
  out.push(dc);
  const hide = (co) => `CASE WHEN ${SITE(co)} AND v_used.created_by IS DISTINCT FROM auth.uid() THEN json_build_object('voucher', v_manual, 'by', 'Head Office', 'hidden', true)::text ELSE `;
  let sl = await def('nf_save_line');
  sl = once(sl, "USING DETAIL = json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no,\n            'by', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v_used.company_id AND m.user_id = v_used.created_by))::text;",
    "USING DETAIL = (" + hide('v_company') + "json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no,\n            'by', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v_used.company_id AND m.user_id = v_used.created_by))::text END);", 'save_line dup');
  out.push(sl);
  for (const [n, co] of [['nf_jv_save', 'p_company_id'], ['nf_set_manual_no', 'v.company_id']]) {
    let d = await def(n);
    d = once(d, "USING DETAIL = json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no)::text;",
      "USING DETAIL = (" + hide(co) + "json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no)::text END);", n);
    out.push(d);
  }
  let ao = await def('nf_assert_own_voucher');
  ao = once(ao, "  RAISE EXCEPTION 'NF:NOT_YOUR_ENTRY' USING DETAIL = json_build_object(",
    `  IF ${SITE('v.company_id')} THEN RAISE EXCEPTION 'NF:NOT_YOUR_ENTRY' USING DETAIL = '{"by": "Head Office", "hidden": true}'; END IF;  -- 20261119e\n  RAISE EXCEPTION 'NF:NOT_YOUR_ENTRY' USING DETAIL = json_build_object(`, 'assert_own');
  out.push(ao);

  // ── the WhatsApp report as the site box gets it: Head Office's own lines as amount only ──
  let dr = await def('nf_day_report');
  dr = once(dr, "  SELECT initcap(lower(split_part(",
    `  -- the site box: a line Head Office entered on Site Cash shows as amount only, a transfer as from / to Head Office (20261119e)
  IF ${SITE('p_company_id')} THEN
    v_rec := COALESCE((SELECT jsonb_agg(CASE WHEN e->>'by' = 'Head Office' THEN jsonb_build_object('no', '–', 'by', 'Head Office', 'party', NULL,
               'for', 'Received by Head Office into Site Cash', 'amount', e->'amount', 'bank', e->'bank') ELSE e END) FROM jsonb_array_elements(v_rec) e), '[]');
    v_pay := COALESCE((SELECT jsonb_agg(CASE WHEN e->>'by' = 'Head Office' THEN jsonb_build_object('no', '–', 'by', 'Head Office', 'party', NULL,
               'for', 'Paid by Head Office from Site Cash', 'amount', e->'amount', 'bank', e->'bank') ELSE e END) FROM jsonb_array_elements(v_pay) e), '[]');
    v_trf := COALESCE((SELECT jsonb_agg(CASE WHEN e->>'by' = 'Head Office' THEN jsonb_build_object('no', '–', 'by', 'Head Office',
               'from', CASE WHEN e->>'to' = 'Site Cash' THEN 'Head Office' ELSE 'Site Cash' END,
               'to', CASE WHEN e->>'to' = 'Site Cash' THEN 'Site Cash' ELSE 'Head Office' END, 'amount', e->'amount', 'cheque', NULL) ELSE e END)
               FROM jsonb_array_elements(v_trf) e), '[]');
  END IF;
  SELECT initcap(lower(split_part(`, 'day_report');
  out.push(dr);

  const sql = `-- ══ NexuFinance: the site cash box sees its own closing only (20261119e) ══
-- NOT APPLIED until the owner says yes.
--
-- Brief of 19-Nov (closes handover item #8). A member whose cash box is Site Cash (via Petty) — today Sharose:
--   * TABLES (row security): reads only the vouchers and legs HE entered; no direct read of day sheets, PDCs,
--     the audit trail, the combined closings or the retired site-closing tables. The nf_lines view follows
--     (security_invoker). Master data stays readable: accounts, floors, members, settings and the party list
--     (the party picker needs the names; no amounts are on it).
--   * RPCs: nf_day_json gives him his own lines and JVs, the Site Cash row only, no checks / PDCs / remarks /
--     Head Office figures, plus "site": transfers from / to Head Office (date and amount) and the lines Head
--     Office entered on Site Cash as two totals. nf_list_days gives Site Cash totals only; nf_jv_list his own;
--     the printed day report, the unallocated tokens and every retired nf_site_* function are Head Office only.
--   * nf_dup_check, NF:DUPLICATE_ENTRY / NF:DUPLICATE_VOUCHER / NF:NOT_YOUR_ENTRY tell him only
--     "entered by Head Office" — no voucher number, date, reference, amount or name.
--   * nf_day_report (his WhatsApp report, Site only): Head Office's lines on Site Cash as amount only.
-- Head office and the director see everything as before.

CREATE OR REPLACE FUNCTION public._nf_site_view_day(p_json jsonb, p_company_id uuid, p_day_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE v_lines jsonb; v_row jsonb; v_extra jsonb;
BEGIN
  IF public.nf_member_cash_box(p_company_id) IS DISTINCT FROM 'Petty' THEN RETURN p_json; END IF;
  -- his own lines only
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sort')::int), '[]') INTO v_lines FROM jsonb_array_elements(p_json->'lines') x
   WHERE (SELECT v.created_by FROM public.nf_vouchers v WHERE v.id = (x->>'voucher_id')::uuid) = auth.uid();
  -- the Site Cash box only
  SELECT x INTO v_row FROM jsonb_array_elements(p_json->'position'->'rows') x WHERE x->>'via' = 'Petty';
  -- what Head Office did on Site Cash in this sheet: transfers by date and amount, other lines as totals
  SELECT jsonb_build_object(
    'transfers', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', t.rd, 'amount', abs(t.net),
                   'label', CASE WHEN t.net > 0 THEN 'Received from Head Office' ELSE 'Sent to Head Office' END) ORDER BY t.rd)
      FROM (SELECT COALESCE(v.real_date, v.voucher_date) AS rd,
                   (SELECT sum(g.debit - g.credit) FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                     WHERE g.voucher_id = v.id AND a.via = 'Petty') AS net
              FROM public.nf_vouchers v
             WHERE v.day_id = p_day_id AND v.status = 'POSTED' AND v.created_by IS DISTINCT FROM auth.uid()
               AND NOT EXISTS (SELECT 1 FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                                WHERE g.voucher_id = v.id AND a.via IS NULL)
               AND EXISTS (SELECT 1 FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                            WHERE g.voucher_id = v.id AND a.via = 'Petty')) t WHERE t.net <> 0), '[]'),
    'ho_received', (SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(sum(s.net), 0)) FROM (
        SELECT (SELECT sum(g.debit - g.credit) FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                 WHERE g.voucher_id = v.id AND a.via = 'Petty') AS net
          FROM public.nf_vouchers v
         WHERE v.day_id = p_day_id AND v.status = 'POSTED' AND v.created_by IS DISTINCT FROM auth.uid()
           AND EXISTS (SELECT 1 FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code WHERE g.voucher_id = v.id AND a.via IS NULL)) s
       WHERE s.net > 0),
    'ho_paid', (SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(-sum(s.net), 0)) FROM (
        SELECT (SELECT sum(g.debit - g.credit) FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                 WHERE g.voucher_id = v.id AND a.via = 'Petty') AS net
          FROM public.nf_vouchers v
         WHERE v.day_id = p_day_id AND v.status = 'POSTED' AND v.created_by IS DISTINCT FROM auth.uid()
           AND EXISTS (SELECT 1 FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code WHERE g.voucher_id = v.id AND a.via IS NULL)) s
       WHERE s.net < 0)) INTO v_extra;
  RETURN p_json
    || jsonb_build_object(
         'day', (p_json->'day') - ARRAY['typed_open_cash', 'typed_open_bank', 'transfer_to_bank', 'counted_cash', 'denominations',
                                        'variance', 'variance_reason', 'remarks', 'last_return_reason'],
         'lines', v_lines,
         'jvs', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(p_json->'jvs') x WHERE (x->>'mine')::boolean), '[]'),
         'pdcs', '[]'::jsonb, 'checks', '[]'::jsonb, 'balanced', true,
         'position', jsonb_build_object(
            'rows', CASE WHEN v_row IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_row) END,
            'total', COALESCE(v_row, '{}'::jsonb) - 'via' - 'code' - 'label',
            'net', COALESCE((v_row->>'received')::numeric, 0) - COALESCE((v_row->>'paid')::numeric, 0),
            'receipts', (SELECT count(*) FROM jsonb_array_elements(v_lines) x WHERE x->>'side' = 'IN'),
            'payments', (SELECT count(*) FROM jsonb_array_elements(v_lines) x WHERE x->>'side' = 'OUT')),
         'site', v_extra);
END $f$;
REVOKE ALL ON FUNCTION public._nf_site_view_day(jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- row security: the site cash box reads only what it entered, and none of the day sheets, PDCs or the audit trail.
-- The policies run as the signed-in role, so it may ask its own cash box (the answer is only ever its own).
GRANT EXECUTE ON FUNCTION public.nf_member_cash_box(uuid) TO authenticated;
ALTER POLICY nf_vouchers_read ON public.nf_vouchers USING (public.nf_is_member(company_id, false)
  AND (public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty' OR created_by = auth.uid()));
ALTER POLICY nf_voucher_legs_read ON public.nf_voucher_legs USING (public.nf_is_member(company_id, false)
  AND (public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty'
       OR EXISTS (SELECT 1 FROM public.nf_vouchers v WHERE v.id = voucher_id AND v.created_by = auth.uid())));
ALTER POLICY nf_days_read ON public.nf_days USING (public.nf_is_member(company_id, false) AND public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty');
ALTER POLICY nf_pdcs_read ON public.nf_pdcs USING (public.nf_is_member(company_id, false) AND public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty');
ALTER POLICY nf_audit_read ON public.nf_audit USING (public.nf_is_member(company_id, true) AND public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty');
ALTER POLICY nf_combined_closings_read ON public.nf_combined_closings USING (public.nf_site_reader(company_id, false) AND public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty');
ALTER POLICY nf_site_days_read ON public.nf_site_days USING (public.nf_site_reader(company_id, true) AND public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty');
ALTER POLICY nf_site_lines_read ON public.nf_site_lines USING (public.nf_site_reader(company_id, true) AND public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty');

${out.map(d => d.trim() + ';').join('\n\n')}
`;
  const f = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261119e_nf_site_box_visibility.sql');
  fs.writeFileSync(f, sql);
  console.log('written', f, '| functions patched', out.length);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

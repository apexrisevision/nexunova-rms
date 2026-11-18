#!/usr/bin/env node
/* Writes supabase/migrations/20261118i_nf_one_closing_two_cash_boxes.sql: one Daily Closing, two logins
   (owner, 18-Nov-2026; mockup D:\Claude Cowork\Ek closing do login\, approved; no cash count — owner "c").
   Every function is patched from its LIVE definition with asserted, exact insertions.
   Usage: node scripts/nf/gen-20261118i-two-cash-boxes.js */
const fs = require('fs'), path = require('path');
const { q } = require('../_sbq');

const ROLE = /(  PERFORM public\.nf_require_role\(([^;]+?), ARRAY\[[^\]]+\]\);\n)/;
// the caller's own cash box decides where his cash lines go
const BOX = { nf_save_line: 'PERFORM public.nf_assert_cash_box(v_company, p_via);',
              nf_save_withdrawal: 'PERFORM public.nf_assert_cash_box(v_company, p_to);',
              nf_save_transfer: 'PERFORM public.nf_assert_cash_box_either(v_company, p_from, p_to);' };
// a voucher is changed or removed only by whoever entered it (a director: any)
const OWN = { nf_delete_line: 'PERFORM public.nf_assert_own_voucher(v_voucher.id);',
              nf_set_manual_no: 'PERFORM public.nf_assert_own_voucher(v.id);',
              nf_jv_delete: 'PERFORM public.nf_assert_own_voucher(v_voucher.id);' };
// the day itself (submit, close), PDCs, IIF and voucher texts by number belong to head office; either login
// may start the next day once head office has closed the last one
const HO = ['nf_close_day', 'nf_submit_day', 'nf_set_remarks', 'nf_set_transfers', 'nf_save_pdc',
            'nf_delete_pdc', 'nf_resolve_pdc', 'nf_iif_record_batch', 'nf_set_voucher_text',
  // owner, 18-Nov (option a): the site login sees the Daily Closing only, not the reports
  'nf_director_summary', 'nf_get_balance_sheet', 'nf_get_cash_bank_movement', 'nf_get_floor_summary', 'nf_get_group_balances',
  'nf_get_journal', 'nf_get_ledger', 'nf_get_monthly_trend', 'nf_get_party_statement', 'nf_get_pl', 'nf_get_project_cost_summary',
  'nf_get_receipt_register', 'nf_get_token_register', 'nf_get_trial_balance', 'nf_iif_list_candidates', 'nf_site_review'];

(async () => {
  const def = async n => {
    const r = await q(`select pg_get_functiondef(p.oid) d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '${n}'`);
    if (r.length !== 1) throw new Error(n + ': ' + r.length + ' definitions');
    return r[0].d;
  };
  const once = (s, find, repl, what) => {
    const parts = s.split(find);
    if (parts.length !== 2) throw new Error(what + ': patch point found ' + (parts.length - 1) + ' times');
    return parts.join(repl);
  };
  const out = [];
  for (const [n, guard] of Object.entries(BOX)) {
    let d = await def(n);
    const m = ROLE.exec(d); if (!m) throw new Error(n + ': no role check');
    d = once(d, m[1], m[1] + '  ' + guard + '  -- own cash box (20261118i)\n', n);
    if (n === 'nf_save_line') {
      d = once(d, '    -- the system number is permanent and names the type\n',
        '    PERFORM public.nf_assert_own_voucher(v_voucher.id);  -- only its own entrant edits it (20261118i)\n    -- the system number is permanent and names the type\n', n + ' own');
    }
    out.push(d.trim() + ';');
  }
  for (const [n, guard] of Object.entries(OWN)) {
    let d = await def(n);
    const m = ROLE.exec(d); if (!m) throw new Error(n + ': no role check');
    out.push(once(d, m[1], m[1] + '  ' + guard + '  -- only its own entrant (20261118i)\n', n).trim() + ';');
  }
  for (const n of HO) {
    let d = await def(n);
    const m = ROLE.exec(d); if (!m) throw new Error(n + ': no role check');
    out.push(once(d, m[1], m[1] + `  PERFORM public.nf_assert_head_office(${m[2]});  -- not the site cash box login (20261118i)\n`, n).trim() + ';');
  }
  // who entered each line / JV, and the caller's cash box in the context
  let dj = await def('nf_day_json');
  dj = once(dj, "'voucher_id', vv.id, 'manual_no', vv.manual_no, 'number_pending', vv.manual_no IS NULL) ORDER BY l.sort)",
    "'voucher_id', vv.id, 'manual_no', vv.manual_no, 'number_pending', vv.manual_no IS NULL,\n" +
    "               'by_name', bm.display_name, 'by_box', bm.cash_via, 'mine', l.created_by = auth.uid()) ORDER BY l.sort)", 'day_json lines');
  dj = once(dj, '        LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = vl.party_id\n',
    '        LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = vl.party_id\n' +
    '        LEFT JOIN public.nf_members bm ON bm.company_id = l.company_id AND bm.user_id = l.created_by\n', 'day_json join');
  dj = once(dj, "'narration', v.narration, 'version', v.version,",
    "'narration', v.narration, 'version', v.version, 'mine', v.created_by = auth.uid(),\n" +
    "               'by_name', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by),\n" +
    "               'by_box', (SELECT m.cash_via FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by),", 'day_json jvs');
  out.push(dj.trim() + ';');
  let cx = await def('nf_get_context');
  cx = once(cx, "'role', m.role, 'display_name', m.display_name,", "'role', m.role, 'display_name', m.display_name, 'cash_via', m.cash_via,", 'context');
  out.push(cx.trim() + ';');

  const sql = `-- ══ NexuFinance: one Daily Closing, two logins — Head Office Cash and Site Cash (20261118i) ══
-- NOT APPLIED until the owner says yes.
--
-- Owner, 18-Nov-2026 (mockup D:\\Claude Cowork\\Ek closing do login\\, approved; no cash count — answer "c"):
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

${out.join('\n\n')}

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
`;
  const f = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261118i_nf_one_closing_two_cash_boxes.sql');
  fs.writeFileSync(f, sql);
  console.log('written', f, '| functions patched', out.length);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

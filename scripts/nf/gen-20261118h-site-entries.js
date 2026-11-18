#!/usr/bin/env node
/* Writes supabase/migrations/20261118h_nf_awami_site_entries_05_18_nov.sql from the plan CSV
   (plan-site-nov-posting.js) — the owner's option A, 18-Nov. Runs as the director (Rashid) through the
   normal NexuFinance functions, so every guard and the audit trail apply:
     1. reopen DC-007 (05-Oct catch-up sheet) with a reason;
     2. BPV-0026 / BPV-0046 now put their cash into the site cash box (10200), and CPV-0170/0171/0172
        are paid from it — amounts unchanged, only which cash box;
     3. post the site lines of 05-16 Nov into DC-007 (via Petty = site cash box), each on its real date;
     4. close DC-007 again;
     5. open 17-Nov, post its site lines, close it; open 18-Nov and post its site lines (left OPEN: today).
   Usage: node scripts/nf/gen-20261118h-site-entries.js <site-plan.csv> */
const fs = require('fs'), path = require('path');
const X = require('xlsx');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const RASHID = '315f2852-852f-4653-9253-a5a27a7828c8';
const wb = X.readFile(process.argv[2], { raw: true });
const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false }).filter(r => r.action === 'POST');
const lit = s => "'" + String(s).replace(/'/g, "''") + "'";
const title = s => String(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const dd = d => { const [y, m, day] = d.split('-'); return day + '-' + ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m]; };
const isoDate = v => { // the CSV round-trip may give 2026-11-05 or 11/5/26
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(v); if (!m) throw new Error('date ' + v);
  return `20${m[3].slice(-2)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
};
const lines = rows.map(r => {
  const date = isoDate(r.date), amt = +String(r.cash || r.bank).replace(/,/g, '');
  const party = r.party ? title(r.party) : '';
  const isToken = r.nf_code === '21100';
  const floor = isToken ? ((/^(LG|GF|FF|SF|TF|5F)/.exec(r.units || '') || [])[1] || 'P-W') : 'P-W';
  const site = 'site cash, Sharose' + (r.no ? ', site voucher #' + r.no : '');
  let narr;
  if (isToken && r.side === 'IN') narr = `Token #${r.token} — ${party}${r.units ? ', Unit ' + r.units : ''} (${site}, ${dd(date)})`;
  else if (isToken) narr = `Token #${r.token || r.no} returned — ${party} (${site}, ${dd(date)})`;
  else narr = `${title(r.remarks || r.site_head)}${party ? ' — ' + party : ''} (${site}, ${dd(date)})`;
  return { date, side: r.side, code: r.nf_code, floor, amt, party: isToken ? party : (party || null), narr };
});
// every voucher needs a paper number before its day closes: the site's own series, by date and type
// (S-CRV-0001…, S-CPV-0001…); the site's printed number, where it wrote one, stays in the narration
{ const seq = { IN: 0, OUT: 0 };
  for (const l of [...lines].sort((a, b) => a.date.localeCompare(b.date))) { seq[l.side]++; l.manual = (l.side === 'IN' ? 'S-CRV-' : 'S-CPV-') + String(seq[l.side]).padStart(4, '0'); } }
// a token returned sits on the same floor as the token it gives back
for (const l of lines) if (l.code === '21100' && l.side === 'OUT') {
  const tok = (/#(\d+)/.exec(l.narr) || [])[1];
  const given = lines.find(g => g.code === '21100' && g.side === 'IN' && g.narr.includes('#' + tok + ' '));
  if (given) l.floor = given.floor;
}
const early = lines.filter(l => l.date <= '2026-11-16'), d17 = lines.filter(l => l.date === '2026-11-17'), d18 = lines.filter(l => l.date === '2026-11-18');
if (early.length + d17.length + d18.length !== lines.length) throw new Error('a line falls outside 05-18 Nov');
const post = (dayVar, l) => `  PERFORM public.nf_save_line(${dayVar}, NULL, '${l.side}', '${l.manual}', ${lit(l.narr)}, '${l.code}', '${l.floor}', 'Petty', ${l.amt}, NULL, ${l.party ? lit(l.party) : 'NULL'});
  UPDATE public.nf_vouchers SET voucher_date = DATE '${l.date}' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = ${dayVar} ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;`;
const sql = `-- ══ NexuFinance Awami: the site accountant's entries 05-18 Nov, site cash box (20261118h) ══
-- NOT APPLIED until the owner says yes.
--
-- Owner's option A (18-Nov). Source: "Awami Daily Entry - Accountant (4).xlsx" (Sharose), matched against head
-- office's books (scripts/nf/plan-site-nov-posting.js; list D:\\Claude Cowork\\Site entries plan 05-18 Nov.csv):
-- ${lines.length} lines posted, 12 skipped (already in head office's books), 2 held (Sakhi Jan 30,011 by JazzCash and
-- chq 6292 5,00,000 to Osama bin Yousaf — not in head office's books, owner to confirm on the BOP statement).
--
-- Site cash box = 10200 (via Petty), starting at 0. It received:
--   * 05-Nov 1,50,000 — BOP chq 1313825996 (BPV-0026), booked as "office supplies" expense: now into the site box;
--   * 16-Nov 3,00,000 — BOP chq 1313826265 (BPV-0046), booked into head office cash: now into the site box,
--     and the three payments made from it (CPV-0170 Naeem Meta 1,50,000, CPV-0171 piling 59,000, CPV-0172
--     Zia ul Haq 50,000) are now paid from the site box. Amounts unchanged; head office cash falls by 41,000.
-- The 05-16 Nov lines go into DC-007 (where head office's entries for those dates are), each dated its real
-- day; a separate sheet for a date head office already posted in DC-007 would miss those postings in its
-- opening. 17-Nov gets its own sheet (closed); 18-Nov its own sheet, left OPEN (today).
-- Runs as the director, through nf_reopen_day / nf_save_line / nf_close_day / nf_start_next_day.

DO $m$
DECLARE
  co constant uuid := '${CO}';
  dc7 uuid; d17 uuid; d18 uuid; ver int; n_posted int := 0; n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '${RASHID}', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '${RASHID}', true);

  -- 1. reopen DC-007
  SELECT id, version INTO dc7, ver FROM public.nf_days WHERE company_id = co AND business_date = DATE '2026-10-05' AND status = 'CLOSED';
  IF dc7 IS NULL THEN RAISE EXCEPTION 'DC-007 is not closed — stop'; END IF;
  PERFORM public.nf_reopen_day(dc7, 'Site cash box (Sharose): BPV-0026 and BPV-0046 cash went to the site; post the site''s 05-16 Nov entries', ver);

  -- 2. the site box gets the two cheques' cash and pays the three 16-Nov payments
  UPDATE public.nf_voucher_legs l SET account_code = '10200'
    FROM public.nf_vouchers v
   WHERE v.id = l.voucher_id AND v.company_id = co AND v.day_id = dc7
     AND ((v.manual_no = 'BPV-0026' AND l.account_code = '70950' AND l.debit = 150000)
       OR (v.manual_no = 'BPV-0046' AND l.account_code = '10100' AND l.debit = 300000)
       OR (v.manual_no = 'CPV-0170' AND l.account_code = '10100' AND l.credit = 150000)
       OR (v.manual_no = 'CPV-0171' AND l.account_code = '10100' AND l.credit = 59000)
       OR (v.manual_no = 'CPV-0172' AND l.account_code = '10100' AND l.credit = 50000));
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 5 THEN RAISE EXCEPTION 'expected 5 legs to move to the site cash box, % matched', n; END IF;
  UPDATE public.nf_vouchers SET narration = narration || ' — cash went to the site cash box (Sharose)'
   WHERE company_id = co AND day_id = dc7 AND manual_no IN ('BPV-0026','BPV-0046');
  UPDATE public.nf_vouchers SET narration = narration || ' — paid from the site cash box (Sharose)'
   WHERE company_id = co AND day_id = dc7 AND manual_no IN ('CPV-0170','CPV-0171','CPV-0172');

  -- 3. the site's 05-16 Nov entries, each on its real date
${early.map(l => post('dc7', l)).join('\n')}

  -- 4. close DC-007 again
  SELECT version INTO ver FROM public.nf_days WHERE id = dc7;
  PERFORM public.nf_close_day(dc7, ver, NULL);

  -- 5. 17-Nov (closed) and 18-Nov (left open)
  PERFORM public.nf_start_next_day(co, DATE '2026-11-17');
  SELECT id INTO d17 FROM public.nf_days WHERE company_id = co AND business_date = DATE '2026-11-17';
${d17.map(l => post('d17', l)).join('\n')}
  SELECT version INTO ver FROM public.nf_days WHERE id = d17;
  PERFORM public.nf_close_day(d17, ver, NULL);
  PERFORM public.nf_start_next_day(co, DATE '2026-11-18');
  SELECT id INTO d18 FROM public.nf_days WHERE company_id = co AND business_date = DATE '2026-11-18';
${d18.map(l => post('d18', l)).join('\n')}

  IF n_posted <> ${lines.length} THEN RAISE EXCEPTION 'expected ${lines.length} site lines, posted %', n_posted; END IF;
END $m$;
`;
const f = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261118h_nf_awami_site_entries_05_18_nov.sql');
fs.writeFileSync(f, sql);
console.log('written', f, '| lines', lines.length, '| 05-16:', early.length, '17:', d17.length, '18:', d18.length);
lines.filter(l => l.code === '21100').forEach(l => console.log(l.date, l.side, l.floor, l.party, l.amt, '|', l.narr));
console.log(lines.slice(0, 3).map(l => l.narr).join('\n'));

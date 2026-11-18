#!/usr/bin/env node
/**
 * NexuFinance — Site Closing, Stage 2 (20261118a): the matching engine, against the REAL
 * site file and a copy of the REAL HO books.
 *
 * ONE request, ONE transaction, always rolled back (ends in RAISE):
 *   1. the Stage 2 migration (unless --applied);
 *   2. a FIXTURE COPY of Awami's NexuFinance books into a throw-away ZZTEST-NF company —
 *      chart, floors, parties, days, every voucher and leg, counters, PDCs — so nothing is
 *      ever posted into the live books, not even inside the rolled-back transaction;
 *   3. a site user enters Sharose's 05-Nov..17-Nov tabs from
 *      "D:\Claude Cowork\Awami Daily Entry - Accountant (Sharose 17-Nov).xlsx" and submits
 *      each day (the match runs on submit);
 *   4. the match table is checked against the owner's expected outcomes;
 *   5. HO resolves every line (posting what was missing at HO, then Accept / re-run match),
 *      and the books must agree: site box 17-Nov = 50,700 = HO's site-box account.
 *
 * The file is read as the site accountant would key it on the screen:
 *   * the head NAMES map to HO head codes (HEAD below);
 *   * "Bank to Cash (withdrawal)" in the Cash column is one site-cash line whose head is the
 *     bank; its mirror in the Bank column of the payments block is the same event and is not
 *     keyed again;
 *   * a token return keyed without a token # carries its receipt no as the token #.
 *
 *   node scripts/nf/verify-nf-site-closing-stage2.js [--applied] [--file <xlsx>] > "$SCRATCH/nf-site2.log" 2>&1
 * Exit: 0 all passed · 1 something failed · 2 could not run.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const ROOT = path.resolve(__dirname, '..', '..');
const { q, REF, TOKEN } = require(path.join(ROOT, 'scripts', '_sbq'));
const AW = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const MIG = path.join(ROOT, 'supabase', 'migrations', '20261118a_nf_site_matching.sql');
const APPLIED = process.argv.includes('--applied');
const FILE = (process.argv.includes('--file') && process.argv[process.argv.indexOf('--file') + 1])
  || 'D:/Claude Cowork/Awami Daily Entry - Accountant (Sharose 17-Nov).xlsx';

const HEAD = {
  'Token - Unit': '21100', 'Bank to Cash (withdrawal)': 'BANK', 'Printing & Stationery': '70500',
  'Entertainment': '60400', 'Other (explain in Remarks)': '81300', 'Office Expense': '70950',
  'Site Utilities': '52900', 'Communication & Internet': '70600', 'Furniture & Fixtures': '15100',
  'Marketing Printing': '60300', 'Fuel & Transport': '70700', 'NOC & Approvals': '53300',
  'Construction Material': '52500', 'Advertising': '60100', 'Commission': '54100', 'Cement': '52200',
  'General Expenses': '70950', 'FMH': '22100' };
const MON = { Nov: '11' };

function readFile() {
  const wb = XLSX.readFile(FILE);
  const out = [];
  for (const tab of wb.SheetNames.filter(n => /^\d\d-Nov$/.test(n))) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: '' });
    const date = `2026-${MON[tab.slice(3)]}-${tab.slice(0, 2)}`;
    const take = (from, to, side) => {
      for (let i = from - 1; i < to; i++) {
        const r = rows[i] || [];
        const [, doc, party, units, tok, head, cash, bank, ref, remarks] = r.map(x => String(x).trim());
        if (!head && !cash && !bank) continue;
        if (!(head in HEAD)) throw new Error(`${tab} row ${i + 1}: head "${head}" not mapped`);
        if (head === 'Bank to Cash (withdrawal)' && side === 'OUT' && bank) continue;   // the mirror
        const isWdl = head === 'Bank to Cash (withdrawal)';
        out.push({ date, tab, row: i + 1, side, doc: doc || null, party: party || null,
          units: side === 'IN' ? (units || null) : null,
          token: tok ? Number(tok) : (HEAD[head] === '21100' && doc ? Number(doc) : null),
          head: isWdl ? 'BANK' : HEAD[head], via: cash ? 'SITE_CASH' : 'BANK',
          amount: Number(cash || bank), ref: ref || null, remarks: remarks || null });
      }
    };
    take(13, 37, 'IN'); take(43, 67, 'OUT');
  }
  return out;
}

const lit = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

(async () => {
  const run = crypto.randomBytes(3).toString('hex');
  console.log(`[verify-nf-site-closing-stage2] project ${REF} · run ${run} · migration ${APPLIED ? 'already applied' : 'inside the transaction'}`);
  let lines;
  try { lines = readFile(); } catch (e) { console.log('COULD NOT RUN —', e.message); process.exitCode = 2; return; }
  const days = [...new Set(lines.map(l => l.date))].sort();
  const cashBook = lines.filter(l => l.via === 'SITE_CASH').reduce((t, l) => t + (l.side === 'IN' ? l.amount : -l.amount), 0);
  console.log(`  file: ${lines.length} lines over ${days.length} days (${days[0]} .. ${days[days.length - 1]}), site cash book from the file = ${cashBook}`);

  const C = crypto.randomUUID(), S = crypto.randomUUID(), D = crypto.randomUUID();
  const colsOf = async t => (await q(`select string_agg(column_name, ',' order by ordinal_position) c from information_schema.columns
                                       where table_schema='public' and table_name='${t}' and is_generated <> 'ALWAYS'`))[0].c.split(',');
  // copy a table's Awami rows with new company / remapped ids, generated columns left out
  const copy = async (t, map) => {
    const cols = await colsOf(t);
    const sel = cols.map(c => map[c] || (c === 'company_id' ? `'${C}'::uuid` : `x.${c}`)).join(', ');
    return `INSERT INTO public.${t} (${cols.join(', ')}) SELECT ${sel} FROM public.${t} x WHERE x.company_id = '${AW}';`;
  };
  const fixture = [
    `INSERT INTO public.companies (id, company_code, company_name) VALUES ('${C}', 'ZZS2${run}', 'ZZTEST-NF-SITE2-${run}');`,
    `SELECT set_config('nf.purge_company', '${C}', true);`,
    // the copy is made with the guards off for this transaction only (no table lock); they are back on before any test call
    `SET LOCAL session_replication_role = replica;`,
    `CREATE TEMP TABLE _mp ON COMMIT DROP AS SELECT id old, gen_random_uuid() new FROM public.nf_parties WHERE company_id = '${AW}';`,
    `CREATE TEMP TABLE _md ON COMMIT DROP AS SELECT id old, gen_random_uuid() new FROM public.nf_days WHERE company_id = '${AW}';`,
    `CREATE TEMP TABLE _mv ON COMMIT DROP AS SELECT id old, gen_random_uuid() new FROM public.nf_vouchers WHERE company_id = '${AW}';`,
    await copy('nf_settings', {}),
    await copy('nf_floors', {}),
    await copy('nf_accounts', {}),
    await copy('nf_parties', { id: '(SELECT new FROM _mp WHERE old = x.id)' }),
    await copy('nf_party_aliases', { id: 'gen_random_uuid()', party_id: '(SELECT new FROM _mp WHERE old = x.party_id)' }),
    await copy('nf_days', { id: '(SELECT new FROM _md WHERE old = x.id)' }),
    await copy('nf_vouchers', { id: '(SELECT new FROM _mv WHERE old = x.id)', day_id: '(SELECT new FROM _md WHERE old = x.day_id)' }),
    await copy('nf_voucher_legs', { id: 'gen_random_uuid()', voucher_id: '(SELECT new FROM _mv WHERE old = x.voucher_id)',
                                    party_id: '(SELECT new FROM _mp WHERE old = x.party_id)' }),
    await copy('nf_voucher_counters', {}),
    await copy('nf_pdcs', { id: 'gen_random_uuid()', entered_day_id: '(SELECT new FROM _md WHERE old = x.entered_day_id)',
                            resolved_day_id: '(SELECT new FROM _md WHERE old = x.resolved_day_id)' }),
    `SET LOCAL session_replication_role = DEFAULT;`,
    `SELECT set_config('nf.purge_company', '', true);`,
    `SET CONSTRAINTS ALL DEFERRED;`,
    ...[['S', S], ['D', D]].map(([k, id]) =>
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nf-site2-${k.toLowerCase()}-${run}@zztest-nf.invalid', '', now(), now(), now());`),
    `INSERT INTO public.nf_members (company_id, user_id, role, display_name, active) VALUES
       ('${C}', '${D}', 'director', 'HO Director', true), ('${C}', '${S}', 'site', 'Sharose', true);`,
  ].join('\n');

  // the site accountant keys every day and submits it
  const keying = days.map(dt => {
    const saves = lines.filter(l => l.date === dt).map(l =>
      `PERFORM public.nf_site_save_line(co, '${dt}', NULL, ${lit(l.side)}, ${lit(l.doc)}, ${lit(l.party)}, ${lit(l.units)}, ${lit(l.token)},
         CASE WHEN ${lit(l.head)} = 'BANK' THEN '10300' ELSE ${lit(l.head)} END, ${lit(l.via)}, ${l.amount}, ${lit(l.ref)}, ${lit(l.remarks)}, NULL, NULL);`).join('\n  ');
    return `  ${saves}
  SELECT id, version, (public.nf_site_get_day(co, '${dt}')->>'book_now')::numeric INTO sd, v, n FROM public.nf_site_days WHERE company_id = co AND business_date = '${dt}';
  PERFORM public.nf_site_submit(sd, n, NULL, NULL, v);`;
  }).join('\n');

  const TESTS = String.raw`
CREATE TEMP TABLE _r (n serial, id text, pass boolean, detail text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.as_(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', u::text, true) $$;
CREATE FUNCTION pg_temp.ok(i text, p boolean, d text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r (id, pass, detail) VALUES (i, COALESCE(p, false), d) $$;
CREATE FUNCTION pg_temp.err(s text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE s; RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
-- the match table, one row per site line
CREATE FUNCTION pg_temp.mt() RETURNS TABLE (dt date, side text, doc text, party text, head text, via text, amount numeric,
  ref text, token int, status text, ho text, action text, reason text, line_id uuid, version int, resolved boolean)
LANGUAGE sql AS $$
  SELECT d.business_date, l.side, l.doc_no, l.party_name, l.head_code, l.via, l.amount, l.bank_ref, l.token_no,
         l.match_status, COALESCE(v.manual_no, v.voucher_no), l.proposal->>'action', l.match_reason, l.id, l.version,
         l.resolved_by IS NOT NULL
    FROM public.nf_site_lines l JOIN public.nf_site_days d ON d.id = l.site_day_id
    LEFT JOIN public.nf_vouchers v ON v.id = l.matched_voucher_id
   WHERE l.company_id = '${C}' ORDER BY d.business_date, l.side, l.line_no $$;
CREATE FUNCTION pg_temp.bal(code text) RETURNS numeric LANGUAGE sql AS $$
  SELECT COALESCE(sum(debit - credit), 0) FROM public.nf_voucher_legs WHERE company_id = '${C}' AND account_code = code $$;

DO $t$
DECLARE
  co constant uuid := '${C}'; us constant uuid := '${S}'; ud constant uuid := '${D}';
  sd uuid; v int; n numeric; e text; r record; cnt int;
BEGIN
  PERFORM pg_temp.ok('FX-01 fixture: the copy has Awami''s 440 vouchers and 938 legs',
    (SELECT count(*) FROM public.nf_vouchers WHERE company_id = co) = (SELECT count(*) FROM public.nf_vouchers WHERE company_id = '${AW}')
    AND (SELECT count(*) FROM public.nf_voucher_legs WHERE company_id = co) = (SELECT count(*) FROM public.nf_voucher_legs WHERE company_id = '${AW}'),
    (SELECT count(*) FROM public.nf_vouchers WHERE company_id = co)::text);
  PERFORM pg_temp.ok('FX-02 fixture: same Cash / Bank / site box as Awami',
    pg_temp.bal('10100') = 456250 AND pg_temp.bal('10300') = 26361788.75 AND pg_temp.bal('10200') = 0,
    pg_temp.bal('10100') || ' / ' || pg_temp.bal('10300') || ' / ' || pg_temp.bal('10200'));
  PERFORM pg_temp.ok('RD-01 real date read from narrations: BPV-0046 = 16-Nov, BRV-0079 = 14-Nov, BPV-0026 = 05-Nov',
    (SELECT bool_and(public._nf_voucher_real_date(narration, real_date, created_at) =
                     CASE manual_no WHEN 'BPV-0046' THEN date '2026-11-16' WHEN 'BRV-0079' THEN date '2026-11-14' ELSE date '2026-11-05' END)
       FROM public.nf_vouchers WHERE company_id = co AND manual_no IN ('BPV-0046','BRV-0079','BPV-0026')), '');

  -- ── HO opens the site box; the site accountant keys and submits every day ──
  PERFORM pg_temp.as_(ud);
  PERFORM public.nf_site_start_first_day(co, '${days[0]}', 0);
  PERFORM pg_temp.as_(us);
${keying}
  PERFORM pg_temp.ok('K-01 every line of the file is keyed and every day submitted',
    (SELECT count(*) FROM public.nf_site_lines WHERE company_id = co) = ${lines.length}
    AND (SELECT bool_and(status = 'SUBMITTED') FROM public.nf_site_days WHERE company_id = co),
    (SELECT count(*) FROM public.nf_site_lines WHERE company_id = co)::text);
  PERFORM pg_temp.ok('K-02 site cash book 17-Nov = 50,700 (and = the file''s own figure ${cashBook})',
    public._nf_site_book(co, '2026-11-17') = 50700 AND ${cashBook} = 50700, public._nf_site_book(co, '2026-11-17')::text);

  -- ── what the site user may see ──
  PERFORM pg_temp.ok('V-01 the site user sees each line''s status, never HO''s voucher / reason / proposal',
    (SELECT bool_and(NOT (x ? 'match_reason') AND NOT (x ? 'matched_voucher_id') AND NOT (x ? 'proposal') AND (x ? 'match_status'))
       FROM jsonb_array_elements(public.nf_site_get_day(co, '2026-11-16')->'lines') x), '');
  e := pg_temp.err(format('SELECT public.nf_site_review((SELECT id FROM public.nf_site_days WHERE company_id = %L LIMIT 1))', co));
  PERFORM pg_temp.ok('V-02 the site user cannot open HO''s review', e LIKE 'NF:NOT_ALLOWED%', e);
  e := pg_temp.err(format('SELECT public.nf_site_match((SELECT id FROM public.nf_site_days WHERE company_id = %L LIMIT 1))', co));
  PERFORM pg_temp.ok('V-03 …nor run the match', e LIKE 'NF:NOT_ALLOWED%', e);
  e := pg_temp.err(format('SELECT public.nf_site_accept(%L, 1, NULL, NULL)', (SELECT line_id FROM pg_temp.mt() LIMIT 1)));
  PERFORM pg_temp.ok('V-04 …nor accept a line', e LIKE 'NF:NOT_ALLOWED%', e);
END
$t$;

-- the match table, exactly as matched on submit
CREATE TEMP TABLE _mt0 ON COMMIT DROP AS SELECT * FROM pg_temp.mt();

DO $t$
DECLARE co constant uuid := '${C}';
BEGIN
  -- ── the owner's expected outcomes ──
  PERFORM pg_temp.ok('M-01 cheque 6265 (3,00,000, 16-Nov) = BPV-0046: DUPLICATE, Accept moves it from HO cash to the site box',
    EXISTS (SELECT 1 FROM _mt0 WHERE dt = '2026-11-16' AND ref = '6265' AND status = 'DUPLICATE' AND ho = 'BPV-0046' AND action = 'transfer'),
    (SELECT string_agg(status || ' ' || COALESCE(ho, '-') || ' ' || COALESCE(action, '-'), ';') FROM _mt0 WHERE ref = '6265'));
  PERFORM pg_temp.ok('M-02 cheque 6268 (2,00,000) and Khyber Traders 2,00,000 cement = BPV-0045 (one bank payment, pass-through)',
    (SELECT count(*) FROM _mt0 WHERE dt = '2026-11-16' AND status = 'DUPLICATE' AND ho = 'BPV-0045' AND action = 'pass_through'
        AND (ref = '6268' OR party = 'KHYBER TRADERS')) = 2,
    (SELECT string_agg(COALESCE(party, ref) || ': ' || status || ' ' || COALESCE(ho, '-') || ' ' || COALESCE(action, '-'), ' ; ') FROM _mt0 WHERE ref = '6268' OR party = 'KHYBER TRADERS'));
  PERFORM pg_temp.ok('M-03 Zia ul Haq 50,000 = CPV-0172, Abu Bakar 59,000 = CPV-0171, Naeem 1,50,000 = CPV-0170: DUPLICATE, source mismatch',
    (SELECT count(*) FROM _mt0 WHERE dt = '2026-11-16' AND status = 'DUPLICATE' AND action = 'reroute' AND reason LIKE 'Source mismatch%'
        AND ((party = 'ZIA UL HAQ' AND ho = 'CPV-0172') OR (party = 'ABU BAKAR' AND ho = 'CPV-0171') OR (party = 'NAEEM' AND ho = 'CPV-0170'))) = 3,
    (SELECT string_agg(party || ': ' || status || ' ' || COALESCE(ho, '-'), ' ; ') FROM _mt0 WHERE party IN ('ZIA UL HAQ','ABU BAKAR','NAEEM')));
  PERFORM pg_temp.ok('M-04 Waqar 10,00,000 (6266) = BPV-0043, Fawad 3,00,000 (6267) = BPV-0044: LINKED',
    (SELECT count(*) FROM _mt0 WHERE status = 'LINKED' AND ((ref = '6266' AND ho = 'BPV-0043') OR (ref = '6267' AND ho = 'BPV-0044'))) = 2, '');
  PERFORM pg_temp.ok('M-05 Irfan Ullah #208 20,000 bank = BRV-0079: LINKED',
    EXISTS (SELECT 1 FROM _mt0 WHERE token = 208 AND status = 'LINKED' AND ho = 'BRV-0079'), '');
  PERFORM pg_temp.ok('M-06 05-Nov NAEEM 1,50,000 "Bank to Cash" vs BPV-0026 (booked at HO as 70950 from the bank): CONFLICT',
    EXISTS (SELECT 1 FROM _mt0 WHERE dt = '2026-11-05' AND party = 'NAEEM' AND status = 'CONFLICT' AND ho = 'BPV-0026'),
    (SELECT string_agg(status || ' ' || COALESCE(ho, '-') || ' ' || reason, ';') FROM _mt0 WHERE dt = '2026-11-05' AND party = 'NAEEM'));
  PERFORM pg_temp.ok('M-07 Osama bin Yousaf 5,00,000 chq 6292 (17-Nov, FMH): CONFLICT "bank line missing at HO"',
    EXISTS (SELECT 1 FROM _mt0 WHERE ref = '6292' AND status = 'CONFLICT' AND ho IS NULL AND reason LIKE 'Bank line missing at HO%'), '');
  PERFORM pg_temp.ok('M-08 Muhammad Tahir #205 10,000 cash, Tehseen Ullah #207 5,000 in (13-Nov) and 5,000 out (14-Nov): NEW',
    (SELECT count(*) FROM _mt0 WHERE status = 'NEW' AND ((token = 205 AND side = 'IN') OR (token = 207 AND side IN ('IN','OUT')))) = 3, '');
  PERFORM pg_temp.ok('M-09 small site expenses 05..17 Nov: NEW, total 1,50,300',
    (SELECT sum(amount) FROM _mt0 WHERE side = 'OUT' AND via = 'SITE_CASH' AND head <> '21100'
        AND NOT (dt = '2026-11-16' AND COALESCE(party, '') IN ('ZIA UL HAQ','ABU BAKAR','NAEEM','KHYBER TRADERS'))) = 150300
    AND (SELECT bool_and(status = 'NEW') FROM _mt0 WHERE side = 'OUT' AND via = 'SITE_CASH' AND head <> '21100'
        AND NOT (dt = '2026-11-16' AND COALESCE(party, '') IN ('ZIA UL HAQ','ABU BAKAR','NAEEM','KHYBER TRADERS'))),
    (SELECT string_agg(dt || ' ' || amount || ' ' || status || COALESCE(' ' || ho, ''), ' ; ') FROM _mt0 WHERE side = 'OUT' AND via = 'SITE_CASH' AND head <> '21100'
        AND NOT (dt = '2026-11-16' AND COALESCE(party, '') IN ('ZIA UL HAQ','ABU BAKAR','NAEEM','KHYBER TRADERS')) AND status <> 'NEW'));
  -- the brief listed Sakhi Jan as NEW; the brief's own ownership rule ("a site BANK line with
  -- no HO match is CONFLICT bank line missing at HO") makes it a CONFLICT. The rule is applied.
  PERFORM pg_temp.ok('M-10 Sakhi Jan #209 30,011 (JazzCash, in the Bank column, nothing at HO): CONFLICT "bank line missing at HO" — the brief''s table said NEW',
    EXISTS (SELECT 1 FROM _mt0 WHERE token = 209 AND status = 'CONFLICT' AND reason LIKE 'Bank line missing at HO%'), '');
  PERFORM pg_temp.ok('M-11 nothing else: every line is one of the expected outcomes',
    (SELECT count(*) FROM _mt0) = ${lines.length}
    AND NOT EXISTS (SELECT 1 FROM _mt0 WHERE status IN ('POSSIBLE')), (SELECT string_agg(dt || ' ' || COALESCE(party, '-') || ' ' || amount || ' ' || status, ' ; ') FROM _mt0 WHERE status = 'POSSIBLE'));
END
$t$;

-- ── HO resolves every line ─────────────────────────────────────────────────
DO $t$
DECLARE co constant uuid := '${C}'; us constant uuid := '${S}'; ud constant uuid := '${D}';
  r record; e text; hoday uuid; sd uuid; v int; c0 numeric; b0 numeric; h record;
BEGIN
  PERFORM pg_temp.as_(ud);
  c0 := pg_temp.bal('10100'); b0 := pg_temp.bal('10300');
  SELECT id INTO hoday FROM public.nf_days WHERE company_id = co AND status = 'OPEN';

  -- guards first
  SELECT * INTO r FROM pg_temp.mt() WHERE ref = '6292';
  e := pg_temp.err(format('SELECT public.nf_site_accept(%L, %s, NULL, NULL)', r.line_id, r.version));
  PERFORM pg_temp.ok('A-01 a CONFLICT cannot simply be accepted', e LIKE 'NF:SITE_LINE_NOT_ACCEPTABLE%', e);
  SELECT * INTO r FROM pg_temp.mt() WHERE ref = '6265';
  e := pg_temp.err(format('SELECT public.nf_site_reject(%L, %s, %L)', r.line_id, r.version, 'test'));
  PERFORM pg_temp.ok('A-02 rejecting the 3,00,000 withdrawal would sink the site box: refused', e LIKE 'NF:SITE_CASH_NEGATIVE%', e);
  e := pg_temp.err(format('SELECT public.nf_site_reject(%L, %s, %L)', r.line_id, r.version, ' '));
  PERFORM pg_temp.ok('A-03 a reject needs a reason', e LIKE 'NF:REASON_REQUIRED%', e);
  e := pg_temp.err(format('SELECT public.nf_site_mark_duplicate(%L, %s, (SELECT id FROM public.nf_vouchers WHERE company_id = %L AND manual_no = %L))',
                          r.line_id, r.version, co, 'CPV-0170'));
  PERFORM pg_temp.ok('A-04 marking a line duplicate of a voucher with another amount is refused', e LIKE 'NF:LINK_AMOUNT_DIFFERS%', e);
  e := pg_temp.err(format($$SELECT public.nf_save_transfer(%L, 'Cash', 'Cash', 10, '2026-11-16', 'x')$$, hoday));
  PERFORM pg_temp.ok('A-05 a transfer goes between HO cash and the site box only', e LIKE 'NF:TRANSFER_CASH_AND_SITE_BOX_ONLY%', e);
  e := pg_temp.err(format($$SELECT public.nf_save_transfer(%L, 'Cash', 'Petty', 10, NULL, 'x')$$, hoday));
  PERFORM pg_temp.ok('A-06 a transfer needs its real date', e LIKE 'NF:REAL_DATE_REQUIRED%', e);
  e := pg_temp.err(format($$SELECT public.nf_save_transfer(%L, 'Petty', 'Cash', 10, '2026-11-16', 'x')$$, hoday));
  PERFORM pg_temp.ok('A-07 the site box cannot be emptied below zero by a transfer', e LIKE 'NF:NEGATIVE_POSITION%', e);

  -- what was missing at HO, HO posts through its own day paths
  -- 05-Nov: HO's BPV-0026 was really the site's withdrawal on chq 1313825996
  SELECT l.id, v.version INTO h FROM public.nf_vouchers v JOIN public.nf_voucher_legs l ON l.voucher_id = v.id AND l.line_no = 1
   WHERE v.company_id = co AND v.manual_no = 'BPV-0026';
  PERFORM public.nf_delete_line(h.id, h.version);
  PERFORM public.nf_save_withdrawal(hoday, 'BPV-0026', 'Bank', 'Petty', 150000, '1313825996', 'Cash for the site box c/o Naeem sb', '2026-11-05');
  -- 16-Nov: Sakhi Jan's JazzCash token (in the bank, per the site)
  PERFORM public.nf_save_line(hoday, NULL, 'IN', NULL, 'Token #209 — Sakhi Jan, Units FF 120, FF 121 and FF 196 (JazzCash into BOP, 16-Nov)',
                              '21100', 'FF', 'Bank', 30011, NULL, 'Sakhi Jan');
  -- 17-Nov: the FMH loan cheque to Osama bin Yousaf
  PERFORM public.nf_save_line(hoday, NULL, 'OUT', NULL, 'Loan to FMH — Osama bin Yousaf, BOP chq #1313826292 (17-Nov)',
                              '22100', 'P-W', 'Bank', 500000, NULL, NULL);
  FOR r IN SELECT id FROM public.nf_site_days WHERE company_id = co ORDER BY business_date LOOP
    PERFORM public.nf_site_match(r.id);
  END LOOP;
  PERFORM pg_temp.ok('A-08 after HO posts them and re-runs the match: 05-Nov NAEEM, Sakhi Jan and Osama all match',
    (SELECT count(*) FROM pg_temp.mt() WHERE (dt = '2026-11-05' AND party = 'NAEEM' AND status = 'DUPLICATE' AND ho = 'BPV-0026')
        OR (token = 209 AND status = 'LINKED') OR (ref = '6292' AND status = 'LINKED')) = 3,
    (SELECT string_agg(COALESCE(party, ref) || ' ' || status || ' ' || COALESCE(ho, '-'), ' ; ') FROM pg_temp.mt()
      WHERE (dt = '2026-11-05' AND party = 'NAEEM') OR token = 209 OR ref = '6292'));

  -- day by day, as HO would: the matched lines (withdrawals first), then every NEW line
  FOR r IN SELECT id FROM public.nf_site_days WHERE company_id = co ORDER BY business_date LOOP
    FOR h IN SELECT * FROM pg_temp.mt() m JOIN public.nf_site_lines l ON l.id = m.line_id
              WHERE l.site_day_id = r.id AND m.status IN ('DUPLICATE','LINKED') AND NOT m.resolved
              ORDER BY (m.action = 'transfer') DESC, (m.side = 'IN') DESC LOOP
      PERFORM public.nf_site_accept(h.line_id, (SELECT version FROM public.nf_site_lines WHERE id = h.line_id), NULL, NULL);
    END LOOP;
    PERFORM public.nf_site_accept_new(r.id, (SELECT version FROM public.nf_site_days WHERE id = r.id));
  END LOOP;

  PERFORM pg_temp.ok('R-01 every line is decided: ACCEPTED (posted) or LINKED, none rejected, none open',
    NOT EXISTS (SELECT 1 FROM pg_temp.mt() WHERE NOT resolved OR status NOT IN ('ACCEPTED','LINKED')),
    (SELECT string_agg(dt || ' ' || COALESCE(party, '-') || ' ' || status, ' ; ') FROM pg_temp.mt() WHERE NOT resolved OR status NOT IN ('ACCEPTED','LINKED')));
  PERFORM pg_temp.ok('R-02 site cash book 17-Nov = 50,700', public._nf_site_book(co, '2026-11-17') = 50700, public._nf_site_book(co, '2026-11-17')::text);
  PERFORM pg_temp.ok('R-03 HO''s site-box account (10200) = 50,700 — the books and the box agree', pg_temp.bal('10200') = 50700, pg_temp.bal('10200')::text);
  PERFORM pg_temp.ok('R-04 HO cash moved by exactly −41,000 (3,00,000 to the site box, 2,59,000 of HO-cash vouchers moved to the box)',
    pg_temp.bal('10100') = c0 - 41000, (pg_temp.bal('10100') - c0)::text);
  PERFORM pg_temp.ok('R-05 bank moved by exactly +30,011 − 5,00,000 (Sakhi Jan in, Osama out; BPV-0026 became a withdrawal)',
    pg_temp.bal('10300') = b0 + 30011 - 500000, (pg_temp.bal('10300') - b0)::text);
  PERFORM pg_temp.ok('R-06 nothing booked twice: no HO voucher is the posting of two site lines',
    NOT EXISTS (SELECT posted_voucher_id FROM public.nf_site_lines WHERE company_id = co AND posted_voucher_id IS NOT NULL
                 GROUP BY 1 HAVING count(*) > 1), '');
  PERFORM pg_temp.ok('R-07 every posted site line is a site-box day voucher with the site''s real date',
    (SELECT bool_and(v.real_date = d.business_date AND v.source = 'DAY'
                     AND EXISTS (SELECT 1 FROM public.nf_voucher_legs g WHERE g.voucher_id = v.id AND g.account_code = '10200'))
       FROM public.nf_site_lines l JOIN public.nf_site_days d ON d.id = l.site_day_id JOIN public.nf_vouchers v ON v.id = l.posted_voucher_id
      WHERE l.company_id = co), '');
  PERFORM pg_temp.ok('R-08 the moved HO vouchers (CPV-0170/71/72) now pay from the site box, HO''s head kept',
    (SELECT count(*) FROM public.nf_vouchers v JOIN public.nf_voucher_legs g ON g.voucher_id = v.id AND g.line_no = 2 AND g.account_code = '10200'
      JOIN public.nf_voucher_legs h1 ON h1.voucher_id = v.id AND h1.line_no = 1
      WHERE v.company_id = co AND ((v.manual_no = 'CPV-0170' AND h1.account_code = '12620') OR (v.manual_no = 'CPV-0171' AND h1.account_code = '52650')
                                OR (v.manual_no = 'CPV-0172' AND h1.account_code = '53500'))) = 3, '');
  PERFORM pg_temp.ok('R-09 one paper voucher, two lines: Nasir Khan 212 is posted as 212/1 and 212/2',
    (SELECT count(*) FROM public.nf_vouchers WHERE company_id = co AND manual_no IN ('212/1','212/2')) = 2, '');
  PERFORM pg_temp.ok('R-10 site token money reaches the token ledger (#205, #207 in and out)',
    (SELECT count(*) FROM public._nf_token_alloc(co, NULL) a WHERE a.nos && ARRAY[205, 207]) = 3, '');

  -- a decided line cannot be changed by the site, even on a returned day
  SELECT id, version INTO sd, v FROM public.nf_site_days WHERE company_id = co AND business_date = '2026-11-17';
  PERFORM public.nf_site_return(sd, 'test: decided lines stay as they are', v);
  PERFORM pg_temp.as_(us);
  SELECT * INTO r FROM pg_temp.mt() WHERE ref = '6292';
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L, '2026-11-17', %L, 'OUT', NULL, 'X', NULL, NULL, '22100', 'BANK', 1, '6292', NULL, NULL, %s)$$,
                          co, r.line_id, r.version));
  PERFORM pg_temp.ok('R-11 the site cannot edit a line HO has decided', e LIKE 'NF:SITE_LINE_RESOLVED%', e);
  e := pg_temp.err(format('SELECT public.nf_site_delete_line(%L, %s)', r.line_id, r.version));
  PERFORM pg_temp.ok('R-12 …nor delete it', e LIKE 'NF:SITE_LINE_RESOLVED%', e);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L, '2026-11-17', NULL, 'OUT', '201', 'X', NULL, NULL, '52900', 'SITE_CASH', 1, NULL, NULL, NULL, NULL)$$, co));
  PERFORM pg_temp.ok('R-13 a paper voucher no used on another day is refused (201 was 05-Nov)', e LIKE 'NF:DUPLICATE_DOC_NO%', e);
  PERFORM pg_temp.ok('R-14 Awami''s own books were not touched', (SELECT count(*) FROM public.nf_vouchers WHERE company_id = '${AW}') = 440, '');
END
$t$;

DO $f$
DECLARE s text; p int; f int; m text;
BEGIN
  SELECT string_agg(format('%s %s %-3s %-5s %-16s %-6s %-9s %10s %-12s %-9s %-9s %s', to_char(dt, 'DD-Mon'), side, COALESCE(doc, ''),
                           COALESCE(token::text, ''), left(COALESCE(party, ''), 16), head, via, amount, left(COALESCE(ref, ''), 12),
                           status, COALESCE(ho, ''), COALESCE(action, '')), E'\n' ORDER BY dt, side DESC)
    INTO m FROM _mt0;
  SELECT string_agg((CASE WHEN pass THEN 'PASS ' ELSE 'FAIL ' END) || id || CASE WHEN pass THEN '' ELSE '  ' || left(COALESCE(detail, ''), 400) END, E'\n' ORDER BY n),
         count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass)
    INTO s, p, f FROM _r;
  RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', p, f, E'\n' || s || E'\n\nMATCH TABLE (as matched on submit)\n' || m;
END
$f$;
`;

  const sql = ['BEGIN;', APPLIED ? '' : fs.readFileSync(MIG, 'utf8'), fixture, TESTS].join('\n');
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const msg = res.ok ? 'NO EXCEPTION — the transaction did not roll back; check for leftovers' : await res.text();
  const m = msg.match(/DRYRUN_RESULT[\s\S]*/);
  const out = m ? m[0].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/"\}$/, '') : msg;
  console.log(out);
  const left = await q(`select (select count(*) from companies where id = '${C}') co,
                               (select count(*) from auth.users where email like '%-${run}@zztest-nf.invalid') users,
                               (select count(*) from nf_vouchers where company_id = '${AW}') awami_vouchers,
                               (select count(*) from pg_proc where proname = 'nf_site_match') fn_live`);
  console.log('after rollback:', JSON.stringify(left));
  const f = /pass=(\d+) fail=(\d+)/.exec(out);
  process.exitCode = !f ? 2 : Number(f[2]) === 0 ? 0 : 1;
})().catch(e => { console.log('COULD NOT RUN —', e.message); process.exitCode = 2; });

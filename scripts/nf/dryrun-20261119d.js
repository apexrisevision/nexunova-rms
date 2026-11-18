#!/usr/bin/env node
/* Dry run of 20261119d (nf_day_report): migration + calls in ONE request ending in RAISE — rolled back.
   As the director: 16-Nov site / ho / combined and 18-Nov site. As Sharose: 16-Nov asking for COMBINED (must
   come back as Site, with no Head Office Cash and no bank). Each report is then drawn by the screen's own
   js/nf/nf-whatsapp-report.js into a JPG and a PDF (the mockups).
   Usage: node scripts/nf/dryrun-20261119d.js <out dir> */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const puppeteer = require(path.join(ROOT, 'node_modules', 'puppeteer-core'));
const { REF, TOKEN, q } = require('../_sbq');
require(path.join(ROOT, 'js', 'nf', 'nf-whatsapp-report.js'));
const MIG = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261119d_nf_day_report_whatsapp.sql'), 'utf8');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', RASHID = '315f2852-852f-4653-9253-a5a27a7828c8';
const OUT = process.argv[2];
(async () => {
  const sh = (await q(`select auth_user_id from app_users where company_id = '${CO}' and username = 'sharose'`))[0].auth_user_id;
  const as = id => `PERFORM set_config('request.jwt.claims', json_build_object('sub', '${id}', 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', '${id}', true);`;
  const body = `DO $t$ DECLARE r jsonb := '{}'; BEGIN
    ${as(RASHID)}
    r := r || jsonb_build_object('16 site', public.nf_day_report('${CO}', DATE '2026-11-16', 'site'),
                                 '16 ho', public.nf_day_report('${CO}', DATE '2026-11-16', 'ho'),
                                 '16 combined', public.nf_day_report('${CO}', DATE '2026-11-16', 'combined'),
                                 '18 site', public.nf_day_report('${CO}', DATE '2026-11-18', 'site'));
    ${as(sh)}
    r := r || jsonb_build_object('sharose asks combined', public.nf_day_report('${CO}', DATE '2026-11-16', 'combined'));
    RAISE EXCEPTION 'DRYRUN_RESULT %', r::text; END $t$;`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'BEGIN;\n' + MIG + '\n' + body }) });
  const msg = JSON.parse(await res.text()).message;
  const m = /DRYRUN_RESULT (\{[\s\S]*\})/.exec(msg); if (!m) { console.log(msg); process.exit(1); }
  const R = JSON.parse(m[1].replace(/\nCONTEXT[\s\S]*$/, ''));
  const tot = l => l.reduce((t, x) => t + Number(x.amount), 0);
  for (const [k, r] of Object.entries(R)) {
    console.log(k.padEnd(22), 'view', r.view, '| boxes', r.boxes.map(b => b.label + ' ' + b.closing).join(', '),
      '| received', r.received.length, tot(r.received), '| paid', r.paid.length, tot(r.paid), '| transfers', r.transfers.length, '| by', r.prepared_by);
  }
  const s = R['sharose asks combined'];
  console.log('CHECK Sharose got Site, no Head Office Cash, no bank:', s.view === 'site' && s.boxes.length === 1 && s.boxes[0].via === 'Petty' && !JSON.stringify(s.boxes).includes('Bank'));
  const c = R['16 combined'];
  console.log('CHECK 16-Nov Combined: received', tot(c.received), '(expect 0) · paid', tot(c.paid), '(expect 1760940)');
  console.log('CHECK token "for":', R['18 site'].received.map(x => x.for).join(' | '));
  console.log('CHECK no narration in From / Paid to:', JSON.stringify([...c.received, ...c.paid].map(x => x.party)));
  // mockups, drawn by the screen's own code
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));
  const br = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const pg = await br.newPage(); await pg.setViewport({ width: 1080, height: 1200, deviceScaleFactor: 1 });
  for (const [k, r] of Object.entries({ '2026-11-16 Site': R['16 site'], '2026-11-16 Head Office': R['16 ho'], '2026-11-16 Combined': R['16 combined'], '2026-11-18 Site': R['18 site'] })) {
    await pg.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body>' + globalThis.NfWaReport.html(r) + '</body></html>', { waitUntil: 'load' });
    const wpx = await pg.evaluate(() => document.documentElement.scrollWidth); console.log('width', k, wpx, wpx <= 1080 ? 'OK' : 'TOO WIDE'); // widths
    await pg.screenshot({ path: path.join(OUT, k + '.jpg'), type: 'jpeg', quality: 90, fullPage: true });
    const h = await pg.evaluate(() => document.body.scrollHeight);
    await pg.pdf({ path: path.join(OUT, k + '.pdf'), width: '1080px', height: h + 'px', printBackground: true, pageRanges: '1' });
  }
  await br.close();
  console.log('after rollback: nf_day_report exists:', JSON.stringify(await q(`select count(*) n from pg_proc where proname = 'nf_day_report'`)));
})();

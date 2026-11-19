#!/usr/bin/env node
/* Dry run of 20261119g (the day report's lines carry head / token / units) + the Daily Brief mockups.
   The migration and the report calls run in ONE request ending in RAISE (rolled back): 16-Nov Combined and Head
   Office as the director, 18-Nov and 19-Nov Site as Sharose. Each report is laid out by the screen's own
   js/nf/nf-whatsapp-report.js (mount = the fitting) into a 1080 × 1350 JPG and an A4 PDF.
   Usage: node scripts/nf/dryrun-20261119g.js <out dir> */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const puppeteer = require(path.join(ROOT, 'node_modules', 'puppeteer-core'));
const { REF, TOKEN, q } = require('../_sbq');
const MIG = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261119g_nf_day_report_heads.sql'), 'utf8');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', RASHID = '315f2852-852f-4653-9253-a5a27a7828c8';
const OUT = process.argv[2];
const url = p => 'file:///' + path.join(ROOT, p).replace(/\\/g, '/');
(async () => {
  const sh = (await q(`select auth_user_id from app_users where company_id = '${CO}' and username = 'sharose'`))[0].auth_user_id;
  const as = id => `PERFORM set_config('request.jwt.claims', json_build_object('sub', '${id}', 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', '${id}', true);`;
  const body = `DO $t$ DECLARE r jsonb := '{}'; BEGIN
    ${as(RASHID)}
    r := r || jsonb_build_object('2026-11-16 Combined', public.nf_day_report('${CO}', DATE '2026-11-16', 'combined'),
                                 '2026-11-16 Head Office', public.nf_day_report('${CO}', DATE '2026-11-16', 'ho'));
    ${as(sh)}
    r := r || jsonb_build_object('2026-11-18 Site', public.nf_day_report('${CO}', DATE '2026-11-18', 'site'),
                                 '2026-11-19 Site', public.nf_day_report('${CO}', DATE '2026-11-19', 'site'));
    RAISE EXCEPTION 'DRYRUN_RESULT %', r::text; END $t$;`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'BEGIN;\n' + MIG + '\n' + body }) });
  const msg = JSON.parse(await res.text()).message;
  const m = /DRYRUN_RESULT (\{[\s\S]*\})/.exec(msg); if (!m) { console.log(msg); process.exit(1); }
  const R = JSON.parse(m[1].replace(/\nCONTEXT[\s\S]*$/, ''));
  if (process.env.NF_DUMP) fs.writeFileSync(process.env.NF_DUMP, JSON.stringify(R, null, 1));
  const tot = l => l.reduce((t, x) => t + Number(x.amount), 0);
  fs.mkdirSync(OUT, { recursive: true });
  const br = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  for (const [name, rep] of Object.entries(R)) {
    const pg = await br.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    const tmp = path.join(require('os').tmpdir(), 'nf-brief-' + process.pid + '.html');
    fs.writeFileSync(tmp, `<!doctype html><html><head><meta charset="utf-8"><base href="${url('')}/"><style>html,body{margin:0;background:#fff}</style>
      <script src="${url('js/nf/nf-format.js')}"></script><script src="${url('js/nf/nf-messages.js')}"></script><script src="${url('js/nf/nf-whatsapp-report.js')}"></script></head>
      <body><div id="p" style="width:1080px"></div></body></html>`);
    await pg.goto('file:///' + tmp.split(path.sep).join('/'), { waitUntil: 'load' });
    const lim = await pg.evaluate(r => window.NfWaReport.mount(document.getElementById('p'), r), rep);
    await pg.evaluate(() => Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(ok => { i.onload = i.onerror = ok; }))));
    const fit = await pg.evaluate(() => { const w = document.querySelector('.wa'); return { h: w.scrollHeight, w: w.scrollWidth, small: [...w.querySelectorAll('*')].filter(e => e.childNodes.length && parseFloat(getComputedStyle(e).fontSize) < 14).length, big: [...w.querySelectorAll('*')].filter(e => parseFloat(getComputedStyle(e).fontSize) > 30).length }; });
    await pg.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
    // A4 portrait, the same page scaled to the paper width
    await pg.evaluate(() => { const p = document.getElementById('p'); p.style.transform = 'scale(' + (718 / 1080) + ')'; p.style.transformOrigin = '0 0'; p.style.margin = '38px 0 0 38px'; });
    await pg.pdf({ path: path.join(OUT, name + '.pdf'), format: 'A4', printBackground: true, pageRanges: '1', margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    console.log(name.padEnd(24), '| fitted with', JSON.stringify(lim), '| page', fit.w + '×' + fit.h, fit.h <= 1350 ? 'fits' : 'OVERFLOWS',
      '| text <14px:', fit.small, '>30px:', fit.big, '| errors', errs.length);
    console.log('   boxes:', rep.boxes.map(b => b.label + ' ' + b.opening + ' → ' + b.closing).join(' · '), '| received', tot(rep.received), '| paid', tot(rep.paid), '| transfers', rep.transfers.length);
    await pg.close();
  }
  await br.close();
  console.log('after rollback: day_report rows have head:', JSON.stringify(await q(`select position('''head'', h.name' in pg_get_functiondef('public.nf_day_report'::regproc)) > 0 live`)));
})();

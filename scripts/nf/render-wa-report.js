#!/usr/bin/env node
/* Read-only: draws the WhatsApp report with the screen's own js/nf/nf-whatsapp-report.js from the LIVE
   nf_day_report (as the director, or as the site login), into a JPG and a PDF. Nothing is written.
   Usage: node scripts/nf/render-wa-report.js <out dir> <date:view[:site]> ...   e.g. 2026-11-16:combined 2026-11-18:site:site */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const puppeteer = require(path.join(ROOT, 'node_modules', 'puppeteer-core'));
const { REF, TOKEN, q } = require('../_sbq');
require(path.join(ROOT, 'js', 'nf', 'nf-whatsapp-report.js'));
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', RASHID = '315f2852-852f-4653-9253-a5a27a7828c8';
const [OUT, ...jobs] = process.argv.slice(2);
(async () => {
  const sh = (await q(`select auth_user_id from app_users where company_id = '${CO}' and username = 'sharose'`))[0].auth_user_id;
  fs.mkdirSync(OUT, { recursive: true });
  const br = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const pg = await br.newPage(); await pg.setViewport({ width: 1080, height: 1200, deviceScaleFactor: 1 });
  for (const job of jobs) {
    const [date, view, who] = job.split(':');
    const uid = who === 'site' ? sh : RASHID;
    const sql = `DO $t$ BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', '${uid}', true);
      RAISE EXCEPTION 'REPORT %', public.nf_day_report('${CO}', DATE '${date}', '${view}')::text; END $t$;`;
    const t = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
    const msg = JSON.parse(t).message;
    const rep = JSON.parse(msg.slice(msg.indexOf('REPORT ') + 7).replace(/\nCONTEXT[\s\S]*$/, ''));
    await pg.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#EEF2F7}</style></head><body>' + globalThis.NfWaReport.html(rep) + '</body></html>', { waitUntil: 'load' });
    const w = await pg.evaluate(() => document.documentElement.scrollWidth), h = await pg.evaluate(() => document.body.scrollHeight);
    const base = path.join(OUT, `${date} ${rep.view_name}`);
    await pg.screenshot({ path: base + '.jpg', type: 'jpeg', quality: 92, fullPage: true });
    await pg.pdf({ path: base + '.pdf', width: '1080px', height: h + 'px', printBackground: true, pageRanges: '1' });
    console.log(job, '->', rep.view_name, '| width', w, w <= 1080 ? 'OK' : 'TOO WIDE', '| boxes', rep.boxes.map(b => b.label + ' ' + b.closing).join(', '), '| by', rep.prepared_by);
  }
  await br.close();
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

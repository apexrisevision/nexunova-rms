#!/usr/bin/env node
/* REPRO: Directors' Room → a "Time over" hold → Release → the picture.

   Reads Awami's real public payload, room report and waiting holds inside a
   transaction that is ROLLED BACK (throw-away link + room password). The page
   is served locally; every Supabase call is answered from what was captured,
   and decide_holds is answered as the server would — so NOTHING is released.
   Then presses Release on the first "Time over" card (never one with a token)
   and Share picture, and prints what happened at each step.

   node scripts/repro-room-release-picture.js [outdir]                          */
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer-core');
const { q } = require('./_sbq');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'marketing_shots', 'room'));
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', PR = '59ded55b-9bc2-45b2-a372-49fc31807fa9';
const TOKEN_UNITS = ['GF-185', 'GF-187', 'GF-127', 'GF-191', 'LG-125'];   // never released, not even in a repro
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cap = await q(`
    BEGIN;
    INSERT INTO public.availability_links (token_hash, company_id, project_id, label)
    VALUES (public._availability_token_hash('repro_rel_probe'), '${CO}', '${PR}', 'RELEASE REPRO - rolled back');
    UPDATE public.projects SET report_password_hash = public._availability_secret_hash('${PR}', 'repro-pw') WHERE id = '${PR}';
    CREATE TEMP TABLE cap ON COMMIT DROP AS
      SELECT public.get_public_availability('repro_rel_probe') AS p,
             public.get_availability_report('repro_rel_probe', 'repro-pw') AS r,
             public.get_hold_decisions('repro_rel_probe', 'repro-pw') AS h;
    SELECT p::text AS p, r::text AS r, h::text AS h FROM cap;
    ROLLBACK;`);
  const payload = JSON.parse(cap[0].p), report = JSON.parse(cap[0].r), holds = JSON.parse(cap[0].h);

  const srv = http.createServer((rq, rs) => {
    const p = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rs.writeHead(404); return rs.end(); }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(rs);
  }).listen(4196);

  const br = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const errs = [], toasts = [], scripts = [];
  try {
    const pg = await br.newPage();
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await pg.setRequestInterception(true);
    pg.on('request', r => {
      if (/portal-reserve-desk\.js/.test(r.url())) scripts.push(r.url().replace(/^https?:\/\/[^/]+/, ''));
      return /supabase\.co/.test(r.url()) ? r.abort() : r.continue();
    });
    await pg.setViewport(process.env.PHONE ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1280, height: 900 });
    await pg.goto('http://127.0.0.1:4196/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
    await pg.evaluate(p => window._availPreview(p), payload);
    await pg.exposeFunction('__toast', m => toasts.push(m));
    await pg.evaluate((r, h, tokenUnits, pl) => {
      const _t = window.toast; window.toast = function (m, k) { window.__toast((k || '') + ' ' + m); return _t && _t.apply(this, arguments); };
      let gone = [];   // what decide_holds has released, so the next reading no longer lists it (as the server does)
      sb.rpc = async function (fn, a) {
        if (fn === 'get_hold_decisions') return { data: Object.assign({}, h, { holds: (h.holds || []).filter(x => gone.indexOf(x.id) < 0) }) };
        if (fn === 'get_availability_report') return { data: r };
        if (fn === 'get_public_availability') return { data: pl };
        if (fn === 'decide_holds') {
          const ids = (a && a.p_ids) || [];
          gone = gone.concat(ids);
          const rows = (h.holds || []).filter(x => ids.indexOf(x.id) >= 0 && tokenUnits.indexOf(x.n || x.unit_no) < 0);
          return { data: { success: true, action: a.p_action,
                           done: rows.map(x => ({ n: x.n || x.unit_no, w: x.w || x.who || null, x: null })), skipped: [] } };
        }
        return { data: null };
      };
      REP = r; REPPW = 'x'; REPP = { view: 'home', key: '' }; showRep(); window.scrollTo(0, 0);
    }, report, holds, TOKEN_UNITS, payload);
    await new Promise(r => setTimeout(r, 1200));

    const pick = await pg.evaluate((tokenUnits, last) => {
      const cards = [...document.querySelectorAll('.dc-c[data-g], [data-g]')].filter(c => /Time over/.test(c.textContent) && c.querySelector('[data-dc="rel"]'));
      const ok = cards.filter(x => !tokenUnits.some(t => x.textContent.includes(t)));
      const c = last ? ok[ok.length - 1] : ok[0];
      if (!c) return { found: false, cards: cards.length };
      c.setAttribute('data-repro', '1');
      return { found: true, cards: cards.length, text: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) };
    }, TOKEN_UNITS, !!process.env.LAST);
    console.log('1. "Time over" cards with Release:', pick.cards, pick.found ? '| using: ' + pick.text : '| none usable');
    if (!pick.found) return;

    await pg.evaluate(() => { const i = document.getElementById('dc-by'); if (i) { i.value = 'Repro'; i.dispatchEvent(new Event('input', { bubbles: true })); } });
    // the person has scrolled down to this card, as they would
    await pg.evaluate(() => document.querySelector('[data-repro]').scrollIntoView({ block: 'center' }));
    await pg.click('[data-repro] [data-dc="rel"]');
    await new Promise(r => setTimeout(r, 300));
    const goSel = await pg.evaluate(() => { const b = document.querySelector('[data-g] [data-dc="rel-go"]'); return b ? b.textContent.trim() : null; });
    console.log('2. confirm button:', goSel);
    await pg.click('[data-g] [data-dc="rel-go"]');
    await new Promise(r => setTimeout(r, 3000));
    const after = await pg.evaluate(() => ({
      done: (window.DEC && DEC.done || []).map(x => ({ who: x.who, hasCard: !!x.card, say: (x.say || '').replace(/<[^>]+>/g, '') })),
      shareBtn: !!document.querySelector('[data-dc="card"]') }));
    console.log('3. after Release:', JSON.stringify(after));
    // where is the note with "Share picture", against what is on screen?
    const where = await pg.evaluate(() => {
      const n = document.querySelector('.dc-ok'), r = n && n.getBoundingClientRect();
      return n ? { noteTop: Math.round(r.top), noteBottom: Math.round(r.bottom), screen: innerHeight, scrollY: Math.round(scrollY),
                   onScreen: r.bottom > 0 && r.top < innerHeight,
                   pictureOpenedByItself: !!document.querySelector('#rd-share img.sh-img') } : null;
    });
    console.log('   note position:', JSON.stringify(where));
    await pg.screenshot({ path: path.join(OUT, 'repro-after-release-' + (process.env.PHONE ? 'phone' : 'desktop') + '.png') });
    await pg.evaluate(() => window.scrollTo(0, 0)); await pg.screenshot({ path: path.join(OUT, 'repro-after-release-top.png') });
    if (after.shareBtn) {
      await pg.click('[data-dc="card"]');
      await new Promise(r => setTimeout(r, 2500));
    }
    const sheet = await pg.evaluate(() => {
      const sh = document.getElementById('rd-share');
      return { sheet: !!sh, picture: !!(sh && sh.querySelector('img.sh-img')), textOnly: !!(sh && sh.querySelector('pre')),
               RDShareCard: typeof window.RDShareCard, DESK_SRC: typeof DESK_SRC !== 'undefined' ? DESK_SRC : null };
    });
    console.log('4. after Share picture:', JSON.stringify(sheet));
    await pg.screenshot({ path: path.join(OUT, 'repro-release-picture.png') });
  } finally {
    await br.close(); srv.close();
    console.log('desk script requested:', JSON.stringify(scripts));
    console.log('toasts:', JSON.stringify(toasts));
    console.log('page errors:', JSON.stringify(errs.filter(e => !/net::ERR_FAILED|Failed to fetch/.test(e))));
  }
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

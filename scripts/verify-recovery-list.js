#!/usr/bin/env node
/* VERIFY: the Recovery List on the reservation link, end to end in Chrome.

   Reads Awami's real public payload and the real recovery list inside a
   transaction that is ROLLED BACK (migration 20261113a + a throw-away link),
   serves the page locally, answers every Supabase call from what was
   captured, then: the button shows, a wrong password is refused, Awami123
   opens the list, the RMS files are highlighted, Download PDF gives a real
   PDF, and its first page is drawn to a PNG to look at.

   node scripts/verify-recovery-list.js [outdir]                               */
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer-core');
const { q } = require('./_sbq');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'marketing_shots', 'recovery'));
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', PR = '59ded55b-9bc2-45b2-a372-49fc31807fa9';
const MIG = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261113a_recovery_list.sql'), 'utf8');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cap = await q(`
    BEGIN;
    ${MIG}
    INSERT INTO public.availability_links (token_hash, company_id, project_id, label)
    VALUES (public._availability_token_hash('verify_rcl_probe'), '${CO}', '${PR}', 'RECOVERY VERIFY - rolled back');
    CREATE TEMP TABLE cap ON COMMIT DROP AS
      SELECT public.get_public_availability('verify_rcl_probe') AS p,
             public.get_recovery_list('verify_rcl_probe', 'Awami123') AS r;
    SELECT p::text AS p, r::text AS r FROM cap;
    ROLLBACK;`);
  const payload = JSON.parse(cap[0].p), list = JSON.parse(cap[0].r);
  const live = await q(`select count(*) n from pg_proc where proname = 'get_recovery_list'`);
  console.log('captured rows:', list.rows.length, '| function live after rollback:', live[0].n);

  const srv = http.createServer((rq, rs) => {
    const p = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rs.writeHead(404); return rs.end(); }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(rs);
  }).listen(4197);

  const br = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const errs = [], res = {};
  try {
    for (const phone of [false, true]) {
      const pg = await br.newPage();
      pg.on('pageerror', e => errs.push(e.message));
      await pg.setRequestInterception(true);
      pg.on('request', r => /supabase\.co/.test(r.url()) ? r.abort() : r.continue());
      await pg.setViewport(phone ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1280, height: 900 });
      const cdp = await pg.target().createCDPSession();
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
      await pg.goto('http://127.0.0.1:4197/availability.html?preview=1&t=verify_rcl_probe', { waitUntil: 'domcontentloaded' });
      await pg.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
      await pg.evaluate(p => window._availPreview(p), payload);
      const hiddenBefore = await pg.$eval('#rcl-open', b => b.hidden);
      await pg.evaluate((l, pl) => {
        sb.rpc = async function (fn, a) {
          if (fn === 'get_recovery_list') {
            if (!a.p_password) return { data: { success: false, error: 'no', enabled: true } };
            return { data: a.p_password === 'Awami123' ? l : { success: false, error: 'no', enabled: true } };
          }
          if (fn === 'get_public_availability') return { data: pl };
          return { data: null };
        };
        return rclProbe();
      }, list, payload);
      const tag = phone ? 'phone' : 'desktop';
      const r = res[tag] = { hiddenBefore, shownAfterProbe: !(await pg.$eval('#rcl-open', b => b.hidden)) };
      await pg.screenshot({ path: path.join(OUT, tag + '-1-header.png'), clip: { x: 0, y: 0, width: phone ? 390 : 1280, height: 160 } });
      await pg.click('#rcl-open');
      await pg.type('#rcl-pw', 'wrong'); await pg.click('#rcl-go');
      await pg.waitForFunction(() => !document.getElementById('rcl-err').hidden);
      r.wrongMsg = await pg.$eval('#rcl-err', e => e.textContent);
      r.listAfterWrong = await pg.$$eval('#rcl-body tr', t => t.length);
      await pg.screenshot({ path: path.join(OUT, tag + '-2-gate.png') });
      await pg.type('#rcl-pw', 'Awami123'); await pg.keyboard.press('Enter');
      await pg.waitForSelector('#rcl-body table');
      Object.assign(r, await pg.evaluate(() => ({
        rows: document.querySelectorAll('#rcl-body tbody tr:not(.tot)').length,
        highlighted: document.querySelectorAll('#rcl-body tr.rms').length,
        highlightedUnits: [...document.querySelectorAll('#rcl-body tr.rms td:nth-child(2)')].map(t => t.textContent).join(','),
        summary: document.querySelector('.rcl-sum').textContent,
        total: document.querySelector('#rcl-body tr.tot').textContent.replace(/\s+/g, ' '),
        pageScrollX: document.documentElement.scrollWidth > window.innerWidth
      })));
      await pg.screenshot({ path: path.join(OUT, tag + '-3-list.png') });
      if (!phone) {
        const before = new Set(fs.readdirSync(OUT));
        await pg.click('#rcl-pdf');
        let file = null;
        for (let i = 0; i < 60 && !file; i++) {
          await new Promise(z => setTimeout(z, 250));
          file = fs.readdirSync(OUT).find(f => !before.has(f) && /\.pdf$/.test(f));
        }
        r.pdf = file; r.pdfBytes = file ? fs.statSync(path.join(OUT, file)).size : 0;
        if (file) {
          // draw page 1 with pdf.js to look at it
          const b64 = fs.readFileSync(path.join(OUT, file)).toString('base64');
          const v = await br.newPage();
          await v.setViewport({ width: 1263, height: 893 });
          await v.setContent('<html><body style="margin:0"><canvas id="c"></canvas></body></html>');
          await v.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js' });
          r.pdfPages = await v.evaluate(async b64 => {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            const d = await pdfjsLib.getDocument({ data: atob(b64) }).promise;
            const p = await d.getPage(1), vp = p.getViewport({ scale: 1.5 }), c = document.getElementById('c');
            c.width = vp.width; c.height = vp.height;
            await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            let txt = '';
            for (let i = 1; i <= d.numPages; i++) txt += (await (await d.getPage(i)).getTextContent()).items.map(x => x.str).join(' ') + ' ';
            window.__txt = txt;
            return d.numPages;
          }, b64);
          const txt = await v.evaluate(() => window.__txt);
          r.pdfHasAllUnits = list.rows.every(x => txt.includes(x.unit));
          r.pdfRmsLabels = (txt.match(/RMS file/g) || []).length;
          await v.screenshot({ path: path.join(OUT, 'pdf-page1.png') });
          await v.close();
        }
      }
      await pg.close();
    }
  } finally { await br.close(); srv.close(); }
  console.log(JSON.stringify(res, null, 1));
  console.log('page errors:', JSON.stringify(errs.slice(0, 5)));
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

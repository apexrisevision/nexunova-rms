/* ═══════════════════════════════════════════════════════════════════════════
   THE STATUS FORM, IN A REAL BROWSER.

   The contract behind custom statuses is covered by shot:daybook, which books
   with a temporary tag and a permanent one inside a rolled-back transaction on
   the live tenant. None of that touches the screen a person actually uses to
   create the status in the first place — Setup → Categories → Statuses — and a
   typo in that modal breaks the only way in.

   So this boots the admin shell the way smoke-pages does, opens the status
   modal, and asks the three questions the change is about:

     · are the three natures offered at all
     · does choosing "temporary" reveal the days box, and permanent hide it
     · does marking the status Sellable take the whole question away, since the
       server refuses that combination

   It also writes a screenshot, because "the picker is there" and "the picker
   is legible" are different claims and only one of them can be asserted.
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https'), puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4198;
const OUT = path.join(ROOT, 'marketing_shots', 'status-nature');
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'];
const CHROME = BROWSERS.find(p => fs.existsSync(p));
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
               '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.ico':'image/x-icon' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The management API, the same way every other suite here talks to the live
   database. Used only to put two statuses on ZZTEST and take them away. */
function sql(q) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const body = JSON.stringify({ query: q });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com',
      path: '/v1/projects/itqxljtfbrppntgyfush/database/query', method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
                 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c);
             x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d))); });
    r.on('error', rej); r.write(body); r.end();
  });
}

function serve() {
  return new Promise(res => {
    /* Anything thrown in here kills the server and every later navigation
       lands on chrome-error:// with no clue why, so nothing is allowed out. */
    const s = http.createServer((q, r) => {
      try {
        const p = decodeURIComponent(q.url.split('?')[0]);
        const f = path.join(ROOT, p === '/' ? 'login.html' : p);
        if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
        r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        const st = fs.createReadStream(f); st.on('error', () => r.end()); st.pipe(r);
      } catch (e) { try { r.writeHead(500); r.end(); } catch (e2) {} }
    });
    s.on('error', e => console.log('     server: ' + e.message));
    s.listen(PORT, '127.0.0.1', () => res(s));
  });
}

let PASS = 0, FAIL = 0;
const ok  = m => { PASS++; console.log('  \u2705 ' + m); };
const bad = m => { FAIL++; console.log('  \u274C ' + m); };

(async () => {
  if (!CHROME) { console.log('No Chrome found'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 1100, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e)));

  try {
    await page.goto('http://127.0.0.1:' + PORT + '/login.html', { waitUntil: 'networkidle2' });

    /* The same stubbed shell smoke-pages uses. Nothing here reaches a database:
       this is a question about a form, not about data. */
    await page.evaluate(() => {
      S = { cid: 'co1', userId: 'u1', role: 'admin', name: 'Tester', coName: 'ZZTEST' };
      supabase.rpc = async () => ({ data: { success: true }, error: null });
      window._projectsCache = [{ id: 'p1', name: 'Awami Market', projectName: 'Awami Market' }];
      window._unitsCache = [];
      window._typesCache = [];
      window._floorsCache = [];
      window._saleTypesCache = [];
      /* One of each nature, so the row copy has something to describe. */
      window._statusesCache = [
        { id: 'st1', projectId: 'p1', statusCode: 'AVAILABLE', name: 'Available',
          isAvailable: true,  nature: null,        holdDays: null, sortOrder: 1, isActive: true },
        { id: 'st2', projectId: 'p1', statusCode: 'HOLD', name: 'On Hold',
          isAvailable: false, nature: 'temporary', holdDays: 3,    sortOrder: 2, isActive: true },
        { id: 'st3', projectId: 'p1', statusCode: 'LANDOWNER', name: 'Landowner',
          isAvailable: false, nature: 'permanent', holdDays: null, sortOrder: 3, isActive: true },
        { id: 'st4', projectId: 'p1', statusCode: 'SOLD', name: 'Sold',
          isAvailable: false, nature: null,        holdDays: null, sortOrder: 4, isActive: true }
      ];
      window.hasProjectAccess = () => true;
      window.activeProjectId = () => 'p1';
      document.getElementById('s-login').classList.remove('on');
      document.getElementById('s-app').classList.add('on');
    });

    await page.evaluate(() => { nav('categories'); });
    await sleep(700);
    await page.evaluate(() => { _catSetProject('p1'); _catShowTab('statuses'); });
    await sleep(500);

    console.log('\n\u2500\u2500 The list says what kind each status is');
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#cat-tab-body .cat-row')]
        .map(r => r.innerText.replace(/\s+/g, ' ').trim()));
    const line = n => rows.find(r => r.indexOf(n) >= 0) || '';

    /Bookable/.test(line('Available'))
      ? ok('Available reads "Bookable"')
      : bad('Available: ' + line('Available'));
    /holds for 3 days/.test(line('On Hold'))
      ? ok('On Hold says it holds for 3 days, which is its own default')
      : bad('On Hold: ' + line('On Hold'));
    /permanent hold/.test(line('Landowner'))
      ? ok('Landowner is marked a permanent hold')
      : bad('Landowner: ' + line('Landowner'));
    /set by the sales module/.test(line('Sold'))
      ? ok('and Sold says where it comes from, rather than looking like a tag nobody chose')
      : bad('Sold: ' + line('Sold'));
    await page.screenshot({ path: path.join(OUT, 'a-statuses-list.png') });

    console.log('\n\u2500\u2500 The form offers a nature, and only asks for days when it needs one');
    await page.evaluate(() => openStatusModal());
    await sleep(400);
    const opts = await page.evaluate(() =>
      [...document.querySelectorAll('input[name="st-nature"]')].map(i => i.value));
    JSON.stringify(opts) === JSON.stringify(['none', 'temporary', 'permanent'])
      ? ok('three natures offered: ' + opts.join(', '))
      : bad('the nature picker offers ' + JSON.stringify(opts));

    const pick = async v => page.evaluate(val => {
      const el = document.querySelector('input[name="st-nature"][value="' + val + '"]');
      el.checked = true; _stNatSync(); _stPrev();
      const row = document.getElementById('st-days-row');
      return { days: !!row && row.style.display !== 'none',
               preview: (document.getElementById('st-prev') || {}).innerText || '' };
    }, v);

    const t = await pick('temporary');
    (t.days && /Holds for/.test(t.preview))
      ? ok('temporary reveals the days box and the preview says what it will do')
      : bad('temporary: ' + JSON.stringify(t));

    const p = await pick('permanent');
    (!p.days && /permanently/.test(p.preview))
      ? ok('permanent asks for no days at all \u2014 a number there would read as a promise')
      : bad('permanent: ' + JSON.stringify(p));

    const n = await pick('none');
    (!n.days && /sales module/.test(n.preview))
      ? ok('and "not applied at the desk" says who does set it')
      : bad('none: ' + JSON.stringify(n));

    await page.evaluate(() => {
      document.querySelector('input[name="st-nature"][value="temporary"]').checked = true;
      _stNatSync(); _stPrev();
    });
    await sleep(150);
    await page.screenshot({ path: path.join(OUT, 'b-status-modal.png') });

    console.log('\n\u2500\u2500 Sellable and "held at the desk" cannot both be true');
    const sell = await page.evaluate(() => {
      document.getElementById('st-avail').checked = true;
      _stNatSync(); _stPrev();
      const f = document.getElementById('st-nat-field');
      return { hidden: !!f && f.style.display === 'none',
               nature: _stNature(),
               preview: (document.getElementById('st-prev') || {}).innerText || '' };
    });
    (sell.hidden && sell.nature === 'none')
      ? ok('ticking Sellable takes the question away and clears what was chosen')
      : bad('a sellable status can still be given a nature in the form: ' + JSON.stringify(sell));


    /* ══ AND NOW THE OTHER END: THE DESK ══════════════════════════════════
       Defining a status is half of it. The half that matters is what the desk
       does when one is armed — a temporary tag brings its own default number
       of days across, and a permanent one has to take the duration control
       off the screen entirely, because a number sitting beside a hold that
       never expires is a promise the system will not keep.

       Real statuses on a real ZZTEST project, a real director session, and
       the portal's own get_reserve_desk answering — nothing stubbed. Both
       statuses are deleted again at the end. ═════════════════════════════ */
    console.log('\n\u2500\u2500 The desk, with a tag it has never seen before');
    const ZP = '708605fc-33e9-4538-8b7c-0513b2d2e8b9';          // ZZ Map Tower
    const ZC = 'a2915ce7-c01c-463b-ba50-b144b2240337';
    const ZD = '3e5ec7c8-89c8-435f-8f52-141b87c4b5b0';          // its director
    const ZTOK = 'natui_' + Math.random().toString(36).slice(2, 10);
    let seeded = false;
    try {
      await sql(`
        DELETE FROM public.category_unit_statuses
         WHERE project_id='${ZP}' AND status_code IN ('ZZVERBAL','ZZLANDOWNER');
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('${ZC}','${ZD}','${ZP}','${ZTOK}', now() + interval '10 minutes');
        INSERT INTO public.category_unit_statuses
          (company_id, project_id, status_code, status_name, color_hex, sort_order,
           is_active, is_available, nature, hold_days)
        VALUES
          ('${ZC}','${ZP}','ZZVERBAL','Verbally Hold','#f59e0b',90,true,false,'temporary',2),
          ('${ZC}','${ZP}','ZZLANDOWNER','Landowner','#8b5cf6',91,true,false,'permanent',NULL);`);
      seeded = true;

      const desk = await browser.newPage();
      const derrs = [];
      desk.on('pageerror', e => derrs.push(String(e.message || e)));
      desk.on('requestfailed', r2 => console.log('     FAILED ' + r2.url() + ' :: ' + (r2.failure()||{}).errorText));
      await desk.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
      /* SEEDED BEFORE THE FIRST BYTE OF THE PAGE RUNS. Loading the portal
         once to write localStorage and then loading it again does not work
         here: with no session the shell bounces to /hub, this little server
         has no such route, and the navigation ends on chrome-error:// where
         localStorage cannot even be read. */
      await desk.evaluateOnNewDocument(t => {
        try {
          localStorage.setItem('rms.sales.token', t);
          localStorage.setItem('rms.sales.active', String(Date.now()));
          sessionStorage.setItem('nx.hub.bounce', '1');
        } catch (e) {}
      }, ZTOK);
      await desk.goto('http://127.0.0.1:' + PORT + '/sales-portal.html?tab=desk',
                      { waitUntil: 'domcontentloaded' });
      await desk.waitForFunction(() => !!document.querySelector('#rd-tags .rd-chip'),
                                 { timeout: 45000 }).catch(() => {});
      await sleep(600);

      const chips = await desk.evaluate(() =>
        [...document.querySelectorAll('#rd-tags .rd-chip')].map(b => ({
          name: b.textContent.trim(),
          nature: b.getAttribute('data-nature'),
          days: b.getAttribute('data-days'),
          perm: b.classList.contains('perm')
        })));
      const verbal = chips.find(c => /Verbally Hold/.test(c.name));
      const land   = chips.find(c => /Landowner/.test(c.name));

      (verbal && verbal.nature === 'temporary' && verbal.days === '2')
        ? ok('a status invented in Settings shows up on the desk as its own chip')
        : bad('the custom temporary tag is not on the desk: ' + JSON.stringify(chips));
      (land && land.nature === 'permanent' && land.perm && /\u221e/.test(land.name))
        ? ok('and the permanent one is drawn differently, marked \u221e')
        : bad('the permanent tag is not marked as one: ' + JSON.stringify(chips));

      const armed = t => desk.evaluate(nm => {
        const b = [...document.querySelectorAll('#rd-tags .rd-chip')]
          .find(x => x.textContent.indexOf(nm) >= 0);
        b.click();
        const days = document.getElementById('rd-days');
        const note = document.getElementById('rd-perm-note');
        const lb   = document.getElementById('rd-days-lb');
        return { daysShown: !!days && days.style.display !== 'none',
                 noteShown: !!note && note.style.display !== 'none',
                 labelShown: !!lb && lb.style.display !== 'none',
                 go: (document.getElementById('rd-go') || {}).textContent || '',
                 /* The effective duration, not just a lit chip: the chips are
                    1/3/7/15, so a status whose default is 2 lands in the box
                    beside them. Both are the same answer. */
                 chosen: [...document.querySelectorAll('#rd-days .rd-chip.on')]
                           .map(x => x.textContent.trim()).join(','),
                 typed: (document.getElementById('rd-dcust') || {}).value || '' };
      }, t);

      const v = await armed('Verbally Hold');
      (v.daysShown && !v.noteShown)
        ? ok('arming it asks how long, the way every timed tag does')
        : bad('the temporary tag hid the duration: ' + JSON.stringify(v));
      (v.chosen === '2d' || v.typed === '2')
        ? ok('and it arrives with its own 2 days already filled in \u2014 no second tap')
        : bad('the tag did not bring its default duration: ' + JSON.stringify(v));

      const l = await armed('Landowner');
      (!l.daysShown && !l.labelShown && l.noteShown)
        ? ok('arming the permanent one takes the duration away and says why')
        : bad('the permanent tag still asks for a number of days: ' + JSON.stringify(l));
      /Landowner/.test(l.go)
        ? ok('and the button says what it is about to do: “' + l.go.trim() + '”')
        : bad('the button still says ' + JSON.stringify(l.go));
      await desk.screenshot({ path: path.join(OUT, 'c-desk-permanent.png') });

      const dclean = derrs.filter(e => !/Failed to load|404|net::ERR|401/.test(e));
      dclean.length === 0 ? ok('no errors on the desk')
                          : bad('desk errors: ' + dclean.slice(0, 2).join(' | '));
      await desk.close();
    } catch (e) {
      bad('desk pass: ' + (e.message || e));
    } finally {
      if (seeded) {
        await sql(`
          DELETE FROM public.category_unit_statuses
           WHERE project_id='${ZP}' AND status_code IN ('ZZVERBAL','ZZLANDOWNER');
          DELETE FROM public.sales_sessions WHERE session_token='${ZTOK}';`);
        const left = Number((await sql(`SELECT count(*)::int n FROM public.category_unit_statuses
                                         WHERE status_code IN ('ZZVERBAL','ZZLANDOWNER');`))[0].n);
        left === 0 ? ok('the two invented statuses were removed again')
                   : bad(left + ' invented status(es) left behind on ZZTEST');
      }
    }
    const clean = errs.filter(e => !/Failed to load|404|net::ERR|401/.test(e));
    clean.length === 0 ? ok('no page errors') : bad('page errors: ' + clean.slice(0, 2).join(' | '));
  } catch (e) {
    bad('DRIVER: ' + (e.message || e));
  }

  await browser.close(); srv.close();
  console.log('\n' + (FAIL === 0
    ? '\u2705 ALL CHECKS OK  (' + PASS + ')'
    : '\u274C ' + FAIL + ' FAILED of ' + (PASS + FAIL)) + '  \u2192 ' + OUT);
  process.exit(FAIL === 0 ? 0 : 1);
})();

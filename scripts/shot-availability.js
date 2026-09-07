/**
 * PUBLIC AVAILABILITY — screenshot it, and assert the things that cannot be
 * seen in a screenshot.
 *
 * TWO SOURCES, ON PURPOSE.
 *
 *   · The CONTRACT is verified end to end on ZZTEST, where a link is created
 *     and revoked through the real director path. That proves the token, the
 *     permissions and the payload shape against the real function over the real
 *     wire.
 *   · The SCALE screens are photographed with Awami's real payload, captured
 *     through the same function inside a transaction that is rolled back. No
 *     Awami link is created — Rashid creates that one himself and sees the token
 *     once. Nothing this script does reaches availability_links.
 *
 * Seven screenshots and the assertions he named: the DOM never holds more than
 * one floor's units, price appears nowhere, and an unavailable unit produces no
 * sheet.
 *
 *   node scripts/shot-availability.js
 */
const fs = require('fs'), path = require('path'), http = require('http'),
      https = require('https'), puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4196, BASE = 'http://127.0.0.1:' + PORT;
const OUT  = path.join(ROOT, 'marketing_shots', 'availability');
const AWAMI_CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const AWAMI_PR = '59ded55b-9bc2-45b2-a372-49fc31807fa9';
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

let FAILED = false;
const ok  = m => console.log('  \u2705 ' + m);
const bad = m => { console.log('  \u274C ' + m); FAILED = true; };
const step = t => console.log('\n\u2500\u2500 ' + t);

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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
               '.json': 'application/json', '.woff2': 'font/woff2' };
function serve() {
  return new Promise(r => {
    const s = http.createServer((q, res) => {
      let p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      // mirror the vercel rewrite: /a/<token> serves the same file
      if (/^\/a\/[A-Za-z0-9_-]{8,}$/.test(q.url.split('?')[0])) p = path.join(ROOT, 'availability.html');
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        res.writeHead(404); return res.end('nf');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter(n => /\.png$/.test(n)).forEach(n => fs.unlinkSync(path.join(OUT, n)));

  /* ── 1. THE PAYLOAD, from the real function, without creating a link ───── */
  step('The payload — real function, real Awami, rolled back');
  const cap = await sql(`
    BEGIN;
    INSERT INTO public.availability_links (token_hash, company_id, project_id, label)
    VALUES (public._availability_token_hash('shot_avail_probe'),
            '${AWAMI_CO}','${AWAMI_PR}','SHOT PROBE — rolled back');
    CREATE TEMP TABLE cap ON COMMIT DROP AS
      SELECT public.get_public_availability('shot_avail_probe') AS d;
    SELECT d::text AS payload, length(d::text) AS bytes FROM cap;
    ROLLBACK;`);
  const payload = JSON.parse(cap[0].payload);
  const bytes = Number(cap[0].bytes);
  const units = (payload.floors || []).reduce((n, f) => n + f.units.length, 0);
  console.log('  payload ' + bytes.toLocaleString() + ' bytes  ·  ' +
              payload.floors.length + ' floors  ·  ' + units.toLocaleString() + ' units');

  /* Price must not be on the wire. Asserted on the RAW TEXT, not on parsed
     keys — a field renamed rather than removed would still pass a key check. */
  !/"p"\s*:|price|base_price/i.test(cap[0].payload)
    ? ok('no price on the wire, by raw text search of the whole payload')
    : bad('the payload still carries a price');
  const keys = new Set();
  payload.floors.forEach(f => f.units.forEach(u => Object.keys(u).forEach(k => keys.add(k))));
  JSON.stringify([...keys].sort()) === JSON.stringify(['a', 'n', 's'])
    ? ok('a unit carries exactly: ' + [...keys].sort().join(', '))
    : bad('unexpected unit keys: ' + [...keys].sort().join(', '));
  const states = new Set();
  payload.floors.forEach(f => f.units.forEach(u => states.add(u.s)));
  [...states].every(s => s === 'available' || s === 'not_available')
    ? ok('two states only: ' + [...states].join(', '))
    : bad('a third state reached the wire: ' + [...states].join(', '));
  payload.area_unit
    ? ok('area_unit is sent once for the project: ' + payload.area_unit)
    : bad('area_unit missing from the payload');
  /* ORDER. The floor grid and the search results are drawn in payload order,
     so this is the only place it can be checked. */
  {
    const big2 = payload.floors.reduce((a, b) => (b.units.length > a.units.length ? b : a));
    const want = await sql(`
      SELECT u.unit_no FROM public.units u
       WHERE u.project_id = '${AWAMI_PR}'
         AND COALESCE(NULLIF(u.floor_label,''),'\u2014') = $q$${big2.floor_label}$q$
         AND public._map_unit_state(u.id) <> 'retired'
       ORDER BY COALESCE(NULLIF(regexp_replace(u.unit_no,'[^0-9]','','g'),'')::bigint, 0), u.unit_no;`);
    const got = big2.units.map(u => u.n);
    JSON.stringify(got) === JSON.stringify(want.map(r => r.unit_no))
      ? ok('units come unit-wise, not alphabetically: ' + got.slice(0, 5).join(', ') + ' \u2026')
      : bad('order is wrong on ' + big2.floor_label + '. got ' +
            JSON.stringify(got.slice(0, 6)) + ' want ' + JSON.stringify(want.slice(0, 6).map(r => r.unit_no)));
    /* The specific thing that was wrong: a three-digit number wedged between
       two two-digit ones. */
    const i10 = got.indexOf(got.find(n => /(^|\D)10$/.test(n)));
    const i100 = got.findIndex(n => /(^|\D)100$/.test(n));
    (i10 < 0 || i100 < 0 || i100 > i10 + 1)
      ? ok('no three-digit unit is wedged in among the two-digit ones')
      : bad('unit 100 still follows unit 10 immediately');
  }

  bytes < 150 * 1024
    ? ok('payload is ' + Math.round(bytes / 1024) + ' KB, under the 150 KB ceiling')
    : bad('payload is ' + Math.round(bytes / 1024) + ' KB');

  /* ── 2. the browser ────────────────────────────────────────────────────── */
  const server = await serve();
  const exe = BROWSERS.find(p => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
    args: ['--no-sandbox', '--force-device-scale-factor=2'] });
  const errs = [];

  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errs.push(String(e.message || e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.setViewport({ width: 380, height: 780, deviceScaleFactor: 2, isMobile: true });
    await page.goto(BASE + '/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
    await page.evaluate(p => window._availPreview(p), payload);
    await sleep(350);

    /* ── a. screen one, 380px, no scrolling ─────────────────────────────── */
    step('Screen one — the whole building, no scrolling');
    const one = await page.evaluate(() => ({
      chips: [...document.querySelectorAll('#floors button')].map(b => ({
        label: b.querySelector('.fn').textContent.trim(),
        count: b.querySelector('.fc').textContent.trim(),
        h: Math.round(b.getBoundingClientRect().height),
        w: Math.round(b.getBoundingClientRect().width)
      })),
      cols: getComputedStyle(document.getElementById('floors')).gridTemplateColumns.split(' ').length,
      docH: document.documentElement.scrollHeight,
      winH: window.innerHeight,
      unitsInDom: document.querySelectorAll('#units button').length,
      total: document.getElementById('tot').textContent.trim()
    }));
    one.chips.length === payload.floors.length
      ? ok('all ' + one.chips.length + ' floor chips are on screen one')
      : bad('expected ' + payload.floors.length + ' chips, drew ' + one.chips.length);
    one.cols === 2
      ? ok('laid out in two columns')
      : bad('the floor grid has ' + one.cols + ' columns, not 2');
    one.docH <= one.winH
      ? ok('no scrolling at 380\u00d7780 \u2014 the page is ' + one.docH + 'px of ' + one.winH + 'px')
      : bad('screen one scrolls: ' + one.docH + 'px of ' + one.winH + 'px available');
    one.unitsInDom === 0
      ? ok('not one unit is in the document on screen one')
      : bad(one.unitsInDom + ' units are mounted on screen one');
    console.log('     chip ' + one.chips[0].w + '\u00d7' + one.chips[0].h + 'px  ·  ' +
                one.total);
    await page.screenshot({ path: path.join(OUT, 'a-screen-one-380.png') });

    /* ── b. search across floors ────────────────────────────────────────── */
    step('Search — across every floor, no server call');
    let calls = 0;
    page.on('request', r => { if (/get_public_availability/.test(r.url())) calls++; });
    const search = await page.evaluate(() => {
      const q = document.getElementById('q');
      q.value = 'LG-1'; q.dispatchEvent(new Event('input', { bubbles: true }));
      const rows = [...document.querySelectorAll('#res .res-r')].map(b => ({
        unit: b.querySelector('.n').textContent.trim(),
        floor: b.querySelector('.f').textContent.trim(),
        off: b.disabled
      }));
      return { rows, more: (document.querySelector('.res-more') || {}).textContent || '' };
    });
    search.rows.length > 0
      ? ok('typing LG-1 finds ' + search.rows.length + ' unit(s)' +
           (search.more ? ' and says "' + search.more.trim() + '"' : ''))
      : bad('search found nothing for LG-1');
    search.rows.every(r => /^LG/i.test(r.unit.replace(/[^A-Za-z0-9]/g, '')))
      ? ok('every result starts with what was typed')
      : bad('search returned something that does not match: ' + JSON.stringify(search.rows.slice(0, 3)));
    await sleep(200);
    calls === 0
      ? ok('searching made no server call')
      : bad('searching fired ' + calls + ' request(s)');
    await page.screenshot({ path: path.join(OUT, 'b-search-LG-1.png') });

    /* ── c. the biggest floor, and only that floor ──────────────────────── */
    step('One floor at a time');
    const big = payload.floors.reduce((a, b) => (b.units.length > a.units.length ? b : a));
    const bigIdx = payload.floors.indexOf(big);
    const floorState = await page.evaluate(i => {
      document.getElementById('q').value = '';
      document.getElementById('q').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#floors button[data-f="' + i + '"]').click();
      const g = document.getElementById('units');
      return {
        name: document.getElementById('fname').textContent.trim(),
        count: document.getElementById('fcount').textContent.trim(),
        mounted: g.querySelectorAll('button').length,
        perRow: getComputedStyle(g).gridTemplateColumns.split(' ').length,
        homeHidden: document.getElementById('home').hidden,
        offShown: g.querySelectorAll('button.off').length
      };
    }, bigIdx);
    const bigAvail = big.units.filter(u => u.s === 'available').length;
    console.log('     ' + big.floor_label + ' \u2014 ' + big.units.length + ' units, ' +
                bigAvail + ' available');
    floorState.mounted === bigAvail
      ? ok('only the ' + bigAvail + ' available units of that floor are mounted')
      : bad('mounted ' + floorState.mounted + ', expected ' + bigAvail);
    floorState.offShown === 0
      ? ok('unavailable units are not drawn by default')
      : bad(floorState.offShown + ' unavailable units drawn with the toggle off');
    floorState.perRow >= 4
      ? ok('a grid of ' + floorState.perRow + ' per row, not a list of rows')
      : bad('only ' + floorState.perRow + ' per row');
    floorState.homeHidden
      ? ok('screen one is put away while a floor is open')
      : bad('both screens are showing at once');
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(120);
    await page.screenshot({ path: path.join(OUT, 'c-floor-largest.png') });

    /* THE HARD RULE. Walk every floor and require that opening one leaves the
       previous one with nothing in the document. */
    step('The DOM never holds more than one floor');
    const walk = await page.evaluate(async n => {
      const seen = [];
      for (let i = 0; i < n; i++) {
        document.getElementById('back').click();
        document.querySelector('#floors button[data-f="' + i + '"]').click();
        seen.push(document.querySelectorAll('#units button').length);
      }
      document.getElementById('back').click();
      return { seen, afterBack: document.querySelectorAll('#units button').length };
    }, payload.floors.length);
    const expected = payload.floors.map(f => f.units.filter(u => u.s === 'available').length);
    JSON.stringify(walk.seen) === JSON.stringify(expected)
      ? ok('each floor mounts exactly its own units: ' + walk.seen.join(', '))
      : bad('mounted ' + JSON.stringify(walk.seen) + ', expected ' + JSON.stringify(expected));
    walk.afterBack === 0
      ? ok('going back unmounts them \u2014 zero units in the document')
      : bad(walk.afterBack + ' units left mounted after going back');

    /* ── d. the request sheet and its message ───────────────────────────── */
    step('The request sheet');
    await page.evaluate(() => {
      try { localStorage.setItem('avail.name', 'Fawad khan'); } catch (e) {}
    });
    const sheet = await page.evaluate(i => {
      NAME = 'Fawad khan';
      document.querySelector('#floors button[data-f="' + i + '"]').click();
      document.querySelector('#units button:not(.off)').click();
      return {
        open: document.getElementById('sheet').classList.contains('on'),
        unit: document.getElementById('sh-n').textContent.trim(),
        label: document.getElementById('go').textContent.trim(),
        note: document.querySelector('.go-n').textContent.trim(),
        durs: [...document.querySelectorAll('#dur button')].map(b => b.textContent.trim()),
        preset: (document.querySelector('#dur button.on') || {}).textContent,
        acts: [...document.querySelectorAll('.acts button')].map(b => b.textContent.trim()),
        msg: message()
      };
    }, 0);
    sheet.open ? ok('the sheet opens on an available unit') : bad('no sheet');
    sheet.label === 'Request Reservation'
      ? ok('the button says "Request Reservation"')
      : bad('the button says "' + sheet.label + '"');
    /reserve now/i.test(sheet.label) ? bad('the button implies it reserves') : ok('and never "Reserve Now"');
    /only held once you receive a confirmation/i.test(sheet.note)
      ? ok('and says the unit is only held once confirmed')
      : bad('the note under the button is wrong: ' + sheet.note);
    JSON.stringify(sheet.durs) === JSON.stringify(['1 day', '3 days', '7 days'])
      ? ok('durations are 1 / 3 / 7 and nothing longer')
      : bad('durations are ' + JSON.stringify(sheet.durs));
    /7/.test(sheet.preset || '') ? ok('7 days preselected') : bad('preselected ' + sheet.preset);
    JSON.stringify(sheet.acts) === JSON.stringify(['WhatsApp', 'Copy'])
      ? ok('WhatsApp and Copy, side by side and the same size')
      : bad('actions are ' + JSON.stringify(sheet.acts));
    await sleep(400);            // let it finish sliding before measuring or shooting
    const fit = await page.evaluate(() => {
      const r = document.getElementById('sheet').getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom),
               h: Math.round(r.height), win: window.innerHeight };
    });
    (fit.top >= 0 && fit.bottom <= fit.win + 1)
      ? ok('the whole sheet fits the screen \u2014 ' + fit.h + 'px of ' + fit.win + 'px, nothing below the fold')
      : bad('part of the sheet is off-screen: ' + JSON.stringify(fit));

    console.log('\n     ' + sheet.msg.split('\n').join('\n     ') + '\n');
    const M = sheet.msg;
    /^\s*\S.*— Reservation Request/m.test(M) && /^Ref: [A-Z]+-REQ-[A-Z0-9]{6}$/m.test(M) &&
    /^Unit: \S+$/m.test(M) && /^Floor: /m.test(M) && /^Size: /m.test(M) &&
    /^Duration: 7 days$/m.test(M) && /^Requested by: Fawad khan$/m.test(M) &&
    /Please confirm\.$/.test(M)
      ? ok('the message is exactly the shape asked for, unit on its own line')
      : bad('the message shape is wrong');
    !/PKR|price|rate/i.test(M) ? ok('and carries no money') : bad('the message mentions money');
    await page.screenshot({ path: path.join(OUT, 'd-request-sheet.png') });
    fs.writeFileSync(path.join(OUT, 'd-message.txt'), M);

    /* ── the other state ───────────────────────────────────────────────────
       Everything above ran on a project where every unit is free, so the two
       checks about unavailable units could not have failed. The payload is
       real; a copy of it with one unit in three marked not_available is what
       makes them mean something. */
    const mixed = JSON.parse(JSON.stringify(payload));
    let flipped = 0;
    mixed.floors.forEach(f2 => {
      f2.units.forEach((u, i) => { if (i % 3 === 1) { u.s = 'not_available'; flipped++; } });
      f2.available = f2.units.filter(u => u.s === 'available').length;
    });
    await page.evaluate(p => window._availPreview(p), mixed);
    await sleep(250);
    console.log('     re-rendered with ' + flipped + ' of ' + units + ' units unavailable');

    /* an unavailable unit must produce nothing at all */
    step('An unavailable unit is inert');
    const inert = await page.evaluate(i => {
      closeSheet();
      document.querySelector('#floors button[data-f="' + i + '"]').click();
      document.getElementById('showall').checked = true;
      document.getElementById('showall').dispatchEvent(new Event('change', { bubbles: true }));
      const off = document.querySelector('#units button.off');
      if (!off) return { none: true };
      off.click();
      /* And through the front door too: openSheet must refuse the unit even
         when called directly, not merely be unreachable because the button
         happens to be disabled. */
      const unit = off.querySelector('.un').textContent.trim();
      openSheet(unit, i);
      return { none: false, disabled: off.disabled, unit,
               sheetOpen: document.getElementById('sheet').classList.contains('on'),
               label: off.textContent.replace(/\s+/g, ' ').trim() };
    }, bigIdx);
    inert.none
      ? bad('the mixed payload produced no unavailable unit \u2014 this check is inert')
      : ok('there are unavailable units to click, so this check can fail');
    (!inert.none && !inert.sheetOpen && inert.disabled)
      ? ok('clicking ' + inert.unit + ' opens no sheet, and openSheet refuses it when called directly')
      : bad('an unavailable unit produced a sheet: ' + JSON.stringify(inert));
    (!inert.none && /Not Available/.test(inert.label) &&
     !/reserved|sold|hold|booked/i.test(inert.label))
      ? ok('and it reads "Not Available" \u2014 never Reserved, never Sold')
      : bad('an unavailable unit is labelled "' + inert.label + '"');

    /* ── e. the toggle ──────────────────────────────────────────────────── */
    step('The unavailable toggle');
    const tog = await page.evaluate(i => {
      document.getElementById('back').click();
      document.querySelector('#floors button[data-f="' + i + '"]').click();
      const before = document.querySelectorAll('#units button').length;
      const cb = document.getElementById('showall');
      cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
      const after = document.querySelectorAll('#units button').length;
      const off = [...document.querySelectorAll('#units button.off')];
      return { before, after, offCount: off.length,
               label: off.length ? off[0].textContent.replace(/\s+/g, ' ').trim() : '' };
    }, bigIdx);
    tog.after > tog.before
      ? ok('the toggle reveals ' + (tog.after - tog.before) + ' more unit(s) (' +
           tog.before + ' \u2192 ' + tog.after + ')')
      : bad('the toggle revealed nothing: ' + tog.before + ' \u2192 ' + tog.after);
    tog.offCount > 0 && /Not Available/.test(tog.label)
      ? ok('and the ' + tog.offCount + ' revealed units read "Not Available"')
      : bad('revealed units are labelled "' + tog.label + '"');
    /* the sheet from the step before is still up; a screenshot of a toggle with a
       modal over it shows neither */
    await page.evaluate(() => { closeSheet(); window.scrollTo(0, 0); });
    await sleep(260);
    await page.screenshot({ path: path.join(OUT, 'e-unavailable-toggle.png') });

    /* ── f. a failed refetch keeps the last good data ───────────────────── */
    step('A failed refetch keeps the last good screen');
    const failState = await page.evaluate(async () => {
      document.getElementById('back').click();
      const chipsBefore = document.querySelectorAll('#floors button').length;
      const totalBefore = document.getElementById('tot').textContent.trim();
      const orig = sb.rpc;
      sb.rpc = function () { return Promise.reject(new Error('offline')); };
      await load(false);
      sb.rpc = orig;
      return { chipsBefore, totalBefore,
               chipsAfter: document.querySelectorAll('#floors button').length,
               totalAfter: document.getElementById('tot').textContent.trim(),
               upd: document.getElementById('upd').textContent.trim(),
               stale: document.getElementById('upd').classList.contains('stale') };
    });
    (failState.chipsAfter === failState.chipsBefore && failState.totalAfter === failState.totalBefore)
      ? ok('the last good data is still on screen after a failed refetch')
      : bad('a failed refetch changed the screen');
    failState.stale && /Updated \d\d:\d\d/.test(failState.upd)
      ? ok('and the timestamp is marked stale rather than blanked or silently kept: "' + failState.upd + '"')
      : bad('the timestamp did not admit the failure: ' + JSON.stringify(failState));
    await page.screenshot({ path: path.join(OUT, 'f-stale-refetch.png') });

    /* ── the whole-DOM price sweep ──────────────────────────────────────── */
    step('Price appears nowhere');
    /* Swept while unavailable units are ON SCREEN — that is the state most
       likely to leak a word like Reserved or Sold into the page. */
    const sweep = await page.evaluate(() => {
      const t = document.body.innerText;
      return { pkr: /PKR|\u20a8|rupee/i.test(t), price: /price|rate\s*\/|\/\s*sq\s*ft/i.test(t),
               leak: /\breserved\b|\bsold\b|\bon hold\b|\bbooked\b/i.test(t) };
    });
    (!sweep.pkr && !sweep.price)
      ? ok('no currency, no price and no rate anywhere in the rendered page')
      : bad('the page shows money: ' + JSON.stringify(sweep));
    !sweep.leak
      ? ok('and never says reserved, sold, on hold or booked \u2014 only Not Available')
      : bad('the page tells the dealer WHY a unit is gone');

    step('What the page writes to the phone');
    const store = await page.evaluate(() => {
      const ls = {}, ss = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); ls[k] = localStorage.getItem(k);
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i); ss[k] = sessionStorage.getItem(k);
      }
      return { ls, ss, cookies: document.cookie };
    });
    const allowed = ['avail.name', 'avail.name.asked'];
    const extra = Object.keys(store.ls).filter(k => allowed.indexOf(k) < 0);
    extra.length === 0
      ? ok('localStorage holds only ' + Object.keys(store.ls).join(', ') + ' \u2014 the name and the asked flag')
      : bad('the page wrote something else to localStorage: ' + extra.join(', '));
    Object.keys(store.ss).length === 0
      ? ok('sessionStorage is untouched')
      : bad('sessionStorage holds ' + Object.keys(store.ss).join(', '));
    !store.cookies
      ? ok('and no cookie is set')
      : bad('a cookie was set: ' + store.cookies);
    /* The token must never be written down. A dealer forwarding their phone's
       storage is not a threat we can control, but writing the link into it is. */
    !JSON.stringify(store).includes('token') &&
    !Object.values(store.ls).some(v => /^[0-9a-f]{24,}$/i.test(String(v)))
      ? ok('the link token is nowhere in storage')
      : bad('the token or something like it was persisted: ' + JSON.stringify(store.ls));

    /* ── g. desktop ─────────────────────────────────────────────────────── */
    step('Desktop');
    const desk = await browser.newPage();
    await desk.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
    await desk.goto(BASE + '/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
    await desk.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
    await desk.evaluate(p => window._availPreview(p), payload);
    await sleep(300);
    const dw = await desk.evaluate(() => {
      const w = document.querySelector('.wrap').getBoundingClientRect();
      return { wrap: Math.round(w.width), left: Math.round(w.left), win: window.innerWidth,
               cols: getComputedStyle(document.getElementById('floors')).gridTemplateColumns.split(' ').length };
    });
    dw.wrap <= 760 && dw.left > 100 && dw.cols >= 3
      ? ok('the column is held at ' + dw.wrap + 'px, centred, floors ' + dw.cols + ' across \u2014 not a stretched phone')
      : bad('desktop layout: ' + JSON.stringify(dw));
    await desk.screenshot({ path: path.join(OUT, 'g-desktop-1280.png') });
    await desk.close();

    /* ── TIME TO INTERACTIVE, throttled ─────────────────────────────────── */
    step('Time to interactive on a slow connection');
    const slow = await browser.newPage();
    await slow.setViewport({ width: 380, height: 780, deviceScaleFactor: 1, isMobile: true });
    const cdp = await slow.target().createCDPSession();
    await cdp.send('Network.enable');
    /* Regular 3G, and a 4x CPU handicap for the mid-range Android this is
       actually deployed to. */
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 300, downloadThroughput: 780 * 1024 / 8,
      uploadThroughput: 330 * 1024 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t0 = Date.now();
    await slow.goto(BASE + '/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
    await slow.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 60000 });
    const tScript = Date.now() - t0;
    await slow.evaluate(p => window._availPreview(p), payload);
    await slow.waitForFunction(() => document.querySelectorAll('#floors button').length > 0,
                               { timeout: 60000 });
    const tPaint = Date.now() - t0;
    const transfer = await slow.evaluate(() =>
      performance.getEntriesByType('resource')
        .reduce((n, r) => n + (r.transferSize || 0), 0) +
      (performance.getEntriesByType('navigation')[0] || {}).transferSize || 0);
    console.log('     shell ready ' + tScript + ' ms  ·  floors painted ' + tPaint + ' ms');
    console.log('     page + scripts over the wire: ' + Math.round(transfer / 1024) + ' KB');
    console.log('     payload on top of that: ' + Math.round(bytes / 1024) + ' KB');
    tPaint < 6000
      ? ok('interactive in ' + (tPaint / 1000).toFixed(1) + 's on Regular 3G with a 4\u00d7 CPU handicap')
      : bad('took ' + (tPaint / 1000).toFixed(1) + 's to become interactive');
    await slow.close();

    /* ── the contract, end to end, on ZZTEST ────────────────────────────── */
    step('End to end on ZZTEST — a real link, created and revoked');
    const zz = await sql(`SELECT p.id, p.project_name, c.company_name
                            FROM public.projects p JOIN public.companies c ON c.id = p.company_id
                           WHERE c.company_name ILIKE '%zztest%'
                             AND EXISTS (SELECT 1 FROM public.units u WHERE u.project_id = p.id)
                           ORDER BY p.project_name LIMIT 1;`);
    if (!zz.length) { bad('no ZZTEST project with units to test against'); }
    else {
      await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-avail-shot';
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        SELECT s.company_id, s.id, NULL, 'zz-avail-shot', now() + interval '5 minutes'
          FROM public.sales_users s JOIN public.companies c ON c.id = s.company_id
         WHERE c.company_name ILIKE '%zztest%' AND s.role='director' LIMIT 1;`);
      const made = await sql(`SELECT public.create_availability_link('zz-avail-shot','${zz[0].id}','shot-availability') AS r;`);
      const tok = made[0].r && made[0].r.token;
      if (!tok) { bad('could not create a ZZTEST link: ' + JSON.stringify(made[0].r)); }
      else {
        const live = await slowFetch(browser, tok);
        live.ok
          ? ok('the real /a/<token> route loads over the real anon key on ' + zz[0].project_name)
          : bad('the live route failed: ' + JSON.stringify(live));
        live.noPrice ? ok('and the live payload carries no price either')
                     : bad('the live payload carries a price');
        await sql(`SELECT public.revoke_availability_link('zz-avail-shot','${tok}');`);
        const after = await sql(`SELECT (public.get_public_availability('${tok}')->>'success') AS ok;`);
        after[0].ok === 'false'
          ? ok('and the same URL is dead the moment it is revoked')
          : bad('a revoked link still answers');
      }
      await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-avail-shot';`);
    }

    /* ── nothing was created on Awami ───────────────────────────────────── */
    step('Awami is untouched');
    const links = await sql(`SELECT count(*)::int n FROM public.availability_links
                              WHERE project_id = '${AWAMI_PR}';`);
    links[0].n === 0
      ? ok('no availability link exists for Awami \u2014 this script created none')
      : bad(links[0].n + ' Awami link(s) exist; this script must not have made one');

    errs.length === 0 ? ok('no console errors') : bad('console: ' + errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (FAILED ? '\u274C SOMETHING IS WRONG' : '\u2705 ALL CHECKS OK') + '  \u2192 ' + OUT);
  process.exit(FAILED ? 1 : 0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });

/* Load the page through the REAL route with a REAL token, so the one thing the
   captured payload cannot prove — that the page and the function actually talk
   to each other — is proven on the tenant it is safe to prove it on. */
async function slowFetch(browser, token) {
  const p = await browser.newPage();
  const seen = [];
  p.on('response', async r => {
    if (!/get_public_availability/.test(r.url())) return;
    try { seen.push(await r.text()); } catch (e) {}
  });
  try {
    await p.setViewport({ width: 380, height: 780 });
    await p.goto(BASE + '/a/' + token, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(400);
    const shown = await p.evaluate(() =>
      document.querySelectorAll('#floors button').length > 0 ||
      /not available/i.test(document.body.innerText));
    const body = seen.join('');
    return { ok: shown && seen.length > 0,
             noPrice: !/"p"\s*:|base_price/i.test(body) };
  } finally { await p.close(); }
}

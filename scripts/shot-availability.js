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

  /* Counted BEFORE anything runs, so "untouched" is a comparison rather than
     an assumption about what Rashid has done in the meantime. */
  const AWAMI_LINKS_BEFORE = (await sql(`SELECT count(*)::int n, count(*) FILTER (WHERE revoked)::int r
                                           FROM public.availability_links
                                          WHERE project_id = '${AWAMI_PR}';`))[0];

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

  /* ── DURATIONS OUT OF RANGE ─────────────────────────────────────────────
     Clamped to the desk's own 1..90, never discarded and never silently
     rewritten to the default — a number appearing in the queue that nobody
     asked for is worse than a refusal. Run inside a rolled-back transaction on
     Awami so it cannot run out of units and leaves nothing behind. */
  step('A duration outside 1..90');
  {
    const clamp = await sql(`
      BEGIN;
      INSERT INTO public.availability_links (token_hash, company_id, project_id, label)
      VALUES (public._availability_token_hash('clamp_probe'),
              '${AWAMI_CO}','${AWAMI_PR}','CLAMP PROBE — rolled back');
      CREATE TEMP TABLE cl ON COMMIT DROP AS
        SELECT 'high' AS k, public.submit_availability_request('clamp_probe',
                 (SELECT u.unit_no FROM public.units u
                    JOIN public.category_unit_statuses st ON st.id=u.status_id
                   WHERE u.project_id='${AWAMI_PR}' AND st.is_available
                   ORDER BY u.unit_no LIMIT 1), 999, 'Clamp') AS d
        UNION ALL
        SELECT 'low', public.submit_availability_request('clamp_probe',
                 (SELECT u.unit_no FROM public.units u
                    JOIN public.category_unit_statuses st ON st.id=u.status_id
                   WHERE u.project_id='${AWAMI_PR}' AND st.is_available
                   ORDER BY u.unit_no OFFSET 1 LIMIT 1), 0, 'Clamp')
        UNION ALL
        SELECT 'mid', public.submit_availability_request('clamp_probe',
                 (SELECT u.unit_no FROM public.units u
                    JOIN public.category_unit_statuses st ON st.id=u.status_id
                   WHERE u.project_id='${AWAMI_PR}' AND st.is_available
                   ORDER BY u.unit_no OFFSET 2 LIMIT 1), 12, 'Clamp');
      SELECT k, (SELECT days FROM public.availability_requests r WHERE r.ref = cl.d->>'ref') AS days
        FROM cl ORDER BY k;
      ROLLBACK;`);
    const by = {}; clamp.forEach(r => { by[r.k] = Number(r.days); });
    by.high === 90 ? ok('999 days is clamped to 90, the desk\u2019s own ceiling')
                   : bad('999 days became ' + by.high);
    by.low === 1   ? ok('0 days is clamped to 1, not dropped')
                   : bad('0 days became ' + by.low);
    by.mid === 12  ? ok('and 12 days is taken as 12 \u2014 nothing in range is rewritten')
                   : bad('12 days became ' + by.mid);
  }

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
      hero: document.querySelector('.hero-n').textContent.trim(),
      heroFoot: document.querySelector('.hero-f').textContent.trim(),
      heroSize: Math.round(parseFloat(getComputedStyle(document.querySelector('.hero-n')).fontSize)),
      labSize: Math.round(parseFloat(getComputedStyle(document.querySelector('.hero-l')).fontSize)),
      barFree: document.querySelector('.bar .free').style.width,
      total: document.querySelector('.hero').textContent.trim()
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
    /* ── the hierarchy, measured rather than admired ─────────────────
       "Flat" is a measurable complaint: it means the biggest thing and the
       smallest thing on the screen are nearly the same size. The headline
       number must be at least three times its own label, or the eye has
       nothing to land on first. */
    const sumFree = payload.floors.reduce((a, f) => a + Number(f.available || 0), 0);
    one.hero === String(sumFree)
      ? ok('the hero states ' + one.hero + ' available, which is what the floors add up to')
      : bad('the hero says ' + one.hero + ' but the floors add up to ' + sumFree);
    (one.heroSize >= one.labSize * 3)
      ? ok('and it is ' + one.heroSize + 'px against a ' + one.labSize +
           'px label — a real hierarchy, not a flat page')
      : bad('the hero is ' + one.heroSize + 'px and its label ' + one.labSize +
            'px — that is flat');
    console.log('     chip ' + one.chips[0].w + '×' + one.chips[0].h + 'px  ·  ' +
                one.hero + ' free  ·  hero ' + one.heroSize + 'px/label ' + one.labSize + 'px');
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
      const out = {
        open: document.getElementById('sheet').classList.contains('on'),
        unit: document.getElementById('sh-n').textContent.trim(),
        label: document.getElementById('wa').textContent.trim(),
        note: document.querySelector('.go-n').textContent.trim(),
        durs: [...document.querySelectorAll('#dur button')].map(b => b.textContent.trim()),
        preset: (document.querySelector('#dur button.on') || {}).textContent,
        acts: [...document.querySelectorAll('.acts button')].map(b => b.textContent.trim()),
        custom: !!document.getElementById('dcust')
      };
      SHEET.ref = 'AB2CD3';   // the server issues this for real; seeded to check the shape
      return Object.assign(out, { msg: message() });
    }, 0);
    sheet.open ? ok('the sheet opens on an available unit') : bad('no sheet');
    /* One action now. It must not read as though tapping it holds the unit. */
    /^Done/.test(sheet.label)
      ? ok('the button says "' + sheet.label + '"')
      : bad('the button says "' + sheet.label + '"');
    /reserve|book|hold/i.test(sheet.label)
      ? bad('the button implies it reserves: ' + sheet.label)
      : ok('and never implies the unit is already held');
    /* The duration chips are buttons too, so counting every button in the
       sheet counts the wrong thing. What must be exactly two is the action
       row: one thing to press and one way out. Two buttons wired to the same
       call is how this sheet asked the same question twice, in the same
       colour — and nothing here noticed. */
    sheet.acts.length === 2
      ? ok('one action and one way out: ' + sheet.acts.join(' / '))
      : bad('the action row holds ' + JSON.stringify(sheet.acts));
    !/request reservation/i.test(JSON.stringify(sheet.acts))
      ? ok('and the old duplicate button is gone')
      : bad('two buttons still send the same request');
    /only held once you receive a confirmation/i.test(sheet.note)
      ? ok('and says the unit is only held once confirmed')
      : bad('the note under the button is wrong: ' + sheet.note);
    JSON.stringify(sheet.durs) === JSON.stringify(['1 day', '3 days', '7 days'])
      ? ok('the chips are 1 / 3 / 7')
      : bad('the chips are ' + JSON.stringify(sheet.durs));
    sheet.custom
      ? ok('with a box beside them for any other number')
      : bad('there is no way to type a custom duration');
    /7/.test(sheet.preset || '') ? ok('7 days preselected') : bad('preselected ' + sheet.preset);
    /* Copy is gone: on a desktop wa.me opens a page that looks like it did
       nothing, so it read as a second equal choice for no reason. One action,
       and a way back that is not a small x in the corner. */
    (sheet.acts.length === 2 && /whatsapp/i.test(sheet.acts[0]) && /cancel/i.test(sheet.acts[1]))
      ? ok('one action and a way out: ' + sheet.acts.join(' / '))
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
      const on = document.querySelector('#units button:not(.off)');
      const px = e => e ? getComputedStyle(e) : null;
      return { before, after, offCount: off.length,
               label: off.length ? off[0].textContent.replace(/\s+/g, ' ').trim() : '',
               offBg: off.length ? px(off[0]).backgroundColor : '',
               onBg: on ? px(on).backgroundColor : '',
               offInk: off.length ? px(off[0].querySelector('.un')).color : '' };
    }, bigIdx);
    tog.after > tog.before
      ? ok('the toggle reveals ' + (tog.after - tog.before) + ' more unit(s) (' +
           tog.before + ' \u2192 ' + tog.after + ')')
      : bad('the toggle revealed nothing: ' + tog.before + ' \u2192 ' + tog.after);
    tog.offCount > 0 && /Not Available/.test(tog.label)
      ? ok('and the ' + tog.offCount + ' revealed units read "Not Available"')
      : bad('revealed units are labelled "' + tog.label + '"');
    /* ── held units are AMBER ─────────────────────────────────
       Read off the computed style, not the class list, because a class that
       no rule matches is exactly the failure this is here to catch. Amber is
       asserted as "red channel clearly above blue" — a hue test, not a hex
       test, so the palette can be tuned without the check going stale. */
    const rgbOf = t => (String(t).match(/[0-9]+/g) || []).map(Number);
    const warm = t => { const c = rgbOf(t); return c.length >= 3 && c[0] > c[2] + 18; };
    (tog.offCount > 0 && warm(tog.offBg) && warm(tog.offInk) && !warm(tog.onBg))
      ? ok('and they are drawn amber — held ' + tog.offBg + ' on ink ' + tog.offInk +
           ', available still ' + tog.onBg)
      : bad('held units are not amber: ' + JSON.stringify(
            { off: tog.offBg, ink: tog.offInk, on: tog.onBg }));
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
      const totalBefore = document.querySelector('.hero').textContent.trim();
      const orig = sb.rpc;
      sb.rpc = function () { return Promise.reject(new Error('offline')); };
      await load(false);
      sb.rpc = orig;
      return { chipsBefore, totalBefore,
               chipsAfter: document.querySelectorAll('#floors button').length,
               totalAfter: document.querySelector('.hero').textContent.trim(),
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

    /* ── NOTHING INVISIBLE IS SITTING ON THE PAGE ─────────────────────────
       Every assertion in this file clicked things by calling .click() on the
       element, which fires whether or not a person could ever reach it. So a
       closed sheet parked over the middle of the page at opacity 0 — fixed,
       520px wide, and never told to ignore the pointer — swallowed real
       clicks on the unit grid for weeks while every test went on passing.

       This asks the browser the question a thumb asks: at the centre of this
       button, what would actually be hit? Only on the wide layout, because
       that is the layout where the closed sheet has a position on screen at
       all. */
    const reach = await desk.evaluate(() => {
      document.querySelector('#floors button').click();
      const seen = [];
      const check = els => els.map(el => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        /* Bound the POINT, not the box: a button straddling the fold has its
           top on screen and its centre below it, and elementFromPoint outside
           the viewport answers null — which is not the same as 'covered'. */
        if (r.width === 0 || cy < 0 || cy > innerHeight || cx < 0 || cx > innerWidth) return null;
        const hit = document.elementFromPoint(cx, cy);
        if (hit && (hit === el || el.contains(hit))) return null;
        return { what: (el.textContent || '').trim().split('\n')[0].slice(0, 12),
                 blockedBy: hit ? (hit.id || hit.className || hit.tagName) : 'nothing' };
      }).filter(Boolean);
      const units  = check([...document.querySelectorAll('#units button')]);
      document.getElementById('back').click();
      const floors = check([...document.querySelectorAll('#floors button')]);
      return { units, floors,
               nUnits: document.querySelectorAll('#units button').length };
    });
    reach.units.length === 0
      ? ok('every unit on screen can actually be clicked \u2014 nothing invisible is over the grid')
      : bad(reach.units.length + ' unit(s) are covered by something: ' +
            JSON.stringify(reach.units.slice(0, 3)));
    reach.floors.length === 0
      ? ok('and every floor chip too')
      : bad(reach.floors.length + ' floor chip(s) are covered: ' +
            JSON.stringify(reach.floors.slice(0, 3)));
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
    /* BEST OF THREE, NOT ONE. A single throttled load measures the machine
       as much as the page: the same bytes came back at 2.5s, 4.4s, 5.8s and
       6.2s on this laptop across four consecutive runs, which turned a real
       budget into a coin toss and, worse, would have let a genuine
       regression hide inside the noise. The floor of a noisy measurement is
       the closest thing to the page's actual cost — a page that got slower
       cannot produce a fast run, but a busy machine can produce a slow one. */
    let tPaint = Infinity, tScript = Infinity, transfer = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const t0 = Date.now();
      await slow.goto(BASE + '/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
      await slow.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 60000 });
      const ts = Date.now() - t0;
      await slow.evaluate(p => window._availPreview(p), payload);
      await slow.waitForFunction(() => document.querySelectorAll('#floors button').length > 0,
                                 { timeout: 60000 });
      const tp = Date.now() - t0;
      if (tp < tPaint) {
        tPaint = tp; tScript = ts;
        transfer = await slow.evaluate(() =>
          performance.getEntriesByType('resource')
            .reduce((n, r) => n + (r.transferSize || 0), 0) +
          (performance.getEntriesByType('navigation')[0] || {}).transferSize || 0);
      }
    }
    console.log('     shell ready ' + tScript + ' ms  ·  floors painted ' + tPaint +
                ' ms   (best of 3)');
    console.log('     page + scripts over the wire: ' + Math.round(transfer / 1024) + ' KB');
    console.log('     payload on top of that: ' + Math.round(bytes / 1024) + ' KB');
    tPaint < 6000
      ? ok('interactive in ' + (tPaint / 1000).toFixed(1) + 's on Regular 3G with a 4× CPU handicap')
      : bad('took ' + (tPaint / 1000).toFixed(1) + 's to become interactive');
    await slow.close();

    /* ══ LIFTED FROM verify-public-availability.js ═════════════════════════
       Twenty-six assertions from the old suite that never depended on the tower
       model: the token, the hash, the table's permissions, what the wire
       carries, rotation, revocation, and what a dead link says. They are the
       reason that file existed, and the redesign does not touch any of them, so
       they move here rather than being retired with it.

       Everything runs on ZZTEST, where a link can be created and thrown away.
       Nothing here reaches Awami. ══════════════════════════════════════════ */
    step('The token, the table and the permissions \u2014 lifted from the old suite');
    const zz = await sql(`SELECT p.id, p.project_name, c.id AS co, c.company_name
                            FROM public.projects p JOIN public.companies c ON c.id = p.company_id
                           WHERE c.company_name ILIKE '%zztest%'
                             AND EXISTS (SELECT 1 FROM public.units u WHERE u.project_id = p.id)
                           ORDER BY p.project_name LIMIT 1;`);
    if (!zz.length) { bad('no ZZTEST project with units to test against'); }
    else {
      const ZZ = zz[0].co, ZZ_PROJECT = zz[0].id;
      await sql(`DELETE FROM public.sales_sessions WHERE session_token IN ('zz-avail-dir','zz-avail-rep');
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        SELECT s.company_id, s.id, NULL, 'zz-avail-dir', now() + interval '10 minutes'
          FROM public.sales_users s WHERE s.company_id='${ZZ}' AND s.role='director' LIMIT 1;`);

      const made = await sql(`SELECT public.create_availability_link('zz-avail-dir','${ZZ_PROJECT}','avail shot') AS r;`);
      const TOKEN = made[0].r && made[0].r.token;
      /* 1 */ (made[0].r.success && /^[0-9a-f]{32}$/.test(TOKEN || ''))
        ? ok('token is 128 random bits: ' + String(TOKEN).slice(0, 8) + '\u2026')
        : bad('token looks wrong: ' + JSON.stringify(made[0].r));

      const stored = await sql(`SELECT token_hash, label FROM public.availability_links
                                 WHERE token_hash = public._availability_token_hash('${TOKEN}');`);
      /* 2 */ stored.length === 1 ? ok('the link is stored') : bad('the link was not stored');
      /* 3 */ (stored[0] && stored[0].token_hash !== TOKEN && /^[0-9a-f]{64}$/.test(stored[0].token_hash))
        ? ok('stored as a sha256 hash, not the link: ' + stored[0].token_hash.slice(0, 12) + '\u2026')
        : bad('the raw token is in the table');
      const anyRaw = await sql(`SELECT count(*)::int n FROM public.availability_links
                                 WHERE token_hash LIKE '%${TOKEN}%';`);
      /* 4 */ Number(anyRaw[0].n) === 0
        ? ok('a dump of the table yields no working link')
        : bad('the table contains the raw token');
      const cols = await sql(`SELECT column_name FROM information_schema.columns
                               WHERE table_schema='public' AND table_name='availability_links';`);
      /* 5 */ !cols.some(c => c.column_name === 'token')
        ? ok('the plaintext token column is gone')
        : bad('availability_links still has a plaintext token column');

      const listed = await sql(`SELECT public.list_availability_links('zz-avail-dir') AS r;`);
      const one = (listed[0].r.links || [])[0];
      /* 6 */ !JSON.stringify(listed[0].r).includes(TOKEN)
        ? ok('the director list never echoes the link back')
        : bad('list_availability_links leaked the token');
      /* 7 */ (one && one.label)
        ? ok('but it does show which links exist: "' + one.label + '" on ' + one.project)
        : bad('the director cannot see which links exist');

      await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-avail-rep';
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        SELECT s.company_id, s.id, s.project_id, 'zz-avail-rep', now()+interval '10 minutes'
          FROM public.sales_users s WHERE s.company_id='${ZZ}' AND s.role NOT IN ('director','admin','cfo') LIMIT 1;`);
      const repTry = await sql(`SELECT public.create_availability_link('zz-avail-rep','${ZZ_PROJECT}','nope') AS r;`);
      /* 8 */ repTry[0].r.success === false
        ? ok('a rep cannot mint a public link \u2014 refused with ' + repTry[0].r.error)
        : bad('a rep minted a public link: ' + JSON.stringify(repTry[0].r));

      const acl = await sql(`SELECT has_table_privilege('anon','public.availability_links','SELECT') AS s,
                                    relrowsecurity AS rls
                               FROM pg_class WHERE oid='public.availability_links'::regclass;`);
      /* 9  */ acl[0].s === false ? ok('anon has no SELECT on availability_links')
                                  : bad('anon can read the token table');
      /* 10 */ acl[0].rls === true ? ok('and RLS is on (deny-all, no policies)')
                                   : bad('RLS is off on availability_links');

      /* The management RPCs ARE callable by anon and that is not a hole: the
         whole portal is an unauthenticated client that identifies its user with
         a session token passed as an argument, so every portal RPC runs as anon.
         The control is the session and role check inside each function, not the
         GRANT \u2014 and that is what has to be measured. An earlier version of the
         old harness asserted grant-level exclusivity instead, which was both
         wrong and the reason the Share-link screen 401'd for real directors. */
      const guarded = await sql(`
        SELECT (public.list_availability_links('no-such-session')->>'error')                  AS l,
               (public.create_availability_link('no-such-session','${ZZ_PROJECT}')->>'error') AS c,
               (public.revoke_availability_link('no-such-session','x')->>'error')             AS r;`);
      /* 11 */ (guarded[0].l === 'session_expired' && guarded[0].c === 'session_expired' &&
                guarded[0].r === 'session_expired')
        ? ok('the three management RPCs refuse a caller with no session')
        : bad('a management RPC answered without a session: ' + JSON.stringify(guarded[0]));
      const repGuard = await sql(`
        SELECT (public.list_availability_links('zz-avail-rep')->>'error')                  AS l,
               (public.create_availability_link('zz-avail-rep','${ZZ_PROJECT}')->>'error') AS c;`);
      /* 12 */ (!!repGuard[0].l && !!repGuard[0].c)
        ? ok('and refuse a rep who does have a session (list: ' + repGuard[0].l +
             ', create: ' + repGuard[0].c + ')')
        : bad('a rep reached a management RPC: ' + JSON.stringify(repGuard[0]));
      const pubOk = await sql(`SELECT (public.get_public_availability('nope')->>'error') AS e;`);
      /* 13 */ pubOk[0].e === 'not_available'
        ? ok('while the public one answers anyone, safely')
        : bad('the public function said something else: ' + pubOk[0].e);

      /* ── the browser, on the real route ──────────────────────────────── */
      const live = await visitToken(browser, TOKEN);
      /* 14 */ live.wire.length > 0
        ? ok('captured the response body over the real anon key')
        : bad('nothing came back on the wire');
      const SECRETS = await sql(`
        SELECT COALESCE(c.full_name,'zz-no-buyer') AS buyer, COALESCE(c.phone_primary,'zz-no-phone') AS phone,
               COALESCE(s.sale_number,'zz-no-sale') AS sale_no
          FROM public.sales s LEFT JOIN public.clients c ON c.id = s.client_id
         WHERE s.project_id='${ZZ_PROJECT}' AND s.status='active' LIMIT 1;`);
      const secret = SECRETS[0] || {};
      const leaked = Object.keys(secret).filter(k => secret[k] && live.wire.includes(secret[k]));
      /* 15 */ leaked.length === 0
        ? ok('no buyer name, phone or sale number on the wire' +
             (secret.buyer ? ' (looked for ' + secret.buyer + ')' : ''))
        : bad('LEAKED on the wire: ' + leaked.join(', '));
      const privKeys = ['client', 'phone', 'paid', 'outstanding', 'overdue', 'net_amount',
                        'sale_number', 'due', 'price', 'base_price']
        .filter(k => new RegExp('"[a-z_]*' + k, 'i').test(live.wire));
      /* 16 */ privKeys.length === 0
        ? ok('not one private key name is present, price included')
        : bad('private key names on the wire: ' + privKeys.join(', '));
      const rpcNames = [...new Set((live.code.match(/\.rpc\(\s*['"]([a-z_]+)['"]/g) || [])
        .map(m => m.replace(/.*['"]([a-z_]+)['"]/, '$1')))];
      /* 17 — THE PAGE'S WHOLE REACH INTO THE SERVER, by name, from its source.
         Three now: read the board, register a request, ask what happened to it.
         Nothing that books, nothing that names a portal RPC. The set is exact,
         so a fourth appearing is a failure rather than a surprise. */
      const allowedRpc = ['get_public_availability', 'get_request_status',
                          'submit_availability_request'].sort();
      (JSON.stringify(rpcNames.slice().sort()) === JSON.stringify(allowedRpc))
        ? ok('the page can call exactly these and nothing else: ' + rpcNames.sort().join(', '))
        : bad('the page calls: ' + (rpcNames.join(', ') || 'nothing at all'));

      /* ══ THE ASSERTION THAT WAS INVERTED ═══════════════════════════════
         The old suite asserted "all 30 ZZTEST units drawn". Under the new model
         that is not merely obsolete, it is the OPPOSITE of the requirement: the
         page must never put a whole building in the document. Dropping it would
         have left the redesign's central rule as an intention. It is inverted
         instead \u2014 on the real route, with a real token, the number of unit
         chips in the document must be LESS than the project's unit count, and on
         the first screen it must be zero. */
      /* 18 */ (live.unitsOnHome === 0 && live.totalUnits > 0)
        ? ok('on the real route the first screen renders 0 of ' + live.totalUnits + ' units')
        : bad('the first screen rendered ' + live.unitsOnHome + ' units');
      /* 19 */ (live.unitsAfterFloor > 0 && live.unitsAfterFloor < live.totalUnits)
        ? ok('and opening a floor renders ' + live.unitsAfterFloor + ' of ' + live.totalUnits +
             ' \u2014 never the whole building')
        : bad('a floor rendered ' + live.unitsAfterFloor + ' of ' + live.totalUnits + ' units');

      /* ── rotation ────────────────────────────────────────────────────── */
      const other = await sql(`SELECT id FROM public.projects
                                WHERE company_id='${ZZ}' AND id <> '${ZZ_PROJECT}' LIMIT 1;`);
      let OTHER = null;
      if (other.length) {
        const m2 = await sql(`SELECT public.create_availability_link('zz-avail-dir','${other[0].id}','avail second') AS r;`);
        OTHER = m2[0].r.token;
        /* 20 */ (OTHER && OTHER !== TOKEN)
          ? ok('a second project gets a different token')
          : bad('two projects share a token');
      } else { ok('only one ZZTEST project exists \u2014 isolation covered by rotation'); }

      const rot = await sql(`SELECT public.create_availability_link('zz-avail-dir','${ZZ_PROJECT}','avail rotated') AS r;`);
      const ROTATED = rot[0].r.token;
      const oldDead = await sql(`SELECT (public.get_public_availability('${TOKEN}')->>'success') AS s;`);
      const newLive = await sql(`SELECT (public.get_public_availability('${ROTATED}')->>'success') AS s;`);
      /* 21 */ oldDead[0].s === 'false' ? ok('rotating retires the previous link for that project')
                                        : bad('the old link still works after rotation');
      /* 22 */ newLive[0].s === 'true' ? ok('and the fresh one works')
                                       : bad('the rotated link does not work');
      if (OTHER) {
        const otherLive = await sql(`SELECT (public.get_public_availability('${OTHER}')->>'success') AS s;`);
        /* 23 */ otherLive[0].s === 'true'
          ? ok("the other project's link is untouched")
          : bad('rotating one project killed another');
      }

      /* ── revocation, and what a dead link says ───────────────────────── */
      const rev = await sql(`SELECT public.revoke_availability_link('zz-avail-dir','${ROTATED}') AS r;`);
      /* 24 */ rev[0].r.success === true ? ok('the director revoked it')
                                         : bad('revoke failed: ' + JSON.stringify(rev[0].r));
      const dead = await visitToken(browser, ROTATED);
      /* 25 */ /not available/i.test(dead.text)
        ? ok('the revoked link says so plainly')
        : bad('a revoked link shows: ' + dead.text.slice(0, 60));
      /* 26 */ !new RegExp(zz[0].project_name.split(' ')[0], 'i').test(dead.text)
        ? ok('and does not even name the project it used to show')
        : bad('the dead page names the project');
      /* 27 */ dead.url.includes('/a/')
        ? ok('still on the public route, never redirected into the portal')
        : bad('a dead link redirected to ' + dead.url);
      const guess = await visitToken(browser, 'deadbeefdeadbeefdeadbeefdeadbeef');
      /* 28 */ guess.text === dead.text
        ? ok('a guessed token gives the identical answer \u2014 no oracle')
        : bad('a guessed token answers differently from a revoked one');

      await sql(`DELETE FROM public.sales_sessions WHERE session_token IN ('zz-avail-dir','zz-avail-rep');`);
    }

    /* ══ THE WHOLE ROUND TRIP ══════════════════════════════════════════════
       A dealer taps Request on the real page, through the real link, and the
       request has to arrive in the desk with the duration THEY chose and the
       name THEIR phone carries — then one tap books it, for real, with the
       reservation carrying that duration. Nothing about that can be seen in a
       screenshot, and nothing about it is provable from either end alone.

       On ZZTEST. The link is created and revoked here. ══════════════════ */
    step('A dealer asks, the desk answers \u2014 the whole round trip');
    const okU2 = m => console.log('  \u2705 ' + m);
    const badU2 = m => { console.log('  \u274C ' + m); FAILED = true; };
    {
      /* TWO free units at least: the round trip approves one and declines
         another, and a project with one would leave the decline half silently
         untested. */
      const zz2 = await sql(`SELECT p.id, p.company_id, p.project_name,
                                    count(*) FILTER (WHERE st.is_available) AS free
                               FROM public.projects p
                               JOIN public.companies c ON c.id=p.company_id
                               JOIN public.units u ON u.project_id=p.id
                               LEFT JOIN public.category_unit_statuses st ON st.id=u.status_id
                              WHERE c.company_name ILIKE '%zztest%'
                               AND EXISTS (SELECT 1 FROM public.sales_users su
                                            WHERE su.company_id = p.company_id AND su.role = 'director')
                              GROUP BY p.id, p.company_id, p.project_name
                             HAVING count(*) FILTER (WHERE st.is_available) >= 2
                              /* A DETERMINISTIC PICK. Three ZZTEST projects sit on
                                 exactly 18 free units, so "the freest one" was a coin
                                 toss, and one of the three companies has no director —
                                 which is why this whole section passed twice and then
                                 failed twice without a line of it changing. The director
                                 is now a condition of being chosen, and the tie is
                                 broken by id so the same project is picked every run. */
                              ORDER BY free DESC, p.id LIMIT 1;`);
      /* Clear whatever a previous run left behind. ZZTEST only, and only rows
         this harness could have written — a failed run must not poison the
         next one's reading of the queue. */
      await sql(`DELETE FROM public.availability_requests r
                  USING public.companies c
                  WHERE c.id = r.company_id AND c.company_name ILIKE '%zztest%';`);

      if (!zz2.length) { bad('no ZZTEST project with two free units'); }
      else {
        await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-rt-dir';
          INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
          SELECT s.company_id, s.id, NULL, 'zz-rt-dir', now()+interval '10 minutes'
            FROM public.sales_users s WHERE s.company_id='${zz2[0].company_id}' AND s.role='director' LIMIT 1;`);
        const mk = await sql(`SELECT public.create_availability_link('zz-rt-dir','${zz2[0].id}','round trip') AS r;`);
        const T = mk[0].r.token;
        /* If the link was never minted, every assertion below is really about
           THIS, and blaming the dealer page for a token that does not exist
           sent me looking in the wrong file once already. */
        if (!T) { badU2('no link to test with — create_availability_link said: ' +
                        JSON.stringify(mk[0].r)); throw new Error('link not minted'); }

        /* THE DEALER. A fresh browser profile: no name, no history. */
        const ctx = await browser.createBrowserContext();
        const dp = await ctx.newPage();
        const derrs = [];
        dp.on('pageerror', e => derrs.push(String(e.message || e)));
        await dp.setViewport({ width: 380, height: 780 });
        await dp.goto(BASE + '/a/' + T, { waitUntil: 'domcontentloaded', timeout: 30000 });
        /* Wait for the thing the next step touches, not for the network. A
           crash on a null element hides whether the page loaded at all. */
        const ready = await dp.waitForFunction(() =>
          !!document.getElementById('nm-in') ||
          /not available/i.test(document.body.innerText), { timeout: 30000 })
          .then(() => true).catch(() => false);
        const shape = await dp.evaluate(() => ({
          dead: /not available/i.test(document.body.innerText),
          asks: !!document.getElementById('nm-in'),
          floors: document.querySelectorAll('#floors button').length }));
        (ready && shape.asks && shape.floors > 0)
          ? okU2('a fresh phone opens the link and is asked for a name (' + shape.floors + ' floors)')
          : badU2('the dealer page did not come up: ' + JSON.stringify(shape));
        if (!shape.asks) throw new Error('dealer page not usable: ' + JSON.stringify(shape));

        const asked = await dp.evaluate(async () => {
          /* give the name the way a dealer does */
          document.getElementById('nm-in').value = 'Round Trip Rep';
          document.getElementById('nm-ok').click();
          await new Promise(r => setTimeout(r, 150));
          document.querySelector('#floors button').click();
          const u = document.querySelector('#units button:not(.off)');
          const unit = u.querySelector('.un').textContent.trim();
          u.click();
          await new Promise(r => setTimeout(r, 250));
          /* 3 days, not the default 7 — so the duration is proven to travel */
          document.querySelector('#dur button[data-d="3"]').click();
          /* The Copy button is gone from the sheet — one action and a cancel
             now — but requestAndSend still knows how to register without
             opening WhatsApp, which is the only reason a test used it. */
          await requestAndSend('copy');
          await new Promise(r => setTimeout(r, 1400));
          return { unit, ref: (window.SHEET || {}).ref, msg: message() };
        });
        asked.ref
          ? okU2('the dealer\u2019s tap registered a request, ref ' + asked.ref)
          : badU2('no ref came back from the server');
        new RegExp('REQ-' + asked.ref).test(asked.msg || '')
          ? okU2('and the WhatsApp message carries THAT ref, not one invented in the browser')
          : badU2('the message ref does not match: ' + String(asked.msg).split('\n')[1]);
        await dp.screenshot({ path: path.join(OUT, 'k-request-sent.png') });

        /* A TYPED DURATION, all the way through. 12 is not one of the chips and
           not the default, so if anything anywhere quietly rewrites it the
           number that comes out the other end will not be 12. */
        const custom = await dp.evaluate(async TAKEN => {
          closeSheet();
          document.getElementById('back').click();
          document.querySelector('#floors button').click();
          const free = [...document.querySelectorAll('#units button:not(.off)')];
          /* Never the one already asked for: the cap would hand back that
             request's own ref and this step would then delete it. */
          const u = free.filter(b => b.querySelector('.un').textContent.trim() !== TAKEN)
                        .slice(-1)[0];
          if (!u) return null;
          u.click();
          await new Promise(r => setTimeout(r, 250));
          const box = document.getElementById('dcust');
          box.value = '12';
          box.dispatchEvent(new Event('input', { bubbles: true }));
          const litChips = [...document.querySelectorAll('#dur button.on')].length;
          const boxLit = box.classList.contains('on');
          await requestAndSend('copy');
          await new Promise(r => setTimeout(r, 1400));
          return { ref: (window.SHEET || {}).ref, days: (window.SHEET || {}).days,
                   unit: (window.SHEET || {}).n, litChips, boxLit, msg: message() };
        }, asked.unit);
        if (!custom || !custom.ref) { badU2('the custom duration request did not register'); }
        else {
          (custom.litChips === 0 && custom.boxLit)
            ? okU2('typing 12 lights the box and lets go of every chip')
            : badU2('both a chip and the box look chosen: ' + JSON.stringify(custom));
          /Duration: 12 days/.test(custom.msg)
            ? okU2('the WhatsApp message says 12 days')
            : badU2('the message says ' + (String(custom.msg).match(/Duration:.*/) || [''])[0]);
          const cRow = await sql(`SELECT days, status FROM public.availability_requests
                                   WHERE ref='${custom.ref}';`);
          Number(cRow[0] && cRow[0].days) === 12
            ? okU2('and the desk receives 12 days, not a rewritten 7')
            : badU2('the queue received ' + JSON.stringify(cRow[0]));
          custom.ref !== asked.ref
            ? okU2('and it is a request of its own, not the first one handed back')
            : badU2('the custom step landed on ' + custom.unit + ', the unit already asked for');
          if (custom.ref !== asked.ref) {
            await sql(`DELETE FROM public.availability_requests WHERE ref='${custom.ref}';`);
          }
        }

        /* NOTHING IS BOOKED YET. This is the whole safety of the anon write. */
        const mid = await sql(`
          SELECT (SELECT count(*)::int FROM public.availability_requests
                   WHERE ref='${asked.ref}' AND status='pending')                    AS pending,
                 (SELECT requested_by_name FROM public.availability_requests WHERE ref='${asked.ref}') AS who,
                 (SELECT days FROM public.availability_requests WHERE ref='${asked.ref}')              AS days,
                 (SELECT count(*)::int FROM public.reservations r
                    JOIN public.units u ON u.id=r.unit_id
                   WHERE u.unit_no='${asked.unit}' AND u.project_id='${zz2[0].id}'
                     AND r.status='active')                                          AS booked;`);
        (mid[0].pending === 1 && mid[0].booked === 0)
          ? okU2('the request is waiting and NOTHING is booked \u2014 submit reserves nothing')
          : badU2('state after the ask: ' + JSON.stringify(mid[0]));
        (mid[0].who === 'Round Trip Rep' && Number(mid[0].days) === 3)
          ? okU2('it carries the name and the 3 days the dealer chose')
          : badU2('the request lost the name or the duration: ' + JSON.stringify(mid[0]));

        /* THE DESK. Same session, the real list function. */
        const q = await sql(`SELECT public.list_reservation_requests('zz-rt-dir','${zz2[0].id}') AS r;`);
        const rows = (q[0].r.requests || []).filter(x => x.ref === asked.ref);
        rows.length === 1
          ? okU2('it appears in the desk queue with unit ' + rows[0].unit_no + ', ' +
                 rows[0].days + ' days, ' + rows[0].requested_by)
          : badU2('the request is not in the desk queue');

        /* ── the desk, with the request waiting on it ─────────────────── */
        const deskCtx = await browser.createBrowserContext();
        const deskPage = await deskCtx.newPage();
        const deskErrs = [];
        deskPage.on('pageerror', e2 => deskErrs.push(String(e2.message || e2)));
        await deskPage.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
        await deskPage.goto(BASE + '/sales-portal.html', { waitUntil: 'domcontentloaded' });
        await deskPage.evaluate(t => {
          localStorage.setItem('rms.sales.token', t);
          localStorage.setItem('rms.sales.active', String(Date.now()));
          sessionStorage.setItem('nx.hub.bounce', '1');
        }, 'zz-rt-dir');
        await deskPage.goto(BASE + '/sales-portal.html?tab=desk', { waitUntil: 'domcontentloaded' });
        await deskPage.waitForFunction(() => !!document.getElementById('rd-root'), { timeout: 60000 });
        await sleep(1800);
        const deskQ = await deskPage.evaluate(myRef => {
          const box = document.getElementById('rd-reqs');
          const cards = [...(box ? box.querySelectorAll('.rq-c') : [])];
          /* BY REF, not by position. The queue is oldest-first and anything
             else waiting is somebody else's row. */
          const mine = cards.filter(c => c.innerText.indexOf(myRef) >= 0)[0] || null;
          return {
            count: cards.length,
            badge: (box && box.querySelector('.rq-n') || {}).textContent || '',
            found: !!mine,
            first: mine ? mine.innerText.replace(/\s+/g, ' ').trim() : '',
            acts: mine ? [...mine.querySelectorAll('.rq-a button')].map(b2 => b2.textContent.trim()) : []
          };
        }, asked.ref);
        (deskQ.found && deskQ.count === 1)
          ? okU2('the desk shows this request and only this one, badge "' + deskQ.badge + '"')
          : badU2('the desk queue holds ' + deskQ.count + ' card(s), ours found: ' + deskQ.found);
        JSON.stringify(deskQ.acts) === JSON.stringify(['Approve', 'Decline'])
          ? okU2('with exactly two buttons: Approve and Decline')
          : badU2('the card offers ' + JSON.stringify(deskQ.acts));
        /Round Trip Rep/.test(deskQ.first) && /3 days/.test(deskQ.first)
          ? okU2('and the card already carries the name and the duration: ' +
                 deskQ.first.slice(0, 70))
          : badU2('the card is missing the name or the duration: ' + deskQ.first);
        deskErrs.length === 0 ? okU2('no errors on the desk')
                              : badU2('desk errors: ' + deskErrs.slice(0, 2).join(' | '));
        await deskPage.screenshot({ path: path.join(OUT, 'm-desk-queue.png') });

        /* ── THE SIDEBAR, FROM ANOTHER SCREEN ──────────────────────────
           A request is useless if it only announces itself on the screen you
           would have to already be on. Checked from the Daybook, which is
           where he actually is when one arrives. */
        await deskPage.evaluate(() => setTab('daybook'));
        await deskPage.waitForFunction(() => !!document.getElementById('db-root'), { timeout: 40000 });
        await sleep(900);
        const badge = await deskPage.evaluate(async () => {
          const b = document.getElementById('nav-badge-requests');
          return { exists: !!b, shown: !!b && b.classList.contains('show'),
                   text: b ? b.textContent.trim() : '',
                   onDesk: (typeof TAB !== 'undefined') ? TAB : null };
        });
        (badge.exists && badge.shown && badge.text === '1' && badge.onDesk === 'daybook')
          ? okU2('the sidebar shows \u201c1\u201d on Reserve Desk while standing on the Daybook')
          : badU2('the sidebar badge is wrong from another tab: ' + JSON.stringify(badge));
        /* At 420px the sidebar is behind the hamburger, so the badge is set but
           not visible. Photographed at a width where the rail is open, and the
           narrow case is checked separately below. */
        await deskPage.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
        await sleep(500);
        const wide = await deskPage.evaluate(() => {
          const b = document.getElementById('nav-badge-requests');
          const r = b ? b.getBoundingClientRect() : null;
          return { visible: !!r && r.width > 0 && r.height > 0 && r.left >= 0, text: b ? b.textContent.trim() : '' };
        });
        wide.visible
          ? okU2('and on a wide screen the badge is actually on the rail, reading ' + wide.text)
          : badU2('the badge is set but not rendered on the rail: ' + JSON.stringify(wide));
        await deskPage.screenshot({ path: path.join(OUT, 'n-sidebar-badge.png') });
        await deskPage.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
        await sleep(400);
        /* The narrow case, which is the one he actually uses. The badge is
           behind the drawer, so the burger has to carry the news itself. */
        const narrow = await deskPage.evaluate(() => {
          const t = document.querySelector('.sb-toggle');
          const b2 = document.getElementById('nav-badge-requests');
          const r = b2 ? b2.getBoundingClientRect() : null;
          return { burgerShown: !!t && getComputedStyle(t).display !== 'none',
                   dot: !!t && t.classList.contains('has-req'),
                   badgeOffscreen: !r || r.width === 0 || r.left < 0 };
        });
        (narrow.burgerShown && narrow.dot)
          ? okU2('on a phone the rail is closed, so the burger carries a dot instead')
          : badU2('nothing on the phone says a request is waiting: ' + JSON.stringify(narrow));
        await deskPage.screenshot({ path: path.join(OUT, 'o-phone-dot.png') });

        /* ── A REQUEST ARRIVING WHILE THE DESK IS OPEN ─────────────────
           The watch runs every 45 seconds; waiting that long in a test proves
           patience, not correctness, so the tick is called directly. What is
           being asserted is that a tick with new data repaints the queue and
           moves the badge \u2014 not the length of the interval. */
        await deskPage.evaluate(() => setTab('desk'));
        await deskPage.waitForFunction(() => !!document.getElementById('rd-root'), { timeout: 40000 });
        /* WAIT FOR THE QUEUE, DO NOT GUESS AT IT. A fixed sleep here measured
           the network, not the code: coming back to the desk costs two RPCs,
           and 900ms was sometimes not enough, so the baseline was read as an
           empty queue and every later comparison was against a lie. The one
           card already waiting is a known fact — wait for it, and say so
           plainly if it never comes. */
        const queueBack = await deskPage
          .waitForFunction(() => document.querySelectorAll('#rd-reqs .rq-c').length > 0,
                           { timeout: 20000 })
          .then(() => true).catch(() => false);
        queueBack
          ? okU2('coming back to the desk brings the waiting request with it')
          : badU2('the desk came back empty — the request that is pending did not redraw');

        /* ── AND IT DOES NOT NARROW ITSELF TO THE OPEN TAB ─────────────
           The queue used to be fetched for whichever project the desk happened
           to be showing, and that project is only decided by the FIRST paint —
           so a request could be visible when the desk opened and gone the
           moment he came back to it. Switch the tower deliberately: a request
           addressed to a person must not disappear because he is looking at a
           different building. */
        const spanned = await deskPage.evaluate(async myRef => {
          const sel = document.getElementById('rd-proj');
          if (!sel || sel.options.length < 2) return { only: true };
          const other = [...sel.options].find(o => o.value !== sel.value);
          sel.value = other.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          const mine = () => [...document.querySelectorAll('#rd-reqs .rq-c')]
            .some(c => c.innerText.indexOf(myRef) >= 0);
          for (let i = 0; i < 60 && !mine(); i++) await new Promise(r => setTimeout(r, 250));
          return { only: false, tower: other.textContent.trim(),
                   cards: document.querySelectorAll('#rd-reqs .rq-c').length,
                   found: mine() };
        }, asked.ref);
        spanned.only
          ? okU2('this company has one tower, so there is no other tab to lose it to')
          : (spanned.found
              ? okU2('and switching to ' + spanned.tower + ' still shows THIS request — ' +
                     'the queue is his, not the tab’s')
              : badU2('switching to ' + spanned.tower + ' lost our request (' +
                      spanned.cards + ' other card(s) on screen)'));
        const beforeArr = await deskPage.evaluate(() =>
          document.querySelectorAll('#rd-reqs .rq-c').length);

        /* a second dealer, elsewhere, asks for something */
        const arriving = await sql(`SELECT (public.submit_availability_request('${T}',
          (SELECT u.unit_no FROM public.units u
             JOIN public.category_unit_statuses st ON st.id=u.status_id
            WHERE u.project_id='${zz2[0].id}' AND st.is_available
              AND NOT EXISTS (SELECT 1 FROM public.availability_requests x
                               WHERE x.unit_id=u.id AND x.status='pending')
            ORDER BY u.unit_no DESC LIMIT 1), 5, 'Second Rep')->>'ref') AS ref;`);
        if (!arriving[0].ref) { badU2('could not make a second request to arrive'); }
        else {
          const arrived = await deskPage.evaluate(async () => {
            /* the real path: the browser fires this when a tab comes back, and the
               watch catches up on it rather than waiting out the interval */
            document.dispatchEvent(new Event('visibilitychange'));
            await new Promise(r => setTimeout(r, 1200));
            const b = document.getElementById('nav-badge-requests');
            return { cards: document.querySelectorAll('#rd-reqs .rq-c').length,
                     badge: b ? b.textContent.trim() : '' };
          });
          (arrived.cards === beforeArr + 1 && arrived.badge === String(beforeArr + 1))
            ? okU2('a request arriving while the desk is open appears without a reload (' +
                   beforeArr + ' \u2192 ' + arrived.cards + ', badge ' + arrived.badge + ')')
            : badU2('the open desk did not pick it up: ' + JSON.stringify(arrived));
          await sql(`DELETE FROM public.availability_requests WHERE ref='${arriving[0].ref}';`);
          /* Waited on rather than slept through: a fixed 1200ms measured the
             network on a busy machine, not whether the desk lets go. The tick
             is nudged more than once because one of them may land before the
             delete is visible. */
          const cleared = await deskPage.evaluate(async want => {
            for (let i = 0; i < 30; i++) {
              document.dispatchEvent(new Event('visibilitychange'));
              await new Promise(r => setTimeout(r, 400));
              if (document.querySelectorAll('#rd-reqs .rq-c').length === want) break;
            }
            const b = document.getElementById('nav-badge-requests');
            return { cards: document.querySelectorAll('#rd-reqs .rq-c').length,
                     shown: !!b && b.classList.contains('show') };
          }, beforeArr);
          cleared.cards === beforeArr
            ? okU2('and it disappears again when it is gone')
            : badU2('a withdrawn request stayed on the desk: ' + JSON.stringify(cleared));
        }
        await deskCtx.close();

        const dec = await sql(`SELECT public.decide_reservation_request('zz-rt-dir',
                                 (SELECT id FROM public.availability_requests WHERE ref='${asked.ref}'),
                                 'approve') AS r;`);
        dec[0].r.success === true
          ? okU2('one tap approves it')
          : badU2('approve failed: ' + JSON.stringify(dec[0].r));
        const after = await sql(`
          SELECT (SELECT status FROM public.availability_requests WHERE ref='${asked.ref}') AS st,
                 (SELECT count(*)::int FROM public.reservations r JOIN public.units u ON u.id=r.unit_id
                   WHERE u.unit_no='${asked.unit}' AND u.project_id='${zz2[0].id}' AND r.status='active') AS booked,
                 (SELECT r.requested_by_name FROM public.reservations r JOIN public.units u ON u.id=r.unit_id
                   WHERE u.unit_no='${asked.unit}' AND u.project_id='${zz2[0].id}' AND r.status='active') AS who,
                 (SELECT EXTRACT(DAY FROM (r.expiry_date - r.created_at))::int
                    FROM public.reservations r JOIN public.units u ON u.id=r.unit_id
                   WHERE u.unit_no='${asked.unit}' AND u.project_id='${zz2[0].id}' AND r.status='active') AS days;`);
        (after[0].st === 'approved' && after[0].booked === 1 &&
         after[0].who === 'Round Trip Rep' && Number(after[0].days) === 3)
          ? okU2('and the unit is really reserved \u2014 for ' + after[0].who + ', ' + after[0].days + ' days')
          : badU2('after approve: ' + JSON.stringify(after[0]));

        /* THE DEALER SEES THE ANSWER. Decline a second one and read it back
           through the page's own status call. */
        const second = await dp.evaluate(async () => {
          closeSheet();
          document.getElementById('back').click();
          document.querySelector('#floors button').click();
          /* A DIFFERENT unit. The payload in this browser still predates the
             approval, so the first free chip is the one just booked and the
             request would be refused — which is correct behaviour, and not what
             this half is testing. */
          const free = [...document.querySelectorAll('#units button:not(.off)')];
          const u = free[1] || free[0];
          if (!u) return null;
          u.click();
          await new Promise(r => setTimeout(r, 250));
          await requestAndSend('copy');
          await new Promise(r => setTimeout(r, 1400));
          return (window.SHEET || {}).ref;
        });
        if (!second) { badU2('no second unit to decline'); }
        else {
          await sql(`SELECT public.decide_reservation_request('zz-rt-dir',
                       (SELECT id FROM public.availability_requests WHERE ref='${second}'),
                       'decline');`);
          const seen = await dp.evaluate(async () => {
            await refreshMyReqs();
            await new Promise(r => setTimeout(r, 300));
            return document.getElementById('myq').innerText;
          });
          /Declined by Management/.test(seen)
            ? okU2('a decline reaches the dealer\u2019s page as \u201cDeclined by Management\u201d')
            : badU2('the dealer does not see the decline: ' + String(seen).replace(/\s+/g, ' ').slice(0, 90));
          /Reserved for you/.test(seen)
            ? okU2('and the approved one reads \u201cReserved for you\u201d')
            : badU2('the approved request does not show as reserved');
          await dp.screenshot({ path: path.join(OUT, 'l-dealer-sees-decision.png') });

          /* ── AND THE HOLD BEING UNDONE REACHES HIM TOO ───────────────
             This is the one that got out. The dealer's row was reading the
             DECISION, which never moves, so a reservation released at the
             desk left “Reserved for you” standing on a phone whose unit was
             back on sale. Undo it the way the desk does — cancel the
             reservation row — and the phone has to catch up on its own.
             Nothing is clicked on the dealer's side but the refresh it
             already runs on a timer. */
          await sql(`UPDATE public.reservations SET status='cancelled', cancelled_at=now()
                      WHERE id = (SELECT reservation_id FROM public.availability_requests
                                   WHERE ref='${asked.ref}');`);
          const undone = await dp.evaluate(async () => {
            await refreshMyReqs();
            await new Promise(r => setTimeout(r, 300));
            return document.getElementById('myq').innerText;
          });
          (/Hold ended/.test(undone) && !/Reserved for you/.test(undone))
            ? okU2('undoing the reservation turns the dealer’s row into “Hold ended”')
            : badU2('the dealer still believes the unit is held: ' +
                    String(undone).replace(/s+/g, ' ').slice(0, 110));
          /* and the decline it is sitting next to is untouched by that */
          /Declined by Management/.test(undone)
            ? okU2('and the declined one still reads as declined')
            : badU2('the decline changed when the other hold was released');
          /* The record of the decision is NOT rewritten — only what the
             dealer is told. A decided row that quietly becomes undecided is
             a forged record, and the desk's own history reads from it. */
          const kept = await sql(`SELECT status FROM public.availability_requests
                                   WHERE ref='${asked.ref}';`);
          kept[0].status === 'approved'
            ? okU2('while the row itself still records that it WAS approved')
            : badU2('the decision was rewritten to ' + kept[0].status);
          /* The band is the evidence; a sheet parked over it is a screenshot
             of nothing. */
          await dp.evaluate(() => { closeSheet(); document.getElementById('back').click();
                                    window.scrollTo(0, 0); });
          await sleep(350);
          await dp.screenshot({ path: path.join(OUT, 'l2-hold-ended.png') });
        }

        /* THE CAPS. One pending per unit, asserted by asking twice. */
        const twice = await sql(`
          SELECT (public.submit_availability_request('${T}','${asked.unit}',7,'Someone')->>'error') AS e;`);
        twice[0].e === 'unit_unavailable'
          ? okU2('asking for a unit that is now booked is refused')
          : badU2('a booked unit accepted a request: ' + twice[0].e);

        derrs.length === 0 ? okU2('no page errors on the dealer\u2019s side')
                           : badU2('dealer page errors: ' + derrs.slice(0, 2).join(' | '));

        await ctx.close();
        /* put ZZTEST back */
        await sql(`
          UPDATE public.reservations SET status='cancelled', cancelled_at=now()
           WHERE id IN (SELECT reservation_id FROM public.availability_requests
                         WHERE ref IN ('${asked.ref}','${second}') AND reservation_id IS NOT NULL);
          DELETE FROM public.availability_requests WHERE ref IN ('${asked.ref}','${second}');
          /* AND UNSTAMP THE UNITS. Cancelling the reservation is only half of
             putting it back: the unit still carries the Reserved status the
             desk wrote on it, and the public page reads that, not the
             reservation. Scoped to ZZTEST and to units that are demonstrably
             free again. */
          WITH avail AS (
            SELECT DISTINCT ON (project_id) project_id, id
              FROM public.category_unit_statuses WHERE is_available AND is_active
             ORDER BY project_id, sort_order NULLS LAST, created_at)
          UPDATE public.units u SET status_id = a.id, updated_at = now()
            FROM avail a, public.companies c, public.category_unit_statuses st
           WHERE a.project_id = u.project_id
             AND c.id = u.company_id AND c.company_name ILIKE '%zztest%'
             AND st.id = u.status_id AND st.is_available = false
             AND public._map_unit_state(u.id) = 'available';
          SELECT public.revoke_availability_link('zz-rt-dir','${T}');
          DELETE FROM public.sales_sessions WHERE session_token='zz-rt-dir';`);
        okU2('ZZTEST put back: requests deleted, reservation cancelled, link revoked');
      }
    }

    /* ── nothing was created on Awami ───────────────────────────────────── */
    /* Rashid creates the Awami link himself and sees the token once, so the
       claim is not "none exists" — it is that this run made no new one and
       revoked none. Counted at the start, compared at the end. */
    step('Awami is untouched');
    const linksAfter = await sql(`SELECT count(*)::int n, count(*) FILTER (WHERE revoked)::int r
                                    FROM public.availability_links
                                   WHERE project_id = '${AWAMI_PR}';`);
    (linksAfter[0].n === AWAMI_LINKS_BEFORE.n && linksAfter[0].r === AWAMI_LINKS_BEFORE.r)
      ? ok('Awami still has exactly the ' + linksAfter[0].n + ' link(s) it started with \u2014 ' +
           'this run created none and revoked none')
      : bad('Awami links changed: ' + JSON.stringify({ before: AWAMI_LINKS_BEFORE, after: linksAfter[0] }));

    errs.length === 0 ? ok('no console errors') : bad('console: ' + errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (FAILED ? '\u274C SOMETHING IS WRONG' : '\u2705 ALL CHECKS OK') + '  \u2192 ' + OUT);
  process.exit(FAILED ? 1 : 0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });

/* Load the page through the REAL route with a REAL token, so the one thing a
   captured payload cannot prove — that the page and the function actually talk
   to each other — is proven on the tenant it is safe to prove it on. Also
   reports how much of the building reached the document, which is what the
   inverted "all units drawn" assertion needs. */
async function visitToken(browser, token) {
  const ctx = await browser.createBrowserContext();   // empty: no storage, no session
  const p = await ctx.newPage();
  const wire = [], pending = [];
  p.on('response', r => {
    if (!/get_public_availability/.test(r.url())) return;
    pending.push(r.text().then(t => wire.push(t)).catch(() => {}));
  });
  try {
    await p.setViewport({ width: 380, height: 780 });
    await p.goto(BASE + '/a/' + token, { waitUntil: 'domcontentloaded', timeout: 30000 });
    /* Rendered, or dead. Waiting on the network going quiet is not the same
       question and answered too early. */
    await p.waitForFunction(() =>
      document.querySelectorAll('#floors button').length > 0 ||
      /not available/i.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
    await Promise.all(pending);
    await sleep(200);
    const out = await p.evaluate(() => {
      const home = document.querySelectorAll('#units button').length;
      const total = (window.P && window.P.floors)
        ? window.P.floors.reduce((n, f) => n + f.units.length, 0) : 0;
      const chip = document.querySelector('#floors button');
      if (chip) chip.click();
      return { home, total, after: document.querySelectorAll('#units button').length,
               text: document.body.innerText };
    });
    const code = fs.readFileSync(path.join(ROOT, 'availability.html'), 'utf8');
    return { wire: wire.join('\n'), code,
             unitsOnHome: out.home, unitsAfterFloor: out.after, totalUnits: out.total,
             text: out.text, url: p.url() };
  } finally { await ctx.close(); }
}

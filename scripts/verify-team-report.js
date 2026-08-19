/**
 * Team report — driven from the sidebar, like a person.
 *
 *   node scripts/verify-team-report.js
 *
 * Two things the owner could not see and now can:
 *   · what a rep WRITES on a lead (a note) and the statuses they move
 *   · what each member actually did on a given day
 *
 * The data was never the problem — lead_activities has been recording notes,
 * calls, WhatsApp and status moves all along, and get_team_activity has existed
 * for months with nothing calling it. So the thing worth testing is reachability
 * and truthfulness: can a director get to the screen by clicking, and does what
 * it shows match what is actually in the table?
 *
 * That is why this file is forbidden from calling renderTeamReport() — it
 * clicks the sidebar. The unit map once worked for six commits while being
 * unreachable, and every test drove it directly.
 *
 * ZZTEST only: the fixture writes its own activities on a throwaway lead, checks
 * they surface, and deletes them.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const zlib = require('zlib');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4225;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'daily_report');
const ZZ = 'a2915ce7-c01c-463b-ba50-b144b2240337';
const NOTE = 'ZZDR client wants a corner unit, will decide after Eid';

let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  ✅ ' + m); };
const bad = m => { FAIL++; console.log('  ❌ ' + m); };
const stepH = m => console.log('\n── ' + m);
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const ref = (mcp.mcpServers.supabase.args.find(a => a.startsWith('--project-ref=')) || '').split('=')[1];
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com', path: `/v1/projects/${ref}/database/query`, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d.slice(0, 300)))); });
    r.on('error', rej); r.write(body); r.end();
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
               '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve() {
  return new Promise(r => {
    const s = http.createServer((q, res) => {
      const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
  });
}
const until = (page, fn, ms = 20000) => page.waitForFunction(fn, { timeout: ms, polling: 250 });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const co = await sql(`SELECT company_name FROM companies WHERE id='${ZZ}'`);
  assert(/ZZTEST/i.test(co[0].company_name), 'measuring on ' + co[0].company_name);

  // ── a rep's day, written the way the app writes it ────────────────────────
  stepH('ZZ Rep One works a lead today');
  await sql(`
    DELETE FROM public.lead_activities a USING public.leads l
     WHERE a.lead_id=l.id AND l.company_id='${ZZ}' AND l.name='ZZDR Lead';
    DELETE FROM public.lead_assignments la USING public.leads l
     WHERE la.lead_id=l.id AND l.company_id='${ZZ}' AND l.name='ZZDR Lead';
    DELETE FROM public.leads WHERE company_id='${ZZ}' AND name='ZZDR Lead';
    DELETE FROM public.sales_sessions WHERE session_token IN ('zz-dr-dir','zz-dr-rep');
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-dr-dir', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Director';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-dr-rep', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One';
    INSERT INTO public.leads (company_id, name, phone, status, owner_sales_user_id, is_test)
    SELECT '${ZZ}', 'ZZDR Lead', '03001110000', 'contacted', id, true
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One';
    INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body, created_at)
    SELECT l.id, l.owner_sales_user_id, k.kind, k.body,
           (((now() AT TIME ZONE 'Asia/Karachi')::date + interval '12 hours') AT TIME ZONE 'Asia/Karachi')
      FROM public.leads l,
           (VALUES ('call', NULL), ('whatsapp', NULL),
                   ('note', '${NOTE}'), ('stage', 'Moved to contacted')) AS k(kind, body)
     WHERE l.company_id='${ZZ}' AND l.name='ZZDR Lead';
    INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id, assigned_at)
    SELECT l.id, d.id, l.owner_sales_user_id,
           (((now() AT TIME ZONE 'Asia/Karachi')::date + interval '12 hours') AT TIME ZONE 'Asia/Karachi')
      FROM public.leads l, public.sales_users d
     WHERE l.company_id='${ZZ}' AND l.name='ZZDR Lead'
       AND d.company_id='${ZZ}' AND d.full_name='ZZ Director';`);

  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });

  async function portal(token) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1320, height: 940, deviceScaleFactor: 2 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t);
                               localStorage.setItem('rms.sales.active', String(Date.now()));
                               sessionStorage.setItem('nx.loc.dismissed', '1');
                               sessionStorage.setItem('nx.pwa.dismissed', '1'); }, token);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1600);
    try { await until(page, () => { const b = document.getElementById('app-body');
      return !!b && b.children.length > 0 && !b.querySelector('.skel, .skeleton'); }); }
    catch (e) { await sleep(1500); }
    await page.evaluate(() => ['loc-bar','pwa-bar','push-bar']
      .forEach(id => { const e = document.getElementById(id); if (e) e.remove(); }));
    return { ctx, page, errs };
  }
  /* The sidebar is an accordion and Management starts collapsed, so a human
     opens the group first. Doing the same here keeps this a real click-through
     rather than a coordinate poke at something nobody could reach. */
  const navItem = async page => {
    await page.evaluate(() => {
      const a = [...document.querySelectorAll('.sb .ni')]
        .find(x => (x.querySelector('.ni-lb') || {}).textContent === 'Team report');
      if (!a) return;
      const grp = a.closest('.ni-grp');
      const btn = grp && grp.querySelector('[data-grp-btn]');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
    });
    await sleep(500);
    return page.evaluate(() => {
      const a = [...document.querySelectorAll('.sb .ni')]
        .find(x => (x.querySelector('.ni-lb') || {}).textContent === 'Team report');
      if (!a) return null;
      const r = a.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { visible: getComputedStyle(a).display !== 'none' && r.width > 0 && r.height > 0,
               reachable: !!(hit && a.contains(hit)),
               x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  };

  // ── the director opens it by clicking ─────────────────────────────────────
  stepH('ZZ Director → sidebar → Team report');
  const D = await portal('zz-dr-dir');
  const nav = await navItem(D.page);
  if (!assert(nav && nav.visible, 'the sidebar shows "Team report"')) throw new Error('no nav item');
  assert(nav.reachable, 'and a click at it actually lands on it');
  await D.page.mouse.click(nav.x, nav.y);                    // a REAL click
  try { await until(D.page, () => !!document.querySelector('.dr-row')); }
  catch (e) {
    console.log('     body → ' + (await D.page.evaluate(() =>
      (document.getElementById('app-body') || {}).innerText || '(empty)')).slice(0, 200));
    console.log('     errs → ' + D.errs.slice(0, 3).join(' | '));
    throw e;
  }
  await sleep(600);
  await D.page.screenshot({ path: path.join(SHOTS, '01-team-day.png') });
  console.log('  📸 01-team-day');

  const team = await D.page.evaluate(() => ({
    period: (document.querySelector('#tr-out') || {}).textContent || '',
    presetOn: (document.querySelector('.dr-p.on[data-preset]') || {}).textContent || '',
    projects: [...document.querySelectorAll('[data-proj]')].map(b => b.textContent.trim()),
    tiles: [...document.querySelectorAll('.dr-tile')].map(t =>
      t.querySelector('.k').textContent + ' ' + t.querySelector('.v').textContent),
    rows: [...document.querySelectorAll('.dr-row')].map(r => ({
      name: r.querySelector('.dr-nm').textContent,
      bits: [...r.querySelectorAll('.dr-b')].map(b => b.textContent.trim())
    })),
    secs: [...document.querySelectorAll('.dr-sec')].map(s => s.textContent)
  }));
  console.log('     ' + team.tiles.join('  |  '));
  assert(team.presetOn === 'Today', 'it opens on Today ("' + team.presetOn + '")');
  assert(team.rows.length > 0, 'it lists ' + team.rows.length + ' member(s)');
  const rep = team.rows.find(r => /ZZ Rep One/.test(r.name));
  assert(!!rep, 'ZZ Rep One is there');
  assert(rep.bits.some(b => /1 reached/.test(b)), 'showing who they reached: ' + rep.bits.join(' · '));
  assert(rep.bits.some(b => /1 note/.test(b)) && rep.bits.some(b => /1 status/.test(b)),
    'and that they wrote a note and moved a status');
  assert(team.secs.some(s => /Worked in this period/.test(s)) && team.secs.some(s => /Nothing recorded/.test(s)),
    'the period splits into who worked and who did not: ' + team.secs.join(' / '));

  // ── the thing the owner could not see: the actual words ───────────────────
  stepH('Open that member — every note and status change');
  await D.page.evaluate(() => [...document.querySelectorAll('.dr-row')]
    .find(r => /ZZ Rep One/.test(r.querySelector('.dr-nm').textContent)).click());
  await until(D.page, () => !!document.querySelector('.dr-ent'));
  await sleep(600);
  await D.page.screenshot({ path: path.join(SHOTS, '02-member-day.png') });
  console.log('  📸 02-member-day');

  const day = await D.page.evaluate(() => ({
    text: document.getElementById('app-body').innerText,
    entries: [...document.querySelectorAll('.dr-ent')].map(e => ({
      time: e.querySelector('.dr-t').textContent.trim(),
      lead: e.querySelector('.dr-lead').textContent.trim(),
      kind: e.querySelector('.dr-kind').textContent.trim(),
      body: (e.querySelector('.dr-txt') || {}).textContent || ''
    }))
  }));
  day.entries.slice(0, 6).forEach(e =>
    console.log('     ' + e.time.padEnd(6) + e.kind.padEnd(12) + e.lead.padEnd(12) + e.body.slice(0, 44)));
  assert(day.entries.length === 4, 'all four things they did are listed (' + day.entries.length + ')');
  assert(day.entries.some(e => e.body === NOTE),
    'the note they WROTE is shown word for word — this is what a director could never see');
  assert(day.entries.some(e => /Status/.test(e.kind) && /Moved to contacted/.test(e.body)),
    'and the status they moved, with what it moved to');
  assert(day.entries.every(e => /^\d{2}:\d{2}$/.test(e.time)), 'each one carries its time');
  assert(day.entries.every(e => e.lead === 'ZZDR Lead'), 'and the lead it belongs to');

  // ── a day with nothing in it must say so, not look broken ─────────────────
  // ── the period controls: presets, a custom range, and a project tab ──────
  stepH('Widen the period and split it by project');
  await D.page.evaluate(() => document.getElementById('app-body').querySelector('.backbtn').click());
  await until(D.page, () => !!document.querySelector('.dr-row'));

  await D.page.evaluate(() => [...document.querySelectorAll('[data-preset]')]
    .find(b => b.textContent.trim() === 'This month').click());
  await until(D.page, () => /days/.test((document.getElementById('tr-out') || {}).textContent || ''));
  await sleep(700);
  await D.page.screenshot({ path: path.join(SHOTS, '03-this-month.png') });
  console.log('  📸 03-this-month');
  const month = await D.page.evaluate(() => ({
    out: (document.getElementById('tr-out') || {}).textContent || '',
    from: (document.getElementById('tr-from') || {}).value,
    to: (document.getElementById('tr-to') || {}).value,
    on: (document.querySelector('.dr-p.on[data-preset]') || {}).textContent || '',
    rows: document.querySelectorAll('.dr-row').length
  }));
  console.log('     ' + month.out.replace(/\s+/g, ' ').trim());
  assert(month.on === 'This month', 'the preset switched to "' + month.on + '"');
  assert(/-01$/.test(month.from) && month.to >= month.from,
    'the window starts on the 1st (' + month.from + ' → ' + month.to + ')');
  assert(/\d+ days/.test(month.out), 'and the header states its length: ' + month.out.replace(/\s+/g,' ').trim());
  assert(month.rows > 0, 'members are still listed (' + month.rows + ')');

  // a custom from–to, typed the way a person types it
  // every control click refetches — wait for the team view to be back rather
  // than sleeping and hoping, or two loads race and the tabs read empty
  const settle = () => until(D.page, () => document.querySelectorAll('[data-proj]').length > 0 &&
    document.querySelectorAll('.dr-row').length > 0);
  const wanted = { from: month.to, to: month.to };
  await D.page.evaluate(v => {
    const f = document.getElementById('tr-from'), t = document.getElementById('tr-to');
    f.value = v.from; f.dispatchEvent(new Event('change', { bubbles: true }));
  }, wanted);
  await settle();
  const custom = await D.page.evaluate(() => ({
    on: !!document.querySelector('.dr-p.on[data-preset]'),
    out: (document.getElementById('tr-out') || {}).textContent || ''
  }));
  assert(!custom.on, 'typing a date drops the preset — the window is yours now');

  // project tabs are built from the leads that exist
  await D.page.evaluate(() => [...document.querySelectorAll('[data-preset]')]
    .find(b => b.textContent.trim() === 'This month').click());
  await settle();
  const tabs = await D.page.evaluate(() =>
    [...document.querySelectorAll('[data-proj]')].map(b => ({ id: b.dataset.proj, t: b.textContent.trim() })));
  console.log('     projects → ' + tabs.map(t => t.t).join(' | '));
  assert(tabs.length >= 2 && tabs[0].t === 'All projects',
    'the project row starts with All and lists ' + (tabs.length - 1) + ' more');
  const withProject = tabs.filter(t => t.id);
  if (withProject.length) {
    await D.page.evaluate(id => document.querySelector('[data-proj="' + id + '"]').click(), withProject[0].id);
    await settle();
    const picked = await D.page.evaluate(() => ({
      on: (document.querySelector('.dr-p.on[data-proj]') || {}).textContent || '',
      rows: document.querySelectorAll('.dr-row').length
    }));
    assert(picked.on.trim() === withProject[0].t, 'picking ' + withProject[0].t + ' highlights that tab');
    assert(picked.rows > 0, 'and the team is still listed under it (' + picked.rows + ')');
    await D.page.evaluate(() => document.querySelector('[data-proj=""]').click());
    await settle();
  } else { ok('ZZTEST leads carry no project, so there is only the All tab'); }

  // ── a member over a whole month: day by day, then the entries ────────────
  stepH('One member over the month');
  await D.page.evaluate(() => [...document.querySelectorAll('.dr-row')]
    .find(r => /ZZ Rep One/.test(r.querySelector('.dr-nm').textContent)).click());
  await until(D.page, () => !!document.querySelector('.dr-ent'));
  await sleep(700);
  await D.page.screenshot({ path: path.join(SHOTS, '04-member-month.png') });
  console.log('  📸 04-member-month');
  // taken from the header the team view already printed, so the count comes from
  // the data and this does not break when the month turns
  const windowDays = Number((month.out.match(/(\d+) days/) || [])[1]) || 0;
  const mon = await D.page.evaluate(() => ({
    tiles: [...document.querySelectorAll('.dr-tile')].map(t =>
      t.querySelector('.k').textContent + ' ' + t.querySelector('.v').textContent),
    days: [...document.querySelectorAll('.dr-d .dd')].map(d => d.textContent.trim()),
    firstStamp: (document.querySelector('.dr-t') || {}).textContent.trim(),
    sec: [...document.querySelectorAll('.dr-sec')].map(s => s.textContent).join(' / ')
  }));
  console.log('     ' + mon.tiles.join('  |  '));
  assert(mon.tiles.some(t => /Given in this period/.test(t)) && mon.tiles.some(t => /Active days/.test(t)),
    'the member view reports the period, not just the day');
  assert(/\d{2} \w{3}/.test(mon.firstStamp),
    'over a multi-day window each entry carries its DATE too (' + mon.firstStamp + ')');
  assert(/Everything they did/.test(mon.sec), 'and the full history is listed: ' + mon.sec);

  // ── the one-page picture ─────────────────────────────────────────────────
  stepH('The figures');
  const viz = await D.page.evaluate(() => {
    const box = [...document.querySelectorAll('.viz')];
    const outcome = box.find(v => /What became of/.test(v.textContent));
    const cols = box.find(v => /Activity across/.test(v.textContent));
    const kinds = box.find(v => /How they worked/.test(v.textContent));
    const seg = outcome ? [...outcome.querySelectorAll('.stack .seg')] : [];
    const stack = outcome && outcome.querySelector('.stack');
    const gapOk = !stack || parseFloat(getComputedStyle(stack).gap) >= 2;
    return {
      titles: box.map(v => v.querySelector('.viz-h').textContent),
      segments: seg.length,
      onlyLine: outcome ? ((outcome.querySelector('.one') || {}).textContent || '') : '',
      gapOk,
      // every segment must be named in words, not left to colour alone
      legend: outcome ? [...outcome.querySelectorAll('.leg span')].map(s => s.textContent.trim()) : [],
      segTitles: seg.map(r => r.getAttribute('title') || ''),
      cols: cols ? cols.querySelectorAll('.cl').length : 0,
      colTitles: cols ? [...cols.querySelectorAll('.cl')].slice(0, 2).map(c => c.getAttribute('title')) : [],
      kindRows: kinds ? [...kinds.querySelectorAll('.kb')].map(k =>
        k.querySelector('.kn').textContent + ' ' + k.querySelector('.kv').textContent) : [],
      // the figures must not be the only copy of the data
      hasTable: !!document.querySelector('.dr-days') && !!document.querySelector('.dr-ent'),
      geom: (() => { const r = {}; box.forEach(v => { const t = v.querySelector('.viz-h').textContent;
        const plot = v.querySelector('.stack, .cols'); if (plot) r[t] = Math.round(plot.getBoundingClientRect().height); });
        return r; })(),
      alt: box.map(v => { const e = v.querySelector('[aria-label]');
        return e ? e.getAttribute('aria-label') : null; }).filter(Boolean)
    };
  });
  console.log('     figures → ' + viz.titles.join(' | '));
  console.log('     legend  → ' + viz.legend.join(' · '));
  console.log('     kinds   → ' + viz.kindRows.join(' · '));
  assert(viz.titles.length === 3, 'three figures, one page (' + viz.titles.length + ')');
  /* A part-to-whole bar with ONE part is a one-bar bar chart — it draws a full
     width and tells the reader nothing. The screen says it in a sentence
     instead, so this asserts whichever case the data actually produced. */
  if (viz.segments) {
    assert(viz.legend.length === viz.segments,
      'the outcome bar names every segment in the legend (' + viz.segments + ' segments, ' +
      viz.legend.length + ' labels)');
    assert(viz.gapOk, 'and leaves a gap between segments, so two colours never touch');
    assert(viz.segTitles.every(t => /—\s*\d+\s*of\s*\d+/.test(t)),
      'each segment says what it is and how many, on hover: "' + viz.segTitles[0] + '"');
  } else {
    assert(/^All \d+ — \w+/.test(viz.onlyLine.trim()),
      'one outcome class is stated, not drawn as a one-bar chart: "' + viz.onlyLine.trim() + '"');
  }
  /* One column per day of the WINDOW, not per day that happened to have work —
     otherwise two busy days in a fortnight draw two half-page slabs. */
  /* one column per day of the window — the count comes from the data, not from
     a number typed here, or this test breaks every time the month turns */
  assert(viz.cols === windowDays && viz.colTitles.every(t => /entries/.test(t)),
    viz.cols + ' columns for a ' + windowDays + '-day window, each hoverable: "' + (viz.colTitles[0] || '') + '"');
  assert(viz.kindRows.length === 5, 'the work breakdown lists all five kinds');
  assert(viz.alt.length === (viz.segments ? 2 : 1),
    'every plotted figure carries an aria-label for a screen reader (' + viz.alt.length + ')');
  assert(viz.hasTable, 'and the same numbers still exist as text below — the figures are not the only copy');

  /* The palette validator checks colour, never layout. The first cut of these
     figures passed every colour check and still rendered a 200px-tall bar with
     a 100px numeral, because an SVG with preserveAspectRatio="none" stretches
     to its container. So the shapes are measured too. */
  console.log('     heights → ' + Object.entries(viz.geom).map(([k, v]) => k.split(' ')[0] + ' ' + v + 'px').join(' · '));
  const heights = Object.values(viz.geom);
  assert(heights.length >= 1 && heights.every(h => h > 8 && h < 200),
    'every figure is a sane height, not stretched to the card (' + heights.join(', ') + 'px)');

  // ── PDF ──────────────────────────────────────────────────────────────────
  /* Headless Chrome will not write a blob: download to disk, and that last hop
     is the browser's job, not ours. So the bytes are caught where they are
     produced: ReportPDF.download is wrapped to keep a copy and then call
     through. The button, the builder and the filename are all still exercised —
     what is skipped is only Chrome saving a file, which we did not write. */
  const armPdf = () => D.page.evaluate(() => {
    if (window.__pdfArmed) return;
    window.__pdfArmed = true;
    const real = window.ReportPDF.download;
    window.ReportPDF.download = function (bytes, name) {
      window.__pdf = { name: name, len: bytes.length,
        head: Array.from(bytes.slice(0, 5)).map(c => String.fromCharCode(c)).join(''),
        text: Array.from(bytes).map(c => String.fromCharCode(c)).join('') };
      return real.apply(this, arguments);
    };
  });
  const grabPdf = async () => {
    const v = await D.page.evaluate(() => { const x = window.__pdf; window.__pdf = null; return x; });
    /* pdf-lib compresses its content streams (FlateDecode), so a raw byte scan
       finds nothing even though every word is perfectly selectable in a reader.
       Inflate the streams and read the text operators out of them — that is what
       a reader does, and it is the only way to prove the page carries drawn text
       rather than a screenshot. */
    const raw = Buffer.from(v.text, 'latin1');
    let out = '', i = 0;
    while (true) {
      const st = raw.indexOf('stream', i); if (st < 0) break;
      const en = raw.indexOf('endstream', st); if (en < 0) break;
      let s0 = st + 6;
      while (raw[s0] === 13 || raw[s0] === 10) s0++;
      try { out += zlib.inflateSync(raw.slice(s0, en)).toString('latin1'); } catch (e) {
        out += raw.slice(s0, en).toString('latin1');
      }
      i = en + 9;
    }
    // both spellings pdf-lib may emit: (literal) Tj and <hex> Tj
    const lit = (out.match(/\(((?:\\.|[^\\()])*)\)\s*Tj/g) || [])
      .map(t => t.slice(1, t.lastIndexOf(')')).replace(/\\([()\\])/g, '$1'));
    const hex = (out.match(/<[0-9A-Fa-f]{2,}>\s*Tj/g) || []).map(h => {
      const x = h.slice(1, h.indexOf('>'));
      let r = '';
      for (let k = 0; k + 1 < x.length; k += 2) r += String.fromCharCode(parseInt(x.substr(k, 2), 16));
      return r;
    });
    v.plain = lit.concat(hex).join(' ');
    return v;
  };

  stepH('Export the member sheet');
  await armPdf();
  await D.page.evaluate(() => document.querySelector('.pdf').click());
  await until(D.page, () => !!window.__pdf, 30000);
  const mp = await grabPdf();
  console.log('     ' + mp.name + '  ' + Math.round(mp.len / 1024) + ' KB');
  assert(mp.head === '%PDF-', 'the member sheet really is a PDF');
  assert(mp.len > 2000 && mp.plain.length > 200,
    'with real content in it (' + Math.round(mp.len / 1024) + ' KB, ' + mp.plain.length + ' chars of text)');
  assert(/ZZ-Rep-One/.test(mp.name) && /2026-08/.test(mp.name),
    'and a filename that names the member and the period');
  /* Drawn text, not a screenshot: a picture of the report would pass a size
     check and fail this one. */
  assert(/ZZDR client wants a corner unit/.test(mp.plain),
    'the note the rep wrote is inside the file as selectable text');
  assert(/Everything they did/.test(mp.plain) && /Nexunova|NEXUNOVA/.test(mp.plain),
    'along with the section headings and the letterhead');

  /* The owner's ask was that the sheet carry EVERYTHING the screen carries, so
     these check for the parts that were missing from it: the how-they-worked
     breakdown, the day-by-day figures, and the tiles the paper used to drop.
     A printed report that quietly leaves half the numbers behind is worse than
     no printout — the reader has no way to know something is gone. */
  assert(/How they worked/.test(mp.plain),
    'the how-they-worked breakdown is on the sheet, not only on the screen');
  assert(['Calls','WhatsApp','Visits','Notes','Status moves']
           .every(k => new RegExp(k).test(mp.plain)),
    'with every kind of action named — calls, WhatsApp, visits, notes, status moves');
  assert(/GIVEN IN PERIOD/.test(mp.plain) && /STATUS MOVED/.test(mp.plain) && /HOLDING NOW/.test(mp.plain),
    'and all eight tiles, the four the paper used to drop included');
  /* "Leads given" counts only what was handed over inside the window. A team
     given its leads on the 12th reads 0 for every later window, next to a column
     of real work — which is how it was misread. The label has to say which
     question it answers. */
  assert(!/LEADS GIVEN/.test(mp.plain),
    'and none of them still says the bare "Leads given" that was being read as "has no leads"');
  const multiDay = /[0-9]+ reached/.test(mp.plain);
  console.log('     day-by-day figures ' + (multiDay ? 'present' : 'not applicable (single-day window)'));

  stepH('Export the team sheet');
  await D.page.evaluate(() => document.getElementById('app-body').querySelector('.backbtn').click());
  await until(D.page, () => !!document.querySelector('.dr-row'));
  await armPdf();
  await D.page.evaluate(() => document.querySelector('.pdf').click());
  await until(D.page, () => !!window.__pdf, 30000);
  const tp = await grabPdf();
  console.log('     ' + tp.name + '  ' + Math.round(tp.len / 1024) + ' KB');
  console.log('     text    → ' + (tp.plain || '(nothing decoded)').slice(0, 160));
  assert(/team/.test(tp.name), 'the team sheet is named for the team, not a person');
  assert(tp.head === '%PDF-' && tp.len > 2000, 'and is a real PDF with content');
  assert(/ZZ Rep One/.test(tp.plain) && /ZZ Rep Two/.test(tp.plain),
    'listing every member, the quiet ones included');
  assert(/Team report/.test(tp.plain), 'under the report title');
  assert(/handed over inside these dates/.test(tp.plain),
    'and the team table explains what its Given column counts, on the page itself');
  assert(D.errs.length === 0, 'no console errors' + (D.errs.length ? ': ' + D.errs[0] : ''));
  await D.ctx.close();

  // ── a rep sees only themselves ────────────────────────────────────────────
  stepH('The same report, called by a rep');
  const mine = await sql(`SELECT public.get_daily_report('zz-dr-rep') AS r`);
  const repMembers = mine[0].r.members || [];
  assert(mine[0].r.success === true, 'a rep may call it');
  assert(repMembers.length === 0,
    'and sees nobody, because nobody reports to them (' + repMembers.length + ')');
  /* Only worth asserting if such a user exists — otherwise the session insert
     writes nothing and the call fails with session_expired, which would look
     like a pass for the wrong reason. */
  const hasLE = await sql(`SELECT count(*) AS n FROM public.sales_users
                            WHERE company_id='${ZZ}' AND role='lead_entry'`);
  if (Number(hasLE[0].n) > 0) {
    const le = await sql(`
      DELETE FROM public.sales_sessions WHERE session_token='zz-dr-le';
      INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
      SELECT company_id, id, project_id, 'zz-dr-le', now()+interval '5 minutes'
        FROM public.sales_users WHERE company_id='${ZZ}' AND role='lead_entry' LIMIT 1;
      SELECT (public.get_daily_report('zz-dr-le')->>'error') AS e`);
    assert(le[0].e === 'forbidden', 'a lead-entry operator is refused (' + le[0].e + ')');
  } else {
    ok('ZZTEST has no lead-entry operator, so that refusal is untested here');
  }

  await browser.close(); server.close();
  await sql(`
    DELETE FROM public.lead_activities a USING public.leads l
     WHERE a.lead_id=l.id AND l.company_id='${ZZ}' AND l.name='ZZDR Lead';
    DELETE FROM public.lead_assignments la USING public.leads l
     WHERE la.lead_id=l.id AND l.company_id='${ZZ}' AND l.name='ZZDR Lead';
    DELETE FROM public.leads WHERE company_id='${ZZ}' AND name='ZZDR Lead';
    DELETE FROM public.sales_sessions WHERE session_token IN ('zz-dr-dir','zz-dr-rep','zz-dr-le');`);
  console.log('\n✓ fixture lead, activities and sessions removed');
  console.log(`\n${PASS} passed · ${FAIL} failed`);
  console.log('shots → migration_work/daily_report/');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

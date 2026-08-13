/**
 * Phase 2 — forced follow-up: REAL-BROWSER VERIFICATION
 *
 * Drives the seven rules Rashid signed off, in a real Chrome, against the ZZTEST
 * tenant only. Each rule is asserted AND screenshotted, so "it works" is a picture
 * and an assertion, not a claim.
 *
 *   node scripts/verify-phase2-followup.js
 *
 * Sessions are minted straight in the DB and deleted at the end. The ZZTEST lead
 * fixtures are rebuilt at the start of every run, so the outcome never depends on
 * what a previous run left behind.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4191;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'phase2_shots');
const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';           // ZZTEST — safe to wipe
const T_REP = 'zzp2_rep_' + Math.random().toString(36).slice(2, 10);
const T_DIR = 'zzp2_dir_' + Math.random().toString(36).slice(2, 10);

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  \u2705 ' + m); };
const bad = m => { FAIL++; console.log('  \u274C ' + m); };
const step = m => console.log('\n\u2500\u2500 ' + m);
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const ref = (mcp.mcpServers.supabase.args.find(a => a.startsWith('--project-ref=')) || '').split('=')[1];
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: 'api.supabase.com', path: `/v1/projects/${ref}/database/query`, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d = ''; r.on('data', c => (d += c)); r.on('end', () => (r.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d.slice(0, 400))))); });
    req.on('error', rej); req.write(body); req.end();
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
               '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
  });
}
async function until(page, fn, arg, ms = 15000) {
  try { await page.waitForFunction(fn, { timeout: ms, polling: 120 }, arg); return true; } catch (e) { return false; }
}
let shotN = 0;
async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, String(++shotN).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot({ path: f });
  console.log('     \u{1F4F7} ' + path.basename(f));
}
async function dismissOverlays(page) {
  for (let i = 0; i < 4; i++) {
    // The first-run gates ("Add your email", "Turn on live location") are not all
    // <button>s — the email gate's escape hatch is a plain div. Matching only
    // buttons left the whole app behind a white card, which is how an earlier run
    // "passed" four rules against a page nobody could see.
    const acted = await page.evaluate(() => {
      const L = ['not now', 'skip for now', 'skip', 'got it', 'dismiss', 'later', 'maybe later'];
      let did = false;
      document.querySelectorAll('button,.btn,.icon-btn,a,div,span').forEach(b => {
        if (b.children.length) return;                       // leaf nodes only
        const t = (b.textContent || '').trim().toLowerCase();
        if (L.includes(t)) { b.click(); did = true; }
      });
      const x = document.querySelector('.nx-perm .icon-btn, .locbar .icon-btn');
      if (x) { x.click(); did = true; }
      return did;
    });
    if (!acted) break;
    await sleep(350);
  }
}

(async () => {
  // ── deterministic fixtures ────────────────────────────────────────────────
  step('Rebuilding ZZTEST fixtures');
  await sql(`
    DELETE FROM public.lead_followup_events WHERE company_id='${CO}';
    DELETE FROM public.leads WHERE company_id='${CO}' AND name LIKE 'ZZ %';
    UPDATE public.sales_users SET overdue_lead_count=0, assign_blocked_since=NULL,
           email=COALESCE(email, lower(replace(full_name,' ','.'))||'@zztest.local'),
           email_verified=true, email_verified_at=now()
     WHERE company_id='${CO}';
    UPDATE public.company_followup_policy SET is_enabled=true WHERE company_id='${CO}';
    INSERT INTO public.leads (company_id, project_id, owner_sales_user_id, name, phone, source, status, next_follow_up_at)
    SELECT '${CO}', su.project_id, su.id, v.nm, v.ph, 'walk_in', v.st, (public._fu_today() + v.off)::timestamptz
      FROM public.sales_users su
      JOIN (VALUES ('ZZ Lead A Healthy','03001110001','new',2),
                   ('ZZ Lead B Overdue','03001110002','contacted',-2),
                   ('ZZ Lead C Overdue','03001110003','contacted',-3),
                   ('ZZ Lead D Overdue','03001110004','new',-4)) AS v(nm,ph,st,off) ON true
     WHERE su.company_id='${CO}' AND su.full_name='ZZ Rep One';
    INSERT INTO public.leads (company_id, project_id, owner_sales_user_id, name, phone, source, status)
    SELECT '${CO}', su.project_id, su.id, 'ZZ Lead F Pool', '03001110006', 'walk_in', 'new'
      FROM public.sales_users su WHERE su.company_id='${CO}' AND su.full_name='ZZ Director';
    SELECT public.cron_followup_sweep();`);
  const state = await sql(`SELECT full_name, overdue_lead_count, (assign_blocked_since IS NOT NULL) AS blocked
                             FROM public.sales_users WHERE company_id='${CO}' ORDER BY full_name`);
  console.log('     ' + JSON.stringify(state));
  assert(state.some(r => r.full_name === 'ZZ Rep One' && r.overdue_lead_count === 3 && r.blocked),
         'sweep put ZZ Rep One on 3 overdue and blocked');

  await sql(`DELETE FROM public.sales_sessions WHERE session_token IN ('${T_REP}','${T_DIR}');
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, '${T_REP}', now()+interval '1 hour' FROM public.sales_users WHERE company_id='${CO}' AND full_name='ZZ Rep One';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, '${T_DIR}', now()+interval '1 hour' FROM public.sales_users WHERE company_id='${CO}' AND full_name='ZZ Director';`);

  const server = await serve();
  const exe = BROWSERS.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!exe) { console.error('No Chrome/Edge found'); process.exit(1); }
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });

  async function openPortal(token) {
    const page = await browser.newPage();
    await page.setViewport({ width: 420, height: 880, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t); localStorage.setItem('rms.sales.active', String(Date.now())); }, token);
    await page.reload({ waitUntil: 'networkidle2' });
    // Wait for the boot render to LAND before driving. A real user taps after the
    // app has painted; the driver is faster, and a setTab() fired mid-boot gets
    // overwritten when Home's async render finally resolves — which is exactly
    // what made the lock-chip assertion flake one run in three.
    await until(page, () => {
      const b = document.getElementById('app-body');
      return !!b && b.children.length > 0 && !b.querySelector('.skel, .skeleton');
    }, null, 20000);
    await sleep(900);
    await dismissOverlays(page);
    return { page, errs };
  }

  // ══ MEMBER ════════════════════════════════════════════════════════════════
  step('RULE 1 — opening a lead forces status + comment + date');
  const { page, errs } = await openPortal(T_REP);
  await page.evaluate(() => { setTab('leads'); });
  const listUp = await until(page, () => document.querySelectorAll('.lead-row').length > 0);
  assert(listUp, 'leads list actually rendered (no first-run gate in the way)');
  await sleep(700);
  await dismissOverlays(page);
  await shot(page, 'member-leads-list');

  // wait for the chips instead of counting the instant the rows appear — the row
  // list and its right-hand rail settle a beat apart, which made this flake.
  await until(page, () => document.querySelectorAll('.lead-lock').length >= 3, null, 8000);
  const lockChips = await page.evaluate(() => document.querySelectorAll('.lead-lock').length);
  assert(lockChips >= 3, `RULE 5 — locked chips visible in the list (found ${lockChips})`);

  const healthyId = (await sql(`SELECT id FROM public.leads WHERE company_id='${CO}' AND name='ZZ Lead A Healthy'`))[0].id;
  await page.evaluate(id => openLead(id), healthyId);
  await until(page, () => !!document.querySelector('.fu-ov'));
  await sleep(600);
  const sheet = await page.evaluate(() => {
    const o = document.querySelector('.fu-ov'); if (!o) return null;
    return { title: (o.querySelector('h3') || {}).textContent || '',
             stages: o.querySelectorAll('.fu-chips')[0].children.length,
             hasDate: !!o.querySelector('#fu-date'),
             hasNote: !!o.querySelector('#fu-note'),
             escapable: /Cancel/i.test(o.textContent) };
  });
  assert(sheet && /Before you move on/i.test(sheet.title), 'RULE 1 — forced sheet opened on lead open');
  assert(sheet && sheet.stages === 6 && sheet.hasNote && sheet.hasDate, 'RULE 1 — status, comment and date all present');
  assert(sheet && sheet.escapable === false, 'RULE 1 — no cancel: the member cannot walk away');
  await shot(page, 'forced-disposition-sheet');

  step('RULE 2 — the sheet refuses an empty or lazy update');
  await page.evaluate(() => { document.querySelector('#fu-note').value = 'ok'; });
  await page.evaluate(() => document.querySelector('.fu-sheet .btn-primary').click());
  await sleep(500);
  const err1 = await page.evaluate(() => (document.querySelector('#fu-err') || {}).textContent || '');
  assert(/few words/i.test(err1), 'RULE 2 — short comment rejected: "' + err1 + '"');
  await shot(page, 'validation-comment-too-short');

  step('RULE 3 — a real update saves and clears the obligation');
  await page.evaluate(() => {
    document.querySelector('#fu-note').value = 'Spoke to him, wants a site visit on the weekend.';
  });
  await page.evaluate(() => {
    const chips = document.querySelectorAll('.fu-chips')[0].children;
    for (const c of chips) if (c.textContent.trim() === 'Visit') { c.click(); return; }
  });
  await sleep(400);
  await page.evaluate(() => { document.querySelector('#fu-note').value = 'Spoke to him, wants a site visit on the weekend.'; });
  await page.evaluate(() => document.querySelector('.fu-sheet .btn-primary').click());
  await until(page, () => !document.querySelector('.fu-ov'));
  await sleep(1200);
  await shot(page, 'disposition-saved');
  const after = await sql(`SELECT l.status, (SELECT d.stage FROM public.deals d WHERE d.lead_id=l.id) AS deal_stage,
                                  (l.last_disposition_at IS NOT NULL) AS dispositioned
                             FROM public.leads l WHERE l.company_id='${CO}' AND l.name='ZZ Lead A Healthy'`);
  assert(after[0] && after[0].dispositioned, 'RULE 3 — disposition recorded');
  assert(after[0] && after[0].deal_stage === 'visit' && after[0].status === 'visit',
         'RULE 3 — stage went through the deal (single source), lead mirrored');

  step('RULE 3b — once dispositioned today, the same lead does NOT ask again');
  await page.evaluate(() => closeLead());
  await sleep(900);
  await page.evaluate(id => openLead(id), healthyId);
  await sleep(2200);                                   // long enough that a sheet would have appeared
  const asksAgain = await page.evaluate(() => !!document.querySelector('.fu-ov'));
  assert(!asksAgain, 'RULE 3b — no second sheet on the same lead the same day');
  const detailAgrees = await page.evaluate(() => !!(LEAD_DETAIL && LEAD_DETAIL.lead && LEAD_DETAIL.lead.disposition_required));
  assert(!detailAgrees, 'RULE 3b — get_lead agrees with the gate (no split brain)');
  await shot(page, 'reopened-same-day-no-sheet');
  // …but a lead NOT yet dispositioned today still asks
  const otherId = (await sql(`SELECT id FROM public.leads WHERE company_id='${CO}' AND name='ZZ Lead D Overdue'`))[0].id;
  await page.evaluate(() => closeLead()); await sleep(700);
  await page.evaluate(id => openLead(id), otherId);
  const stillAsks = await until(page, () => !!document.querySelector('.fu-ov'), null, 6000);
  assert(stillAsks, 'RULE 3b — a lead not yet updated today STILL asks (accountability intact)');
  await page.evaluate(() => { const o = document.querySelector('.fu-ov'); if (o) o.remove(); });

  step('RULE 4 — a missed lead is locked and read-only');
  const lockedId = (await sql(`SELECT id FROM public.leads WHERE company_id='${CO}' AND name='ZZ Lead C Overdue'`))[0].id;
  await page.evaluate(id => openLead(id), lockedId);
  await sleep(1500);
  await page.evaluate(() => { const o = document.querySelector('.fu-ov'); if (o) o.remove(); });  // step past the forced sheet to inspect the page under it
  await sleep(400);
  const locked = await page.evaluate(() => ({
    banner: !!document.querySelector('.fu-lock'),
    text: (document.querySelector('.fu-lock') || {}).textContent || '',
    logCard: !!document.querySelector('.lglog'),
    fuDate: !!document.querySelector('#l360-fu'),
    stillVisible: !!document.querySelector('.l360-hero'),
    // no button may point at a field the lock removed
    deadReminder: [...document.querySelectorAll('button')].some(b => /add reminder|set date/i.test(b.textContent||'')),
    updateNow: [...document.querySelectorAll('button')].some(b => /update now/i.test(b.textContent||'')),
  }));
  assert(locked.banner && /Locked/i.test(locked.text), 'RULE 4 — red locked banner shown');
  assert(!locked.logCard && !locked.fuDate, 'RULE 4 — edit cards withdrawn (read-only)');
  assert(locked.stillVisible, 'RULE 4 — lead is NOT hidden, just read-only');
  assert(!locked.deadReminder, 'RULE 4 — no button left pointing at a removed field');
  assert(locked.updateNow, 'RULE 4 — the one way out ("Update now") is offered');
  await shot(page, 'locked-lead-readonly');
  assert(errs.length === 0, 'member screens threw no JS errors' + (errs.length ? ' — ' + errs.slice(0, 2).join(' | ') : ''));
  await page.close();

  // ══ DIRECTOR ══════════════════════════════════════════════════════════════
  step('RULE 6 — assigning to a blocked member is refused');
  const { page: dp, errs: derrs } = await openPortal(T_DIR);
  const poolId = (await sql(`SELECT id FROM public.leads WHERE company_id='${CO}' AND name='ZZ Lead F Pool'`))[0].id;
  const repId = (await sql(`SELECT id FROM public.sales_users WHERE company_id='${CO}' AND full_name='ZZ Rep One'`))[0].id;
  await dp.evaluate((lead, to) => { ASSIGN.ids = [lead]; _assignRun(to); }, poolId, repId);
  await until(dp, () => !!document.querySelector('.overlay .modal'));
  await sleep(700);
  const blk = await dp.evaluate(() => (document.querySelector('.overlay .modal') || {}).textContent || '');
  assert(/Cannot assign yet/i.test(blk) && /overdue/i.test(blk), 'RULE 6 — block modal explains why: ' + blk.slice(0, 90).replace(/\s+/g, ' '));
  await shot(dp, 'assign-blocked-modal');
  const stillOwned = await sql(`SELECT su.full_name FROM public.leads l JOIN public.sales_users su ON su.id=l.owner_sales_user_id
                                  WHERE l.company_id='${CO}' AND l.name='ZZ Lead F Pool'`);
  assert(stillOwned[0] && stillOwned[0].full_name === 'ZZ Director', 'RULE 6 — the lead did NOT move');

  step('RULE 7 — the director board flags the blocked member');
  await dp.evaluate(() => closeModal());
  await dp.evaluate(() => { setTab('home'); });   // the director's team board IS their home screen
  await until(dp, () => document.querySelectorAll('.tbd-c').length > 0);
  await sleep(1200);
  const board = await dp.evaluate(() => {
    const c = [...document.querySelectorAll('.tbd-c')].find(x => /Rep One/i.test(x.textContent));
    return c ? { flagged: c.classList.contains('blocked'), chips: c.textContent.replace(/\s+/g, ' ') } : null;
  });
  assert(board && board.flagged, 'RULE 7 — blocked member carries the red rail');
  assert(board && /blocked/i.test(board.chips), 'RULE 7 — "blocked" chip on the card: ' + (board ? board.chips.slice(0, 80) : ''));
  await shot(dp, 'director-board-red-flag');
  assert(derrs.length === 0, 'director screens threw no JS errors' + (derrs.length ? ' — ' + derrs.slice(0, 2).join(' | ') : ''));
  await dp.close();

  // ══ isolation ═════════════════════════════════════════════════════════════
  step('Live tenants untouched');
  const iso = await sql(`SELECT c.company_code, p.is_enabled,
      count(*) FILTER (WHERE l.overdue_since IS NOT NULL) AS marked,
      count(*) FILTER (WHERE l.followup_locked_at IS NOT NULL) AS locked
    FROM public.companies c JOIN public.company_followup_policy p ON p.company_id=c.id
    LEFT JOIN public.leads l ON l.company_id=c.id
    WHERE c.company_code <> 'zztestinternalsafeto' GROUP BY 1,2`);
  assert(iso.every(r => r.is_enabled === false && Number(r.marked) === 0 && Number(r.locked) === 0),
         'no non-ZZTEST tenant is enabled, marked or locked');

  await browser.close(); server.close();
  await sql(`DELETE FROM public.sales_sessions WHERE session_token IN ('${T_REP}','${T_DIR}')`);

  console.log(`\n${'═'.repeat(52)}\n  PASS ${PASS}   FAIL ${FAIL}\n  shots → migration_work/phase2_shots/\n${'═'.repeat(52)}`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(1); });

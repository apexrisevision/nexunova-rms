/**
 * A lead a member types in belongs to the company, not to the phone it landed on.
 *
 *   node scripts/verify-member-leads-to-director.js
 *
 * The rule this proves, in the director's words: "I ran the ads on a sales
 * person's number. He enters the WhatsApp lead, I pull it, I hand it out."
 *
 * Every branch of that is exercised, and the branches are the point:
 *
 *   1. switch ON  → a rep's manual entry lands with the DIRECTOR, not the rep.
 *   2. switch OFF → the same entry stays with the rep. Nothing changed for the
 *      companies that never asked for this.
 *   3. switch ON, NO director in the company → the lead stays with the member.
 *      A lead that cannot find a pool must not be dropped on the floor; this is
 *      the branch where one would go missing, so it gets its own throwaway
 *      tenant rather than an argument.
 *   4. the director's pool row NAMES whoever typed it in, and the member's own
 *      record says where it went — first waiting, then back with him after the
 *      director hands it over.
 *
 * The browser half is driven through the real portal in real Chrome and reached
 * by CLICKING THE SIDEBAR. Nothing here calls a render function directly: the
 * unit map once worked for six commits while being unreachable, because every
 * test called its renderer.
 *
 * ZZTEST only. Every row this creates is deleted at the end.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4231;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;

const ZZ  = 'a2915ce7-c01c-463b-ba50-b144b2240337';
const DIR = '3e5ec7c8-89c8-435f-8f52-141b87c4b5b0';   // ZZ Director
const REP = '965ed586-f40f-45cf-9d3d-465655c55c31';   // ZZ Rep One
const TMP_CO = '11111111-2222-3333-4444-555555555555'; // throwaway tenant, no director

let PASS = 0, FAIL = 0;
const ok   = m => { PASS++; console.log('  ✅ ' + m); };
const bad  = m => { FAIL++; console.log('  ❌ ' + m); };
const stepH = m => console.log('\n── ' + m);
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const ref = 'itqxljtfbrppntgyfush';   // RMS. Pinned: the MCP target flips.
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com', path: `/v1/projects/${ref}/database/query`, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d.slice(0, 400)))); });
    r.on('error', rej); r.write(body); r.end();
  });
}
const one = async q => (await sql(q))[0];

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

const CLEAN = `
  DELETE FROM public.lead_activities  a USING public.leads l WHERE a.lead_id=l.id AND l.name LIKE 'ZZMLD%';
  DELETE FROM public.lead_views       v USING public.leads l WHERE v.lead_id=l.id AND l.name LIKE 'ZZMLD%';
  DELETE FROM public.lead_assignments s USING public.leads l WHERE s.lead_id=l.id AND l.name LIKE 'ZZMLD%';
  DELETE FROM public.leads WHERE name LIKE 'ZZMLD%';
  DELETE FROM public.sales_sessions WHERE session_token IN ('zz-mld-dir','zz-mld-rep','zz-mld-lone');
  DELETE FROM public.sales_users        WHERE company_id='${TMP_CO}';
  DELETE FROM public.lead_intake_settings WHERE company_id='${TMP_CO}';
  DELETE FROM public.companies          WHERE id='${TMP_CO}';`;

(async () => {
  console.log('══ A member-entered lead belongs to the company ══');
  await sql(CLEAN);

  await sql(`
    INSERT INTO public.lead_intake_settings (company_id, member_leads_to_director)
    VALUES ('${ZZ}', true) ON CONFLICT (company_id) DO UPDATE SET member_leads_to_director=true;
    INSERT INTO public.sales_sessions (company_id, sales_user_id, session_token, expires_at) VALUES
      ('${ZZ}','${DIR}','zz-mld-dir', now()+interval '30 minutes'),
      ('${ZZ}','${REP}','zz-mld-rep', now()+interval '30 minutes');
    -- Phase 2 refuses to hand a lead to anyone carrying overdue follow-ups, and
    -- the scratch tenant has a backlog of them from other tests. That gate has
    -- its own harness; clear the backlog so THIS test measures the pool.
    UPDATE public.leads SET next_follow_up_at=NULL
     WHERE company_id='${ZZ}' AND next_follow_up_at < now();`);

  // ══ 1 · switch ON — the rep's entry goes to the director ═══════════════════
  stepH('The rep types in a WhatsApp lead');
  const c1 = await one(`SELECT public.create_lead('zz-mld-rep', jsonb_build_object(
      'name','ZZMLD Whatsapp Aunty','phone','03009990001','source','whatsapp')) AS r;`);
  assert(c1.r.success === true, 'the lead saves');
  assert(c1.r.pooled === true, 'the server says it was pooled — the portal needs this to explain where it went');

  const l1 = await one(`SELECT l.owner_sales_user_id::text o, l.created_by_sales_user_id::text c, ow.role orole
      FROM public.leads l JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
     WHERE l.name='ZZMLD Whatsapp Aunty';`);
  assert(l1.o === DIR,   'it is held by the DIRECTOR, not by the rep who typed it');
  assert(l1.c === REP,   'the rep is still recorded as the one who entered it');
  assert(l1.orole === 'director', 'its holder is a director — which is what puts it in the distributable pool');

  // ══ 2 · switch OFF — nothing changed for anyone who did not ask ═══════════
  stepH('The same entry with the switch OFF');
  await sql(`UPDATE public.lead_intake_settings SET member_leads_to_director=false WHERE company_id='${ZZ}';`);
  const c2 = await one(`SELECT public.create_lead('zz-mld-rep', jsonb_build_object(
      'name','ZZMLD Stays With Me','phone','03009990002','source','walkin')) AS r;`);
  assert(c2.r.success === true && c2.r.pooled === false, 'it saves and is NOT reported as pooled');
  const l2 = await one(`SELECT owner_sales_user_id::text o FROM public.leads WHERE name='ZZMLD Stays With Me';`);
  assert(l2.o === REP, 'with the switch off the lead stays with the member — today\'s behaviour is untouched');
  await sql(`UPDATE public.lead_intake_settings SET member_leads_to_director=true WHERE company_id='${ZZ}';`);

  // ══ 3 · switch ON but nobody to pool it to — the lead must not vanish ═════
  stepH('A company with the switch on and no director at all');
  await sql(`
    INSERT INTO public.companies (id, company_name, company_code, status)
    VALUES ('${TMP_CO}','ZZMLD Lone Rep Co','zzmldlone','active');
    INSERT INTO public.sales_users (id, company_id, full_name, phone, role, status)
    VALUES ('${TMP_CO}','${TMP_CO}','ZZMLD Lone Rep','03009990009','sale_rep','active');
    INSERT INTO public.lead_intake_settings (company_id, member_leads_to_director) VALUES ('${TMP_CO}', true);
    INSERT INTO public.sales_sessions (company_id, sales_user_id, session_token, expires_at)
    VALUES ('${TMP_CO}','${TMP_CO}','zz-mld-lone', now()+interval '30 minutes');`);
  const c3 = await one(`SELECT public.create_lead('zz-mld-lone', jsonb_build_object(
      'name','ZZMLD Nowhere To Go','phone','03009990003','source','whatsapp')) AS r;`);
  assert(c3.r.success === true, 'the lead still saves when there is no director to pool it to');
  const l3 = await one(`SELECT owner_sales_user_id::text o FROM public.leads WHERE name='ZZMLD Nowhere To Go';`);
  assert(l3.o === TMP_CO, 'it stays with the member rather than being dropped — losing it would be the worse answer');

  // ══ 4 · the two screens read the right thing ══════════════════════════════
  stepH('What the director sees, and what the member sees');
  const pool = await one(`SELECT (SELECT x FROM jsonb_array_elements(public.list_my_leads('zz-mld-dir')->'leads') x
                                   WHERE x->>'name'='ZZMLD Whatsapp Aunty') AS row;`);
  assert(pool.row && pool.row.entered_by_name === 'ZZ Rep One',
    'the director\'s row names who entered it — the one fact he needs before deciding where it goes');
  assert(pool.row && pool.row.created_by_sales_user_id === REP,
    'and carries the id, so the assign sheet can offer that member first');
  assert(pool.row && pool.row.owner_role === 'director',
    'owner_role is director, so it counts in "To assign"');

  const mine1 = await one(`SELECT public.get_my_entered_leads('zz-mld-rep') AS r;`);
  const row1 = (mine1.r.rows || []).find(x => x.name === 'ZZMLD Whatsapp Aunty');
  assert(!!row1, 'the member still finds the lead under his own name');
  assert(row1 && row1.waiting === true && row1.with_me === false, 'and it reads as waiting to be handed out');
  assert(Number(mine1.r.waiting) >= 1, 'the waiting count is not zero');

  // ══ 5 · the director hands it back ════════════════════════════════════════
  stepH('The director hands it to the member who found it');
  const id1 = (await one(`SELECT id::text FROM public.leads WHERE name='ZZMLD Whatsapp Aunty';`)).id;
  const a1 = await one(`SELECT public.assign_lead('zz-mld-dir','${id1}','${REP}') AS r;`);
  assert(a1.r.success === true, 'assign_lead accepts it straight from the pool — no pull-back step');
  const mine2 = await one(`SELECT public.get_my_entered_leads('zz-mld-rep') AS r;`);
  const row2 = (mine2.r.rows || []).find(x => x.name === 'ZZMLD Whatsapp Aunty');
  assert(row2 && row2.with_me === true && row2.waiting === false,
    'the member\'s own screen now says it is back with him');

  // ══ 5b · handed on, and the member can no longer work it ═════════════════
  // The director's question: can he still see it? The answer must be "he sees
  // THAT he gave it, not the number to ring." The ad ran on his phone but the
  // company paid for it.
  stepH('A lead that went to somebody else');
  const c5 = await one(`SELECT public.create_lead('zz-mld-rep', jsonb_build_object(
      'name','ZZMLD Handed Away','phone','03211234567','source','whatsapp')) AS r;`);
  const id5 = c5.r.id;
  const seen = await one(`SELECT (SELECT x FROM jsonb_array_elements(public.get_my_entered_leads('zz-mld-rep')->'rows') x
                                   WHERE x->>'name'='ZZMLD Handed Away') AS row,
                                 public.get_lead('zz-mld-rep','${id5}')->>'error' AS detail_err,
                                 (SELECT count(*) FROM jsonb_array_elements(public.list_my_leads('zz-mld-rep')->'leads') y
                                   WHERE y->>'name'='ZZMLD Handed Away')::int AS in_list;`);
  assert(seen.row && seen.row.masked === true, 'his row is flagged masked');
  assert(seen.row && !/1234567/.test(String(seen.row.phone || '')),
    'the client\'s number is NOT in the payload — masking is server-side, not a CSS trick');
  assert(seen.row && /••/.test(String(seen.row.phone || '')),
    'what he gets is recognisable but not dialable (' + seen.row.phone + ')');
  assert(seen.row && seen.row.name === 'ZZMLD Handed Away',
    'the NAME stays — he must still be able to say "I gave you this one and nobody rang"');
  assert(seen.detail_err === 'not_found', 'he cannot open the lead detail at all — no call, no WhatsApp, no log');
  assert(seen.in_list === 0, 'and it is not in his Leads list');

  stepH('The same lead handed back to him');
  await sql(`SELECT public.assign_lead('zz-mld-dir','${id5}','${REP}');`);
  const back = await one(`SELECT (SELECT x FROM jsonb_array_elements(public.get_my_entered_leads('zz-mld-rep')->'rows') x
                                   WHERE x->>'name'='ZZMLD Handed Away') AS row,
                                 public.get_lead('zz-mld-rep','${id5}')->>'success' AS detail_ok;`);
  assert(back.row && back.row.masked === false && back.row.phone === '03211234567',
    'the number comes back the moment the lead is his to work again');
  assert(back.detail_ok === 'true', 'and the lead detail opens again');

  // ══ 6 · the real portal, reached by clicking the sidebar ══════════════════
  stepH('The screens themselves, in a real browser');
  // put a second one back in the pool so the director's screen has something in it
  await sql(`SELECT public.create_lead('zz-mld-rep', jsonb_build_object(
      'name','ZZMLD Second Aunty','phone','03009990004','source','whatsapp'));`);

  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!exe) { console.log('  ⚠ no Chrome found — skipping the browser half'); }
  else {
    const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
    async function portal(token) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1320, height: 980 });
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
        return !!b && b.children.length > 0 && !b.querySelector('.skel, .skeleton'); }); } catch (e) { await sleep(1500); }
      await page.evaluate(() => ['loc-bar','pwa-bar','push-bar']
        .forEach(id => { const e = document.getElementById(id); if (e) e.remove(); }));
      return { ctx, page, errs };
    }
    /* Open the group first, then click the item — the sidebar is an accordion,
       which is exactly what a person has to do. */
    const clickNav = async (page, label) => {
      const there = await page.evaluate(lb => {
        const a = [...document.querySelectorAll('.sb .ni')]
          .find(x => (x.querySelector('.ni-lb') || {}).textContent === lb);
        if (!a) return false;
        const grp = a.closest('.ni-grp'), btn = grp && grp.querySelector('[data-grp-btn]');
        if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
        return true;
      }, label);
      if (!there) return false;
      await sleep(350);
      const hit = await page.evaluate(lb => {
        const a = [...document.querySelectorAll('.sb .ni')]
          .find(x => (x.querySelector('.ni-lb') || {}).textContent === lb);
        if (!a) return false;
        const r = a.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return false;
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!(top && a.contains(top))) return false;
        a.click(); return true;
      }, label);
      if (hit) await sleep(1800);
      return hit;
    };

    // ── the member's screen ──
    const R = await portal('zz-mld-rep');
    const gotMine = await clickNav(R.page, 'Leads I entered');
    assert(gotMine, '"Leads I entered" is in the rep\'s sidebar and is actually clickable');
    if (gotMine) {
      const seen = await R.page.evaluate(() => document.getElementById('app-body').innerText);
      assert(/ZZMLD Whatsapp Aunty/.test(seen), 'the lead he typed in is listed on his own screen');
      assert(/With you/.test(seen),              'the one handed back to him reads "With you"');
      assert(/Waiting to be handed/.test(seen),  'the one still in the pool reads "Waiting to be handed"');
      assert(/••/.test(seen), 'the handed-on lead shows a masked number on the screen itself');
      assert(!/3211234567/.test(seen), 'and the real number is nowhere in the rendered page');
      assert(/company pays for the ads/i.test(seen), 'the screen says WHY the number is hidden — a member who is not told assumes he is being cheated');
    }
    assert(R.errs.length === 0, 'the rep\'s screen throws nothing' + (R.errs.length ? ' — ' + R.errs[0] : ''));

    // ── the director's screen ──
    const D = await portal('zz-mld-dir');
    const gotDist = await clickNav(D.page, 'Assign leads');
    assert(gotDist, '"Assign leads" is reachable from the director\'s sidebar');
    if (gotDist) {
      const pooled = await D.page.evaluate(() => document.getElementById('app-body').innerText);
      assert(/ZZMLD Second Aunty/.test(pooled), 'the member-entered lead is waiting in his pool');
      assert(/Entered by ZZ Rep One/.test(pooled), 'and the row says who entered it');
    }
    assert(D.errs.length === 0, 'the director\'s screen throws nothing' + (D.errs.length ? ' — ' + D.errs[0] : ''));
    await browser.close();
  }
  server.close();

  // ══ cleanup ══════════════════════════════════════════════════════════════
  await sql(CLEAN);
  const left = await one(`SELECT count(*)::int n FROM public.leads WHERE name LIKE 'ZZMLD%';`);
  assert(left.n === 0, 'every row this test created is gone');

  console.log(`\n══ ${PASS} passed · ${FAIL} failed ══`);
  process.exit(FAIL ? 1 : 0);
})().catch(async e => { console.error('\nFATAL', e.message); try { await sql(CLEAN); } catch (_) {} process.exit(1); });

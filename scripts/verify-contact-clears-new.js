/**
 * Calling someone takes the lead out of "new" — a note does not.
 *
 *   node scripts/verify-contact-clears-new.js
 *
 * The reps' complaint: they open a lead, call the person, send a WhatsApp, and
 * the lead still shows the "new" tag while the director still sees it as not
 * contacted. Opening was never the problem — mark_lead_seen records that fine.
 * The two writers that log a call simply never moved leads.status.
 *
 * The rule this guards, in both directions:
 *   · a contact channel moves new → contacted, exactly once, and says so in the
 *     history so the tag never changes silently
 *   · a NOTE does not, because writing to yourself is not reaching anybody
 *   · nothing already past new is touched, in either direction
 *
 * Every case runs through the real RPCs on ZZTEST fixtures, which are deleted at
 * the end. Nothing here writes to a live tenant.
 */
const fs = require('fs'), path = require('path'), https = require('https');
const ROOT = path.resolve(__dirname, '..');
const ZZ = 'a2915ce7-c01c-463b-ba50-b144b2240337';

let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  ✅ ' + m); };
const bad = m => { FAIL++; console.log('  ❌ ' + m); };
const stepH = m => console.log('\n── ' + m);
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };

function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const ref = (mcp.mcpServers.supabase.args.find(a => a.startsWith('--project-ref=')) || '').split('=')[1];
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com', path: `/v1/projects/${ref}/database/query`, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d.slice(0, 400)))); });
    r.on('error', rej); r.write(body); r.end();
  });
}

const clean = `
  DELETE FROM public.lead_activities a USING public.leads l
   WHERE a.lead_id=l.id AND l.company_id='${ZZ}' AND l.name LIKE 'ZZCT%';
  DELETE FROM public.leads WHERE company_id='${ZZ}' AND name LIKE 'ZZCT%';`;

// make one lead in a given starting status and hand back its id
async function mkLead(tag, status) {
  const r = await sql(`
    INSERT INTO public.leads (company_id, name, phone, status, owner_sales_user_id, is_test)
    SELECT '${ZZ}', 'ZZCT ${tag}', '03009990001', '${status}', id, true
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One'
    RETURNING id`);
  return r[0].id;
}
const statusOf = async id =>
  (await sql(`SELECT status FROM public.leads WHERE id='${id}'`))[0].status;
const stageNotes = async id =>
  (await sql(`SELECT count(*) AS n FROM public.lead_activities
               WHERE lead_id='${id}' AND kind='stage' AND body='Moved to contacted'`))[0].n;

(async () => {
  const co = await sql(`SELECT company_name FROM companies WHERE id='${ZZ}'`);
  assert(/ZZTEST/i.test(co[0].company_name), 'measuring on ' + co[0].company_name);

  await sql(`${clean}
    DELETE FROM public.sales_sessions WHERE session_token='zz-ct-rep';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-ct-rep', now()+interval '20 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One';`);

  // ══ a call clears "new" ═══════════════════════════════════════════════════
  stepH('A rep calls a brand-new lead');
  const a = await mkLead('call', 'new');
  const r1 = await sql(`SELECT public.log_lead_interaction('zz-ct-rep','${a}','call',NULL,'rang, will call back') AS r`);
  assert(r1[0].r.success === true, 'the call is logged');
  assert(await statusOf(a) === 'contacted', 'and the lead is no longer new — it reads contacted');
  assert(r1[0].r.moved_to_contacted === true, 'the response says so, so the screen can react');
  assert(Number(await stageNotes(a)) === 1,
    'and the move is written into the history, not applied silently');

  // a second call must not move it again, or double-log
  const r2 = await sql(`SELECT public.log_lead_interaction('zz-ct-rep','${a}','call') AS r`);
  assert(r2[0].r.moved_to_contacted === false,
    'a second call does not claim to have moved it again');
  assert(Number(await stageNotes(a)) === 1, 'and writes no second status entry');

  // ══ a WhatsApp does too, through the other writer ═════════════════════════
  stepH('The other writer, and the other channel');
  const b = await mkLead('wa', 'new');
  await sql(`SELECT public.add_lead_activity('zz-ct-rep','${b}','whatsapp','sent the plan') AS r`);
  assert(await statusOf(b) === 'contacted', 'add_lead_activity moves it too — both writers agree');

  const v = await mkLead('visit', 'new');
  await sql(`SELECT public.add_lead_activity('zz-ct-rep','${v}','visit') AS r`);
  assert(await statusOf(v) === 'contacted', 'a site visit counts as reaching them');

  // ══ a note does NOT ═══════════════════════════════════════════════════════
  stepH('A note is not a contact');
  const n = await mkLead('note', 'new');
  const rn = await sql(`SELECT public.add_lead_activity('zz-ct-rep','${n}','note','number is off, try later') AS r`);
  assert(rn[0].r.success === true, 'the note is saved');
  assert(await statusOf(n) === 'new',
    'and the lead is still new — writing to yourself is not reaching anybody');
  assert(Number(await stageNotes(n)) === 0, 'with no status entry invented for it');

  // ══ nothing already past new is touched ═══════════════════════════════════
  stepH('Leads further along are left alone');
  for (const st of ['contacted', 'visit', 'negotiation', 'won', 'lost']) {
    const id = await mkLead(st, st);
    const rr = await sql(`SELECT public.log_lead_interaction('zz-ct-rep','${id}','call') AS r`);
    const after = await statusOf(id);
    assert(after === st && rr[0].r.moved_to_contacted === false,
      'a call on a ' + st + ' lead leaves it at ' + after + ', and claims nothing');
  }

  // ══ how many live leads this would have caught ════════════════════════════
  stepH('What is sitting in the live data right now');
  const stuck = await sql(`
    SELECT count(*) AS n FROM public.leads l
     WHERE l.deleted_at IS NULL AND l.status='new'
       AND EXISTS (SELECT 1 FROM public.lead_activities a
                    WHERE a.lead_id=l.id AND public._lead_contact_channel(a.kind))`);
  const allNew = await sql(`SELECT count(*) AS n FROM public.leads WHERE deleted_at IS NULL AND status='new'`);
  console.log('     ' + stuck[0].n + ' of ' + allNew[0].n +
              ' leads still tagged new have already been called or messaged');
  ok('counted the leads the old behaviour left stranded (they are NOT changed here)');

  await sql(`${clean} DELETE FROM public.sales_sessions WHERE session_token='zz-ct-rep';`);
  console.log('\n✓ fixture leads and session removed');
  console.log(`\n${PASS} passed · ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

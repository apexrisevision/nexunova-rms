/**
 * A member nobody tagged to a project must never disappear.
 *
 *   node scripts/verify-untagged-staff-visible.js
 *
 * The bug this exists for: a newly added rep sat correctly under his director —
 * active, right company, parent set — and still did not show up, while everyone
 * added before him did. get_my_team had him all along; the PROJECT TAB dropped
 * him, because home_project_id was NULL.
 *
 * home_project_id was introduced (20260812c) as a display label, in its own
 * words "Does NOT scope anything". Three places later started filtering people
 * by it. A label became a gate, and whoever had no label fell through it. NULL
 * means "nobody has said", not "belongs to nowhere".
 *
 * So this checks the rule from both ends, on a throwaway ZZTEST member:
 *   · untagged  → visible on EVERY project tab, flagged untagged
 *   · tagged to project A → visible on A, hidden on B (that part was correct)
 * and it checks the same rule in the two portal screens that make the same
 * decision in JavaScript, by reading their source rather than trusting it.
 *
 * ZZTEST only. The fixture member is deleted at the end.
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
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d.slice(0, 300)))); });
    r.on('error', rej); r.write(body); r.end();
  });
}

(async () => {
  const co = await sql(`SELECT company_name FROM companies WHERE id='${ZZ}'`);
  assert(/ZZTEST/i.test(co[0].company_name), 'measuring on ' + co[0].company_name);

  // two ZZTEST projects to tab between
  const projs = await sql(`SELECT id, project_name FROM public.projects
                            WHERE company_id='${ZZ}' ORDER BY project_name LIMIT 2`);
  if (projs.length < 2) { console.log('need two ZZTEST projects'); process.exit(2); }
  const [A, B] = projs;

  await sql(`DELETE FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Untagged Rep';
    DELETE FROM public.sales_sessions WHERE session_token='zz-tag-dir';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-tag-dir', now()+interval '20 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Director';
    INSERT INTO public.sales_users (company_id, full_name, role, status, is_active,
                                    parent_sales_user_id, home_project_id, phone)
    SELECT '${ZZ}', 'ZZ Untagged Rep', 'sale_rep', 'active', true, id, NULL, '03000000099'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Director';`);

  const onTab = async pid => {
    const r = await sql(`SELECT public.get_director_board('zz-tag-dir', ${pid ? `'${pid}'` : 'NULL'}) AS b`);
    const ms = (r[0].b.members || []);
    const me = ms.find(m => /ZZ Untagged Rep/.test(m.name || ''));
    return { seen: !!me, untagged: me && me.untagged, belongs: me && me.belongs, total: ms.length };
  };

  // ══ untagged ══════════════════════════════════════════════════════════════
  stepH('A member with no project tag');
  const all0 = await onTab(null), a0 = await onTab(A.id), b0 = await onTab(B.id);
  assert(all0.seen, 'shows on the All tab');
  assert(a0.seen, 'shows on ' + A.project_name);
  assert(b0.seen, 'shows on ' + B.project_name + ' too — a tag that was never set hides nobody');
  assert(a0.untagged === true && b0.untagged === true,
    'and is flagged untagged, so the screen can ask for the tag');
  assert(a0.belongs === true, 'he is not counted as an outsider on a tab he was never excluded from');

  // ══ tagged ════════════════════════════════════════════════════════════════
  stepH('The same member, now tagged to ' + A.project_name);
  await sql(`UPDATE public.sales_users SET home_project_id='${A.id}'
              WHERE company_id='${ZZ}' AND full_name='ZZ Untagged Rep'`);
  const a1 = await onTab(A.id), b1 = await onTab(B.id);
  assert(a1.seen && a1.untagged === false, 'still on ' + A.project_name + ', no longer flagged');
  assert(!b1.seen, 'and now correctly absent from ' + B.project_name +
    ' — a real tag still filters, which is what keeps a tab useful');

  // ══ the same decision, made twice more in JavaScript ══════════════════════
  stepH('The two portal screens that repeat this decision');
  const src = fs.readFileSync(path.join(ROOT, 'sales-portal.html'), 'utf8');
  const filters = src.split('\n')
    .map((l, i) => ({ n: i + 1, l }))
    .filter(x => /\.filter\(\s*u\s*=>\s*u\.home_project_id\s*===/.test(x.l) ||
                 /\.some\(\s*u\s*=>\s*u\.home_project_id\s*===/.test(x.l));
  /* A COUNT of how many are tagged to a project is a legitimate use of the tag —
     it is a statistic, not a gate. Only the filters that decide who is PICKABLE
     have to let an untagged member through. */
  const unguarded = filters.filter(x =>
    !/\|\|\s*!u\.home_project_id/.test(x.l) && !/\.length\s*;?\s*$/.test(x.l.trim()));
  filters.forEach(x => console.log('     line ' + x.n + ': ' + x.l.trim().slice(0, 96)));
  assert(filters.length >= 2, 'found the ' + filters.length + ' places that filter staff by the tag');
  assert(unguarded.length === 0,
    'every one of them lets an untagged member through' +
    (unguarded.length ? ' — UNGUARDED at line(s) ' + unguarded.map(x => x.n).join(', ') : ''));

  // and a missing tag is shown, not swallowed
  assert(/No project<\/span>/.test(src), 'a missing tag is shown as "No project", not left blank');

  await sql(`DELETE FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Untagged Rep';
             DELETE FROM public.sales_sessions WHERE session_token='zz-tag-dir';`);
  console.log('\n✓ fixture member removed');
  console.log(`\n${PASS} passed · ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

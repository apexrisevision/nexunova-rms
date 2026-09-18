/**
 * Applies 20260918e (the _nf_seed_company follow-up fix) on its own —
 * 20260918a-d are already live and not idempotent (CREATE TABLE would fail
 * on a re-run), so this is a separate, standalone apply, same discipline:
 * committed-to-HEAD check, outside-nf_ detector, search_path check, write
 * guard.
 *
 *   node scripts/nf/apply-phase-de-followup.js                  dry run
 *   node scripts/nf/apply-phase-de-followup.js --apply --owner-ok
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { GUARD_BLOCK } = require('./write-guard');

const ROOT = path.resolve(__dirname, '..', '..');
const FILE = process.argv.find(a => /^supabase\/migrations\/.*\.sql$/.test(a)) || 'supabase/migrations/20260918e_nf_de_seed_requires_party.sql';
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

function targetsOutsideNf(sql) {
  let bare = sql.replace(/--[^\n]*/g, '').replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, '$$');
  const bad = [];
  const judge = (kind, obj) => {
    const o = obj.replace(/"/g, '').replace(/^public\./, '').replace(/^pg_temp\./, 'pg_temp:');
    if (!/^_?nf_/.test(o)) bad.push(`${kind} ${o}`);
  };
  const re = /\b(CREATE(?:\s+OR\s+REPLACE)?\s+(?:TABLE|FUNCTION|VIEW)|ALTER\s+TABLE|DROP\s+(?:TABLE|FUNCTION|VIEW|TRIGGER|INDEX|POLICY)|INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([\w."]+)/gi;
  let m;
  while ((m = re.exec(bare))) judge(m[1].replace(/\s+/g, ' ').toUpperCase(), m[2]);
  return bad;
}

(async () => {
  const real = process.argv.includes('--apply');
  if (real && !process.argv.includes('--owner-ok')) {
    console.log('REFUSED — --apply needs --owner-ok.');
    process.exitCode = 1; return;
  }
  console.log(`[apply-phase-de-followup] mode: ${real ? 'APPLY' : 'DRY RUN'}\n`);

  const abs = path.join(ROOT, FILE);
  if (!fs.existsSync(abs)) { console.log(`✗ ${FILE} — missing`); process.exitCode = 1; return; }
  const disk = fs.readFileSync(abs);
  let committed;
  try { committed = execFileSync('git', ['show', `HEAD:${FILE}`], { cwd: ROOT, maxBuffer: 1 << 26 }); }
  catch { console.log(`✗ ${FILE} — not in HEAD`); process.exitCode = 1; return; }
  const same = sha(disk) === sha(committed);
  const sql = disk.toString('utf8');
  const outside = targetsOutsideNf(sql);
  console.log(`${FILE}: ${disk.length} bytes · ${same ? 'identical to HEAD' : '✗ DIFFERS FROM HEAD'}`);
  console.log(`statements on objects outside nf_: ${outside.length ? '✗ ' + outside.join('; ') : 'none'}`);
  const spOk = /SET\s+search_path\s+TO\s+public/i.test(sql);
  console.log(`search_path pinned: ${spOk ? 'yes' : '✗ NO'}`);

  if (!same || outside.length || !spOk) { console.log('\nREFUSED — see ✗ above.'); process.exitCode = 1; return; }

  const stripped = sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '');
  const batch = ['BEGIN;', stripped, GUARD_BLOCK, 'COMMIT;'].join('\n');

  if (!real) { console.log('\nDRY RUN OK — this file would run alone, in one transaction. Nothing was sent.'); return; }

  const { q } = require('../_sbq');
  const t0 = Date.now();
  try { await q(batch, 1); }
  catch (e) { console.log(`✗ FAILED after ${Date.now() - t0} ms: ${e.message}\nNOTHING APPLIED.`); process.exitCode = 1; return; }
  console.log(`\nAPPLIED in ${Date.now() - t0} ms — write guard passed.`);
})();

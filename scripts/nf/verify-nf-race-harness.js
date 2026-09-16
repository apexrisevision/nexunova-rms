/**
 * NexuFinance v1 — does the race instrument actually see a race? (SR-2)
 *
 *   node scripts/nf/verify-nf-race-harness.js > "$SCRATCH/nf-race-harness.log" 2>&1
 *
 * The race test in verify-nf-rules.js claims "side 2 was blocked by side 1".
 * If that detection were broken it would report a clean result for two calls
 * that never overlapped, and R1/R2 under concurrency would be untested while
 * looking tested. So the detector is exercised on its own, both ways:
 *
 *   OVERLAP     two connections contend for the same transaction advisory lock,
 *               side 1 holding for 4 s  → blocked must be TRUE
 *   NO OVERLAP  the same pair, side 1 holding 1 s and side 2 starting after
 *               2.5 s                   → blocked must be FALSE
 *
 * Touches no table and no tenant: pg_advisory_xact_lock only, on a key derived
 * from a random run id. Safe to run before the migrations are applied, which is
 * the point — it checks the instrument, not the rules.
 *
 * Exit (via process.exitCode): 0 the detector works · 1 it does not · 2 could not run.
 */
'use strict';

const crypto = require('crypto');
const { race } = require('./verify-nf-rules');

const advisorySides = key => (tag, n, hold) => `/* ${tag}-${n} */
BEGIN;
SELECT pg_advisory_xact_lock(${key});
${hold ? `SELECT pg_sleep(${hold / 1000});` : ''}
COMMIT;`;

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  const key = BigInt.asIntN(63, BigInt('0x' + crypto.randomBytes(6).toString('hex'))).toString();
  console.log(`[verify-nf-race-harness] run ${run} · advisory key ${key} · no table is touched`);

  const results = [];
  const show = (name, x) => console.log(`  ${name}: side1 HTTP ${x.r1.status} in ${x.r1.ms} ms · side2 HTTP ${x.r2.status} in ${x.r2.ms} ms · ` +
    `pid1 ${x.pid1} · blocked-by-side-1 ${x.blockedBy1} · ${x.samples} samples`);

  try {
    const overlap = await race({ tag: `nf-rh-${run}-a`, sides: advisorySides(key), holdMs: 4000, staggerMs: 1500 });
    show('OVERLAP   ', overlap);
    results.push(['OVERLAP detected', overlap.blockedBy1 === true && overlap.r2.ms > 1500]);

    const apart = await race({ tag: `nf-rh-${run}-b`, sides: advisorySides(key), holdMs: 1000, staggerMs: 2500 });
    show('NO OVERLAP', apart);
    results.push(['NO OVERLAP reported as not blocked', apart.blockedBy1 === false]);
    results.push(['both sides succeeded in both runs', [overlap.r1, overlap.r2, apart.r1, apart.r2].every(r => r.status === 201)]);
  } catch (e) {
    console.log('COULD NOT RUN —', e.message);
    process.exitCode = 2;
    return;
  }

  results.forEach(([name, pass]) => console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`));
  const failed = results.filter(([, p]) => !p).length;
  console.log(failed ? `\n${failed} check(s) failed — the race test cannot be trusted until this passes.`
                     : '\nPASS — the instrument sees a real overlap and does not invent one.');
  process.exitCode = failed ? 1 : 0;
})();

#!/usr/bin/env node
/**
 * NexuFinance — IIF export, the ONLY write step. Deliberately separate
 * from scripts/nf/iif-export.js (which only reads and writes a file) —
 * per the owner's own instruction, nothing gets marked as exported on
 * this session's own judgment. Run this only after the owner has looked
 * at the generated .iif file and the validation output and says go.
 *
 *   node scripts/nf/iif-record-batch.js <from> <to> --file <path.iif> --qb-chart <chart.iif> --checksum <hex> [--company <uuid>]
 *
 * Re-derives the exact same candidate list iif-export.js used (same
 * nf_iif_list_candidates call, same from/to) rather than trusting
 * anything cached from that earlier run — if the ledger changed in
 * between (a new voucher posted, another export ran), the candidate set
 * re-computed here is what actually gets recorded, not a stale one.
 * Calls nf_iif_record_batch, which itself re-validates every voucher is
 * POSTED/exportable/in-company and rejects the whole batch (writes
 * nothing) if any of that has changed — this script doesn't re-implement
 * that check, the RPC already owns it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { q } = require('../_sbq');

const AWAMI = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const [FROM, TO] = positional;
function flag(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; }
const FILE = flag('file');
const QB_CHART = flag('qb-chart');
const CHECKSUM = flag('checksum');
const COMPANY = flag('company', AWAMI);
const AS_USER = flag('as');

if (!FROM || !TO || !FILE || !AS_USER) {
  console.error('usage: node scripts/nf/iif-record-batch.js <from> <to> --file <path.iif> --qb-chart <chart.iif> --checksum <hex> --as <accountant_or_director_user_id> [--company <uuid>]');
  process.exit(2);
}
if (!fs.existsSync(FILE)) { console.error(`file not found: ${FILE}`); process.exit(2); }

// Same reasoning as iif-export.js's own qAs() — the Management API's
// privileged connection, not a real session, and set_config is
// transaction-local so it must ride in the same q() call as the RPC
// that needs it, every time, never a separate earlier call.
function qAs(sql) {
  return q(`SELECT set_config('request.jwt.claims', '{"sub":"${AS_USER}","role":"authenticated"}', true); ${sql}`);
}

(async () => {
  const [{ nf_iif_list_candidates: candidates }] = await qAs(
    `SELECT public.nf_iif_list_candidates('${COMPANY}'::uuid, '${FROM}'::date, '${TO}'::date) AS nf_iif_list_candidates`
  );
  if (!candidates.length) {
    console.log('No exportable candidates in this range right now — nothing to record. (If this differs from what iif-export.js just showed you, the ledger changed in between; re-run iif-export.js first.)');
    return;
  }
  console.log(`Recording ${candidates.length} voucher(s) as exported in ${path.basename(FILE)}...`);
  const idArray = `ARRAY[${candidates.map(c => `'${c.id}'`).join(',')}]::uuid[]`;
  const [result] = await qAs(`
    SELECT public.nf_iif_record_batch(
      '${COMPANY}'::uuid, '${path.basename(FILE)}', '${FROM}'::date, '${TO}'::date,
      ${QB_CHART ? `'${path.basename(QB_CHART)}'` : 'NULL'}, ${CHECKSUM ? `'${CHECKSUM}'` : 'NULL'},
      ${idArray}
    ) AS r`);
  console.log('recorded:', JSON.stringify(result.r));
})().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1; });

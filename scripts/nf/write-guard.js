/**
 * NexuFinance v1 — the exact test of "this transaction wrote nothing outside nf_".
 *
 * pg_stat_xact_user_tables counts rows inserted, updated and deleted in every
 * user table BY THE CURRENT TRANSACTION ONLY — including writes made by
 * triggers. Other sessions, real users and smoke tests do not appear in it, so
 * unlike a before/after row count it cannot be disturbed by live use.
 *
 * Shared by apply-phase1.js (aborts the apply) and verify-nf-schema.js
 * (asserts it, with a positive control that shows it fires).
 */
'use strict';

// jsonb object { "schema.table": rows written } for every non-nf_, non-temp table this transaction wrote.
const WRITTEN_OUTSIDE_NF = `(SELECT COALESCE(jsonb_object_agg(schemaname || '.' || relname, n_tup_ins + n_tup_upd + n_tup_del), '{}'::jsonb)
   FROM pg_stat_xact_user_tables
  WHERE n_tup_ins + n_tup_upd + n_tup_del > 0
    AND relname NOT LIKE 'nf\\_%'
    AND schemaname NOT LIKE 'pg\\_temp%')`;

const GUARD_BLOCK = `
DO $nf_write_guard$
DECLARE w jsonb := ${WRITTEN_OUTSIDE_NF};
BEGIN
  IF w <> '{}'::jsonb THEN
    RAISE EXCEPTION 'NF_APPLY_GUARD: this transaction wrote outside nf_: %', w;
  END IF;
END
$nf_write_guard$;`;

module.exports = { WRITTEN_OUTSIDE_NF, GUARD_BLOCK };

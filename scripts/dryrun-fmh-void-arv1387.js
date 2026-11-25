#!/usr/bin/env node
/* Dry run: void the duplicate 41,000 receipt for Toheeda Yousaf (FMH) — PRV-2627-00506 / ARV#1387 — through
   cancel_payment as the FMH owner login, in a transaction that is rolled back. Usage: node <this> [--apply] */
const { REF, TOKEN, q } = require('./_sbq');
const FMH = '71d33e07-e55c-49af-8f5b-fdd7fd6e8612', OWNER_AUTH = '97d8b303-16b1-4797-9f7e-8918d57ce5e4';
const APPLY = process.argv.includes('--apply');
const SNAP = `(SELECT jsonb_build_object(
  'receipts_live', (SELECT count(*) FROM payments WHERE sale_id = s.id AND status <> 'cancelled'),
  'received_total', (SELECT sum(amount) FROM payments WHERE sale_id = s.id AND status <> 'cancelled'),
  'the_two', (SELECT jsonb_object_agg(manual_number, status) FROM payments WHERE payment_code IN ('PAY-2611-0074','PAY-2611-0075')),
  'installments_paid', (SELECT sum(amount_paid) FROM installments WHERE sale_id = s.id))
  FROM sales s WHERE s.id = 'f393e0d3-2753-4af7-bf42-c227bf33c6b0')`;
(async () => {
  const sql = `BEGIN;
CREATE TEMP TABLE _r (k text, v jsonb);
INSERT INTO _r VALUES ('1_before', ${SNAP});
DO $t$ DECLARE res jsonb; BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '${OWNER_AUTH}', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '${OWNER_AUTH}', true);
  res := public.cancel_payment((SELECT id FROM payments WHERE payment_code = 'PAY-2611-0075' AND company_id = '${FMH}'), '${FMH}', NULL,
    'Duplicate of ARV#1386 (PRV-2627-00505): the same 41,000 was entered twice because the receipt list did not show the first one. Voided on the owner''s instruction, 25-Nov-2026.');
  INSERT INTO _r VALUES ('2_cancel_result', res);
END $t$;
INSERT INTO _r VALUES ('3_after', ${SNAP});
${APPLY ? `DO $t$ BEGIN IF (SELECT v->>'success' FROM _r WHERE k = '2_cancel_result') <> 'true' THEN RAISE EXCEPTION 'cancel failed: %', (SELECT v FROM _r WHERE k = '2_cancel_result'); END IF; END $t$;
SELECT jsonb_object_agg(k, v) FROM _r;
COMMIT;` : `DO $t$ BEGIN RAISE EXCEPTION 'DRYRUN_RESULT %', (SELECT jsonb_object_agg(k, v) FROM _r)::text; END $t$;`}`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const t = await res.text();
  if (APPLY) { console.log('HTTP', res.status, t.slice(0, 1500)); return; }
  let msg; try { msg = JSON.parse(t).message || t; } catch { msg = t; }
  const m = /DRYRUN_RESULT (\{[\s\S]*\})/.exec(msg);
  if (!m) { console.log(msg.slice(0, 1500)); process.exit(1); }
  const j = JSON.parse(m[1].replace(/\nCONTEXT[\s\S]*$/, '')); for (const k of Object.keys(j).sort()) console.log(k, JSON.stringify(j[k]));
  console.log('after rollback:', JSON.stringify(await q(`select manual_number, status from payments where payment_code in ('PAY-2611-0074','PAY-2611-0075')`)));
})();

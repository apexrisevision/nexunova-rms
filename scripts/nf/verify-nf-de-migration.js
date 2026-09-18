#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// HISTORICAL — frozen, do not re-run. Kept only as the record of the
// pre-apply rehearsal that 20260918a-d actually passed before being applied
// to live on 2026-09-18. That migration is long since applied; this
// script's job is done.
//
// It WILL fail if run today, for two independent reasons, neither worth
// fixing on a script whose result already shipped:
//   1. FILES below only rehearses a-d. Everything from 20260918e onward
//      (the seven post-apply follow-ups, the QuickBooks reconciliation, the
//      director report, the RPC grants lockdown) is invisible to it — a
//      pass here would prove nothing about the schema as it exists now.
//   2. It calls nf_account_path and nf_ledger_position over the Management
//      API's raw-SQL endpoint (q(), no JWT — auth.uid() reads NULL there).
//      Both now require an authenticated, company-member session
//      (20260918o, 2026-09-18) — this script would hit NF:NOT_SIGNED_IN on
//      its own BEGIN/ROLLBACK rehearsal before getting anywhere near what
//      it was written to check.
// ═══════════════════════════════════════════════════════════════════════════
//
// Rehearses the double-entry foundation migration (20260918a-d) against the
// LIVE database inside one BEGIN ... ROLLBACK — nothing this script does
// persists. No local Postgres and no Docker are available on this machine,
// and the Supabase org has no branching plan, so a literal "restore into a
// scratch database" is not possible here; BEGIN/ROLLBACK against the live
// engine is the established substitute this project already uses for
// schema rehearsals (see scripts/nf/verify-nf-schema.js).
//
// What this proves, pre-apply:
//   1. The combined SQL (a+b+c+d) runs clean, in order, with no errors.
//   2. The rupee-exact reconciliation embedded in 20260918d's own DO block
//      passes for every existing (company, business_date) — currently just
//      the ZZTEST-NF-DEMO tenant's 1 day / 8 lines and its one real
//      transfer_to_bank of 300000, since Awami itself has zero
//      nf_days/nf_lines rows.
//   3. Voucher balance is enforced (an unbalanced post is rejected).
//   4. A >2-leg voucher balances and posts correctly.
//   5. Party requiredness is enforced on 21100 (Token Money) — a real,
//      everyday nf_save_line head, driven through nf_save_line itself
//      (not nf_post_voucher directly) including its new, optional
//      p_party_name resolve-or-create path. 5b proves 12610 (director
//      receivable) correctly needs NO party — it was wrongly in the first
//      draft's requires_party list and would have blocked real, current
//      usage; fixed after checking the real Awami chart (see 20260918a).
//   6. The COA colon-path resolves correctly for a known nested account.
//   7. Ledger-derived opening recomputes correctly when an earlier
//      voucher's amount changes (the mathematical half of the
//      reopen-a-historical-day requirement — the policy half, tying
//      reopening to an accounting PERIOD rather than "latest day", is
//      decided in nf_days_guard (20260918d) per the owner's 2026-09-18
//      instruction, pending the period-lock gate the IIF export pass
//      builds).
//   8. A transfer is an ordinary voucher, not a special case: Cash->Bank
//      (through nf_set_transfers, the real screen's own RPC) and the
//      reverse Bank->Cash (through the general nf_post_voucher path, which
//      the current screen has no input for but the model must support)
//      both move both via-positions correctly in one operation, and
//      neither appears in the nf_lines cash-book view.
//   9. The negative-position guard still holds under the new,
//      ledger-backed nf_position_row — checked explicitly per the owner's
//      2026-09-18 instruction, not assumed to have carried over.
//
// What this does NOT prove (by design — needs real, persisted state across
// two independent connections, which a single rolled-back transaction
// cannot provide): the two-connection race proof and the end-to-end
// closing-sheet-unchanged check. Those run post-apply, against
// ZZTEST-NF-DEMO, exactly like the existing RACE-R1/OK/R2 tests do today —
// see scripts/nf/verify-nf-de-race.js and scripts/nf/verify-nf-de-postapply.js.
const fs = require('fs');
const path = require('path');
const { q } = require('../_sbq');

const MIG = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILES = ['20260918a_nf_double_entry_tables.sql', '20260918b_nf_double_entry_guards.sql',
  '20260918c_nf_double_entry_rpcs.sql', '20260918d_nf_migrate_lines_to_vouchers.sql'];

function body(file) {
  let sql = fs.readFileSync(path.join(MIG, file), 'utf8');
  sql = sql.replace(/^\s*BEGIN;\s*$/m, '');
  sql = sql.replace(/\s*COMMIT;\s*$/, '');
  return sql;
}

const OUT = path.join(require('os').tmpdir(), 'nf-de-migration-rehearsal.txt');
const log = [];
function say(s) { log.push(s); console.log(s); }

(async () => {
  const combined = FILES.map(body).join('\n\n-- ==== next file ====\n\n');

  const checks = `
CREATE TEMP TABLE nf_rehearsal_log (step text PRIMARY KEY, detail text) ON COMMIT DROP;

-- Awami has zero active nf_members right now (checked directly, 2026-09-18
-- — a real, separate finding: the go-live blocker where director/
-- accountant name+email are still the literal template placeholder). With
-- no Awami member to be, nf_require_role has no real identity to grant —
-- checks 3-6 below impersonate ZZTEST-NF-DEMO's real director instead,
-- the only company with an active member at all, by setting the same GUC
-- PostgREST sets from a verified JWT. This never leaves this rolled-back
-- transaction and mirrors auth.uid()'s own definition exactly.
SET LOCAL "request.jwt.claims" = '{"sub":"a18a6ca6-c548-4d9c-8474-0b96f68b4d7f"}';

-- ── 3. balance is enforced ──────────────────────────────────────────────
DO $t$
DECLARE v_co uuid; v_floor text; v_caught boolean := false;
BEGIN
  SELECT id INTO v_co FROM public.companies WHERE company_name LIKE 'ZZTEST-NF-%' LIMIT 1;
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_co LIMIT 1;
  BEGIN
    PERFORM public.nf_post_voucher(v_co, NULL, 'REHEARSAL-UNBAL-1', current_date, 'rehearsal', 0,
      jsonb_build_array(
        jsonb_build_object('account_code','40100','floor_code',v_floor,'credit',1000),
        jsonb_build_object('account_code','10100','floor_code',v_floor,'debit',900)));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'NF:VOUCHER_UNBALANCED%' THEN v_caught := true; ELSE RAISE; END IF;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'REHEARSAL:UNBALANCED_NOT_CAUGHT'; END IF;
  INSERT INTO nf_rehearsal_log VALUES ('3_balance_enforced', 'unbalanced voucher rejected');
END $t$;

-- ── 4. a real >2-leg voucher balances and posts ─────────────────────────
DO $t$
DECLARE v_co uuid; v_floor text; v_id uuid; v_n integer;
BEGIN
  SELECT id INTO v_co FROM public.companies WHERE company_name LIKE 'ZZTEST-NF-%' LIMIT 1;
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_co LIMIT 1;
  v_id := public.nf_post_voucher(v_co, NULL, 'REHEARSAL-MULTI-1', current_date, 'rehearsal 3-leg', 0,
    jsonb_build_array(
      jsonb_build_object('account_code','40100','floor_code',v_floor,'credit',700),
      jsonb_build_object('account_code','40200','floor_code',v_floor,'credit',300),
      jsonb_build_object('account_code','10100','floor_code',v_floor,'debit',1000)));
  SELECT count(*) INTO v_n FROM public.nf_voucher_legs WHERE voucher_id = v_id;
  IF v_n <> 3 THEN RAISE EXCEPTION 'REHEARSAL:MULTI_LEG_WRONG_COUNT got=%', v_n; END IF;
  INSERT INTO nf_rehearsal_log VALUES ('4_multi_leg', '3-leg voucher posted, legs=' || v_n);
END $t$;

-- ── 5. party requiredness — on 21100 (Token Money), a real, everyday
--    nf_save_line head, NOT 12610 (director receivable): 12610/12620 and
--    22100-22400 are already dedicated per-entity accounts and were
--    correctly dropped from requires_party (see 20260918a) — marking them
--    would have blocked the real, current use of 12610 as a cash-book head
--    (a director's draw, side=OUT, exactly the corrected QuickBooks bug
--    this task's brief itself cites). Only 21100/21200/21300 pool many
--    customers under one code and actually need a party. Driven through
--    nf_save_line itself (not nf_post_voucher directly) because that is
--    the real path the cashier's screen calls, p_party_name and all. ──────
DO $t$
DECLARE v_co uuid; v_day uuid; v_floor text; v_caught boolean := false; v_res jsonb;
BEGIN
  SELECT id INTO v_co FROM public.companies WHERE company_name LIKE 'ZZTEST-NF-%' LIMIT 1;
  SELECT id INTO v_day FROM public.nf_days WHERE company_id = v_co LIMIT 1;
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_co LIMIT 1;
  BEGIN
    PERFORM public.nf_save_line(v_day, NULL, 'IN', 'CRV-REHEARSAL-NOPARTY-1', 'rehearsal', '21100', v_floor, 'Cash', 2500, NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'NF:PARTY_REQUIRED' THEN v_caught := true; ELSE RAISE; END IF;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'REHEARSAL:PARTY_NOT_ENFORCED'; END IF;

  -- same call, this time with a party name nf-sheet.js does not collect
  -- yet but nf_save_line can now resolve-or-create (see 20260918c) — a
  -- brand-new name, proving the auto-create-customer path, not just an
  -- existing one
  v_res := public.nf_save_line(v_day, NULL, 'IN', 'CRV-REHEARSAL-PARTY-1', 'rehearsal', '21100', v_floor, 'Cash', 2500, NULL, 'Rehearsal Token Customer');
  INSERT INTO nf_rehearsal_log VALUES ('5_party_required', 'enforced on 21100 without a name, satisfied by auto-creating "Rehearsal Token Customer"');
END $t$;

-- ── 5b. director receivable (12610) posts WITHOUT a party — confirms the
--    correction actually fixed the real-usage regression it was meant to ──
DO $t$
DECLARE v_co uuid; v_day uuid; v_floor text;
BEGIN
  SELECT id INTO v_co FROM public.companies WHERE company_name LIKE 'ZZTEST-NF-%' LIMIT 1;
  SELECT id INTO v_day FROM public.nf_days WHERE company_id = v_co LIMIT 1;
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_co LIMIT 1;
  PERFORM public.nf_save_line(v_day, NULL, 'OUT', 'CPV-REHEARSAL-DRAW-1', 'director draw, rehearsal', '12610', v_floor, 'Cash', 1500, NULL);
  INSERT INTO nf_rehearsal_log VALUES ('5b_director_receivable_no_party', '12610 posted with no party_id, as it should — the account itself is the party');
END $t$;

-- ── 6. COA colon-path ────────────────────────────────────────────────────
DO $t$
DECLARE v_co uuid; v_path text;
BEGIN
  SELECT id INTO v_co FROM public.companies WHERE company_name LIKE 'ZZTEST-NF-%' LIMIT 1;
  v_path := public.nf_account_path(v_co, '12610');
  IF v_path <> 'Current Assets:Receivable from Directors:Syed Yousaf Shah' THEN
    RAISE EXCEPTION 'REHEARSAL:PATH_WRONG got=%', v_path;
  END IF;
  INSERT INTO nf_rehearsal_log VALUES ('6_coa_path', v_path);
END $t$;

-- ── 7. ledger-derived opening recomputes when an earlier posting changes ──
-- Proves the MATH: nf_ledger_position(as-of a later date) moves when an
-- earlier day's already-migrated voucher changes, with nothing cached in
-- between. This is the computational half of "reopen a historical day,
-- change an amount, assert later days move correctly" — the separate
-- policy question of whether nf_days_guard's NF:LATER_DAY_EXISTS should be
-- relaxed so a director can trigger this through the real reopen RPC is
-- flagged in docs/PLAN.md §11, not decided here.
DO $t$
DECLARE
  v_co uuid; v_bdate date; v_via text; v_after date;
  v_open_before numeric; v_open_after numeric;
  v_head_id uuid; v_via_id uuid; v_delta numeric := 111.50;
BEGIN
  SELECT id INTO v_co FROM public.companies WHERE company_name LIKE 'ZZTEST-NF-%' LIMIT 1;
  IF v_co IS NULL THEN RAISE NOTICE 'REHEARSAL-SKIP: no ZZTEST-NF tenant present'; RETURN; END IF;

  -- pick a line whose head is NOT party-required (21100 Token Money is,
  -- and the migrated legacy rows have no party_id — see docs/PLAN.md §11
  -- for that separate, real finding) so this check stays about the
  -- ledger math, not the party guard.
  SELECT l.via, d.business_date INTO v_via, v_bdate
    FROM public.nf_lines l JOIN public.nf_days d ON d.id = l.day_id
   WHERE l.company_id = v_co AND l.head_code = '40100' LIMIT 1;
  IF v_via IS NULL THEN RAISE NOTICE 'REHEARSAL-SKIP: ZZTEST-NF tenant has no migrated lines'; RETURN; END IF;
  v_after := v_bdate + 1;

  SELECT hl.id, vl.id INTO v_head_id, v_via_id
    FROM public.nf_voucher_legs hl
    JOIN public.nf_vouchers v ON v.id = hl.voucher_id
    JOIN public.nf_voucher_legs vl ON vl.voucher_id = hl.voucher_id AND vl.line_no = 2
    JOIN public.nf_accounts a ON a.company_id = v.company_id AND a.code = vl.account_code
   WHERE v.company_id = v_co AND v.day_id = (SELECT id FROM public.nf_days WHERE company_id = v_co AND business_date = v_bdate)
     AND hl.line_no = 1 AND a.via = v_via
   LIMIT 1;
  IF v_head_id IS NULL THEN RAISE NOTICE 'REHEARSAL-SKIP: no leg pair found to perturb'; RETURN; END IF;

  EXECUTE format('SELECT %I FROM public.nf_ledger_position($1, $2)', lower(v_via)) INTO v_open_before USING v_co, v_after;

  -- bump both legs of the SAME voucher by the same amount, on whichever
  -- side is currently non-zero, keeping the voucher balanced
  UPDATE public.nf_voucher_legs SET debit  = debit  + v_delta WHERE id = v_head_id AND debit  > 0;
  UPDATE public.nf_voucher_legs SET credit = credit + v_delta WHERE id = v_head_id AND credit > 0;
  UPDATE public.nf_voucher_legs SET debit  = debit  + v_delta WHERE id = v_via_id  AND debit  > 0;
  UPDATE public.nf_voucher_legs SET credit = credit + v_delta WHERE id = v_via_id  AND credit > 0;

  EXECUTE format('SELECT %I FROM public.nf_ledger_position($1, $2)', lower(v_via)) INTO v_open_after USING v_co, v_after;

  IF v_open_after - v_open_before <> v_delta AND v_open_before - v_open_after <> v_delta THEN
    RAISE EXCEPTION 'REHEARSAL:OPENING_DID_NOT_RECOMPUTE before=% after=% delta_expected=%', v_open_before, v_open_after, v_delta;
  END IF;
  INSERT INTO nf_rehearsal_log VALUES ('7_ledger_recompute', v_via || ' opening as of ' || v_after || ' moved ' || v_open_before || ' -> ' || v_open_after);
END $t$;

-- ── 8. transfers, BOTH directions, as one balanced 2-leg voucher, moving
--    both positions in the same operation (owner's explicit ask,
--    2026-09-18: "under double-entry a transfer is just an ordinary
--    voucher, not a special case") ─────────────────────────────────────
DO $t$
DECLARE
  v_co uuid; v_day uuid; v_ver integer; v_id uuid; v_floor text; v_cash_code text; v_bank_code text;
  v_trf_bank numeric; v_trf_cash numeric; v_before_cash numeric;
BEGIN
  SELECT id INTO v_co FROM public.companies WHERE company_name LIKE 'ZZTEST-NF-%' LIMIT 1;
  SELECT id INTO v_day FROM public.nf_days WHERE company_id = v_co LIMIT 1;
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_co ORDER BY sort LIMIT 1;
  SELECT code INTO v_cash_code FROM public.nf_accounts WHERE company_id = v_co AND via = 'Cash';
  SELECT code INTO v_bank_code FROM public.nf_accounts WHERE company_id = v_co AND via = 'Bank';

  -- documented direction: Cash -> Bank, through the real screen's own RPC.
  -- nf_set_transfers is a SET, not an add-to (matching its pre-existing,
  -- unchanged semantics) — the demo day already carries a real 300000
  -- transfer_to_bank migrated from the old columns, so this re-sets it to
  -- a new value; the assertion checks the RESULT is exactly that new
  -- value, isolated via trf_bank/trf_cash (the transfer's own component of
  -- the position, immune to whatever the other checks' in/out lines do).
  SELECT version INTO v_ver FROM public.nf_days WHERE id = v_day;
  PERFORM public.nf_set_transfers(v_day, 20000, NULL, v_ver);
  SELECT trf_bank, trf_cash INTO v_trf_bank, v_trf_cash FROM public.nf_position_row(v_day);
  IF v_trf_bank <> 20000 OR v_trf_cash <> -20000 THEN
    RAISE EXCEPTION 'REHEARSAL:TRANSFER_CASH_TO_BANK_WRONG trf_bank=% trf_cash=% (want 20000/-20000)', v_trf_bank, v_trf_cash;
  END IF;

  -- the general mechanism, reverse direction: Bank -> Cash — the current
  -- screen has no input for this (only two Cash-outbound fields), but the
  -- underlying voucher/leg model must support it, since it is a real,
  -- routine movement this business makes. A fresh, independent voucher
  -- (not the XFR-BANK- one above), so its effect is additive on top of it.
  SELECT close_cash INTO v_before_cash FROM public.nf_position_row(v_day);
  v_id := public.nf_post_voucher(v_co, v_day, 'XFR-REHEARSAL-B2C-1', (SELECT business_date FROM public.nf_days WHERE id = v_day), 'Bank to cash, rehearsal', 0,
    jsonb_build_array(
      jsonb_build_object('account_code', v_cash_code, 'floor_code', v_floor, 'debit', 7000),
      jsonb_build_object('account_code', v_bank_code, 'floor_code', v_floor, 'credit', 7000)));
  SELECT close_cash INTO v_trf_cash FROM public.nf_position_row(v_day);  -- reusing the var: this is now close_cash after
  IF v_trf_cash - v_before_cash <> 7000 THEN
    RAISE EXCEPTION 'REHEARSAL:TRANSFER_BANK_TO_CASH_WRONG cash %->%', v_before_cash, v_trf_cash;
  END IF;
  IF EXISTS (SELECT 1 FROM public.nf_lines WHERE voucher_key IN (upper('XFR-BANK-' || v_day::text), 'XFR-REHEARSAL-B2C-1')) THEN
    RAISE EXCEPTION 'REHEARSAL:TRANSFER_LEAKED_INTO_CASHBOOK_VIEW';
  END IF;
  INSERT INTO nf_rehearsal_log VALUES ('8_transfer_both_directions',
    'Cash->Bank via nf_set_transfers and Bank->Cash via nf_post_voucher both moved both positions correctly in one operation; neither appears in nf_lines');
END $t$;

-- ── 9. the negative-position guard still holds, computed from the NEW
--    ledger-backed position, not the old nf_days columns (owner's
--    explicit ask, 2026-09-18: "confirm this specifically") ─────────────
DO $t$
DECLARE v_co uuid; v_day uuid; v_ver integer; v_cash numeric; v_caught boolean := false;
BEGIN
  SELECT id INTO v_co FROM public.companies WHERE company_name LIKE 'ZZTEST-NF-%' LIMIT 1;
  SELECT id INTO v_day FROM public.nf_days WHERE company_id = v_co LIMIT 1;
  SELECT close_cash INTO v_cash FROM public.nf_position_row(v_day);
  SELECT version INTO v_ver FROM public.nf_days WHERE id = v_day;
  BEGIN
    -- ask to move far more out of cash (into bank) than cash actually holds
    PERFORM public.nf_set_transfers(v_day, v_cash + 999999, NULL, v_ver);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'NF:NEGATIVE_POSITION' THEN v_caught := true; ELSE RAISE; END IF;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'REHEARSAL:NEGATIVE_POSITION_NOT_ENFORCED'; END IF;
  INSERT INTO nf_rehearsal_log VALUES ('9_negative_position_guard', 'an over-large transfer out of cash was rejected, computed from the ledger-backed position');
END $t$;

INSERT INTO nf_rehearsal_log VALUES ('2_rupee_exact_migration',
  (SELECT 'legacy_rows=' || count(*) FROM public.nf_lines_legacy) || ', ' ||
  (SELECT 'view_rows=' || count(*) FROM public.nf_lines) || ' (file d''s own DO block already raised NF:MIGRATION_MISMATCH and aborted the whole transaction if these did not reconcile to the rupee)');

SELECT step, detail FROM nf_rehearsal_log ORDER BY step;
`;

  const full = `BEGIN;\n${combined}\n${checks}\nROLLBACK;\n`;
  fs.writeFileSync(OUT, full, 'utf8');
  say(`SQL written to ${OUT} (${full.length} bytes)`);

  let result;
  try {
    result = await q(full);
  } catch (e) {
    say('REHEARSAL FAILED (transport/HTTP error):');
    say(String(e.message || e));
    process.exitCode = 1;
    fs.writeFileSync(OUT + '.result.txt', log.join('\n'));
    return;
  }
  say('Raw result:');
  say(JSON.stringify(result, null, 1));
  fs.writeFileSync(OUT + '.result.txt', log.join('\n'));
  say(`\nFull log: ${OUT}.result.txt`);
})();

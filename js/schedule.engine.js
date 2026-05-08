// ══════════════════════════════════════════════════════════════════
//  Nexunova RMS — Schedule Engine v1.0
//  Pure financial calculation module — NO DOM, NO side-effects
//  Integrates with: sales.store (via modals.js commit flow)
//                   recovery.store (via ledger creation)
// ══════════════════════════════════════════════════════════════════

'use strict';

/* ── PUBLIC API ──────────────────────────────────────────────────
 *
 *  buildSchedule(params)   → { rows[], summary{} }   (pure)
 *  statusForRow(row, today) → 'paid'|'partial'|'overdue'|'upcoming'
 *  validateScheduleParams(params) → { valid:bool, errors:[] }
 *  commitScheduleToStore(unitId, schedule, saleData) → void
 *
 * ─────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────
   1.  DATE HELPERS  (no external deps)
────────────────────────────────────────────────────────────── */
function _addMonths(isoDate, n) {
  // Adds n calendar months to a YYYY-MM-DD string, returns YYYY-MM-DD
  const d = new Date(isoDate + 'T00:00:00');
  const target = new Date(d);
  target.setMonth(target.getMonth() + n);
  // Clamp to last day of target month (avoids March 31 + 1m = May 1)
  if (target.getDate() < d.getDate()) target.setDate(0);
  return target.toISOString().slice(0, 10);
}

function _isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function _parseAmt(v) {
  // Robust number parse — strips commas, spaces
  if (v === null || v === undefined || v === '') return 0;
  return Math.round(Number(String(v).replace(/,/g, '').trim()) || 0);
}

/* ──────────────────────────────────────────────────────────────
   2.  VALIDATION
────────────────────────────────────────────────────────────── */
function validateScheduleParams(p) {
  const errors = [];

  const totalValue = _parseAmt(p.totalValue);
  const months     = parseInt(p.months) || 0;
  const dpStages   = Array.isArray(p.dpStages) ? p.dpStages : [];
  const commence   = p.commence || '';

  if (!totalValue || totalValue <= 0)
    errors.push('Total asset value must be greater than zero.');

  if (!commence || !/^\d{4}-\d{2}-\d{2}$/.test(commence))
    errors.push('Schedule commence date is required (YYYY-MM-DD).');

  if (months < 0 || months > 60)
    errors.push('Installment months must be between 0 and 60.');

  // DP validation
  let totalDP = 0;
  dpStages.forEach((dp, i) => {
    const amt = _parseAmt(dp.amount);
    if (amt < 0) errors.push(`Down payment #${i + 1}: amount cannot be negative.`);
    if (!dp.label || !String(dp.label).trim())
      errors.push(`Down payment #${i + 1}: label is required.`);
    totalDP += amt;
  });

  if (totalDP > totalValue)
    errors.push(`Total down payments (${totalDP.toLocaleString()}) exceed total asset value (${totalValue.toLocaleString()}).`);

  if (months === 0 && totalDP < totalValue)
    errors.push('No installment months defined. Down payments must equal total asset value for a cash deal.');

  return { valid: errors.length === 0, errors };
}

/* ──────────────────────────────────────────────────────────────
   3.  CORE SCHEDULE BUILDER
────────────────────────────────────────────────────────────── */

/**
 * buildSchedule(params) → { rows[], summary{}, valid, errors[] }
 *
 * params = {
 *   totalValue   : number   — total asset value (PKR)
 *   months       : number   — installment term (0–60)
 *   commence     : string   — 'YYYY-MM-DD' first installment date
 *   dpStages     : Array<{ label:string, amount:number, dueDate?:string }>
 *                            — ordered list of down payment stages
 * }
 *
 * Row schema:
 * {
 *   installmentNo : number,  // 1-based sequential
 *   dueDate       : string,  // 'YYYY-MM-DD'
 *   label         : string,
 *   type          : 'dp' | 'installment',
 *   debit         : number,  // amount due this row
 *   received      : number,  // 0 by default (updated from recovery ledger)
 *   balance       : number,  // running outstanding after this row
 *   status        : string   // computed from statusForRow()
 * }
 */
function buildSchedule(params) {
  // ── validation ──
  const vr = validateScheduleParams(params);
  if (!vr.valid) return { rows: [], summary: {}, valid: false, errors: vr.errors };

  const totalValue = _parseAmt(params.totalValue);
  const months     = parseInt(params.months) || 0;
  const commence   = params.commence;
  const dpStages   = (params.dpStages || []).filter(dp => _parseAmt(dp.amount) > 0);
  const today      = _isoToday();

  const rows = [];
  let installmentNo = 1;
  let runningBalance = totalValue;   // decreases as debits are scheduled
  let totalDPAmt = 0;

  // ── 1. Down Payment rows ──
  dpStages.forEach((dp, i) => {
    const debit = _parseAmt(dp.amount);
    totalDPAmt += debit;
    runningBalance -= debit;

    // DP due dates: use provided date, or offset from commence by stage index
    // (stage 0 = before commence, i.e. booking; stage 1 = at commence, etc.)
    // Operator may override via dp.dueDate
    const dueDate = dp.dueDate
      ? dp.dueDate
      : i === 0
        ? _addMonths(commence, -1)   // booking advance = 1 month before commence
        : commence;

    const row = {
      installmentNo,
      dueDate,
      label    : String(dp.label).trim() || `Down Payment ${i + 1}`,
      type     : 'dp',
      debit,
      received : 0,
      balance  : Math.max(0, runningBalance),
      status   : 'upcoming',
    };
    row.status = statusForRow(row, today);
    rows.push(row);
    installmentNo++;
  });

  // ── 2. Installment rows ──
  if (months > 0) {
    const remainingForEMI = Math.max(0, totalValue - totalDPAmt);

    if (remainingForEMI > 0) {
      // Equal EMI with last-instalment rounding correction
      const baseEMI  = Math.floor(remainingForEMI / months);
      const lastEMI  = remainingForEMI - baseEMI * (months - 1);  // absorbs rounding

      for (let m = 0; m < months; m++) {
        const debit    = m === months - 1 ? lastEMI : baseEMI;
        const dueDate  = _addMonths(commence, m);
        runningBalance -= debit;

        const row = {
          installmentNo,
          dueDate,
          label    : `Installment ${m + 1}`,
          type     : 'installment',
          debit,
          received : 0,
          balance  : Math.max(0, runningBalance),
          status   : 'upcoming',
        };
        row.status = statusForRow(row, today);
        rows.push(row);
        installmentNo++;
      }
    }
  }

  // ── 3. Summary ──
  const totalScheduled = rows.reduce((s, r) => s + r.debit, 0);
  const emi = months > 0
    ? rows.filter(r => r.type === 'installment')[0]?.debit || 0
    : 0;

  const summary = {
    totalValue,
    totalDP   : totalDPAmt,
    totalEMI  : totalValue - totalDPAmt,
    emi,
    months,
    rows      : rows.length,
    balanced  : totalScheduled === totalValue,   // integrity check
    totalScheduled,
  };

  return { rows, summary, valid: true, errors: [] };
}

/* ──────────────────────────────────────────────────────────────
   4.  STATUS ENGINE
────────────────────────────────────────────────────────────── */
function statusForRow(row, today) {
  today = today || _isoToday();
  if (row.received >= row.debit && row.debit > 0) return 'paid';
  if (row.received > 0 && row.received < row.debit) return 'partial';
  if (row.dueDate < today && row.debit > 0)         return 'overdue';
  return 'upcoming';
}

/* ──────────────────────────────────────────────────────────────
   5.  HYDRATE SCHEDULE WITH RECOVERY LEDGER
   Merges actual payments (from recovery store) into schedule rows
   Returns an updated copy with received, balance, status set.
────────────────────────────────────────────────────────────── */
function hydrateSchedule(rows, recoveryRecords) {
  if (!recoveryRecords || !recoveryRecords.length) return rows;
  const today = _isoToday();

  // Build a simple payment pool sorted by date (FIFO allocation)
  const pool = recoveryRecords
    .map(r => ({ date: r.date, remaining: Number(r.amt) || 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Deep-copy rows
  const hydrated = rows.map(r => ({ ...r, received: 0 }));

  // Allocate payments to rows in chronological order
  for (const pmt of pool) {
    for (const row of hydrated) {
      if (pmt.remaining <= 0) break;
      const owed = row.debit - row.received;
      if (owed <= 0) continue;
      const alloc = Math.min(pmt.remaining, owed);
      row.received += alloc;
      pmt.remaining -= alloc;
    }
  }

  // Recompute running balance & status
  let runBal = hydrated.reduce((s, r) => s + r.debit, 0);
  for (const row of hydrated) {
    runBal -= row.received;
    row.balance = Math.max(0, runBal);
    row.status  = statusForRow(row, today);
  }

  return hydrated;
}

/* ──────────────────────────────────────────────────────────────
   6.  STORE INTEGRATION
   Persists full schedule + creates initial recovery ledger entry
   Called on "Commit Sale" from the sell modal.
────────────────────────────────────────────────────────────── */
function commitScheduleToStore(unitId, scheduleRows, saleData) {
  if (typeof gdb === 'undefined' || typeof sdb === 'undefined') {
    console.error('[ScheduleEngine] gdb/sdb not available');
    return false;
  }

  const db = gdb();
  db.schedules         = db.schedules || {};
  db.schedules[S.cid]  = db.schedules[S.cid] || {};

  // Persist the full schedule keyed by unitId
  db.schedules[S.cid][unitId] = {
    unitId,
    createdAt : new Date().toISOString(),
    createdBy : S.userId,
    params    : saleData.scheduleParams || {},
    rows      : scheduleRows,
  };

  // If there are DP amounts already received (e.g. booking advance entered)
  // register them as initial recovery entries so the ledger is populated
  const initPayments = (saleData.scheduleParams?.dpStages || [])
    .filter(dp => Number(dp.received) > 0);

  initPayments.forEach(dp => {
    db.recoveries[S.cid] = db.recoveries[S.cid] || [];
    const alreadyExists = (db.recoveries[S.cid]).find(
      r => r.uid === unitId && r.notes === `Initial: ${dp.label}`
    );
    if (!alreadyExists) {
      db.recoveries[S.cid].push({
        id    : uid(),
        cid   : S.cid,
        uid   : unitId,
        amt   : Number(dp.received),
        date  : dp.dueDate || saleData.soldDate || _isoToday(),
        ptype : 'Cash',
        rcpt  : saleData.bookingNo || '',
        notes : `Initial: ${dp.label}`,
        at    : new Date().toISOString(),
        by    : S.userId,
      });
    }
  });

  sdb(db);
  return true;
}

/* ──────────────────────────────────────────────────────────────
   7.  LOAD PERSISTED SCHEDULE
────────────────────────────────────────────────────────────── */
function loadSchedule(unitId) {
  if (typeof gdb === 'undefined') return null;
  const db = gdb();
  return (db.schedules?.[S.cid]?.[unitId]) || null;
}

/* ──────────────────────────────────────────────────────────────
   8.  DELETE SCHEDULE (used when sale is reversed / unit freed)
────────────────────────────────────────────────────────────── */
function deleteSchedule(unitId) {
  if (typeof gdb === 'undefined') return;
  const db = gdb();
  if (db.schedules?.[S.cid]?.[unitId]) {
    delete db.schedules[S.cid][unitId];
    sdb(db);
  }
}

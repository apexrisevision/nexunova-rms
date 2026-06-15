const fs = require('fs');
const f = 'js/pages/clients.js';
let s = fs.readFileSync(f, 'utf8');
let n = 0;

// ── 1) Profile financial strip → 5 KPIs (overdue = Σ closing WHERE overdue_days>0) ──
const oldKpi =
`  const contracted = rpRows.reduce((a,r)=>a+Number(r.net_price||0),0);
  const paid = rpRows.reduce((a,r)=>a+Number(r.paid_to_date||0),0);
  const balance = rpRows.reduce((a,r)=>a+Number(r.closing||0),0);
  const overdue = rpRows.reduce((a,r)=>a+Number(r.closing_old||0),0);
  if (fin) fin.innerHTML = NX.kpi({label:'Contracted (net)', value:fMF(contracted)}) + NX.kpi({label:'Paid', value:fMF(paid)}) + NX.kpi({label:'Balance', value:fMF(balance)}) + NX.kpi({label:'Overdue today', value:fMF(overdue)});`;
const newKpi =
`  // RP buckets (closing_old/current) degenerate to 0 in an all-time call; only 'closing'
  // and 'overdue_days' are meaningful. Overdue = row-level Σ closing WHERE overdue_days>0
  // (the dashboard's Overdue-Today formula at client scope), NOT closing_old.
  const contracted = rpRows.reduce((a,r)=>a+Number(r.net_price||0),0);
  const paid = rpRows.reduce((a,r)=>a+Number(r.paid_to_date||0),0);
  const remaining = contracted - paid;                                  // total still owed on the contract
  const dueToday = rpRows.reduce((a,r)=>a+Number(r.closing||0),0);       // billed-to-date minus paid
  const overdue = rpRows.reduce((a,r)=>a + (Number(r.overdue_days||0) > 0 ? Number(r.closing||0) : 0), 0);
  if (fin) fin.innerHTML = NX.kpi({label:'Contracted (net)', value:fMF(contracted)}) + NX.kpi({label:'Paid', value:fMF(paid)}) + NX.kpi({label:'Remaining', value:fMF(remaining)}) + NX.kpi({label:'Due till today', value:fMF(dueToday)}) + NX.kpi({label:'Overdue', value:fMF(overdue)});`;
if (s.includes(oldKpi)) { s = s.replace(oldKpi, newKpi); n++; } else console.log('MISS: profile KPI block');

// totals row referenced the old 'balance' var → use dueToday
const oldTot = "'<span>Net <strong>' + fMF(contracted) + '</strong></span><span>Paid <strong>' + fMF(paid) + '</strong></span><span>Balance <strong>' + fMF(balance) + '</strong></span>' +";
const newTot = "'<span>Net <strong>' + fMF(contracted) + '</strong></span><span>Paid <strong>' + fMF(paid) + '</strong></span><span>Due <strong>' + fMF(dueToday) + '</strong></span>' +";
if (s.includes(oldTot)) { s = s.replace(oldTot, newTot); n++; } else console.log('MISS: profile totals row');

// ── 2) List aggregation → overdue = Σ closing WHERE overdue_days>0 ──
const oldAgg =
`      a.balance += Number(r.closing||0);
      a.overdue += Number(r.closing_old||0);
      if (Number(r.closing||0) > 0) a.overdueDays = Math.max(a.overdueDays, Number(r.overdue_days||0));`;
const newAgg =
`      a.balance += Number(r.closing||0);
      if (Number(r.overdue_days||0) > 0) a.overdue += Number(r.closing||0);   // row-level overdue amount
      if (Number(r.closing||0) > 0 && Number(r.overdue_days||0) > 0) a.overdueDays = Math.max(a.overdueDays, Number(r.overdue_days||0));`;
if (s.includes(oldAgg)) { s = s.replace(oldAgg, newAgg); n++; } else console.log('MISS: list aggregation');

// ── 3) Risk filter → amount-based (don't over-flag paid-up clients with stale overdue_days) ──
const oldRisk =
`    if (_clRisk === 'overdue' && !(rp && (rp.overdue > 0 || rp.overdueDays > 0))) return false;
    if (_clRisk === 'aging90' && !(rp && rp.overdueDays >= 90)) return false;`;
const newRisk =
`    if (_clRisk === 'overdue' && !(rp && rp.overdue > 0)) return false;
    if (_clRisk === 'aging90' && !(rp && rp.overdue > 0 && rp.overdueDays >= 90)) return false;`;
if (s.includes(oldRisk)) { s = s.replace(oldRisk, newRisk); n++; } else console.log('MISS: risk filter');

fs.writeFileSync(f, s);
console.log('applied', n, 'of 4 edits');

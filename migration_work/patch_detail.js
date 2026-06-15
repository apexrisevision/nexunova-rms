const fs = require('fs');
const f = 'js/pages/sales.js';
let s = fs.readFileSync(f, 'utf8');
let log = [];

// 1) note #1 comment above totalPaid
const a1 = '  const totalPaid = rawInst.reduce((s, i) => s + Number(i.amount_paid || 0), 0);';
const note = [
  '  // BALANCE FROM INSTALLMENTS, NOT sales.remaining_amount (binding note #1).',
  '  // The 232 imported KBH sales carry down_payment=0 by migration design (their',
  '  // balance lives entirely in installments); new 5-step sales set down_payment =',
  '  // booking line. So remaining_amount is semantically inconsistent across the two',
  '  // cohorts — plan-vs-paid + balance MUST derive from Σ installments.amount_paid.'
].join('\r\n') + '\r\n' + a1;
if (s.includes(a1) && !s.includes('binding note #1')) { s = s.replace(a1, note); log.push('note#1 ok'); }
else log.push('note#1 SKIP');

// 2) three links before the Edit button
const editAnchor = "      ${(isA || isR) ? `<button class=\"btn btn-gh btn-sm\" onclick=\"openSaleEdit('${d.id}')\"";
const ico = (p) => '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">' + p + '</svg>';
const newBtns =
  '      ${d.status !== \'cancelled\' ? `<button class="btn btn-g btn-sm" onclick="nav(\'addpayment\',\'${d.unit_id}\')" style="display:inline-flex;align-items:center;gap:5px" title="Record a payment against this unit">' +
    ico('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>') + 'Record Payment</button>` : \'\'}\r\n' +
  '      <button class="btn btn-gh btn-sm" onclick="nav(\'reports\');setTimeout(function(){if(typeof openRptViewer===\'function\')openRptViewer(\'unit_statement\')},300)" style="display:inline-flex;align-items:center;gap:5px" title="Per-unit statement (plan vs payments)">' +
    ico('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>') + 'Unit Statement</button>\r\n' +
  '      <button class="btn btn-gh btn-sm" onclick="nav(\'reports\');setTimeout(function(){if(typeof openRptViewer===\'function\')openRptViewer(\'client_ledger\')},300)" style="display:inline-flex;align-items:center;gap:5px" title="Per-client ledger (running balance)">' +
    ico('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>') + 'Client Ledger</button>\r\n' +
  editAnchor;
if (s.includes(editAnchor) && !s.includes('Record Payment</button>')) { s = s.replace(editAnchor, newBtns); log.push('links ok'); }
else log.push('links SKIP (anchor:' + s.includes(editAnchor) + ')');

fs.writeFileSync(f, s);
console.log(log.join(' | '));

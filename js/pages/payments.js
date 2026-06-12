// ══════════════════════════════════════════════════════════════════════════
// RECORD PAYMENT — Phase 3F · rebuilt on the nx- foundation kit
// ──────────────────────────────────────────────────────────────────────────
// One focused flow: context pre-selected when launched from a sale/unit, else a
// sold-unit picker. Fields: amount · date · mode · reference · notes (+ cheque
// no/bank/date when mode=cheque). A future-dated cheque is NEVER booked as a
// payment — it is diverted to the PDC register (money not yet realized).
//
// ALLOCATION (Phase 3F): payments are written with installment_id = NULL via
// record_payment_simple. FIFO aging is computed at READ time by
// get_recovery_position (the one-aging-law); the explicit-allocation engine with
// approvals is register #14 (future). We expose NO delete/reverse on these
// payments here — reversal of a NULL-installment payment must re-run FIFO over
// the sale's remaining payments and belongs with #14 (see migration header).
//
// RPCs: get_unit_payment_summary (read), record_payment_simple, create_pdc_cheque.
// Names _pymSubStep / _pymShowProjectPicker / _pymShowClientSearch are kept so the
// global ESC back-handler in ui.js keeps working.
// ══════════════════════════════════════════════════════════════════════════

let _pymSubStep         = null;   // 'projects' | 'payment'
let _pymSelectedProject = null;
let _apUnitId           = null;
let _apSummary          = null;   // last get_unit_payment_summary payload

const _AP_MODES = [
  { value:'cash',          label:'Cash' },
  { value:'cheque',        label:'Cheque' },
  { value:'bank_transfer', label:'Bank Transfer' },
  { value:'online',        label:'Online / Mobile' },
  { value:'adjustment',    label:'Adjustment' },
  { value:'other',         label:'Other' },
];

// ── Entry point (nav('addpayment') or nav('addpayment', unitId)) ────────────
async function rAddPayment(preUnitId) {
  const el = document.getElementById('pg-addpayment');
  if (!el) return;
  if (!S?.cid) {
    el.innerHTML = NX.card(NX.empty({ icon:'alert-triangle', message:'No company selected.' }));
    return;
  }
  _apSummary = null;
  if (preUnitId) {
    const u = (window._unitsCache || []).find(x => x.id === preUnitId);
    _pymSelectedProject = u?.projectId || null;
    await _apShowPayment(preUnitId);
    return;
  }
  _apShowPicker();
}

// Kept names — ui.js ESC handler steps back to the picker through these.
function _pymShowProjectPicker() { _apShowPicker(); }
function _pymShowClientSearch()  { _apShowPicker(); }

// ── Sold-unit picker ────────────────────────────────────────────────────────
function _apShowPicker() {
  _pymSubStep = 'projects';
  _apUnitId = null;
  const el = document.getElementById('pg-addpayment');
  if (!el) return;

  const sold = (window._unitsCache || []).filter(u => u.isAvailable === false);
  if (!sold.length) {
    el.innerHTML =
      NX.pageHeader('Record Payment', '', { icon:'wallet' }) +
      NX.card(NX.empty({
        icon:'inbox',
        message:'No sold units yet — create a sale first to receive payments.',
        action: NX.button('Create sale', { variant:'primary', onclick:"nav('newsale')" })
      }));
    return;
  }

  el.innerHTML =
    NX.pageHeader('Record Payment', '', { icon:'wallet' }) +
    NX.card(
      '<div class="nx-field" style="margin-bottom:0">' +
        '<label class="nx-label">Find a sold unit</label>' +
        '<input class="nx-input" id="ap-q" placeholder="Search client, unit no or project…" ' +
          'autocomplete="off" oninput="_apRenderPicker(this.value)">' +
      '</div>', { compact:true }) +
    '<div id="ap-picker" style="margin-top:var(--fk-sp-3,12px)"></div>';

  document.getElementById('ap-q')?.focus();
  _apRenderPicker('');
}

function _apRenderPicker(q) {
  const wrap = document.getElementById('ap-picker');
  if (!wrap) return;
  const query = (q || '').trim().toLowerCase();
  const projName = id => (window._projectsCache || []).find(p => p.id === id)?.name
    || (window._projectsCache || []).find(p => p.id === id)?.projectName || '';

  const rows = (window._unitsCache || [])
    .filter(u => u.isAvailable === false)
    .filter(u => !query
      || (u.customerName || '').toLowerCase().includes(query)
      || (u.unitNo || '').toLowerCase().includes(query)
      || projName(u.projectId).toLowerCase().includes(query))
    .sort((a, b) => Number(b.pendingAmount || 0) - Number(a.pendingAmount || 0))
    .map(u => {
      const pend = Number(u.pendingAmount || 0);
      const bal  = pend <= 0
        ? NX.badge('Paid', 'success', { dot:true })
        : '<span class="num">PKR ' + fM(pend) + '</span>';
      return [
        NX.esc(u.customerName || '—'),
        NX.esc(u.unitNo || '—') + (projName(u.projectId) ? ' · <span style="color:var(--fk-text-muted)">' + NX.esc(projName(u.projectId)) + '</span>' : ''),
        bal,
        NX.button('Receive', { variant:'secondary', size:'sm', onclick:"_apShowPayment('" + u.id + "')" })
      ];
    });

  if (!rows.length) {
    wrap.innerHTML = NX.card(NX.empty({ icon:'search', message:'No matching sold units.' }));
    return;
  }
  wrap.innerHTML = NX.card(NX.table({
    cols: [{ label:'Client' }, { label:'Unit / Project' }, { label:'Outstanding', num:true }, { label:'', num:true, width:'110px' }],
    rows, flush:true
  }), { flush:true });
}

// ── Payment view for a specific unit ────────────────────────────────────────
async function _apShowPayment(unitId) {
  _pymSubStep = 'payment';
  _apUnitId = unitId;
  const el = document.getElementById('pg-addpayment');
  if (!el) return;

  el.innerHTML =
    NX.pageHeader('Record Payment',
      NX.button('Back to list', { variant:'ghost', size:'sm', onclick:'_apShowPicker()' }),
      { icon:'wallet' }) +
    NX.card('<div id="ap-ctx" class="num"></div>', { compact:true }) +
    '<div id="ap-body" style="margin-top:var(--fk-sp-4,16px)"></div>';

  const body = document.getElementById('ap-body');
  body.innerHTML = NX.card(NX.empty({ icon:'info', message:'Loading sale…' }));

  try {
    const { data, error } = await supabase.rpc('get_unit_payment_summary', { p_unit_id: unitId, p_company_id: S.cid });
    if (error) throw error;
    if (!data || !data.success) throw new Error(data?.error || 'No sale found for this unit');
    _apSummary = data;
    _apRenderContext();
    _apRenderForm();
  } catch (e) {
    body.innerHTML = NX.card(NX.empty({ icon:'alert-triangle', message:'Failed to load sale — ' + (e.message || 'error') }));
  }
}

function _apRenderContext() {
  const c = document.getElementById('ap-ctx');
  if (!c || !_apSummary) return;
  const s    = _apSummary.sale;
  const inst = Array.isArray(_apSummary.installments) ? _apSummary.installments : [];
  const net  = Number(s.net_amount || 0);
  const paid = inst.reduce((a, r) => a + Number(r.amount_paid || 0), 0);
  const out  = inst.reduce((a, r) => a + Number(r.outstanding  || 0), 0);

  c.innerHTML =
    '<div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start">' +
      '<div>' +
        '<div style="font-size:var(--fk-fs-title,14px);color:var(--fk-text)">' + NX.esc(s.client_name || '—') + '</div>' +
        '<div style="font-size:var(--fk-fs-label,11px);color:var(--fk-text-muted);margin-top:2px">Unit ' +
          NX.esc(s.unit_no || '—') + (s.project_name ? ' · ' + NX.esc(s.project_name) : '') +
          (s.sale_number ? ' · ' + NX.esc(s.sale_number) : '') + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:20px">' +
        _apStat('Sale value', net) + _apStat('Collected', paid) + _apStat('Balance', out, out > 0) +
      '</div>' +
    '</div>';
}

function _apStat(label, val, danger) {
  return '<div style="text-align:right">' +
    '<div style="font-size:var(--fk-fs-label,11px);color:var(--fk-text-muted);text-transform:uppercase;letter-spacing:.4px">' + label + '</div>' +
    '<div class="num" style="font-size:var(--fk-fs-kpi,20px);color:' + (danger ? 'var(--fk-danger)' : 'var(--fk-text)') + '">PKR ' + fM(val) + '</div>' +
  '</div>';
}

function _apRenderForm() {
  const body = document.getElementById('ap-body');
  if (!body) return;
  const today = (typeof td === 'function') ? td() : new Date().toISOString().slice(0, 10);

  const form =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3,12px)">' +
      NX.field({ label:'Amount (PKR)', name:'ap-amount', type:'number', required:true, attrs:'min="1" step="0.01" class="nx-input num"' }) +
      NX.field({ label:'Payment date', name:'ap-date', type:'date', value:today, required:true }) +
      NX.field({ label:'Mode', name:'ap-mode', el:'select', value:'cash', options:_AP_MODES, attrs:'onchange="_apOnModeChange()"' }) +
      NX.field({ label:'Reference / Txn no', name:'ap-ref', placeholder:'Bank / transaction reference (optional)' }) +
    '</div>' +
    '<div id="ap-cheque" style="display:none;margin-top:var(--fk-sp-3,12px)">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--fk-sp-3,12px)">' +
        NX.field({ label:'Cheque no', name:'ap-chqno' }) +
        NX.field({ label:'Bank', name:'ap-bank' }) +
        NX.field({ label:'Cheque date', name:'ap-chqdate', type:'date', value:today, attrs:'onchange="_apOnModeChange()"' }) +
      '</div>' +
      '<div id="ap-pdc-note" style="margin-top:var(--fk-sp-2,8px)"></div>' +
    '</div>' +
    '<div style="margin-top:var(--fk-sp-3,12px)">' +
      NX.field({ label:'Notes', name:'ap-notes', el:'textarea', placeholder:'Optional' }) +
    '</div>' +
    '<div id="ap-actions" style="display:flex;justify-content:flex-end;gap:var(--fk-sp-2,8px);margin-top:var(--fk-sp-4,16px)">' +
      NX.button('Save & Print receipt', { variant:'primary', icon:'plus', attrs:'id="ap-save"', onclick:'_apSave()' }) +
    '</div>';

  body.innerHTML = NX.card(form);
  _apOnModeChange();
  document.getElementById('ap-amount')?.focus();
}

// Show cheque fields for cheque mode; detect a post-dated cheque (→ PDC, no payment).
function _apOnModeChange() {
  const mode   = document.getElementById('ap-mode')?.value;
  const chqBox = document.getElementById('ap-cheque');
  const note   = document.getElementById('ap-pdc-note');
  const save   = document.getElementById('ap-save');
  const isCheque = mode === 'cheque';
  if (chqBox) chqBox.style.display = isCheque ? 'block' : 'none';

  const today  = (typeof td === 'function') ? td() : new Date().toISOString().slice(0, 10);
  const chqDate = document.getElementById('ap-chqdate')?.value;
  const isPDC  = isCheque && chqDate && chqDate > today;

  if (note) note.innerHTML = isPDC
    ? NX.banner('Cheque date is in the future — this is a post-dated cheque. It will be added to the PDC register, not booked as a payment.', 'warn')
    : '';
  if (save) {
    const span = save.querySelector('span');
    if (span) span.textContent = isPDC ? 'Add to PDC register' : 'Save & Print receipt';
  }
}

// ── Save ────────────────────────────────────────────────────────────────────
async function _apSave() {
  if (!_apSummary?.sale?.sale_id) { toast('No sale loaded', 'warn'); return; }
  const sale   = _apSummary.sale;
  const amount = parseFloat(document.getElementById('ap-amount')?.value || '0');
  const date   = document.getElementById('ap-date')?.value;
  const mode   = document.getElementById('ap-mode')?.value;
  const ref    = (document.getElementById('ap-ref')?.value || '').trim();
  const notes  = (document.getElementById('ap-notes')?.value || '').trim();
  const chqNo  = (document.getElementById('ap-chqno')?.value || '').trim();
  const bank   = (document.getElementById('ap-bank')?.value || '').trim();
  const chqDt  = document.getElementById('ap-chqdate')?.value;
  const today  = (typeof td === 'function') ? td() : new Date().toISOString().slice(0, 10);

  if (!(amount > 0)) { toast('Enter a positive amount', 'warn'); return; }
  if (!date)         { toast('Enter the payment date', 'warn'); return; }
  if (mode === 'cheque' && (!chqNo || !chqDt)) { toast('Cheque needs a number and a date', 'warn'); return; }

  const isPDC = mode === 'cheque' && chqDt > today;
  const btn = document.getElementById('ap-save');
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Saving…'; }

  try {
    if (isPDC) {
      // Post-dated cheque → PDC register. No payment is booked (money not realized).
      const { data, error } = await supabase.rpc('create_pdc_cheque', {
        p_company_id: S.cid,
        p_data: {
          sale_id:       sale.sale_id,
          client_id:     sale.client_id || null,
          cheque_no:     chqNo,
          bank_name:     bank || null,
          amount:        amount,
          cheque_date:   chqDt,
          received_date: today,
          status:        'pending',
          notes:         notes || null,
          created_by:    S.userId || S.name || 'system'
        }
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data.error || 'Failed to add PDC');
      _apShowSuccess({ pdc:true, chqNo, amount });
      return;
    }

    const { data, error } = await supabase.rpc('record_payment_simple', {
      p_company_id:     S.cid,
      p_sale_id:        sale.sale_id,
      p_amount:         amount,
      p_payment_date:   date,
      p_payment_method: mode,
      p_reference_no:   ref || (mode === 'cheque' ? chqNo : null) || null,
      p_bank_name:      bank || null,
      p_notes:          notes || null,
      p_created_by:     S.userId || null,
      p_cheque_date:    mode === 'cheque' ? chqDt : null,
      p_bank_id:        null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data.error || 'Payment failed');
    _apShowSuccess({ pdc:false, result:data, amount, mode, date, ref: ref || chqNo, bank, notes });
  } catch (e) {
    if (btn) { btn.disabled = false; _apOnModeChange(); }
    notify ? notify.error('Could not save', { detail: e.message || 'Error' }) : toast(e.message || 'Error', 'err');
  }
}

// ── Success card ────────────────────────────────────────────────────────────
async function _apShowSuccess(o) {
  const body = document.getElementById('ap-body');
  if (!body) return;

  if (o.pdc) {
    body.innerHTML = NX.card(
      '<div style="text-align:center;padding:var(--fk-sp-5,24px) 0">' +
        '<div style="color:var(--fk-warning);margin-bottom:8px">' + NX.icon('alert-triangle', 28) + '</div>' +
        '<div style="font-size:var(--fk-fs-title,14px)">Cheque ' + NX.esc(o.chqNo) + ' added to the PDC register</div>' +
        '<div style="font-size:var(--fk-fs-body,13px);color:var(--fk-text-muted);margin-top:4px">PKR ' + fM(o.amount) +
          ' — no payment booked until the cheque clears.</div>' +
        '<div style="display:flex;gap:8px;justify-content:center;margin-top:var(--fk-sp-4,16px)">' +
          NX.button('Open PDC register', { variant:'primary', onclick:"nav('pdc')" }) +
          NX.button('Record another', { variant:'secondary', onclick:"_apShowPayment('" + _apUnitId + "')" }) +
        '</div>' +
      '</div>');
    return;
  }

  // Re-fetch the summary so the receipt + balance reflect this payment (FIFO-maintained).
  let net = Number(_apSummary?.sale?.net_amount || 0), paid = 0, out = 0;
  try {
    const { data } = await supabase.rpc('get_unit_payment_summary', { p_unit_id: _apUnitId, p_company_id: S.cid });
    if (data?.success) {
      _apSummary = data;
      const inst = data.installments || [];
      net  = Number(data.sale.net_amount || 0);
      paid = inst.reduce((a, r) => a + Number(r.amount_paid || 0), 0);
      out  = inst.reduce((a, r) => a + Number(r.outstanding  || 0), 0);
    }
  } catch (_) { /* balance is best-effort */ }
  _apRenderContext();

  const s = _apSummary.sale;
  window._apLastReceipt = {
    paymentCode:   o.result.payment_code || '',
    amount:        o.amount,
    paymentMethod: o.mode,
    paymentDate:   o.date,
    referenceNo:   o.ref || '',
    bankName:      o.bank || '',
    notes:         o.notes || '',
    clientName:    s.client_name || '',
    unitNo:        s.unit_no || '',
    floorLabel:    s.floor_label || '',
    unitType:      s.unit_type || '',
    projectName:   s.project_name || '',
    saleNumber:    s.sale_number || '',
    receivingAgainst: 'Payment received',
    newAmtPaid:    paid,
    newOutstanding:out,
    netAmount:     net,
    recordedBy:    S.name || ''
  };

  body.innerHTML = NX.card(
    '<div style="text-align:center;padding:var(--fk-sp-5,24px) 0">' +
      '<div style="color:var(--fk-success);margin-bottom:8px">' + NX.icon('check', 28) + '</div>' +
      '<div style="font-size:var(--fk-fs-title,14px)">Payment recorded — ' + NX.esc(o.result.payment_code || '') + '</div>' +
      '<div class="num" style="font-size:var(--fk-fs-kpi,22px);margin-top:6px">PKR ' + fM(o.amount) + '</div>' +
      '<div style="font-size:var(--fk-fs-label,11px);color:var(--fk-text-muted);margin-top:2px">New balance: PKR ' + fM(out) + '</div>' +
      '<div style="display:flex;gap:8px;justify-content:center;margin-top:var(--fk-sp-4,16px)">' +
        NX.button('Print receipt', { variant:'primary', onclick:'_apPrintReceipt()' }) +
        NX.button('Record another', { variant:'secondary', onclick:"_apShowPayment('" + _apUnitId + "')" }) +
      '</div>' +
    '</div>');
}

function _apPrintReceipt() {
  if (window._apLastReceipt && typeof printPaymentReceiptSupa === 'function') {
    printPaymentReceiptSupa(window._apLastReceipt);
  } else {
    toast('Receipt unavailable', 'warn');
  }
}

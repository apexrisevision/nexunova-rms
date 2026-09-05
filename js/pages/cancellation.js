/* ════════════════════════════════════════════════════════════════════════════
   UNIT CANCELLATION — Single-page sectioned form
   Premium SaaS layout. Sticky right summary. RPC: execute_unit_cancellation
   ════════════════════════════════════════════════════════════════════════════ */

let _cxData = null;
let _cxBanks = [];
let _cxResult = null;

const _CX_REASONS_CLIENT = [
  'Financial constraints',
  'Personal / family reasons',
  'Relocation / moving abroad',
  'Found better option',
  'Project delay concerns',
  'Dissatisfaction with project',
  'Other'
];

const _CX_REASONS_COMPANY = [
  'Non-payment / defaulter',
  'Repeated late payments',
  'Bounced cheques',
  'Contract violation',
  'Inaccessible client',
  'Legal dispute',
  'Other'
];

function _cxReset() {
  const today = new Date().toISOString().slice(0, 10);
  _cxData = {
    unitId: null, projectId: null,
    saleId: null, clientId: null, agentId: null,
    unitObj: null, saleObj: null, clientObj: null, agentObj: null,
    totalPaid: 0, outstanding: 0, netAmount: 0, cashPaid: 0, bankPaid: 0, adjPaid: 0,
    cancellationType: 'client_initiated',
    cancellationDate: today,
    effectiveDate: today,
    reasonCategory: '',
    detailedReason: '',
    bookingForfeiture: 0,
    cancellationCharges: 0,
    processingFee: 0,
    otherDeductions: 0,
    otherDeductionsNote: '',
    netRefund: 0,
    refundMethod: 'immediate',
    refundPaymentMode: 'cash',
    refundBankId: '',
    refundReference: '',
    refundDate: today,
    expectedRefundDate: '',
    refundNotes: '',
    notes: ''
  };
  _cxBanks = [];
  _cxResult = null;
}

/* ── ENTRY ─────────────────────────────────────────────────────────────── */
async function rUnitCancel(preUnitId) {
  const el = document.getElementById('pg-unitcancel');
  if (!el) return;
  if (!S?.cid) {
    el.innerHTML = _cxNoCompanyHTML();
    return;
  }
  _cxReset();
  if (preUnitId) _cxData.unitId = preUnitId;

  _cxRender(el);
  await _cxLoadBanks();
  if (preUnitId) await _cxAutoLoadUnit(preUnitId);
}

function _cxNoCompanyHTML() {
  return `<div class="rops"><div class="rops-empty">
    <div class="rops-empty-mark">${_cxIco('warn')}</div>
    <div class="rops-empty-t">No company selected</div>
    <div class="rops-empty-s">Please sign in to continue.</div>
  </div></div>`;
}

async function _cxLoadBanks() {
  try {
    const { data } = await supabase.rpc('list_banks_active', { p_company_id: S.cid });
    _cxBanks = data || [];
  } catch { _cxBanks = []; }
}

/* ── RENDER ────────────────────────────────────────────────────────────── */
function _cxRender(elParam) {
  const el = elParam || document.getElementById('pg-unitcancel');
  if (!el) return;
  if (typeof _opsWarmCSS === 'function') _opsWarmCSS();

  el.innerHTML = `
    <div class="rops" id="cx-root">
      ${_cxHeaderHTML()}
      <!-- Form navigation bar (browse past cancellations) -->
      <div id="cx-form-nav"></div>
      <div class="rops-grid">
        <div class="rops-main">
          ${_cxSecUnitHTML()}
          ${_cxSecReasonHTML()}
          ${_cxSecReviewHTML()}
        </div>
        <aside class="rops-aside">
          ${_cxSummaryHTML()}
        </aside>
      </div>
    </div>`;

  // Populate project selector + auto-load if pre-selected
  _cxPopulateProjects();

  // Mount form-nav — browse past cancellations
  if (typeof mountFormNav === 'function') {
    mountFormNav({
      targetSel: '#cx-form-nav',
      entity:    'cancellation',
      dateField: 'cancellation_date',
      currentId: null,
      storageKey:'rms.fnav.cancellation',
      loadList: async () => {
        try {
          const { data } = await supabase.rpc('list_cancellations_for_fnav', { p_company_id: S.cid });
          return data || [];
        } catch (e) { return []; }
      },
      // Opening a past cancellation goes to the unit detail (cancellations are immutable)
      openEntry: async (cancId) => {
        try {
          const { data } = await supabase.rpc('get_cancellation_by_id', { p_id: cancId, p_company_id: S.cid });
          if (data?.unit_id) openUD(data.unit_id);
          else if (typeof toast === 'function') toast('Could not open cancellation', 'warn');
        } catch (e) {}
      },
      onEdit: () => {
        if (typeof toast === 'function') toast('Cancellations cannot be edited — they are immutable for audit.', 'warn');
      },
      onDelete: () => {
        if (typeof toast === 'function') toast('Cancellations cannot be deleted — they are immutable for audit.', 'warn');
      },
      onSave:    () => _cxSubmit(),
      onCancel:  () => nav('units'),
      saveLabel: 'Confirm Cancel'
    });
  }
}

function _cxHeaderHTML() {
  return `
    <div class="rops-hd">
      <div class="rops-hd-l">
        <div class="rops-hd-mark is-danger">${_cxIco('x')}</div>
        <div>
          <h1 class="rops-hd-title">Cancel Unit</h1>
          <div class="rops-hd-sub">Terminate sale and return unit to inventory</div>
        </div>
      </div>
      <div class="rops-hd-r">
        <button class="rops-btn rops-btn-ghost rops-btn-sm" onclick="nav('units')">Cancel</button>
      </div>
    </div>`;
}

/* ── SECTION 1 — Unit & Buyer ─────────────────────────────────────────── */
function _cxSecUnitHTML() {
  return `
    <section class="rops-sec is-active" id="cx-sec-unit">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">1</div>
          <div>
            <h3 class="rops-sec-title">Unit & Buyer</h3>
            <div class="rops-sec-desc">Pick the sold unit you want to cancel.</div>
          </div>
        </div>
        <span class="rops-sec-badge is-req">Required</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-g2" style="max-width:640px">
          <div class="rops-fr">
            <label class="rops-fl">Project <span class="req">*</span></label>
            <select class="rops-sel" id="cx-project" onchange="_cxOnProject(this.value)">
              <option value="">Select project</option>
            </select>
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Sold / Booked Unit <span class="req">*</span></label>
            <select class="rops-sel" id="cx-unit" onchange="_cxOnUnit(this.value)">
              <option value="">Choose project first</option>
            </select>
          </div>
        </div>
        <div id="cx-buyer-info" style="margin-top:16px"></div>
      </div>
    </section>`;
}

function _cxPopulateProjects() {
  const sel = document.getElementById('cx-project');
  if (!sel) return;
  const projects = window._projectsCache || [];
  const soldByProj = {};
  (window._unitsCache || []).forEach(u => {
    if (!u.isAvailable) soldByProj[u.projectId] = (soldByProj[u.projectId] || 0) + 1;
  });

  // Show ALL projects always; projects with no sold units appear disabled so
  // the user sees them in context rather than a baffling empty dropdown.
  const totalSold = Object.values(soldByProj).reduce((s, n) => s + n, 0);
  const opts = projects.map(p => {
    const cnt  = soldByProj[p.id] || 0;
    const name = esc(p.projectName || p.name || 'Unnamed project');
    return cnt
      ? `<option value="${esc(p.id)}">${name} · ${cnt} sold</option>`
      : `<option value="" disabled style="color:var(--text-faint)">${name} · no sold units</option>`;
  }).join('');

  if (!projects.length) {
    sel.innerHTML = `<option value="">No projects exist yet</option>`;
  } else if (!totalSold) {
    sel.innerHTML = `<option value="">No sold units yet — record a sale first</option>${opts}`;
  } else {
    sel.innerHTML = `<option value="">Select project</option>${opts}`;
  }

  // Pre-select if unit was passed
  if (_cxData.unitId) {
    const u = (window._unitsCache || []).find(x => x.id === _cxData.unitId);
    if (u?.projectId) {
      sel.value = u.projectId;
      _cxOnProject(u.projectId, _cxData.unitId);
    }
  }
}

function _cxOnProject(projectId, autoUnit) {
  _cxData.projectId = projectId;
  const uSel = document.getElementById('cx-unit');
  if (!uSel) return;
  if (!projectId) {
    uSel.innerHTML = `<option value="">Choose project first</option>`;
    document.getElementById('cx-buyer-info').innerHTML = '';
    _cxUpdateSummary();
    return;
  }
  const units = (window._unitsCache || []).filter(u => u.projectId === projectId && !u.isAvailable);
  const opts = units.map(u =>
    `<option value="${esc(u.id)}">${esc(u.unitNo)}${u.floorLabel ? ' · ' + u.floorLabel : ''}${u.type ? ' · ' + u.type : ''}</option>`
  ).join('');
  uSel.innerHTML = `<option value="">Choose unit</option>${opts}`;
  if (autoUnit) {
    uSel.value = autoUnit;
    _cxOnUnit(autoUnit);
  }
}

async function _cxAutoLoadUnit(unitId) {
  const u = (window._unitsCache || []).find(x => x.id === unitId);
  if (u?.projectId) _cxOnProject(u.projectId, unitId);
}

async function _cxOnUnit(unitId) {
  _cxData.unitId = unitId;
  const info = document.getElementById('cx-buyer-info');
  if (!info || !unitId) { if (info) info.innerHTML = ''; _cxUpdateSummary(); return; }
  info.innerHTML = `<div class="rops-buyer-card"><div class="rops-bc-item"><span class="rops-spin"></span> Loading buyer ledger…</div></div>`;

  try {
    const [pymRes, saleRes] = await Promise.all([
      supabase.rpc('get_unit_payment_summary', { p_unit_id: unitId, p_company_id: S.cid }),
      supabase.rpc('get_active_sale_for_unit', { p_unit_id: unitId, p_company_id: S.cid })
    ]);

    const pym = pymRes.data;
    const sale = saleRes.data;
    if (!sale) {
      info.innerHTML = `<div class="rops-alert is-warn">${_cxIco('warn')} No active sale exists on this unit.</div>`;
      _cxData.saleId = null;
      _cxUpdateSummary();
      return;
    }

    _cxData.saleId = sale.id;
    _cxData.clientId = sale.client_id;
    _cxData.agentId = sale.agent_id;
    _cxData.saleObj = sale;

    const insts = pym?.installments || [];
    let totalPaid = 0;
    insts.forEach(i => { totalPaid += parseFloat(i.amount_paid || 0); });
    if (pym?.down_payment) totalPaid += parseFloat(pym.down_payment.amount_paid || 0);
    const netAmt = parseFloat(pym?.sale?.net_amount || sale.net_amount || 0);
    const outstanding = Math.max(0, netAmt - totalPaid);

    // Payment breakdown
    const pmtRes = await supabase.rpc('list_payments_for_sale', { p_sale_id: sale.id, p_company_id: S.cid });
    const pmts = pmtRes.data || [];
    const cashPaid = pmts.filter(p => p.payment_method === 'cash' && p.payment_category !== 'adjustment').reduce((s, p) => s + parseFloat(p.amount), 0);
    // 'bank' is not a value payment_method has ever held — the column holds
    // bank_transfer / cheque. Same set as search.js:1154. See
    // docs/findings/2026-09-05-E-bank-literal-never-matches.md
    const bankPaid = pmts.filter(p => ['bank_transfer', 'bank', 'cheque', 'online'].includes(p.payment_method) && p.payment_category !== 'adjustment').reduce((s, p) => s + parseFloat(p.amount), 0);
    const adjPaid = pmts.filter(p => p.payment_category === 'adjustment').reduce((s, p) => s + parseFloat(p.amount), 0);

    _cxData.totalPaid = totalPaid;
    _cxData.outstanding = outstanding;
    _cxData.netAmount = netAmt;
    _cxData.cashPaid = cashPaid;
    _cxData.bankPaid = bankPaid;
    _cxData.adjPaid = adjPaid;

    const [clientRes, agentRes, unitObj] = await Promise.all([
      supabase.rpc('get_client_lite', { p_id: sale.client_id, p_company_id: S.cid }),
      sale.agent_id ? supabase.rpc('get_agent_lite', { p_id: sale.agent_id, p_company_id: S.cid }) : Promise.resolve({ data: null }),
      Promise.resolve((window._unitsCache || []).find(u => u.id === unitId))
    ]);

    _cxData.clientObj = clientRes.data;
    _cxData.agentObj = agentRes.data;
    _cxData.unitObj = unitObj;

    const prj = (window._projectsCache || []).find(p => p.id === _cxData.projectId);
    const c = clientRes.data || {};
    const a = agentRes.data;

    // Internal: detect re-sale or transfer
    const internalChips = [];
    if (sale.is_resale) internalChips.push(`<span class="rops-internal" style="margin-left:8px">RE-SALE</span>`);
    if (sale.is_transfer) internalChips.push(`<span class="rops-internal" style="margin-left:8px">TRANSFER</span>`);

    info.innerHTML = `
      <div class="rops-buyer-card">
        <div class="rops-bc-item"><span class="l">Unit</span><span class="v">${esc(unitObj?.unitNo || '')}${unitObj?.floorLabel ? ' · ' + esc(unitObj.floorLabel) : ''}</span></div>
        <div class="rops-bc-item"><span class="l">Project</span><span class="v">${esc(prj?.name || prj?.projectName || '')}</span></div>
        <div class="rops-bc-item"><span class="l">Type / Area</span><span class="v">${esc(unitObj?.type || '—')}${unitObj?.area ? ' · ' + Number(unitObj.area).toLocaleString() + ' sqft' : ''}</span></div>
        <div class="rops-bc-item"><span class="l">Buyer</span><span class="v">${esc(c.full_name || '')}${internalChips.join('')}</span></div>
        <div class="rops-bc-item"><span class="l">CNIC</span><span class="v">${esc(c.cnic || '—')}</span></div>
        <div class="rops-bc-item"><span class="l">Phone</span><span class="v">${esc(c.phone_primary || '—')}</span></div>
        <div class="rops-bc-item"><span class="l">Sale No</span><span class="v">${esc(sale.sale_number || '')}</span></div>
        <div class="rops-bc-item"><span class="l">Sale Date</span><span class="v">${esc(sale.sale_date || '')}</span></div>
        ${a ? `<div class="rops-bc-item"><span class="l">Agent</span><span class="v">${esc(a.full_name)} (${esc(a.agent_code)})</span></div>` : ''}
      </div>

      <div class="rops-ledger" style="margin-top:14px">
        <div class="rops-ledger-hd">Buyer Ledger</div>
        <div class="rops-ledger-row"><span class="l">Sale Price</span><span class="r">PKR ${fmtPK(netAmt)}</span></div>
        <div class="rops-ledger-row"><span class="l">Cash Received</span><span class="r">PKR ${fmtPK(cashPaid)}</span></div>
        <div class="rops-ledger-row"><span class="l">Bank Received</span><span class="r">PKR ${fmtPK(bankPaid)}</span></div>
        ${adjPaid ? `<div class="rops-ledger-row"><span class="l">Adjustment</span><span class="r">PKR ${fmtPK(adjPaid)}</span></div>` : ''}
        <div class="rops-ledger-row is-total"><span class="l">Total Paid</span><span class="r pos">PKR ${fmtPK(totalPaid)}</span></div>
        <div class="rops-ledger-row"><span class="l">Outstanding</span><span class="r ${outstanding > 0 ? 'neg' : 'muted'}">PKR ${fmtPK(outstanding)}</span></div>
      </div>`;

    _cxMarkSecDone('cx-sec-unit');
    _cxUpdateSummary();
  } catch (e) {
    info.innerHTML = `<div class="rops-alert is-danger">${_cxIco('warn')} Error loading buyer: ${esc(e.message)}</div>`;
    _cxData.saleId = null;
    _cxUpdateSummary();
  }
}

/* ── SECTION 2 — Reason ────────────────────────────────────────────────── */
function _cxSecReasonHTML() {
  return `
    <section class="rops-sec" id="cx-sec-reason">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">2</div>
          <div>
            <h3 class="rops-sec-title">Cancellation Reason</h3>
            <div class="rops-sec-desc">Was it the client's choice or company decision?</div>
          </div>
        </div>
        <span class="rops-sec-badge is-req">Required</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-opts is-2col" style="margin-bottom:18px">
          <div class="rops-opt is-on" id="cx-type-client" onclick="_cxSetType('client_initiated')">
            <div class="rops-opt-rad"></div>
            <div class="rops-opt-bd">
              <div class="rops-opt-t">Client-Initiated</div>
              <div class="rops-opt-d">Buyer requested cancellation. Standard deductions apply.</div>
            </div>
          </div>
          <div class="rops-opt is-danger" id="cx-type-company" onclick="_cxSetType('company_shortage')">
            <div class="rops-opt-rad"></div>
            <div class="rops-opt-bd">
              <div class="rops-opt-t">Company-Initiated</div>
              <div class="rops-opt-d">Buyer in default / non-payment. Forced cancellation.</div>
            </div>
          </div>
        </div>

        <div class="rops-g2" style="max-width:640px">
          <div class="rops-fr">
            <label class="rops-fl">Cancellation Date <span class="req">*</span></label>
            <input type="date" class="rops-inp" id="cx-canc-date" value="${esc(_cxData.cancellationDate)}" oninput="_cxData.cancellationDate=this.value">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Effective Date <span class="req">*</span></label>
            <input type="date" class="rops-inp" id="cx-eff-date" value="${esc(_cxData.effectiveDate)}" oninput="_cxData.effectiveDate=this.value">
          </div>
          <div class="rops-fr fr-full">
            <label class="rops-fl">Reason Category <span class="req">*</span></label>
            <select class="rops-sel" id="cx-reason-cat" onchange="_cxData.reasonCategory=this.value">
              <option value="">Select reason</option>
              ${_cxReasonOpts()}
            </select>
          </div>
          <div class="rops-fr fr-full">
            <label class="rops-fl">Detailed Reason <span class="req">*</span></label>
            <textarea class="rops-ta" id="cx-detail-reason" rows="3" placeholder="Explain the situation in detail…" oninput="_cxData.detailedReason=this.value">${esc(_cxData.detailedReason)}</textarea>
            <div class="rops-fh">Minimum 20 characters for client-initiated, 30 for company-initiated.</div>
          </div>
          <div class="rops-fr fr-full">
            <label class="rops-fl">Internal Notes</label>
            <input type="text" class="rops-inp" id="cx-notes" placeholder="Any additional notes…" value="${esc(_cxData.notes)}" oninput="_cxData.notes=this.value">
          </div>
        </div>
      </div>
    </section>`;
}

function _cxReasonOpts() {
  const reasons = _cxData.cancellationType === 'company_shortage' ? _CX_REASONS_COMPANY : _CX_REASONS_CLIENT;
  return reasons.map(r => `<option value="${esc(r)}" ${_cxData.reasonCategory === r ? 'selected' : ''}>${esc(r)}</option>`).join('');
}

function _cxSetType(type) {
  _cxData.cancellationType = type;
  document.getElementById('cx-type-client')?.classList.toggle('is-on', type === 'client_initiated');
  document.getElementById('cx-type-company')?.classList.toggle('is-on', type === 'company_shortage');
  // Refresh reason dropdown
  const sel = document.getElementById('cx-reason-cat');
  if (sel) {
    _cxData.reasonCategory = '';
    sel.innerHTML = `<option value="">Select reason</option>${_cxReasonOpts()}`;
  }
  _cxUpdateSummary();
}

/* ── SECTION 3 — Financial settlement ─────────────────────────────────── */
function _cxSecFinancialHTML() {
  return `
    <section class="rops-sec" id="cx-sec-fin">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">3</div>
          <div>
            <h3 class="rops-sec-title">Financial Settlement</h3>
            <div class="rops-sec-desc">Enter deductions; net refund will calculate automatically.</div>
          </div>
        </div>
        <span class="rops-sec-badge is-opt">Optional</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-g2" style="max-width:720px">
          <div class="rops-fr">
            <label class="rops-fl">Booking Forfeiture (PKR)</label>
            <input type="text" inputmode="numeric" class="rops-inp is-amt" id="cx-ded-booking" value="0" oninput="_cxRecalc()">
            <div class="rops-fh">Amount forfeited per contract for booking.</div>
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Cancellation Charges (PKR)</label>
            <input type="text" inputmode="numeric" class="rops-inp is-amt" id="cx-ded-cancel" value="0" oninput="_cxRecalc()">
            <div class="rops-fh">Standard cancellation administrative fee.</div>
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Processing Fee (PKR)</label>
            <input type="text" inputmode="numeric" class="rops-inp is-amt" id="cx-ded-proc" value="0" oninput="_cxRecalc()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Other Deductions (PKR)</label>
            <input type="text" inputmode="numeric" class="rops-inp is-amt" id="cx-ded-other" value="0" oninput="_cxRecalc()">
          </div>
          <div class="rops-fr fr-full">
            <label class="rops-fl">Other Deductions Note</label>
            <input type="text" class="rops-inp" id="cx-ded-other-note" placeholder="Describe other deductions…" oninput="_cxData.otherDeductionsNote=this.value">
          </div>
        </div>

        <div class="rops-ledger" style="margin-top:18px; max-width:520px">
          <div class="rops-ledger-hd">Refund Calculation</div>
          <div class="rops-ledger-row"><span class="l">Total Paid</span><span class="r">PKR <span id="cx-calc-paid">0</span></span></div>
          <div class="rops-ledger-row"><span class="l">Less: Deductions</span><span class="r neg">− PKR <span id="cx-calc-ded">0</span></span></div>
          <div class="rops-ledger-row is-total"><span class="l">Net Refund Due</span><span class="r pos" id="cx-calc-net">PKR 0</span></div>
          <div id="cx-calc-warn" style="margin-top:8px; font-size:11px; color:var(--err); display:none">Deductions exceed total paid — please review.</div>
        </div>
      </div>
    </section>`;
}

function _cxRecalc() {
  const get = id => parseAmt(document.getElementById(id)?.value);
  _cxData.bookingForfeiture = get('cx-ded-booking');
  _cxData.cancellationCharges = get('cx-ded-cancel');
  _cxData.processingFee = get('cx-ded-proc');
  _cxData.otherDeductions = get('cx-ded-other');
  const ded = _cxData.bookingForfeiture + _cxData.cancellationCharges + _cxData.processingFee + _cxData.otherDeductions;
  const net = Math.max(0, _cxData.totalPaid - ded);
  _cxData.netRefund = net;

  const $ = id => document.getElementById(id);
  if ($('cx-calc-paid')) $('cx-calc-paid').textContent = fmtPK(_cxData.totalPaid);
  if ($('cx-calc-ded')) $('cx-calc-ded').textContent = fmtPK(ded);
  if ($('cx-calc-net')) {
    $('cx-calc-net').textContent = 'PKR ' + fmtPK(net);
    $('cx-calc-net').className = 'r ' + (net > 0 ? 'pos' : 'muted');
  }
  const warn = $('cx-calc-warn');
  if (warn) warn.style.display = ded > _cxData.totalPaid ? 'block' : 'none';
  _cxUpdateSummary();
}

/* ── SECTION 4 — Refund method ─────────────────────────────────────────── */
function _cxSecRefundHTML() {
  const methods = [
    { val: 'immediate', t: 'Immediate Refund', d: 'Refund paid now via cash or bank transfer.' },
    { val: 'payable', t: 'Refund Payable', d: 'Pay later — creates a pending payable.' },
    { val: 'adjustment', t: 'Adjust Against Another Unit', d: 'Client is buying another unit — net the amount.' },
    { val: 'no_refund', t: 'Full Forfeiture (No Refund)', d: 'All paid amount retained per contract terms.' }
  ];
  return `
    <section class="rops-sec" id="cx-sec-refund">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">4</div>
          <div>
            <h3 class="rops-sec-title">Refund Method</h3>
            <div class="rops-sec-desc">How will the net refund (if any) be settled?</div>
          </div>
        </div>
        <span class="rops-sec-badge is-req">Required</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-opts" id="cx-refund-opts" style="margin-bottom:16px; max-width:720px">
          ${methods.map(m => `
            <div class="rops-opt ${_cxData.refundMethod === m.val ? 'is-on' : ''}" data-val="${m.val}" onclick="_cxSetRefund('${m.val}')">
              <div class="rops-opt-rad"></div>
              <div class="rops-opt-bd">
                <div class="rops-opt-t">${m.t}</div>
                <div class="rops-opt-d">${m.d}</div>
              </div>
            </div>`).join('')}
        </div>
        <div id="cx-refund-detail" style="max-width:720px">${_cxRefundDetailHTML()}</div>
      </div>
    </section>`;
}

function _cxSetRefund(val) {
  _cxData.refundMethod = val;
  document.querySelectorAll('#cx-refund-opts .rops-opt').forEach(o => {
    o.classList.toggle('is-on', o.dataset.val === val);
  });
  const det = document.getElementById('cx-refund-detail');
  if (det) det.innerHTML = _cxRefundDetailHTML();
}

function _cxRefundDetailHTML() {
  const d = _cxData;
  const bankOpts = _cxBanks.map(b =>
    `<option value="${esc(b.id)}" ${d.refundBankId === b.id ? 'selected' : ''}>${esc(b.bank_name)} — ${esc(b.account_title)}</option>`
  ).join('');

  if (d.refundMethod === 'immediate') {
    return `
      <div class="rops-g2">
        <div class="rops-fr">
          <label class="rops-fl">Payment Mode <span class="req">*</span></label>
          <select class="rops-sel" id="cx-ref-mode" onchange="_cxData.refundPaymentMode=this.value; _cxToggleBank()">
            <option value="cash" ${d.refundPaymentMode === 'cash' ? 'selected' : ''}>Cash</option>
            <option value="bank" ${d.refundPaymentMode === 'bank' ? 'selected' : ''}>Bank Transfer</option>
          </select>
        </div>
        <div class="rops-fr" id="cx-ref-bank-row" style="${d.refundPaymentMode === 'bank' ? '' : 'display:none'}">
          <label class="rops-fl">Company Bank <span class="req">*</span></label>
          <select class="rops-sel" id="cx-ref-bank" onchange="_cxData.refundBankId=this.value">
            <option value="">Select bank</option>${bankOpts}
          </select>
        </div>
        <div class="rops-fr">
          <label class="rops-fl">Reference / Transaction No</label>
          <input type="text" class="rops-inp" id="cx-ref-ref" placeholder="TRX-XXXXXX" value="${esc(d.refundReference)}" oninput="_cxData.refundReference=this.value">
        </div>
        <div class="rops-fr">
          <label class="rops-fl">Refund Date <span class="req">*</span></label>
          <input type="date" class="rops-inp" id="cx-ref-date" value="${esc(d.refundDate)}" oninput="_cxData.refundDate=this.value">
        </div>
      </div>`;
  }
  if (d.refundMethod === 'payable') {
    return `
      <div class="rops-g2">
        <div class="rops-fr">
          <label class="rops-fl">Expected Payment Date <span class="req">*</span></label>
          <input type="date" class="rops-inp" id="cx-ref-exp" value="${esc(d.expectedRefundDate)}" oninput="_cxData.expectedRefundDate=this.value">
        </div>
        <div class="rops-fr">
          <label class="rops-fl">Reason for Delay <span class="req">*</span></label>
          <input type="text" class="rops-inp" id="cx-ref-notes" placeholder="Reason refund is deferred…" value="${esc(d.refundNotes)}" oninput="_cxData.refundNotes=this.value">
        </div>
      </div>`;
  }
  if (d.refundMethod === 'adjustment') {
    return `
      <div class="rops-fr">
        <label class="rops-fl">Adjustment Note <span class="req">*</span></label>
        <input type="text" class="rops-inp" id="cx-ref-notes" placeholder="Unit number / sale this is adjusted against…" value="${esc(d.refundNotes)}" oninput="_cxData.refundNotes=this.value">
      </div>`;
  }
  if (d.refundMethod === 'no_refund') {
    return `
      <div class="rops-alert is-danger" style="margin-bottom:12px">
        ${_cxIco('warn')}
        <div><strong>Full forfeiture.</strong> All paid amounts retained per contract. Management approval recommended.</div>
      </div>
      <div class="rops-fr">
        <label class="rops-fl">Justification <span class="req">*</span></label>
        <textarea class="rops-ta" id="cx-ref-notes" rows="2" placeholder="Explain why full forfeiture is justified…" oninput="_cxData.refundNotes=this.value">${esc(d.refundNotes)}</textarea>
      </div>`;
  }
  return '';
}

function _cxToggleBank() {
  const row = document.getElementById('cx-ref-bank-row');
  if (row) row.style.display = _cxData.refundPaymentMode === 'bank' ? '' : 'none';
}

/* ── SECTION 5 — Review & confirm ──────────────────────────────────────── */
function _cxSecReviewHTML() {
  return `
    <section class="rops-sec" id="cx-sec-review">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">3</div>
          <div>
            <h3 class="rops-sec-title">Review & Confirm</h3>
            <div class="rops-sec-desc">After confirming: the sale is voided, the unit returns to inventory, and the agent's commission is reversed.</div>
          </div>
        </div>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-alert is-warn">
          ${_cxIco('warn')}
          <div>This action cannot be undone from the UI. The unit will be flagged internally as <strong>ex-cancelled</strong> when it goes back to inventory — clients will never see this tag.</div>
        </div>
        <div class="rops-alert" style="background:var(--fk-bg-subtle);border:1px solid var(--fk-border);margin-top:10px">
          ${_cxIco('warn')}
          <div><strong>Refunds &amp; financial settlement are handled in QuickBooks.</strong> RMS only records the cancellation — it does not move money.</div>
        </div>
        <div class="rops-confirm is-danger">
          <input type="checkbox" id="cx-confirm">
          <div class="rops-confirm-text">I confirm this cancellation is final and all details above are correct.</div>
        </div>
        <div style="margin-top:16px; display:flex; gap:10px; justify-content:flex-end">
          <button class="rops-btn rops-btn-ghost" onclick="nav('units')">Cancel</button>
          <button class="rops-btn rops-btn-danger rops-btn-lg" id="cx-submit-btn" onclick="_cxSubmit()">Confirm Cancellation</button>
        </div>
      </div>
    </section>`;
}

/* ── Sticky summary ────────────────────────────────────────────────────── */
function _cxSummaryHTML() {
  return `
    <div class="rops-sum" id="cx-summary">
      <div class="rops-sum-hd"><h4 class="rops-sum-title">Cancellation Summary</h4></div>
      <div class="rops-sum-bd" id="cx-sum-bd">${_cxSumBodyHTML()}</div>
    </div>`;
}

function _cxSumBodyHTML() {
  const d = _cxData;
  const u = d.unitObj;
  const c = d.clientObj;
  return `
    <div class="rops-sum-row"><span class="l">Unit</span><span class="r">${u ? esc(u.unitNo) : '—'}</span></div>
    <div class="rops-sum-row"><span class="l">Buyer</span><span class="r">${c ? esc((c.full_name || '').split(' ')[0] || '—') : '—'}</span></div>
    <div class="rops-sum-row"><span class="l">Type</span><span class="r">${d.cancellationType === 'company_shortage' ? 'Company' : 'Client'}</span></div>`;
}

function _cxRefundLabel() {
  return {
    immediate: 'Immediate',
    payable: 'Payable',
    adjustment: 'Adjust',
    no_refund: 'Forfeit'
  }[_cxData.refundMethod] || '—';
}

function _cxUpdateSummary() {
  const bd = document.getElementById('cx-sum-bd');
  const net = document.getElementById('cx-sum-net');
  if (bd) bd.innerHTML = _cxSumBodyHTML();
  if (net) {
    net.textContent = 'PKR ' + fmtPK(_cxData.netRefund);
    net.className = 'rops-sum-hero-val ' + (_cxData.netRefund > 0 ? 'pos' : 'neg');
  }
}

function _cxMarkSecDone(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('is-active'); el.classList.add('is-done'); }
}

/* ── Validation + submit ───────────────────────────────────────────────── */
function _cxValidate() {
  const d = _cxData;
  const fail = (msg) => { _cxToast(msg, 'error'); return false; };

  if (!d.unitId) return fail('Please select a unit.');
  if (!d.saleId) return fail('No active sale found for this unit.');
  if (!d.cancellationType) return fail('Please select cancellation type.');
  if (!d.reasonCategory) return fail('Please select a reason category.');

  const minLen = d.cancellationType === 'company_shortage' ? 30 : 20;
  if (!d.detailedReason || d.detailedReason.length < minLen) {
    return fail(`Detailed reason must be at least ${minLen} characters.`);
  }
  if (!document.getElementById('cx-confirm')?.checked) return fail('Please tick the confirmation checkbox.');

  return true;
}

async function _cxSubmit() {
  if (!_cxValidate()) return;
  const btn = document.getElementById('cx-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="rops-spin"></span> Processing…`; }

  const d = _cxData;
  try {
    const { data, error } = await supabase.rpc('execute_unit_cancellation', {
      p_company_id:        S.cid,
      p_unit_id:           d.unitId,
      p_project_id:        d.projectId,
      p_sale_id:           d.saleId,
      p_client_id:         d.clientId,
      p_agent_id:          d.agentId || null,
      p_cancellation_date: d.cancellationDate,
      p_effective_date:    d.effectiveDate || d.cancellationDate,
      p_cancellation_type: d.cancellationType,
      p_reason_category:   d.reasonCategory,
      p_detailed_reason:   d.detailedReason,
      p_total_paid:        0,
      p_booking_forfeiture: 0,
      p_cancellation_charges: 0,
      p_late_penalty:      0,
      p_processing_fee:    0,
      p_other_deductions:  0,
      p_other_deductions_note: null,
      p_net_refund:        0,
      p_refund_method:     null,
      p_refund_payment_mode: null,
      p_refund_bank_id:    null,
      p_refund_reference:  null,
      p_refund_date:       null,
      p_expected_refund_date: null,
      p_refund_notes:      null,
      p_commission_action: 'no_clawback',
      p_client_flag:       'none',
      p_initiated_by:      S.uname || S.email || null,
      p_notes:             d.notes || null
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Unknown server error');

    // Soft-block: cancellation is pending admin approval, not yet executed
    if (data.status === 'pending_approval') {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Confirm Cancellation'; }
      _cxRenderApprovalPending(data.request_id);
      if (typeof refreshApprovalsBadge === 'function') refreshApprovalsBadge();
      return;
    }

    _cxResult = data;
    if (typeof loadAllData === 'function') loadAllData();
    else if (typeof _refreshCaches === 'function') _refreshCaches();

    _cxRenderSuccess(data);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Cancellation'; }
    _cxToast('Cancellation failed: ' + e.message, 'error');
  }
}

function _cxRenderSuccess(data) {
  const el = document.getElementById('pg-unitcancel');
  if (!el) return;
  el.innerHTML = `
    <div class="rops">
      <div class="rops-success-screen">
        <div class="rops-success-mark">${_cxIco('check')}</div>
        <h2 class="rops-success-title">Cancellation Confirmed</h2>
        <div class="rops-success-sub">Unit has been returned to inventory and the sale is voided.</div>
        <div class="rops-success-vch">${esc(data.voucher_no || '')}</div>
        <div class="rops-success-actions">
          <button class="rops-btn rops-btn-primary" onclick="printCancellationVoucher('${esc(data.cancellation_id)}','${esc(data.voucher_no)}')">Print Voucher</button>
          <button class="rops-btn rops-btn-ghost" onclick="nav('units')">Back to Inventory</button>
          <button class="rops-btn rops-btn-ghost" onclick="nav('cancelledunits')">View Ledger</button>
        </div>
      </div>
    </div>`;
}

function _cxRenderApprovalPending(requestId) {
  const el = document.getElementById('pg-unitcancel');
  if (!el) return;
  el.innerHTML = `
    <div class="rops">
      <div class="rops-success-screen">
        <div class="rops-success-mark" style="background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.3)"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <h2 class="rops-success-title">Approval Requested</h2>
        <div class="rops-success-sub">This cancellation requires admin approval. Your request has been submitted and is pending review.</div>
        ${requestId ? `<div class="rops-success-vch" style="font-size:11px">Request ID: ${esc(requestId)}</div>` : ''}
        <div class="rops-success-actions">
          <button class="rops-btn rops-btn-ghost" onclick="nav('units')">Back to Inventory</button>
        </div>
      </div>
    </div>`;
}

/* ── Print voucher ─────────────────────────────────────────────────────── */
async function printCancellationVoucher(cancellationId, voucherNo) {
  const d = _cxData;
  const u = d.unitObj || {};
  const prj = (window._projectsCache || []).find(p => p.id === d.projectId) || {};
  const c = d.clientObj || {};
  const ded = d.bookingForfeiture + d.cancellationCharges + d.processingFee + d.otherDeductions;
  const co = window._companyCache || {};
  const today = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
  const refundLabels = { immediate: 'Immediate Payment', payable: 'Payable (Deferred)', adjustment: 'Adjusted Against Unit', no_refund: 'No Refund — Full Forfeiture' };

  const w = (typeof _pw === 'function') ? _pw('Unit Cancellation Voucher — ' + (voucherNo || ''), (typeof _pCSS === 'function' ? _pCSS('A4') : ''), 'A4') : window.open('', '_blank');
  if (!w) return;
  const lh = typeof _lh === 'function' ? _lh('Cancellation Voucher') : '';

  w.document.write(`
    <div class="pg">
      ${lh}
      <div class="co-block">
        <div class="co-name">${esc(co.company_name || 'Company')}</div>
        <div class="co-sub">Unit Cancellation Voucher</div>
      </div>
      <table class="meta-table">
        <tr><td><strong>Voucher No:</strong> ${esc(voucherNo || '')}</td><td><strong>Date:</strong> ${today}</td></tr>
        <tr><td><strong>Type:</strong> ${d.cancellationType === 'company_shortage' ? 'Company-Initiated' : 'Client-Initiated'}</td><td><strong>Effective:</strong> ${esc(d.effectiveDate || d.cancellationDate)}</td></tr>
        <tr><td colspan="2"><strong>Reason:</strong> ${esc(d.reasonCategory)} — ${esc(d.detailedReason)}</td></tr>
      </table>
      <h3 class="sec-hd">Unit</h3>
      <table class="data-table"><tbody>
        <tr><td>Project</td><td>${esc(prj.name || prj.projectName || '')}</td><td>Unit Number</td><td>${esc(u.unitNo || '')}</td></tr>
        <tr><td>Floor</td><td>${esc(u.floorLabel || '')}</td><td>Type</td><td>${esc(u.type || '')}</td></tr>
        <tr><td>Area</td><td>${u.area ? esc(u.area) + ' sqft' : '—'}</td><td>Sale No</td><td>${esc(d.saleObj?.sale_number || '')}</td></tr>
      </tbody></table>
      <h3 class="sec-hd">Buyer</h3>
      <table class="data-table"><tbody>
        <tr><td>Name</td><td>${esc(c.full_name || '')}</td><td>CNIC</td><td>${esc(c.cnic || '—')}</td></tr>
        <tr><td>Phone</td><td>${esc(c.phone_primary || '')}</td><td>Sale Date</td><td>${esc(d.saleObj?.sale_date || '')}</td></tr>
      </tbody></table>
      <h3 class="sec-hd">Financial Settlement</h3>
      <table class="data-table"><tbody>
        <tr><td>Sale Price</td><td><strong>PKR ${fmtPK(d.netAmount)}</strong></td><td>Total Paid</td><td><strong>PKR ${fmtPK(d.totalPaid)}</strong></td></tr>
        ${d.bookingForfeiture ? `<tr><td style="padding-left:20px">Booking Forfeiture</td><td>PKR ${fmtPK(d.bookingForfeiture)}</td><td></td><td></td></tr>` : ''}
        ${d.cancellationCharges ? `<tr><td style="padding-left:20px">Cancellation Charges</td><td>PKR ${fmtPK(d.cancellationCharges)}</td><td></td><td></td></tr>` : ''}
        ${d.processingFee ? `<tr><td style="padding-left:20px">Processing Fee</td><td>PKR ${fmtPK(d.processingFee)}</td><td></td><td></td></tr>` : ''}
        ${d.otherDeductions ? `<tr><td style="padding-left:20px">Other (${esc(d.otherDeductionsNote || '')})</td><td>PKR ${fmtPK(d.otherDeductions)}</td><td></td><td></td></tr>` : ''}
        <tr style="background:#fef2f2"><td><strong>Total Deductions</strong></td><td><strong>PKR ${fmtPK(ded)}</strong></td><td><strong>Net Refund</strong></td><td><strong>PKR ${fmtPK(d.netRefund)}</strong></td></tr>
        <tr><td>Refund Method</td><td colspan="3">${esc(refundLabels[d.refundMethod] || d.refundMethod || '')}</td></tr>
        ${d.refundReference ? `<tr><td>Transaction Ref</td><td colspan="3">${esc(d.refundReference)}</td></tr>` : ''}
      </tbody></table>
      ${d.notes ? `<h3 class="sec-hd">Remarks</h3><div class="remarks-box">${esc(d.notes)}</div>` : ''}
      <div class="sig-grid">
        <div class="sig-box"><div class="sig-line"></div><div>Client Signature</div><div class="sig-date">Date: ___________</div></div>
        <div class="sig-box"><div class="sig-line"></div><div>Authorized Signature</div><div class="sig-date">Date: ___________</div></div>
        <div class="sig-box"><div class="sig-line"></div><div>Witness 1</div><div class="sig-date">Date: ___________</div></div>
        <div class="sig-box"><div class="sig-line"></div><div>Witness 2</div><div class="sig-date">Date: ___________</div></div>
      </div>
      <div class="footer-note">Printed on: ${today} | ${esc(voucherNo || '')} | Computer-generated document.</div>
    </div>`);
  if (typeof _pclose === 'function') _pclose(w); else { w.document.close(); w.focus(); }
}

/* ── Helpers ───────────────────────────────────────────────────────────── */
function _cxToast(msg, type) {
  if (window.notify) {
    if (type === 'error') notify.error('Error', { detail: msg });
    else if (type === 'success') notify.success(msg);
    else notify.info(msg);
  } else if (typeof showToast === 'function') {
    try { showToast(type === 'error' ? 'error' : 'info', msg); } catch { showToast(msg, type); }
  } else { console.log('[' + type + ']', msg); alert(msg); }
}

function fmtPK(n) {
  return Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

function _cxIco(name) {
  const i = {
    x:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    check: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    warn:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>'
  };
  return i[name] || '';
}

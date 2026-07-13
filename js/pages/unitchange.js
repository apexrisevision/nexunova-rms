/* ════════════════════════════════════════════════════════════════════════════
   CHANGE UNIT — same client, different unit.
   Not a Cancel (the sale lives on) and not a Transfer (the buyer does not change).
   The SAME sale is repointed to the new unit, so every payment and printed receipt
   stays attached exactly where it was. RPC: execute_unit_change
   ════════════════════════════════════════════════════════════════════════════ */

let _ucData     = null;
let _ucSchedule = [];
let _ucAvail    = [];   // available units in the picked project
let _ucResult   = null;

function _ucReset() {
  _ucData = {
    projectId: '', oldUnitId: '', saleId: '', clientId: '',
    oldSale: null, oldUnitNo: '', clientName: '', agentName: '',
    received: 0,

    newUnitId: '', newUnitNo: '',
    pricePerSqft: 0, areaSqft: 0, discount: 0,

    changeDate: new Date().toISOString().slice(0, 10),
    installmentCount: 12,
    firstDueDate: '',

    changeFee: 0, docCharges: 0, otherCharges: 0, otherChargesDesc: '',
    chargesPaidBy: 'client', chargesMethod: 'cash', chargesRef: '',

    reason: '', notes: ''
  };
  _ucSchedule = [];
  _ucAvail    = [];
  _ucResult   = null;
}

const _UC_REASONS = [
  'Client wants a bigger unit',
  'Client wants a smaller unit',
  'Client wants a different floor',
  'Client wants a different facing / block',
  'Company reallocation',
  'Other'
];

const _ucN  = v => Number(String(v == null ? 0 : v).replace(/[^0-9.-]/g, '')) || 0;
const _ucM  = v => (typeof fM === 'function' ? fM(v) : Number(v || 0).toLocaleString('en-US'));

/* ── Derived money ─────────────────────────────────────────────────────────
   The single source of truth for the whole form. The backend recomputes all of
   this independently and refuses the change if our schedule does not add up, so
   these numbers are for the human — not a thing the server trusts. */
function _ucMoney() {
  const oldNet   = _ucN(_ucData.oldSale?.net_amount);
  const newNet   = (_ucN(_ucData.pricePerSqft) * _ucN(_ucData.areaSqft)) - _ucN(_ucData.discount);
  const received = _ucN(_ucData.received);
  return {
    oldNet, newNet, received,
    diff:    newNet - oldNet,
    carried: Math.min(received, newNet),
    balance: Math.max(newNet - received, 0),
    credit:  Math.max(received - newNet, 0),
    charges: _ucN(_ucData.changeFee) + _ucN(_ucData.docCharges) + _ucN(_ucData.otherCharges)
  };
}

/* ── Entry ─────────────────────────────────────────────────────────────── */
async function rUnitChange(preUnitId) {
  const el = document.getElementById('pg-unitchange');
  if (!el) return;
  if (!S?.cid) {
    el.innerHTML = `<div class="rops"><div class="rops-empty">
      <div class="rops-empty-t">No company selected</div>
    </div></div>`;
    return;
  }
  _ucReset();
  if (preUnitId) _ucData.oldUnitId = preUnitId;
  _ucRender(el);
  if (preUnitId) {
    const u = (window._unitsCache || []).find(x => x.id === preUnitId);
    if (u?.projectId) {
      const sel = document.getElementById('uc-project');
      if (sel) sel.value = u.projectId;
      await _ucOnProject(u.projectId, preUnitId);
    }
  }
}

/* ── Render ────────────────────────────────────────────────────────────── */
function _ucRender(elParam) {
  const el = elParam || document.getElementById('pg-unitchange');
  if (!el) return;
  if (typeof _opsWarmCSS === 'function') _opsWarmCSS();
  el.innerHTML = `
    <div class="rops" id="uc-root">
      ${_ucHeaderHTML()}
      <div class="rops-grid">
        <div class="rops-main">
          ${_ucSecCurrentHTML()}
          ${_ucSecNewUnitHTML()}
          ${_ucSecPricingHTML()}
          ${_ucSecScheduleHTML()}
          ${_ucSecChargesHTML()}
          ${_ucSecReasonHTML()}
        </div>
        <aside class="rops-aside">
          ${_ucSummaryHTML()}
        </aside>
      </div>
    </div>`;
  _ucPopulateProjects();
  _ucUpdateSummary();
}

function _ucHeaderHTML() {
  return `
    <div class="rops-hd">
      <div class="rops-hd-l">
        <div class="rops-hd-mark">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M21 3l-7.5 7.5"/><path d="M3 21l7.5-7.5"/>
          </svg>
        </div>
        <div>
          <h1 class="rops-hd-title">Change Unit</h1>
          <div class="rops-hd-sub">Same client, different unit. Payments and receipts move with him.</div>
        </div>
      </div>
      <div class="rops-hd-r">
        <button class="rops-btn rops-btn-ghost rops-btn-sm" onclick="nav('units')">Cancel</button>
      </div>
    </div>`;
}

/* ── Section 1: current unit + client ──────────────────────────────────── */
function _ucSecCurrentHTML() {
  return `
    <section class="rops-sec is-active" id="uc-sec-current">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">1</div>
          <div>
            <h3 class="rops-sec-title">Current Unit</h3>
            <div class="rops-sec-desc">The unit the client holds today.</div>
          </div>
        </div>
        <span class="rops-sec-badge is-req">Required</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-g2" style="max-width:640px">
          <div class="rops-fr">
            <label class="rops-fl">Project <span class="req">*</span></label>
            <select class="rops-sel" id="uc-project" onchange="_ucOnProject(this.value)">
              <option value="">Select project</option>
            </select>
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Current Unit <span class="req">*</span></label>
            <select class="rops-sel" id="uc-old-unit" onchange="_ucOnOldUnit(this.value)">
              <option value="">Choose project first</option>
            </select>
          </div>
        </div>
        <div id="uc-old-info" style="margin-top:16px"></div>
      </div>
    </section>`;
}

function _ucPopulateProjects() {
  const sel = document.getElementById('uc-project');
  if (!sel) return;
  const projects = window._projectsCache || [];
  const soldByProj = {};
  (window._unitsCache || []).forEach(u => { if (!u.isAvailable) soldByProj[u.projectId] = (soldByProj[u.projectId] || 0) + 1; });
  const opts = projects.map(p => {
    const cnt  = soldByProj[p.id] || 0;
    const name = esc(p.projectName || p.name || 'Unnamed project');
    return cnt
      ? `<option value="${esc(p.id)}">${name} · ${cnt} sold</option>`
      : `<option value="" disabled>${name} · no sold units</option>`;
  }).join('');
  sel.innerHTML = projects.length
    ? `<option value="">Select project</option>${opts}`
    : `<option value="">No projects exist yet</option>`;
}

async function _ucOnProject(projectId, autoUnit) {
  _ucData.projectId = projectId;
  _ucData.oldUnitId = ''; _ucData.saleId = ''; _ucData.oldSale = null;
  _ucData.newUnitId = ''; _ucSchedule = [];

  const oSel = document.getElementById('uc-old-unit');
  const info = document.getElementById('uc-old-info');
  if (info) info.innerHTML = '';
  if (!oSel) return;

  if (!projectId) {
    oSel.innerHTML = `<option value="">Choose project first</option>`;
    _ucAvail = [];
    _ucRefreshNewUnits();
    _ucUpdateSummary();
    return;
  }

  const sold = (window._unitsCache || []).filter(u => u.projectId === projectId && !u.isAvailable);
  oSel.innerHTML = `<option value="">Choose unit</option>` +
    sold.map(u => `<option value="${esc(u.id)}">${esc(u.unitNo)}${u.floorLabel ? ' · ' + u.floorLabel : ''}</option>`).join('');

  // Units he could move INTO — asked of the server, not the local cache, so a unit
  // someone else booked a minute ago cannot be picked here.
  try {
    const { data } = await supabase.rpc('list_available_units_for_change', {
      p_company_id: S.cid, p_project_id: projectId
    });
    _ucAvail = data || [];
  } catch { _ucAvail = []; }
  _ucRefreshNewUnits();

  if (autoUnit) { oSel.value = autoUnit; await _ucOnOldUnit(autoUnit); }
  _ucUpdateSummary();
}

async function _ucOnOldUnit(unitId) {
  _ucData.oldUnitId = unitId;
  const info = document.getElementById('uc-old-info');
  if (!info || !unitId) { if (info) info.innerHTML = ''; _ucUpdateSummary(); return; }

  const u = (window._unitsCache || []).find(x => x.id === unitId);
  _ucData.oldUnitNo = u?.unitNo || '';
  info.innerHTML = `<div class="rops-buyer-card"><div class="rops-bc-item"><span class="rops-spin"></span> Loading sale…</div></div>`;

  try {
    const { data: sale } = await supabase.rpc('get_active_sale_for_unit', { p_unit_id: unitId, p_company_id: S.cid });
    if (!sale) {
      info.innerHTML = `<div class="rops-alert is-warn">No active sale on this unit — nothing to change.</div>`;
      _ucData.saleId = ''; _ucData.oldSale = null;
      _ucUpdateSummary();
      return;
    }
    _ucData.saleId   = sale.id;
    _ucData.clientId = sale.client_id;
    _ucData.oldSale  = sale;

    // Money already received — asked of get_sale_received, NOT list_payments_for_sale, because
    // that one filters status='received' and silently drops 'cleared' receipts. The figure here
    // must match what the RPC computes byte for byte, or the schedule never adds up and every
    // change is refused with schedule_mismatch.
    const { data: money } = await supabase.rpc('get_sale_received', { p_sale_id: sale.id, p_company_id: S.cid });
    _ucData.received = _ucN(money?.received);

    let clientName = '';
    try {
      const { data: cl } = await supabase.rpc('get_client_lite', { p_id: sale.client_id, p_company_id: S.cid });
      clientName = cl?.full_name || '';
    } catch {}
    _ucData.clientName = clientName;

    const m = _ucMoney();
    info.innerHTML = `
      <div class="rops-buyer-card">
        <div class="rops-bc-item"><span class="l">Client</span><span class="v">${esc(clientName || '—')}</span></div>
        <div class="rops-bc-item"><span class="l">Sale No</span><span class="v">${esc(sale.sale_number || '—')}</span></div>
        <div class="rops-bc-item"><span class="l">Current Price</span><span class="v">PKR ${_ucM(m.oldNet)}</span></div>
        <div class="rops-bc-item"><span class="l">Received So Far</span><span class="v">PKR ${_ucM(m.received)}</span></div>
      </div>
      <div class="rops-fh" style="margin-top:8px">This money follows the client to the new unit — nothing is refunded or re-entered.</div>`;
  } catch (e) {
    info.innerHTML = `<div class="rops-alert is-warn">Could not load the sale on this unit.</div>`;
    _ucData.saleId = ''; _ucData.oldSale = null;
  }
  _ucUpdateSummary();
}

/* ── Section 2: the new unit ───────────────────────────────────────────── */
function _ucSecNewUnitHTML() {
  return `
    <section class="rops-sec" id="uc-sec-new">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">2</div>
          <div>
            <h3 class="rops-sec-title">New Unit</h3>
            <div class="rops-sec-desc">Only available units in the same project can be picked.</div>
          </div>
        </div>
        <span class="rops-sec-badge is-req">Required</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-fr" style="max-width:400px">
          <label class="rops-fl">Move client to <span class="req">*</span></label>
          <select class="rops-sel" id="uc-new-unit" onchange="_ucOnNewUnit(this.value)">
            <option value="">Choose project first</option>
          </select>
          <div class="rops-fh">The new unit's area and rate fill in below — you can edit them.</div>
        </div>
        <div id="uc-new-info"></div>
      </div>
    </section>`;
}

function _ucRefreshNewUnits() {
  const sel = document.getElementById('uc-new-unit');
  if (!sel) return;
  if (!_ucData.projectId) { sel.innerHTML = `<option value="">Choose project first</option>`; return; }
  const list = _ucAvail.filter(u => u.id !== _ucData.oldUnitId);
  sel.innerHTML = list.length
    ? `<option value="">Choose the new unit</option>` + list.map(u =>
        `<option value="${esc(u.id)}">${esc(u.unit_no || u.unit_code || '—')}${u.floor_label ? ' · ' + esc(u.floor_label) : ''}${u.area ? ' · ' + u.area + ' sqft' : ''}</option>`).join('')
    : `<option value="">No available units in this project</option>`;
}

function _ucOnNewUnit(unitId) {
  _ucData.newUnitId = unitId;
  const info = document.getElementById('uc-new-info');
  const u = _ucAvail.find(x => x.id === unitId);
  _ucData.newUnitNo = u?.unit_no || u?.unit_code || '';

  if (u) {
    // Prefill from the unit itself; the user stays free to overwrite both.
    _ucData.areaSqft     = _ucN(u.area);
    _ucData.pricePerSqft = _ucN(u.rate_per_sqft);
    const rate = document.getElementById('uc-rate');
    const area = document.getElementById('uc-area');
    if (rate) rate.value = _ucData.pricePerSqft;
    if (area) area.value = _ucData.areaSqft;
    if (info) info.innerHTML = `
      <div class="rops-buyer-card" style="margin-top:14px">
        <div class="rops-bc-item"><span class="l">Unit</span><span class="v">${esc(_ucData.newUnitNo)}</span></div>
        <div class="rops-bc-item"><span class="l">Area</span><span class="v">${_ucM(u.area)} sqft</span></div>
        <div class="rops-bc-item"><span class="l">List Rate</span><span class="v">PKR ${_ucM(u.rate_per_sqft)}/sqft</span></div>
      </div>`;
  } else if (info) info.innerHTML = '';

  _ucRecalc();
}

/* ── Section 3: pricing ────────────────────────────────────────────────── */
function _ucSecPricingHTML() {
  return `
    <section class="rops-sec" id="uc-sec-price">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">3</div>
          <div>
            <h3 class="rops-sec-title">Price of the New Unit</h3>
            <div class="rops-sec-desc">Prefilled from the unit — change it if the client agreed a different rate.</div>
          </div>
        </div>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-g3" style="max-width:640px">
          <div class="rops-fr">
            <label class="rops-fl">Rate / sqft <span class="req">*</span></label>
            <input type="text" inputmode="numeric" class="rops-inp" id="uc-rate" value="0"
                   oninput="_ucData.pricePerSqft=this.value; _ucRecalc()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Area (sqft) <span class="req">*</span></label>
            <input type="text" inputmode="numeric" class="rops-inp" id="uc-area" value="0"
                   oninput="_ucData.areaSqft=this.value; _ucRecalc()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Discount</label>
            <input type="text" inputmode="numeric" class="rops-inp" id="uc-disc" value="0"
                   oninput="_ucData.discount=this.value; _ucRecalc()">
          </div>
        </div>
        <div id="uc-price-out"></div>
      </div>
    </section>`;
}

/* ── Section 4: schedule for the balance ───────────────────────────────── */
function _ucSecScheduleHTML() {
  return `
    <section class="rops-sec" id="uc-sec-sched">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">4</div>
          <div>
            <h3 class="rops-sec-title">New Schedule</h3>
            <div class="rops-sec-desc">Only the balance is scheduled. What he already paid is carried forward.</div>
          </div>
        </div>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-g3" style="max-width:640px">
          <div class="rops-fr">
            <label class="rops-fl">Change date <span class="req">*</span></label>
            <input type="date" class="rops-inp" id="uc-date" value="${esc(_ucData.changeDate)}"
                   oninput="_ucData.changeDate=this.value">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Installments</label>
            <input type="number" min="0" max="360" class="rops-inp" id="uc-count" value="12"
                   oninput="_ucData.installmentCount=this.value; _ucBuildSchedule()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">First due date</label>
            <input type="date" class="rops-inp" id="uc-first" value=""
                   oninput="_ucData.firstDueDate=this.value; _ucBuildSchedule()">
          </div>
        </div>
        <div id="uc-sched-out"></div>
      </div>
    </section>`;
}

function _ucBuildSchedule() {
  const m = _ucMoney();
  const n = Math.max(0, parseInt(_ucData.installmentCount, 10) || 0);
  _ucSchedule = [];

  if (m.balance > 0 && n > 0) {
    const start = _ucData.firstDueDate ? new Date(_ucData.firstDueDate) : (() => {
      const d = new Date(_ucData.changeDate || Date.now());
      d.setMonth(d.getMonth() + 1);
      return d;
    })();
    // Round each instalment, then push the rounding crumbs into the last one so the
    // schedule sums to the balance EXACTLY — the RPC rejects anything off by > 1.
    const per = Math.round(m.balance / n);
    for (let i = 0; i < n; i++) {
      const d = new Date(start);
      d.setMonth(start.getMonth() + i);
      _ucSchedule.push({
        installment_number: i + 1,
        installment_type: 'installment',
        due_date: d.toISOString().slice(0, 10),
        amount_due: i === n - 1 ? (m.balance - per * (n - 1)) : per
      });
    }
  }
  _ucRenderSchedule();
  _ucUpdateSummary();
}

function _ucRenderSchedule() {
  const out = document.getElementById('uc-sched-out');
  if (!out) return;
  const m = _ucMoney();

  if (m.credit > 0) {
    out.innerHTML = `<div class="rops-confirm" style="margin-top:14px">
      The client has already paid PKR ${_ucM(m.received)}, which is more than the new unit costs
      (PKR ${_ucM(m.newNet)}). Nothing is left to schedule — PKR <strong>${_ucM(m.credit)}</strong> stays as
      his credit. RMS does not issue the refund; settle it in QuickBooks if he wants the money back.
    </div>`;
    return;
  }
  if (m.balance <= 0) { out.innerHTML = ''; return; }
  if (!_ucSchedule.length) {
    out.innerHTML = `<div class="rops-fh" style="margin-top:12px">Set how many installments to spread PKR ${_ucM(m.balance)} over.</div>`;
    return;
  }

  const sum = _ucSchedule.reduce((s, r) => s + _ucN(r.amount_due), 0);
  out.innerHTML = `
    <div style="margin-top:14px">
      <table class="rops-sched">
        <thead><tr><th>#</th><th>Due Date</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          ${_ucSchedule.map(r => `<tr>
            <td>${r.installment_number}</td>
            <td>${esc(r.due_date)}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">PKR ${_ucM(r.amount_due)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="2"><strong>Total</strong></td>
          <td style="text-align:right;font-variant-numeric:tabular-nums"><strong>PKR ${_ucM(sum)}</strong></td>
        </tr></tfoot>
      </table>
    </div>`;
}

/* ── Section 5: charges ────────────────────────────────────────────────── */
function _ucSecChargesHTML() {
  return `
    <section class="rops-sec" id="uc-sec-charges">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">5</div>
          <div>
            <h3 class="rops-sec-title">Charges</h3>
            <div class="rops-sec-desc">Optional. Leave at 0 if you are not charging for the change.</div>
          </div>
        </div>
        <span class="rops-sec-badge">Optional</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-g3" style="max-width:640px">
          <div class="rops-fr">
            <label class="rops-fl">Change fee</label>
            <input type="text" inputmode="numeric" class="rops-inp" value="0"
                   oninput="_ucData.changeFee=this.value; _ucUpdateSummary()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Documentation</label>
            <input type="text" inputmode="numeric" class="rops-inp" value="0"
                   oninput="_ucData.docCharges=this.value; _ucUpdateSummary()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Other charges</label>
            <input type="text" inputmode="numeric" class="rops-inp" value="0"
                   oninput="_ucData.otherCharges=this.value; _ucUpdateSummary()">
          </div>
        </div>
        <div class="rops-fr" style="max-width:400px">
          <label class="rops-fl">Charges paid by</label>
          <select class="rops-sel" oninput="_ucData.chargesPaidBy=this.value">
            <option value="client">Client</option>
            <option value="company">Company</option>
          </select>
        </div>
      </div>
    </section>`;
}

/* ── Section 6: reason ─────────────────────────────────────────────────── */
function _ucSecReasonHTML() {
  return `
    <section class="rops-sec" id="uc-sec-reason">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">6</div>
          <div>
            <h3 class="rops-sec-title">Why is the unit changing?</h3>
            <div class="rops-sec-desc">This is stamped on the voucher and on both units' history.</div>
          </div>
        </div>
        <span class="rops-sec-badge is-req">Required</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-fr" style="max-width:520px">
          <label class="rops-fl">Reason <span class="req">*</span></label>
          <select class="rops-sel" id="uc-reason" onchange="_ucData.reason=this.value; _ucUpdateSummary()">
            <option value="">Select a reason</option>
            ${_UC_REASONS.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
        </div>
        <div class="rops-fr">
          <label class="rops-fl">Notes</label>
          <textarea class="rops-ta" oninput="_ucData.notes=this.value" placeholder="Anything worth recording…"></textarea>
        </div>
      </div>
    </section>`;
}

/* ── Summary rail ──────────────────────────────────────────────────────── */
function _ucSummaryHTML() {
  return `<div class="rops-sum" id="uc-summary"></div>`;
}

function _ucRecalc() { _ucBuildSchedule(); }

function _ucUpdateSummary() {
  const box = document.getElementById('uc-summary');
  if (!box) return;
  const m = _ucMoney();
  const ready = _ucReady();

  const diffRow = m.newNet && m.oldNet
    ? `<div class="rops-sum-row">
         <span>Price difference</span>
         <span style="color:${m.diff > 0 ? 'var(--fk-danger)' : m.diff < 0 ? 'var(--fk-success)' : 'inherit'}">
           ${m.diff > 0 ? '+' : ''}PKR ${_ucM(m.diff)}
         </span>
       </div>` : '';

  box.innerHTML = `
    <div class="rops-sum-hd"><h4 class="rops-sum-title">Change Summary</h4></div>
    <div class="rops-sum-bd">
      <div class="rops-sum-row"><span class="l">Client</span><span class="r">${esc(_ucData.clientName || '—')}</span></div>
      <div class="rops-sum-row"><span class="l">From Unit</span><span class="r">${esc(_ucData.oldUnitNo || '—')}</span></div>
      <div class="rops-sum-row"><span class="l">To Unit</span><span class="r">${esc(_ucData.newUnitNo || '—')}</span></div>
      <div class="rops-sum-row"><span class="l">Old Price</span><span class="r">PKR ${_ucM(m.oldNet)}</span></div>
      ${diffRow}
      <div class="rops-sum-row"><span class="l">Already Received</span><span class="r">PKR ${_ucM(m.received)}</span></div>
      <div class="rops-sum-row"><span class="l">Carried Forward</span><span class="r">PKR ${_ucM(m.carried)}</span></div>
      ${m.charges > 0 ? `<div class="rops-sum-row"><span class="l">Charges</span><span class="r">PKR ${_ucM(m.charges)}</span></div>` : ''}
    </div>
    <div class="rops-sum-hero">
      <span class="rops-sum-hero-lbl">New Net Amount</span>
      <span class="rops-sum-hero-val">PKR ${_ucM(m.newNet)}</span>
    </div>
    <div class="rops-sum-foot">
      ${m.credit > 0
        ? `<div class="rops-sum-row"><span class="l">Credit To Client</span><span class="r" style="color:var(--fk-success)">PKR ${_ucM(m.credit)}</span></div>`
        : `<div class="rops-sum-row"><span class="l">Balance Payable</span><span class="r">PKR ${_ucM(m.balance)}</span></div>`}
      <button class="rops-btn rops-btn-primary rops-btn-lg" id="uc-submit" style="width:100%;margin-top:10px"
              ${ready ? '' : 'disabled'} onclick="_ucSubmit()">Confirm Change</button>
      ${ready ? '' : `<div class="rops-fh" style="margin-top:8px">${esc(_ucWhyNotReady())}</div>`}
    </div>`;
}

function _ucReady() { return !_ucWhyNotReady(); }

/* Returns the FIRST thing still missing, so the user is told what to do next —
   not handed a dead button with no explanation. */
function _ucWhyNotReady() {
  const m = _ucMoney();
  if (!_ucData.projectId)  return 'Pick the project.';
  if (!_ucData.saleId)     return 'Pick the unit the client holds today.';
  if (!_ucData.newUnitId)  return 'Pick the unit he is moving to.';
  if (m.newNet <= 0)       return 'Enter the rate and area of the new unit.';
  if (!_ucData.reason)     return 'Select a reason for the change.';
  if (m.balance > 0 && !_ucSchedule.length) return 'Set the installments for the balance.';
  return '';
}

/* ── Submit ────────────────────────────────────────────────────────────── */
async function _ucSubmit() {
  const why = _ucWhyNotReady();
  if (why) { if (typeof toast === 'function') toast(why, 'warn'); return; }

  const m   = _ucMoney();
  const btn = document.getElementById('uc-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Changing…'; }

  try {
    const { data, error } = await supabase.rpc('execute_unit_change', {
      p_company_id: S.cid,
      p_change_date: _ucData.changeDate,
      p_project_id: _ucData.projectId,
      p_sale_id: _ucData.saleId,
      p_client_id: _ucData.clientId,
      p_old_unit_id: _ucData.oldUnitId,
      p_new_unit_id: _ucData.newUnitId,
      p_price_per_sqft: _ucN(_ucData.pricePerSqft),
      p_area_sqft: _ucN(_ucData.areaSqft),
      p_discount: _ucN(_ucData.discount),
      p_installments: _ucSchedule,
      p_change_fee: _ucN(_ucData.changeFee),
      p_documentation_charges: _ucN(_ucData.docCharges),
      p_other_charges: _ucN(_ucData.otherCharges),
      p_other_charges_desc: _ucData.otherChargesDesc || null,
      p_charges_paid_by: _ucData.chargesPaidBy,
      p_charges_payment_method: _ucData.chargesMethod || null,
      p_charges_reference: _ucData.chargesRef || null,
      p_reason: _ucData.reason,
      p_notes: _ucData.notes || null
    });

    if (error) throw error;
    if (!data?.success) {
      // The RPC hands back a human message for every refusal it knows about.
      throw new Error(data?.message || data?.error || 'Unit change failed');
    }

    if (data.status === 'pending_approval') {
      if (typeof toast === 'function') toast('Sent to the Admin for approval.', 'ok');
      nav('units');
      return;
    }

    _ucResult = data;
    if (typeof toast === 'function') toast(`Unit changed · ${data.voucher_no}`, 'ok');
    _ucShowResult(data);
    if (typeof loadUnits === 'function') loadUnits();   // refresh the units cache: two of them just flipped
  } catch (e) {
    if (typeof toast === 'function') toast(e.message || 'Unit change failed', 'err');
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Change'; }
  }
}

function _ucShowResult(r) {
  const el = document.getElementById('pg-unitchange');
  if (!el) return;
  el.innerHTML = `
    <div class="rops">
      <div class="rops-success-screen">
        <div class="rops-success-mark">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <h2 class="rops-success-title">Unit changed</h2>
        <div class="rops-success-sub">
          ${esc(r.old_unit)} → ${esc(r.new_unit)} · <span class="rops-success-vch">${esc(r.voucher_no)}</span>
        </div>
        <div class="rops-buyer-card" style="margin:18px auto;max-width:420px;text-align:left">
          <div class="rops-bc-item"><span class="l">New Price</span><span class="v">PKR ${_ucM(r.new_net)}</span></div>
          <div class="rops-bc-item"><span class="l">Carried Forward</span><span class="v">PKR ${_ucM(r.carried_forward)}</span></div>
          ${_ucN(r.credit_balance) > 0
            ? `<div class="rops-bc-item"><span class="l">Credit To Client</span><span class="v">PKR ${_ucM(r.credit_balance)}</span></div>`
            : `<div class="rops-bc-item"><span class="l">Balance Payable</span><span class="v">PKR ${_ucM(r.balance_payable)}</span></div>`}
        </div>
        <div class="rops-success-actions">
          <button class="rops-btn rops-btn-ghost" onclick="rUnitChange()">Change another</button>
          <button class="rops-btn rops-btn-primary" onclick="nav('units')">Back to Units</button>
        </div>
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════════════════════
   UNIT OWNERSHIP CHAIN — Shajra-e-Nasab
   Standalone page (pg-unitchain) + helper to embed the timeline anywhere.
   RPC: get_unit_ownership_chain
   ════════════════════════════════════════════════════════════════════════════ */

let _ucChain = null;
let _ucUnitId = null;

/* ── Standalone page ─────────────────────────────────────────────────── */
async function rUnitChain(unitId) {
  const el = document.getElementById('pg-unitchain');
  if (!el) return;

  // Set as current page (so nav() works)
  if (unitId) _ucUnitId = unitId;
  if (!_ucUnitId) {
    el.innerHTML = `<div class="rops">${_ucPickerHTML()}</div>`;
    if (typeof nav === 'function') nav('unitchain');
    return;
  }

  el.innerHTML = `<div class="rops">
    <div class="rops-hd">
      <div class="rops-hd-l">
        <div class="rops-hd-mark">${_ucIco('chain')}</div>
        <div>
          <h1 class="rops-hd-title">Ownership Chain</h1>
          <div class="rops-hd-sub">Complete shajra-e-nasab of this unit</div>
        </div>
      </div>
      <div class="rops-hd-r">
        <button class="rops-btn rops-btn-ghost rops-btn-sm" onclick="rUnitChain()">Pick Different Unit</button>
        <button class="rops-btn rops-btn-ghost rops-btn-sm" onclick="_ucPrint()">Print</button>
        <button class="rops-btn rops-btn-ghost rops-btn-sm" onclick="nav('units')">Back to Units</button>
      </div>
    </div>
    <div id="uc-body"><div class="rops-tbl-empty"><span class="rops-spin"></span> Loading chain…</div></div>
  </div>`;

  if (typeof nav === 'function') nav('unitchain');
  await _ucLoad(_ucUnitId, document.getElementById('uc-body'));
}

function _ucPickerHTML() {
  const units = (window._unitsCache || [])
    .filter(u => !u.isAvailable || u.origin_type === 'transferred' || u.origin_type === 'ex_cancelled');
  const opts = units.map(u => {
    const prj = (window._projectsCache || []).find(p => p.id === u.projectId);
    return `<option value="${esc(u.id)}">${esc(u.unitNo)}${prj ? ' · ' + esc(prj.name || prj.projectName) : ''}</option>`;
  }).join('');
  return `
    <div class="rops-hd">
      <div class="rops-hd-l">
        <div class="rops-hd-mark">${_ucIco('chain')}</div>
        <div>
          <h1 class="rops-hd-title">Ownership Chain Report</h1>
          <div class="rops-hd-sub">Pick a unit to view its full transfer / cancellation history</div>
        </div>
      </div>
    </div>
    <div class="rops-sec">
      <div class="rops-sec-bd">
        <div class="rops-fr" style="max-width:480px">
          <label class="rops-fl">Unit</label>
          <select class="rops-sel" onchange="if(this.value) rUnitChain(this.value)">
            <option value="">Select a unit</option>${opts}
          </select>
        </div>
      </div>
    </div>`;
}

/* ── Loader (also called by embed helper) ─────────────────────────────── */
async function _ucLoad(unitId, targetEl) {
  if (!targetEl) return;
  try {
    const { data, error } = await supabase.rpc('get_unit_ownership_chain', {
      p_unit_id: unitId,
      p_company_id: S.cid
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Unknown error');
    _ucChain = data;
    targetEl.innerHTML = _ucBodyHTML(data);
  } catch (e) {
    targetEl.innerHTML = `<div class="rops-alert is-danger">${_ucIco('warn')} ${esc(e.message)}</div>`;
  }
}

function _ucBodyHTML(data) {
  const unit = data.unit || {};
  const chain = data.chain || [];
  const originBadge = _ucOriginBadge(unit.origin_type);

  return `
    <div class="rops-sec" style="margin-bottom:18px">
      <div class="rops-sec-bd">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap">
          <div>
            <div style="font-size:22px; font-weight:700; letter-spacing:-0.01em">${esc(unit.unit_no || '—')}${unit.block ? ' · ' + esc(unit.block) : ''}</div>
            <div style="font-size:12.5px; color:var(--t2); margin-top:4px">
              ${esc(unit.project_name || '—')}${unit.floor_label ? ' · ' + esc(unit.floor_label) : ''}
            </div>
          </div>
          <div style="display:flex; gap:8px; align-items:center">
            ${originBadge}
            <span class="rops-badge"><span class="dot"></span> ${chain.length} event${chain.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>
    </div>

    ${chain.length === 0 ? `
      <div class="rops-empty">
        <div class="rops-empty-mark">${_ucIco('chain')}</div>
        <div class="rops-empty-t">No history yet</div>
        <div class="rops-empty-s">When this unit is sold, cancelled, or transferred, the chain will appear here.</div>
      </div>` : `
      <div class="rops-sec">
        <div class="rops-sec-bd">
          <div class="rops-chain">
            ${chain.map((evt, i) => _ucEventHTML(evt, i, chain.length)).join('')}
          </div>
        </div>
      </div>`}`;
}

function _ucOriginBadge(origin) {
  if (origin === 'ex_cancelled') return `<span class="rops-internal">EX-CANCELLED</span>`;
  if (origin === 'transferred')  return `<span class="rops-internal">TRANSFERRED</span>`;
  return `<span class="rops-badge"><span class="dot"></span> Fresh inventory</span>`;
}

function _ucEventHTML(evt, idx, total) {
  const typeMap = { sale: 'is-sale', cancellation: 'is-cancel', transfer: 'is-xfer' };
  const labelMap = { sale: 'Sale', cancellation: 'Cancellation', transfer: 'Transfer' };
  const cls = typeMap[evt.event_type] || '';
  const lbl = labelMap[evt.event_type] || evt.event_type;
  const date = _ucFormatDate(evt.event_at);
  const amtA = Number(evt.amount_a || 0);
  const amtB = Number(evt.amount_b || 0);

  // Re-sale badge for sales that follow a cancellation
  const isReSale = evt.event_type === 'sale' && evt.is_resale;
  const isTransferSale = evt.event_type === 'sale' && evt.is_transfer;

  // Order number badge (1st owner / 2nd owner / ... — only for sale events)
  const ownershipOrder = evt.event_type === 'sale' ? _ucCalcOwnerOrder(idx) : null;

  let aLabel = '', bLabel = '';
  if (evt.event_type === 'sale')        { aLabel = 'Sale Price'; bLabel = 'Paid'; }
  if (evt.event_type === 'cancellation'){ aLabel = 'Total Paid'; bLabel = 'Net Refund'; }
  if (evt.event_type === 'transfer')    { aLabel = 'New Sale Price'; bLabel = 'Transfer Charges'; }

  return `
    <div class="rops-chain-evt ${cls}">
      <div class="rops-chain-dot"></div>
      <div class="rops-chain-card">
        <div class="rops-chain-meta">
          <span class="rops-chain-type">${lbl}</span>
          ${ownershipOrder ? `<span class="rops-badge"><span class="dot"></span> ${ownershipOrder}</span>` : ''}
          ${isReSale ? `<span class="rops-internal">RE-SALE</span>` : ''}
          ${isTransferSale ? `<span class="rops-internal">VIA TRANSFER</span>` : ''}
          <span class="rops-chain-date">${date}</span>
          ${evt.voucher_no ? `<span class="rops-chain-vch">${esc(evt.voucher_no)}</span>` : ''}
        </div>
        <div class="rops-chain-client">${esc(evt.client_name || '—')}</div>
        <div class="rops-chain-fin">
          ${evt.client_cnic ? `<div><span class="lbl">CNIC</span><span class="val">${esc(evt.client_cnic)}</span></div>` : ''}
          ${evt.client_phone ? `<div><span class="lbl">Phone</span><span class="val">${esc(evt.client_phone)}</span></div>` : ''}
          ${amtA ? `<div><span class="lbl">${aLabel}</span><span class="val">PKR ${_ucFM(amtA)}</span></div>` : ''}
          ${amtB ? `<div><span class="lbl">${bLabel}</span><span class="val">PKR ${_ucFM(amtB)}</span></div>` : ''}
        </div>
        ${evt.reason || evt.note ? `<div class="rops-chain-note">${[evt.reason, evt.note].filter(Boolean).map(esc).join(' — ')}</div>` : ''}
      </div>
    </div>`;
}

function _ucCalcOwnerOrder(idx) {
  if (!_ucChain) return null;
  const chain = _ucChain.chain || [];
  let ownerN = 0;
  for (let i = 0; i <= idx; i++) {
    if (chain[i].event_type === 'sale') ownerN++;
  }
  return _ucOrdinal(ownerN) + ' Owner';
}

function _ucOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ── Embed helper — usable from Unit Detail or anywhere ──────────────── */
async function ucEmbedTimeline(targetEl, unitId) {
  const el = typeof targetEl === 'string' ? document.querySelector(targetEl) : targetEl;
  if (!el) return;
  el.innerHTML = `<div class="rops" style="padding:0"><div class="rops-tbl-empty"><span class="rops-spin"></span> Loading ownership chain…</div></div>`;
  // Wrap a .rops scope so the chain styles apply
  await _ucLoad(unitId, el.querySelector('.rops') || el);
}

/* ── Print ────────────────────────────────────────────────────────────── */
function _ucPrint() {
  if (!_ucChain) return;
  const unit = _ucChain.unit || {};
  const co = window._companyCache || {};
  const today = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });

  const rows = (_ucChain.chain || []).map((evt, i) => {
    const date = _ucFormatDate(evt.event_at);
    const amtA = Number(evt.amount_a || 0);
    const amtB = Number(evt.amount_b || 0);
    let extra = '';
    if (evt.event_type === 'sale') extra = `Sale Price PKR ${_ucFM(amtA)} · Paid PKR ${_ucFM(amtB)}`;
    if (evt.event_type === 'cancellation') extra = `Paid PKR ${_ucFM(amtA)} · Refund PKR ${_ucFM(amtB)}`;
    if (evt.event_type === 'transfer') extra = `New Sale PKR ${_ucFM(amtA)} · Charges PKR ${_ucFM(amtB)}`;
    return `<tr>
      <td style="width:90px">${i + 1}</td>
      <td style="width:120px">${date}</td>
      <td style="width:120px">${esc(evt.event_type.toUpperCase())}</td>
      <td>${esc(evt.client_name || '—')}${evt.client_cnic ? `<br><span style="color:#666; font-size:10px">${esc(evt.client_cnic)}</span>` : ''}</td>
      <td style="width:160px">${esc(evt.voucher_no || '—')}</td>
      <td>${extra}</td>
    </tr>`;
  }).join('');

  const _ucHtml = `
    <html><head><title>Ownership Chain — ${esc(unit.unit_no || '')}</title>
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size:12px; color:#222; padding:24px; }
      h1 { font-size:18px; margin:0 0 4px; }
      .sub { color:#666; font-size:11px; margin-bottom:18px; }
      table { width:100%; border-collapse:collapse; font-size:11px; }
      th { background:#f4f4f8; padding:8px 10px; text-align:left; font-weight:600; border-bottom:2px solid #ddd; text-transform:uppercase; font-size:10px; letter-spacing:0.04em; }
      td { padding:8px 10px; border-bottom:1px solid #eee; vertical-align:top; }
      .foot { margin-top:24px; padding-top:12px; border-top:1px solid #ddd; font-size:10px; color:#888; text-align:center; }
    </style></head><body>
      <h1>${esc(co.company_name || 'Company')}</h1>
      <div class="sub">Unit Ownership Chain · ${esc(unit.unit_no || '')} · ${esc(unit.project_name || '')}</div>
      <table>
        <thead><tr>
          <th>#</th><th>Date</th><th>Event</th><th>Party</th><th>Voucher</th><th>Financials</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="text-align:center; padding:24px; color:#999">No history</td></tr>'}</tbody>
      </table>
      <div class="foot">Printed: ${today} · Computer-generated report</div>
    </body></html>`;
  _printHTML(_ucHtml, 'Ownership Chain — ' + esc(unit.unit_no || ''));
}

/* ── Helpers ─────────────────────────────────────────────────────────── */
function _ucFM(n) { return Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
function _ucFormatDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}
function _ucIco(name) {
  const i = {
    chain: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
    warn:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>'
  };
  return i[name] || '';
}

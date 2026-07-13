/* ════════════════════════════════════════════════════════════════════════════
   UNIT OWNERSHIP CHAIN — Shajra-e-Nasab (warmth kit timeline)
   Standalone page (pg-unitchain) + embed helper. RPC: get_unit_ownership_chain
   ════════════════════════════════════════════════════════════════════════════ */

let _ucChain = null;
let _ucUnitId = null;

// One-time timeline CSS. Class names avoid "-card" (visual-overhaul boxes those) → uc-*.
function _ucCSS() {
  if (document.getElementById('_uc_css')) return;
  const s = document.createElement('style'); s.id = '_uc_css';
  s.textContent = `
    .uc-tl{position:relative;padding-left:26px}
    .uc-tl::before{content:'';position:absolute;left:8px;top:8px;bottom:8px;width:2px;background:var(--fk-border)}
    .uc-ev{position:relative;margin-bottom:14px}
    .uc-ev:last-child{margin-bottom:0}
    .uc-dot{position:absolute;left:-23px;top:16px;width:13px;height:13px;border-radius:50%;border:3px solid var(--fk-bg-page);box-shadow:0 0 0 1px var(--fk-border);background:var(--fk-primary)}
    .uc-dot.is-cancel{background:var(--fk-danger)}
    .uc-dot.is-xfer{background:var(--fk-warning)}
    .uc-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px}
    .uc-type{font-size:13.5px;font-weight:600;color:var(--fk-text)}
    .uc-date{font-size:11.5px;color:var(--fk-text-muted);margin-left:auto;white-space:nowrap}
    .uc-vch{font-size:11px;font-family:var(--fk-font-mono,ui-monospace,monospace);color:var(--fk-text-muted)}
    .uc-client{font-size:14px;font-weight:600;color:var(--fk-text);margin-bottom:9px}
    .uc-fin{display:flex;flex-wrap:wrap;gap:8px 18px}
    .uc-fin>div{display:flex;flex-direction:column;gap:1px}
    .uc-fin .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--fk-text-muted)}
    .uc-fin .val{font-size:13px;font-weight:500;color:var(--fk-text);font-variant-numeric:tabular-nums}
    .uc-note{margin-top:9px;padding-top:9px;border-top:1px solid var(--fk-border);font-size:12px;color:var(--fk-text-muted)}
    .uc-summary{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
    .uc-unit-no{font-size:20px;font-weight:600;color:var(--fk-text);letter-spacing:-.01em}
    .uc-unit-sub{font-size:12.5px;color:var(--fk-text-muted);margin-top:3px}
  `;
  document.head.appendChild(s);
}

/* ── Standalone page ─────────────────────────────────────────────────────
   HARDEN (2026-06-13): the legacy code called `nav('unitchain')` from INSIDE
   rUnitChain — and nav() re-invokes rUnitChain() with no same-page guard. Since
   that call sits before the first `await`, it recursed synchronously → stack
   overflow every time the chain opened (the verify harness logged ~750 rejected
   navigations). Fixed with an activation guard: if a link calls us directly while
   another page is active, activate the route once (nav re-invokes us, now active,
   and we render). When nav invokes us, pg-unitchain is already `.on` → we render
   directly, no recursion. */
async function rUnitChain(unitId) {
  const el = document.getElementById('pg-unitchain');
  if (!el) return;
  _ucCSS();

  if (unitId !== undefined && unitId !== null) _ucUnitId = unitId;

  // Direct call from a link while on another page → activate the route once.
  if (!el.classList.contains('on')) { if (typeof nav === 'function') nav('unitchain'); return; }

  if (!_ucUnitId) {
    el.innerHTML = '<div class="ani">' + _ucPickerHTML() + '</div>';
    return;
  }

  el.innerHTML =
    '<div class="ani">' +
      NX.pageHeader('Ownership Chain',
        NX.button('Pick unit', { variant:'secondary', onclick:'_ucUnitId=null;rUnitChain()' }) +
        NX.button('Print', { variant:'secondary', icon:'printer', onclick:'_ucPrint()' }) +
        NX.button('Back to units', { variant:'ghost', onclick:"nav('units')" }),
        { icon:'git-branch', sub:'Complete shajra-e-nasab of this unit.' }) +
      '<div id="uc-body">' + NX.card(NX.empty({ icon:'git-branch', message:'Loading chain…' })) + '</div>' +
    '</div>';

  await _ucLoad(_ucUnitId, document.getElementById('uc-body'));
}

function _ucPickerHTML() {
  const units = (window._unitsCache || [])
    .filter(u => !u.isAvailable || u.origin_type === 'transferred' || u.origin_type === 'ex_cancelled');
  const opts = units.map(u => {
    const prj = (window._projectsCache || []).find(p => p.id === u.projectId);
    return `<option value="${esc(u.id)}">${esc(u.unitNo)}${prj ? ' · ' + esc(prj.name || prj.projectName) : ''}</option>`;
  }).join('');
  return NX.pageHeader('Ownership Chain', '', { icon:'git-branch', sub:'Pick a unit to view its full transfer / cancellation history.' }) +
    NX.card(
      `<div class="nx-field uc-pick" style="max-width:480px;margin:0">
        <label class="nx-label" for="uc-pick">Unit</label>
        <select class="nx-select" id="uc-pick" onchange="if(this.value) rUnitChain(this.value)">
          <option value="">Select a unit</option>${opts}
        </select>
      </div>`);
}

/* ── Loader (also called by embed helper) ─────────────────────────────── */
async function _ucLoad(unitId, targetEl) {
  if (!targetEl) return;
  _ucCSS();
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
    targetEl.innerHTML = NX.card(NX.banner(esc(e.message), 'danger'));
  }
}

function _ucBodyHTML(data) {
  const unit = data.unit || {};
  const chain = data.chain || [];

  const summary = NX.card(
    `<div class="uc-summary">
      <div>
        <div class="uc-unit-no">${esc(unit.unit_no || '—')}${unit.block ? ' · ' + esc(unit.block) : ''}</div>
        <div class="uc-unit-sub">${esc(unit.project_name || '—')}${unit.floor_label ? ' · ' + esc(unit.floor_label) : ''}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${_ucOriginBadge(unit.origin_type)}
        ${NX.badge(chain.length + ' event' + (chain.length === 1 ? '' : 's'), 'info', { dot:true })}
      </div>
    </div>`);

  if (chain.length === 0) {
    return `<div style="margin-bottom:16px">${summary}</div>` +
      NX.card(NX.empty({ icon:'git-branch', message:'No history yet — when this unit is sold, cancelled, transferred or changed, the chain will appear here.' }));
  }

  const tl = NX.card(`<div class="uc-tl">${chain.map((evt, i) => _ucEventHTML(evt, i, chain.length)).join('')}</div>`);
  return `<div style="margin-bottom:16px">${summary}</div>` + tl;
}

function _ucOriginBadge(origin) {
  if (origin === 'ex_cancelled') return NX.badge('Ex-cancelled', 'warning', { dot:true });
  if (origin === 'transferred')  return NX.badge('Transferred', 'info', { dot:true });
  return NX.badge('Fresh inventory', '', { dot:true });
}

function _ucEventHTML(evt, idx, total) {
  const typeMap  = { sale: 'is-sale', cancellation: 'is-cancel', transfer: 'is-xfer', unit_change: 'is-xfer' };
  const labelMap = { sale: 'Sale', cancellation: 'Cancellation', transfer: 'Transfer', unit_change: 'Unit Changed' };
  const toneMap  = { sale: 'primary', cancellation: 'danger', transfer: 'warning', unit_change: 'info' };
  const cls = typeMap[evt.event_type] || '';
  const lbl = labelMap[evt.event_type] || evt.event_type;
  const tone = toneMap[evt.event_type] || '';
  const date = _ucFormatDate(evt.event_at);
  const amtA = Number(evt.amount_a || 0);
  const amtB = Number(evt.amount_b || 0);

  const isReSale = evt.event_type === 'sale' && evt.is_resale;
  const isTransferSale = evt.event_type === 'sale' && evt.is_transfer;
  const ownershipOrder = evt.event_type === 'sale' ? _ucCalcOwnerOrder(idx) : null;

  let aLabel = '', bLabel = '';
  if (evt.event_type === 'sale')         { aLabel = 'Sale Price'; bLabel = 'Paid'; }
  if (evt.event_type === 'cancellation') { aLabel = 'Total Paid'; bLabel = 'Net Refund'; }
  if (evt.event_type === 'transfer')     { aLabel = 'New Sale Price'; bLabel = 'Transfer Charges'; }
  // Same buyer, different unit. amount_a is THIS unit's price (the RPC picks the side that belongs
  // to the unit being viewed), amount_b the money he had already paid and carried across.
  if (evt.event_type === 'unit_change')  { aLabel = 'Price On This Unit'; bLabel = 'Paid & Carried'; }

  const inner =
    `<div class="uc-meta">
      ${NX.badge(lbl, tone, { dot:true })}
      ${ownershipOrder ? NX.chip(ownershipOrder) : ''}
      ${isReSale ? NX.badge('Re-sale', 'warning') : ''}
      ${isTransferSale ? NX.badge('Via transfer', 'info') : ''}
      ${evt.voucher_no ? `<span class="uc-vch">${esc(evt.voucher_no)}</span>` : ''}
      <span class="uc-date">${date}</span>
    </div>
    <div class="uc-client">${esc(evt.client_name || '—')}</div>
    <div class="uc-fin">
      ${evt.client_cnic ? `<div><span class="lbl">CNIC</span><span class="val">${esc(evt.client_cnic)}</span></div>` : ''}
      ${evt.client_phone ? `<div><span class="lbl">Phone</span><span class="val">${esc(evt.client_phone)}</span></div>` : ''}
      ${amtA ? `<div><span class="lbl">${aLabel}</span><span class="val">PKR ${_ucFM(amtA)}</span></div>` : ''}
      ${amtB ? `<div><span class="lbl">${bLabel}</span><span class="val">PKR ${_ucFM(amtB)}</span></div>` : ''}
    </div>
    ${evt.reason || evt.note ? `<div class="uc-note">${[evt.reason, evt.note].filter(Boolean).map(esc).join(' — ')}</div>` : ''}`;

  return `<div class="uc-ev"><span class="uc-dot ${cls}"></span>${NX.card(inner, { compact:true })}</div>`;
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
  _ucCSS();
  el.innerHTML = NX.card(NX.empty({ icon:'git-branch', message:'Loading ownership chain…' }));
  await _ucLoad(unitId, el);
}

/* ── Print (unchanged) ──────────────────────────────────────────────── */
function _ucPrint() {
  if (!_ucChain) return;
  const unit = _ucChain.unit || {};
  const co = window._companyCache || {};
  const today = new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });

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
function _ucFM(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function _ucFormatDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

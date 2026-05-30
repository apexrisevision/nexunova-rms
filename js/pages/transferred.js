/* ════════════════════════════════════════════════════════════════════════════
   TRANSFERRED UNITS LEDGER — premium SaaS list
   ════════════════════════════════════════════════════════════════════════════ */

let _tlList = [];
let _tlFilter = { project: '', fr: '', to: '', settlement_status: 'All' };

function rTransferLedger() {
  const pg = document.getElementById('pg-transferunits');
  if (!pg) return;

  if (!_tlFilter.fr && typeof _ldgFiscalYear === 'function') {
    const { from, to } = _ldgFiscalYear();
    _tlFilter.fr = from; _tlFilter.to = to;
  }

  const projects = window._projectsCache || [];
  const projOpts = projects.map(p => `<option value="${esc(p.id)}">${esc(p.projectName || p.name || '')}</option>`).join('');
  const isA = S?.role === 'admin' || S?.role === 'owner';

  pg.innerHTML = `
    <div class="rops">
      <div class="rops-hd">
        <div class="rops-hd-l">
          <div class="rops-hd-mark">${_tlIco('xfer')}</div>
          <div>
            <h1 class="rops-hd-title">Transferred Units Ledger</h1>
            <div class="rops-hd-sub">Ownership-transfer register with charges and settlement</div>
          </div>
        </div>
        <div class="rops-hd-r">
          ${isA ? `<button class="rops-btn rops-btn-primary rops-btn-sm" onclick="nav('unittransfer')">+ New Transfer</button>` : ''}
        </div>
      </div>

      <div class="rops-ldg-filters">
        <div class="rops-fr">
          <label class="rops-fl">Project</label>
          <select class="rops-sel" id="tl-f-project" onchange="_tlApplyFilter()">
            <option value="">All Projects</option>${projOpts}
          </select>
        </div>
        <div class="rops-fr">
          <label class="rops-fl">Settlement Status</label>
          <select class="rops-sel" id="tl-f-settlement" onchange="_tlApplyFilter()">
            <option value="All">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="partial">Partial</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <div class="rops-fr">
          <label class="rops-fl">Date From</label>
          <input type="date" class="rops-inp" id="tl-f-fr" value="${esc(_tlFilter.fr)}" onchange="_tlApplyFilter()">
        </div>
        <div class="rops-fr">
          <label class="rops-fl">Date To</label>
          <input type="date" class="rops-inp" id="tl-f-to" value="${esc(_tlFilter.to)}" onchange="_tlApplyFilter()">
        </div>
        <div class="rops-fr">
          <label class="rops-fl">&nbsp;</label>
          <button class="rops-btn rops-btn-ghost" onclick="_tlClearFilter()">Clear Filters</button>
        </div>
      </div>

      <div class="rops-kpis" id="tl-kpis"></div>

      <div class="rops-tbl-wrap">
        <div id="tl-tbl"></div>
      </div>
    </div>

    <div class="rops-drawer-overlay" id="tl-drawer-ov" onclick="_tlCloseDrawer()"></div>
    <div class="rops-drawer" id="tl-drawer"></div>`;

  _tlLoad();
}

async function _tlLoad() {
  const tbl = document.getElementById('tl-tbl');
  const kpis = document.getElementById('tl-kpis');
  if (!tbl) return;
  tbl.innerHTML = `<div class="rops-tbl-empty"><span class="rops-spin"></span> Loading ledger…</div>`;

  try {
    const f = _tlFilter;
    const res = await supabase.rpc('get_transferred_units_ledger', {
      p_company_id: S.cid,
      p_project_id: f.project || null,
      p_date_from: f.fr || null,
      p_date_to: f.to || null,
      p_settlement_status: f.settlement_status || 'All'
    });
    const d = res.data;
    if (!d || d.success === false) throw new Error(d?.error || 'RPC error');
    _tlList = d.rows || [];
    _tlRenderKPIs();
    _tlRenderTable();
  } catch (e) {
    tbl.innerHTML = `<div class="rops-tbl-empty" style="color:var(--err)">Could not load ledger — ${esc(e.message)}</div>`;
    if (kpis) kpis.innerHTML = '';
  }
}

function _tlApplyFilter() {
  _tlFilter.project = document.getElementById('tl-f-project')?.value || '';
  _tlFilter.fr = document.getElementById('tl-f-fr')?.value || '';
  _tlFilter.to = document.getElementById('tl-f-to')?.value || '';
  _tlFilter.settlement_status = document.getElementById('tl-f-settlement')?.value || 'All';
  _tlLoad();
}

function _tlClearFilter() {
  _tlFilter = { project: '', fr: '', to: '', settlement_status: 'All' };
  ['tl-f-project','tl-f-fr','tl-f-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const r = document.getElementById('tl-f-settlement'); if (r) r.value = 'All';
  _tlLoad();
}

function _tlRenderKPIs() {
  const el = document.getElementById('tl-kpis');
  if (!el) return;
  const rows = _tlList;
  const count = rows.length;
  const totalCharges = rows.reduce((s, r) => s + (+r.total_transfer_charges || 0), 0);
  const totalNewSale = rows.reduce((s, r) => s + (+r.new_sale_price || 0), 0);
  const totalOldPaid = rows.reduce((s, r) => s + (+r.old_total_paid || 0), 0);

  el.innerHTML = `
    <div class="rops-kpi"><div class="rops-kpi-lbl">Transfers</div><div class="rops-kpi-val">${count}</div></div>
    <div class="rops-kpi is-accent"><div class="rops-kpi-lbl">New Sale Volume</div><div class="rops-kpi-val">PKR ${_tlFM(totalNewSale)}</div></div>
    <div class="rops-kpi is-success"><div class="rops-kpi-lbl">Transfer Charges</div><div class="rops-kpi-val">PKR ${_tlFM(totalCharges)}</div></div>
    <div class="rops-kpi"><div class="rops-kpi-lbl">Pre-transfer Paid</div><div class="rops-kpi-val">PKR ${_tlFM(totalOldPaid)}</div></div>`;
}

function _tlRenderTable() {
  const wrap = document.getElementById('tl-tbl');
  if (!wrap) return;
  if (!_tlList.length) {
    wrap.innerHTML = `<div class="rops-tbl-empty">No transfers found for the selected filters.</div>`;
    return;
  }
  const rows = _tlList.map((r, i) => `<tr onclick="_tlOpenDrawer(${i})">
      <td>${esc(_tlDate(r.transfer_date))}</td>
      <td>
        <div style="font-weight:600">${esc(r.unit_no || r.unit_code || '—')}</div>
        <div style="font-size:11px; color:var(--t3); font-family:'JetBrains Mono', monospace">${esc(r.transfer_voucher_no || '')}</div>
      </td>
      <td>${esc(r.project_name || '—')}</td>
      <td>${esc(r.old_client_name || '—')}</td>
      <td>${esc(r.new_client_name || '—')}</td>
      <td class="num">${_tlFM(+r.old_total_paid || 0)}</td>
      <td class="num">${_tlFM(+r.new_sale_price || 0)}</td>
      <td class="num pos">${_tlFM(+r.total_transfer_charges || 0)}</td>
      <td>${_tlBadge(r.settlement_status)}</td>
    </tr>`).join('');

  wrap.innerHTML = `
    <div style="overflow-x:auto">
      <table class="rops-tbl">
        <thead><tr>
          <th>Date</th>
          <th>Unit / Voucher</th>
          <th>Project</th>
          <th>Previous Owner</th>
          <th>New Owner</th>
          <th class="num">Pre-Paid</th>
          <th class="num">New Price</th>
          <th class="num">Charges</th>
          <th>Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function _tlBadge(s) {
  const v = (s || '').toLowerCase();
  if (v === 'completed' || v === 'paid') return `<span class="rops-badge is-success"><span class="dot"></span> Completed</span>`;
  if (v === 'partial') return `<span class="rops-badge is-warn"><span class="dot"></span> Partial</span>`;
  return `<span class="rops-badge is-accent"><span class="dot"></span> Active</span>`;
}

function _tlOpenDrawer(idx) {
  const r = _tlList[idx];
  if (!r) return;
  const drawer = document.getElementById('tl-drawer');
  const ov = document.getElementById('tl-drawer-ov');
  if (!drawer || !ov) return;

  drawer.innerHTML = `
    <div class="rops-drawer-hd">
      <div>
        <div class="rops-drawer-title">Transfer Detail</div>
        <div class="rops-drawer-sub">${esc(r.transfer_voucher_no || '')} · ${esc(_tlDate(r.transfer_date))}</div>
      </div>
      <button class="rops-drawer-close" onclick="_tlCloseDrawer()">×</button>
    </div>
    <div class="rops-drawer-bd">
      <div style="margin-bottom:18px">${_tlBadge(r.settlement_status)}</div>
      <div class="rops-ledger" style="margin-bottom:14px">
        <div class="rops-ledger-hd">Unit</div>
        <div class="rops-ledger-row"><span class="l">Unit</span><span class="r">${esc(r.unit_no || r.unit_code || '—')}</span></div>
        <div class="rops-ledger-row"><span class="l">Project</span><span class="r">${esc(r.project_name || '—')}</span></div>
        <div class="rops-ledger-row"><span class="l">New Sale No</span><span class="r">${esc(r.new_sale_number || '—')}</span></div>
      </div>
      <div class="rops-ledger" style="margin-bottom:14px">
        <div class="rops-ledger-hd">Previous Owner</div>
        <div class="rops-ledger-row"><span class="l">Name</span><span class="r">${esc(r.old_client_name || '—')}</span></div>
        <div class="rops-ledger-row"><span class="l">Old Sale Price</span><span class="r">PKR ${_tlFM(+r.old_sale_price || 0)}</span></div>
        <div class="rops-ledger-row"><span class="l">Pre-Paid</span><span class="r pos">PKR ${_tlFM(+r.old_total_paid || 0)}</span></div>
        <div class="rops-ledger-row"><span class="l">Pre-Outstanding</span><span class="r neg">PKR ${_tlFM(+r.old_outstanding || 0)}</span></div>
      </div>
      <div class="rops-ledger" style="margin-bottom:14px">
        <div class="rops-ledger-hd">New Owner</div>
        <div class="rops-ledger-row"><span class="l">Name</span><span class="r">${esc(r.new_client_name || '—')}</span></div>
        <div class="rops-ledger-row"><span class="l">New Net Amount</span><span class="r" style="color:var(--brand)">PKR ${_tlFM(+r.new_sale_price || 0)}</span></div>
      </div>
      <div class="rops-ledger">
        <div class="rops-ledger-hd">Transfer Charges</div>
        <div class="rops-ledger-row"><span class="l">Transfer Fee</span><span class="r">PKR ${_tlFM(+r.transfer_fee || 0)}</span></div>
        <div class="rops-ledger-row"><span class="l">Documentation</span><span class="r">PKR ${_tlFM(+r.documentation_charges || 0)}</span></div>
        <div class="rops-ledger-row"><span class="l">Other</span><span class="r">PKR ${_tlFM(+r.other_charges || 0)}</span></div>
        <div class="rops-ledger-row is-total"><span class="l">Total Charges</span><span class="r pos">PKR ${_tlFM(+r.total_transfer_charges || 0)}</span></div>
        <div class="rops-ledger-row"><span class="l">Paid By</span><span class="r">${esc(r.charges_paid_by || '—')}</span></div>
        <div class="rops-ledger-row"><span class="l">Method</span><span class="r">${esc(r.charges_payment_method || '—')}</span></div>
      </div>
      ${r.notes ? `<div style="margin-top:14px; padding:12px 14px; background:var(--surface2); border-radius:6px; font-size:12.5px; color:var(--t2); line-height:1.5"><strong style="color:var(--text)">Notes: </strong>${esc(r.notes)}</div>` : ''}
      <div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap">
        <button class="rops-btn rops-btn-primary" onclick="printTransferLetter('${esc(r.id)}')">Print Transfer Letter</button>
        <button class="rops-btn rops-btn-ghost" onclick="rUnitChain('${esc(r.unit_id)}')">Ownership Chain</button>
      </div>
    </div>`;
  drawer.classList.add('is-open');
  ov.classList.add('is-open');
}

function _tlCloseDrawer() {
  document.getElementById('tl-drawer')?.classList.remove('is-open');
  document.getElementById('tl-drawer-ov')?.classList.remove('is-open');
}

function _tlFM(n) { return Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
function _tlDate(d) {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}
function _tlIco(name) {
  const i = {
    xfer: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>'
  };
  return i[name] || '';
}

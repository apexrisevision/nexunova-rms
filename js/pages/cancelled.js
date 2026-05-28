/* ════════════════════════════════════════════════════════════════════════════
   CANCELLED UNITS LEDGER — premium SaaS list
   ════════════════════════════════════════════════════════════════════════════ */

let _clList = [];
let _clFilter = { project: '', fr: '', to: '', refund_status: 'All' };

function rCancelLedger() {
  const pg = document.getElementById('pg-cancelledunits');
  if (!pg) return;

  if (!_clFilter.fr && typeof _ldgFiscalYear === 'function') {
    const { from, to } = _ldgFiscalYear();
    _clFilter.fr = from; _clFilter.to = to;
  }

  const projects = (typeof gprojects === 'function') ? gprojects() : (window._projectsCache || []);
  const projOpts = projects.map(p => `<option value="${esc(p.id)}"${_clFilter.project===p.id?' selected':''}>${esc(p.projectName || p.name || '')}</option>`).join('');

  pg.innerHTML = `
    <div class="rops">
      <div class="rops-hd">
        <div class="rops-hd-l">
          <div class="rops-hd-mark is-danger">${_clIco('x')}</div>
          <div>
            <h1 class="rops-hd-title" style="font-size:18px;font-weight:700;margin:0;letter-spacing:-.01em">Cancelled Units Ledger</h1>
            <div class="rops-hd-sub" style="font-size:12px;margin-top:2px">Forfeiture &amp; refund breakdown</div>
          </div>
        </div>
        <div class="rops-hd-r">
          <button class="dx-tool primary" onclick="nav('unitcancel')">+ New Cancellation</button>
        </div>
      </div>

      <div class="dx-toolbar" style="margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div class="dx-toolbar-l" style="flex-wrap:wrap;gap:8px">
          <select class="rops-sel" id="cl-f-project" onchange="_clApplyFilter()" style="min-width:150px">
            <option value="">All Projects</option>${projOpts}
          </select>
          <select class="rops-sel" id="cl-f-refund" onchange="_clApplyFilter()" style="min-width:140px">
            <option value="All"${_clFilter.refund_status==='All'?' selected':''}>All Statuses</option>
            <option value="paid"${_clFilter.refund_status==='paid'?' selected':''}>Paid</option>
            <option value="partial"${_clFilter.refund_status==='partial'?' selected':''}>Partial</option>
            <option value="pending"${_clFilter.refund_status==='pending'?' selected':''}>Pending</option>
          </select>
          <input type="date" class="rops-sel" id="cl-f-fr" value="${esc(_clFilter.fr)}" onchange="_clApplyFilter()" style="min-width:130px">
          <input type="date" class="rops-sel" id="cl-f-to" value="${esc(_clFilter.to)}" onchange="_clApplyFilter()" style="min-width:130px">
          <button class="dx-tool" onclick="_clClearFilter()">Clear</button>
        </div>
      </div>

      <div class="rops-kpis" id="cl-kpis"></div>

      <div class="rops-tbl-wrap">
        <div id="cl-tbl"></div>
      </div>
    </div>

    <div class="rops-drawer-overlay" id="cl-drawer-ov" onclick="_clCloseDrawer()"></div>
    <div class="rops-drawer" id="cl-drawer"></div>`;

  _clLoad();
}

async function _clLoad() {
  const tbl = document.getElementById('cl-tbl');
  const kpis = document.getElementById('cl-kpis');
  if (!tbl) return;
  tbl.innerHTML = `<div class="rops-tbl-empty"><span class="rops-spin"></span> Loading ledger…</div>`;

  try {
    const f = _clFilter;
    const res = await supabase.rpc('get_cancelled_units_ledger', {
      p_company_id: S.cid,
      p_project_id: f.project || null,
      p_date_from: f.fr || null,
      p_date_to: f.to || null,
      p_refund_status: f.refund_status || 'All'
    });
    const d = res.data;
    if (!d || d.success === false) throw new Error(d?.error || 'RPC error');
    _clList = d.rows || [];
    _clRenderKPIs();
    _clRenderTable();
  } catch (e) {
    tbl.innerHTML = `<div class="rops-tbl-empty" style="color:var(--err)">Could not load ledger — ${esc(e.message)}</div>`;
    if (kpis) kpis.innerHTML = '';
  }
}

function _clApplyFilter() {
  _clFilter.project = document.getElementById('cl-f-project')?.value || '';
  _clFilter.fr = document.getElementById('cl-f-fr')?.value || '';
  _clFilter.to = document.getElementById('cl-f-to')?.value || '';
  _clFilter.refund_status = document.getElementById('cl-f-refund')?.value || 'All';
  _clLoad();
}

function _clClearFilter() {
  _clFilter = { project: '', fr: '', to: '', refund_status: 'All' };
  ['cl-f-project','cl-f-fr','cl-f-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const r = document.getElementById('cl-f-refund'); if (r) r.value = 'All';
  _clLoad();
}

function _clRenderKPIs() {
  const el = document.getElementById('cl-kpis');
  if (!el) return;
  const rows = _clList;
  const totalCount = rows.length;
  const totalForfeited = rows.reduce((s, r) => s + (+r.total_deductions || 0), 0);
  const totalRefundDue = rows.reduce((s, r) => s + (+r.net_refund_amount || 0), 0);
  const totalRefundPaid = rows.reduce((s, r) =>
    (r.refund_status || '').toLowerCase() === 'paid' ? s + (+r.net_refund_amount || 0) : s, 0);
  const totalPending = Math.max(0, totalRefundDue - totalRefundPaid);

  el.innerHTML = `
    <div class="rops-kpi"><div class="rops-kpi-lbl">Cancelled</div><div class="rops-kpi-val" style="font-size:28px">${totalCount}</div></div>
    <div class="rops-kpi is-danger"><div class="rops-kpi-lbl">Forfeited</div><div class="rops-kpi-val" style="font-size:18px">PKR ${_clFM(totalForfeited)}</div></div>
    <div class="rops-kpi is-success"><div class="rops-kpi-lbl">Refund Paid</div><div class="rops-kpi-val" style="font-size:18px">PKR ${_clFM(totalRefundPaid)}</div></div>
    <div class="rops-kpi is-warn"><div class="rops-kpi-lbl">Pending Refund</div><div class="rops-kpi-val" style="font-size:18px">PKR ${_clFM(totalPending)}</div></div>`;
}

function _clRenderTable() {
  const wrap = document.getElementById('cl-tbl');
  if (!wrap) return;
  if (!_clList.length) {
    wrap.innerHTML = `<div class="rops-tbl-empty">No cancellations found for the selected filters.</div>`;
    return;
  }
  const rows = _clList.map((r, i) => {
    const refundDue = +r.net_refund_amount || 0;
    const forfeited = +r.total_deductions || 0;
    const paid = (r.refund_status || '').toLowerCase() === 'paid' ? refundDue : 0;
    const pending = Math.max(0, refundDue - paid);
    return `<tr onclick="_clOpenDrawer(${i})">
      <td>${esc(_clDate(r.cancellation_date))}</td>
      <td>
        <div style="font-weight:600">${esc(r.unit_no || r.unit_code || '—')}</div>
        <div style="font-size:11px; color:var(--t3); font-family:'JetBrains Mono', monospace">${esc(r.cancellation_voucher_no || '')}</div>
      </td>
      <td>${esc(r.client_name || '—')}</td>
      <td>${esc(r.project_name || '—')}</td>
      <td class="num">${_clFM(+r.total_paid || 0)}</td>
      <td class="num neg">${_clFM(forfeited)}</td>
      <td class="num">${_clFM(refundDue)}</td>
      <td class="num pos">${_clFM(paid)}</td>
      <td class="num ${pending > 0 ? 'neg' : 'muted'}">${_clFM(pending)}</td>
      <td>${_clBadge(r.refund_status)}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div style="overflow-x:auto">
      <table class="rops-tbl">
        <thead><tr>
          <th>Date</th>
          <th>Unit / Voucher</th>
          <th>Client</th>
          <th>Project</th>
          <th class="num">Total Paid</th>
          <th class="num">Forfeited</th>
          <th class="num">Refund Due</th>
          <th class="num">Refund Paid</th>
          <th class="num">Pending</th>
          <th>Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function _clBadge(status) {
  const s = (status || '').toLowerCase();
  if (s === 'paid') return `<span class="rops-badge is-success"><span class="dot"></span> Paid</span>`;
  if (s === 'partial') return `<span class="rops-badge is-warn"><span class="dot"></span> Partial</span>`;
  return `<span class="rops-badge is-danger"><span class="dot"></span> Pending</span>`;
}

function _clOpenDrawer(idx) {
  const r = _clList[idx];
  if (!r) return;
  const drawer = document.getElementById('cl-drawer');
  const ov = document.getElementById('cl-drawer-ov');
  if (!drawer || !ov) return;

  const refundDue = +r.net_refund_amount || 0;
  const forfeited = +r.total_deductions || 0;
  const paid = (r.refund_status || '').toLowerCase() === 'paid' ? refundDue : 0;
  const pending = Math.max(0, refundDue - paid);

  drawer.innerHTML = `
    <div class="rops-drawer-hd">
      <div>
        <div class="rops-drawer-title">Cancellation Detail</div>
        <div class="rops-drawer-sub">${esc(r.cancellation_voucher_no || '')} · ${esc(_clDate(r.cancellation_date))}</div>
      </div>
      <button class="rops-drawer-close" onclick="_clCloseDrawer()">×</button>
    </div>
    <div class="rops-drawer-bd">
      <div style="margin-bottom:18px">${_clBadge(r.refund_status)}</div>
      <div class="rops-ledger" style="margin-bottom:14px">
        <div class="rops-ledger-hd">Unit & Client</div>
        <div class="rops-ledger-row"><span class="l">Client</span><span class="r">${esc(r.client_name || '—')}</span></div>
        <div class="rops-ledger-row"><span class="l">Unit</span><span class="r">${esc(r.unit_no || r.unit_code || '—')}</span></div>
        <div class="rops-ledger-row"><span class="l">Project</span><span class="r">${esc(r.project_name || '—')}</span></div>
        <div class="rops-ledger-row"><span class="l">Type</span><span class="r">${esc(r.cancellation_type || '—')}</span></div>
        <div class="rops-ledger-row"><span class="l">Reason</span><span class="r">${esc(r.reason_category || '—')}</span></div>
      </div>
      <div class="rops-ledger" style="margin-bottom:14px">
        <div class="rops-ledger-hd">Refund</div>
        <div class="rops-ledger-row"><span class="l">Refund Date</span><span class="r">${esc(_clDate(r.refund_date) || '—')}</span></div>
        <div class="rops-ledger-row"><span class="l">Method</span><span class="r">${esc(r.refund_method || '—')}</span></div>
        <div class="rops-ledger-row"><span class="l">Reference</span><span class="r">${esc(r.refund_reference || '—')}</span></div>
      </div>
      <div class="rops-ledger">
        <div class="rops-ledger-hd">Financial Breakdown</div>
        <div class="rops-ledger-row"><span class="l">Total Paid</span><span class="r">PKR ${_clFM(+r.total_paid || 0)}</span></div>
        <div class="rops-ledger-row"><span class="l">Booking Forfeiture</span><span class="r neg">− PKR ${_clFM(+r.booking_forfeiture || 0)}</span></div>
        <div class="rops-ledger-row"><span class="l">Cancellation Charges</span><span class="r neg">− PKR ${_clFM(+r.cancellation_charges || 0)}</span></div>
        <div class="rops-ledger-row"><span class="l">Total Deductions</span><span class="r neg">− PKR ${_clFM(forfeited)}</span></div>
        <div class="rops-ledger-row is-total"><span class="l">Net Refund Due</span><span class="r" style="color:var(--brand)">PKR ${_clFM(refundDue)}</span></div>
        <div class="rops-ledger-row"><span class="l">Refund Paid</span><span class="r pos">PKR ${_clFM(paid)}</span></div>
        <div class="rops-ledger-row"><span class="l">Refund Pending</span><span class="r ${pending > 0 ? 'neg' : 'muted'}">PKR ${_clFM(pending)}</span></div>
      </div>
      ${r.detailed_reason ? `<div style="margin-top:14px; padding:12px 14px; background:var(--surface2); border-radius:6px; font-size:12.5px; color:var(--t2); line-height:1.5"><strong style="color:var(--text)">Reason: </strong>${esc(r.detailed_reason)}</div>` : ''}
      ${r.notes ? `<div style="margin-top:8px; padding:12px 14px; background:var(--surface2); border-radius:6px; font-size:12.5px; color:var(--t2); line-height:1.5"><strong style="color:var(--text)">Notes: </strong>${esc(r.notes)}</div>` : ''}
    </div>`;
  drawer.classList.add('is-open');
  ov.classList.add('is-open');
}

function _clCloseDrawer() {
  document.getElementById('cl-drawer')?.classList.remove('is-open');
  document.getElementById('cl-drawer-ov')?.classList.remove('is-open');
}

function _clFM(n) { return Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
function _clDate(d) {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}
function _clIco(name) {
  const i = {
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
  };
  return i[name] || '';
}

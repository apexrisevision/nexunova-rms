/* ════════════════════════════════════════════════════════════════════════════
   CANCELLED UNITS LEDGER — warmth kit (read register)
   RPC untouched: get_cancelled_units_ledger
   ════════════════════════════════════════════════════════════════════════════ */

let _clList = [];
let _clFilter = { project: '', fr: '', to: '', refund_status: 'All' };

function rCancelLedger() {
  const pg = document.getElementById('pg-cancelledunits');
  if (!pg) return;
  if (typeof _ldgCSS === 'function') _ldgCSS();

  // No default date window — cancelled units (incl. imported ones without a
  // recorded cancellation date) should all be visible on open; the user can
  // narrow by date if they want.
  if (!_clFilter.project && typeof activeProjectId === 'function') _clFilter.project = activeProjectId() || '';   // global project lens
  const projects = ((typeof gprojects === 'function') ? gprojects() : (window._projectsCache || []))
    .filter(p => typeof hasProjectAccess !== 'function' || hasProjectAccess(p.id));
  const projOpts = '<option value="">All projects</option>' +
    projects.map(p => `<option value="${esc(p.id)}"${_clFilter.project===p.id?' selected':''}>${esc(p.projectName || p.name || '')}</option>`).join('');
  const stOpts = [['All','All statuses'],['paid','Paid'],['partial','Partial'],['pending','Pending']]
    .map(([v,l]) => `<option value="${v}"${_clFilter.refund_status===v?' selected':''}>${l}</option>`).join('');
  const isA = S?.role === 'admin' || S?.role === 'owner';

  pg.innerHTML =
    '<div class="ani">' +
      NX.pageHeader('Cancelled Units',
        isA ? NX.button('New cancellation', { variant:'danger-soft', icon:'ban', onclick:"nav('unitcancel')" }) : '',
        { icon:'x-circle', tone:'danger', sub:'Forfeiture & refund breakdown.' }) +
      '<div class="ldg-kpis" id="cl-kpis"></div>' +
      `<div class="ldg-filters">
        <div class="ldg-f"><label>Project</label><select class="nx-select" id="cl-f-project" onchange="_clApplyFilter()">${projOpts}</select></div>
        <div class="ldg-f"><label>Refund</label><select class="nx-select" id="cl-f-refund" onchange="_clApplyFilter()">${stOpts}</select></div>
        <div class="ldg-f"><label>From</label><input class="nx-input" type="date" id="cl-f-fr" value="${esc(_clFilter.fr)}" onchange="_clApplyFilter()"></div>
        <div class="ldg-f"><label>To</label><input class="nx-input" type="date" id="cl-f-to" value="${esc(_clFilter.to)}" onchange="_clApplyFilter()"></div>
        ${NX.button('Clear', { variant:'secondary', onclick:'_clClearFilter()' })}
      </div>` +
      '<div id="cl-tbl"></div>' +
    '</div>' +
    '<div id="cl-modal-host"></div>';

  _clLoad();
}

async function _clLoad() {
  const tbl = document.getElementById('cl-tbl');
  const kpis = document.getElementById('cl-kpis');
  if (!tbl) return;
  tbl.innerHTML = NX.card(NX.empty({ icon:'x-circle', message:'Loading ledger…' }));

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
    tbl.innerHTML = NX.card(NX.banner('Could not load ledger: ' + (e.message || 'Error'), 'danger'));
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
  const totalCollected = rows.reduce((s, r) => s + (+r.total_paid || 0), 0);
  const totalForfeited = rows.reduce((s, r) => s + (+r.total_deductions || 0), 0);
  const totalRefundDue = rows.reduce((s, r) => s + (+r.net_refund_amount || 0), 0);
  const totalRefundPaid = rows.reduce((s, r) =>
    (r.refund_status || '').toLowerCase() === 'paid' ? s + (+r.net_refund_amount || 0) : s, 0);
  const totalPending = Math.max(0, totalRefundDue - totalRefundPaid);

  el.innerHTML =
    NX.kpi({ icon:'x-circle',   tone:'danger',  label:'Cancelled',       value:String(totalCount) }) +
    NX.kpi({ icon:'wallet',     tone:'info',    label:'Collected (on cancelled)', value:`PKR ${_clK(totalCollected)}` }) +
    NX.kpi({ icon:'ban',        tone:'danger',  label:'Forfeited',       value:`PKR ${_clK(totalForfeited)}` }) +
    NX.kpi({ icon:'check-circle', tone:'success', label:'Refund Paid',   value:`PKR ${_clK(totalRefundPaid)}` }) +
    NX.kpi({ icon:'clock',      tone:'warning', label:'Pending Refund',  value:`PKR ${_clK(totalPending)}` });
}

function _clRenderTable() {
  const wrap = document.getElementById('cl-tbl');
  if (!wrap) return;
  if (!_clList.length) {
    wrap.innerHTML = NX.card(NX.empty({ icon:'x-circle', message:'No cancellations found for the selected filters.' }));
    return;
  }
  const body = `<table class="nx-table"><thead><tr>
      <th>Date</th><th>Unit / Voucher</th><th>Client</th><th>Project</th>
      <th class="num">Total Paid</th><th class="num">Forfeited</th><th class="num">Refund Due</th>
      <th class="num">Refund Paid</th><th class="num">Pending</th><th>Status</th>
    </tr></thead><tbody>
    ${_clList.map((r, i) => {
      const refundDue = +r.net_refund_amount || 0;
      const forfeited = +r.total_deductions || 0;
      const paid = (r.refund_status || '').toLowerCase() === 'paid' ? refundDue : 0;
      const pending = Math.max(0, refundDue - paid);
      // Imported / silently-cancelled units have no formal refund record — show the
      // collected amount but blank the refund columns so nothing reads as "owed".
      const hasRec = r.has_record !== false && r.id != null;
      const dash = '<span style="color:var(--fk-text-muted)">—</span>';
      return `<tr style="cursor:pointer" onclick="_clOpenDetail(${i})">
        <td style="white-space:nowrap">${esc(_clDate(r.cancellation_date)) || dash}</td>
        <td><div style="font-weight:500">${esc(r.unit_no || r.unit_code || '—')}</div><div class="nx-mono" style="font-size:11px;color:var(--fk-text-muted)">${esc(r.cancellation_voucher_no || r.sale_number || '')}</div></td>
        <td>${esc(r.client_name || '—')}</td>
        <td style="color:var(--fk-text-muted)">${esc(r.project_name || '—')}</td>
        <td class="num">${_clFM(+r.total_paid || 0)}</td>
        <td class="num" style="color:var(--fk-danger)">${hasRec ? _clFM(forfeited) : dash}</td>
        <td class="num">${hasRec ? _clFM(refundDue) : dash}</td>
        <td class="num" style="color:var(--fk-success)">${hasRec ? _clFM(paid) : dash}</td>
        <td class="num" style="color:${pending > 0 ? 'var(--fk-danger)' : 'var(--fk-text-muted)'}">${hasRec ? _clFM(pending) : dash}</td>
        <td>${hasRec ? _clBadge(r.refund_status) : '<span style="display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;background:var(--fk-bg-subtle);color:var(--fk-text-muted);white-space:nowrap">Not processed</span>'}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
  wrap.innerHTML = NX.card(body, { flush:true });
}

function _clBadge(status) {
  const s = (status || '').toLowerCase();
  if (s === 'paid') return NX.badge('Paid', 'success', { dot:true });
  if (s === 'partial') return NX.badge('Partial', 'warning', { dot:true });
  return NX.badge('Pending', 'danger', { dot:true });
}

function _clOpenDetail(idx) {
  const r = _clList[idx];
  if (!r) return;
  const host = document.getElementById('cl-modal-host');
  if (!host) return;

  const refundDue = +r.net_refund_amount || 0;
  const forfeited = +r.total_deductions || 0;
  const paid = (r.refund_status || '').toLowerCase() === 'paid' ? refundDue : 0;
  const pending = Math.max(0, refundDue - paid);
  const hasRec = r.has_record !== false && r.id != null;

  const grp = (icon, tone, title, rows) =>
    `<div class="ldg-grp"><div class="ldg-grp-hd">${NX.ichip(icon, tone, { size:'sm' })}${esc(title)}</div>${rows}</div>`;
  const row = (l, v, cls) => `<div class="ldg-row"><span class="l">${esc(l)}</span><span class="r ${cls||''}">${v}</span></div>`;

  const body =
    (hasRec
      ? `<div style="margin-bottom:14px">${_clBadge(r.refund_status)}</div>`
      : `<div style="margin-bottom:14px;padding:11px 14px;background:var(--fk-bg-subtle);border-radius:var(--fk-radius-control);font-size:12.5px;color:var(--fk-text-muted);line-height:1.5"><strong style="color:var(--fk-text)">Not processed through cancellation workflow.</strong> Only the collected amount is known — forfeiture / refund treatment is handled in QuickBooks.</div>`) +
    grp('package', '', 'Unit & Client',
      row('Client', esc(r.client_name || '—')) +
      row('Unit', esc(r.unit_no || r.unit_code || '—')) +
      row('Project', esc(r.project_name || '—')) +
      row('Type', esc(r.cancellation_type || '—')) +
      row('Reason', esc(r.reason_category || '—'))) +
    (hasRec ? grp('rotate-ccw', '', 'Refund',
      row('Refund Date', esc(_clDate(r.refund_date) || '—')) +
      row('Method', esc(r.refund_method || '—')) +
      row('Reference', esc(r.refund_reference || '—'))) : '') +
    grp('wallet', '', hasRec ? 'Financial Breakdown' : 'Amount Collected',
      row(hasRec ? 'Total Paid' : 'Amount Collected', 'PKR ' + _clFM(+r.total_paid || 0)) +
      (hasRec
        ? row('Booking Forfeiture', '− PKR ' + _clFM(+r.booking_forfeiture || 0), 'ldg-neg') +
          row('Cancellation Charges', '− PKR ' + _clFM(+r.cancellation_charges || 0), 'ldg-neg') +
          row('Total Deductions', '− PKR ' + _clFM(forfeited), 'ldg-neg') +
          row('Net Refund Due', '<span style="color:var(--fk-primary)">PKR ' + _clFM(refundDue) + '</span>', 'is-total') +
          row('Refund Paid', 'PKR ' + _clFM(paid), 'ldg-pos') +
          row('Refund Pending', 'PKR ' + _clFM(pending), pending > 0 ? 'ldg-neg' : '')
        : '')) +
    (r.detailed_reason ? `<div style="padding:12px 14px;background:var(--fk-bg-subtle);border-radius:var(--fk-radius-control);font-size:12.5px;color:var(--fk-text-muted);line-height:1.5;margin-bottom:8px"><strong style="color:var(--fk-text)">Reason: </strong>${esc(r.detailed_reason)}</div>` : '') +
    (r.notes ? `<div style="padding:12px 14px;background:var(--fk-bg-subtle);border-radius:var(--fk-radius-control);font-size:12.5px;color:var(--fk-text-muted);line-height:1.5"><strong style="color:var(--fk-text)">Notes: </strong>${esc(r.notes)}</div>` : '');

  host.innerHTML = NX.modal({
    id:'cl-detail', title:'Cancellation detail', size:'m', onClose:'_clCloseDetail()', body,
    footer: (r.unit_id ? NX.button('Ownership chain', { variant:'secondary', icon:'git-branch', onclick:`_clCloseDetail();rUnitChain('${esc(r.unit_id)}')` }) : '') +
            NX.button('Close', { variant:'primary', onclick:'_clCloseDetail()' })
  });
}
function _clCloseDetail() { const h = document.getElementById('cl-modal-host'); if (h) h.innerHTML = ''; }

function _clFM(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function _clK(n) {
  n = Number(n || 0); const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return Math.round(n / 1e3) + 'K';
  return _clFM(n);
}
function _clDate(d) {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

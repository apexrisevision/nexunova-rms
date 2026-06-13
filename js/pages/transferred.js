/* ════════════════════════════════════════════════════════════════════════════
   TRANSFERRED UNITS LEDGER — warmth kit (read register)
   RPC untouched: get_transferred_units_ledger
   ════════════════════════════════════════════════════════════════════════════ */

let _tlList = [];
let _tlFilter = { project: '', fr: '', to: '', settlement_status: 'All' };

// One-time CSS for the register chrome (filters row, detail rows).
// Class names avoid the "-card" substring (visual-overhaul boxes those) → ldg-*.
function _ldgCSS() {
  if (document.getElementById('_ldg_css')) return;
  const s = document.createElement('style'); s.id = '_ldg_css';
  s.textContent = `
    .ldg-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
    @media(max-width:900px){.ldg-kpis{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:520px){.ldg-kpis{grid-template-columns:1fr}}
    .ldg-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px}
    .ldg-f{display:flex;flex-direction:column;gap:4px}
    .ldg-f label{font-size:var(--fk-fs-label,11px);font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--fk-text-muted)}
    .ldg-f .nx-select,.ldg-f .nx-input{height:var(--fk-h-input,36px);min-width:140px}
    .ldg-rows{display:flex;flex-direction:column}
    .ldg-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;font-size:13px;border-bottom:1px solid var(--fk-border)}
    .ldg-row:last-child{border-bottom:none}
    .ldg-row .l{color:var(--fk-text-muted)}
    .ldg-row .r{color:var(--fk-text);font-weight:500;font-variant-numeric:tabular-nums}
    .ldg-row.is-total{font-weight:600;border-top:1px solid var(--fk-border);margin-top:2px}
    .ldg-grp{margin-bottom:16px}
    .ldg-grp-hd{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--fk-text-muted);margin-bottom:6px}
    .ldg-pos{color:var(--fk-success)}
    .ldg-neg{color:var(--fk-danger)}
  `;
  document.head.appendChild(s);
}

function rTransferLedger() {
  const pg = document.getElementById('pg-transferunits');
  if (!pg) return;
  _ldgCSS();

  if (!_tlFilter.fr && typeof _ldgFiscalYear === 'function') {
    const { from, to } = _ldgFiscalYear();
    _tlFilter.fr = from; _tlFilter.to = to;
  }

  if (!_tlFilter.project && typeof activeProjectId === 'function') _tlFilter.project = activeProjectId() || '';   // global project lens
  const projects = (window._projectsCache || []).filter(p => typeof hasProjectAccess !== 'function' || hasProjectAccess(p.id));
  const projOpts = '<option value="">All projects</option>' +
    projects.map(p => `<option value="${esc(p.id)}"${_tlFilter.project===p.id?' selected':''}>${esc(p.projectName || p.name || '')}</option>`).join('');
  const stOpts = [['All','All statuses'],['completed','Completed'],['partial','Partial'],['pending','Pending']]
    .map(([v,l]) => `<option value="${v}"${_tlFilter.settlement_status===v?' selected':''}>${l}</option>`).join('');
  const isA = S?.role === 'admin' || S?.role === 'owner';

  pg.innerHTML =
    '<div class="ani">' +
      NX.pageHeader('Transferred Units',
        isA ? NX.button('New transfer', { variant:'primary', icon:'arrow-left-right', onclick:"nav('unittransfer')" }) : '',
        { icon:'arrow-left-right', sub:'Ownership-transfer register with charges and settlement.' }) +
      '<div class="ldg-kpis" id="tl-kpis"></div>' +
      `<div class="ldg-filters">
        <div class="ldg-f"><label>Project</label><select class="nx-select" id="tl-f-project" onchange="_tlApplyFilter()">${projOpts}</select></div>
        <div class="ldg-f"><label>Settlement</label><select class="nx-select" id="tl-f-settlement" onchange="_tlApplyFilter()">${stOpts}</select></div>
        <div class="ldg-f"><label>From</label><input class="nx-input" type="date" id="tl-f-fr" value="${esc(_tlFilter.fr)}" onchange="_tlApplyFilter()"></div>
        <div class="ldg-f"><label>To</label><input class="nx-input" type="date" id="tl-f-to" value="${esc(_tlFilter.to)}" onchange="_tlApplyFilter()"></div>
        ${NX.button('Clear', { variant:'secondary', onclick:'_tlClearFilter()' })}
      </div>` +
      '<div id="tl-tbl"></div>' +
    '</div>' +
    '<div id="tl-modal-host"></div>';

  _tlLoad();
}

async function _tlLoad() {
  const tbl = document.getElementById('tl-tbl');
  const kpis = document.getElementById('tl-kpis');
  if (!tbl) return;
  tbl.innerHTML = NX.card(NX.empty({ icon:'arrow-left-right', message:'Loading ledger…' }));

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
    tbl.innerHTML = NX.card(NX.banner('Could not load ledger: ' + (e.message || 'Error'), 'danger'));
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

  el.innerHTML =
    NX.kpi({ icon:'arrow-left-right', label:'Transfers',        value:String(count) }) +
    NX.kpi({ icon:'trending-up',      label:'New Sale Volume',  value:`PKR ${_tlK(totalNewSale)}` }) +
    NX.kpi({ icon:'hand-coins', tone:'success', label:'Transfer Charges', value:`PKR ${_tlK(totalCharges)}` }) +
    NX.kpi({ icon:'wallet',           label:'Pre-transfer Paid', value:`PKR ${_tlK(totalOldPaid)}` });
}

function _tlRenderTable() {
  const wrap = document.getElementById('tl-tbl');
  if (!wrap) return;
  if (!_tlList.length) {
    wrap.innerHTML = NX.card(NX.empty({ icon:'arrow-left-right', message:'No transfers found for the selected filters.' }));
    return;
  }
  const body = `<table class="nx-table"><thead><tr>
      <th>Date</th><th>Unit / Voucher</th><th>Project</th><th>Previous Owner</th><th>New Owner</th>
      <th class="num">Pre-Paid</th><th class="num">New Price</th><th class="num">Charges</th><th>Status</th>
    </tr></thead><tbody>
    ${_tlList.map((r, i) => `<tr style="cursor:pointer" onclick="_tlOpenDetail(${i})">
      <td style="white-space:nowrap">${esc(_tlDate(r.transfer_date))}</td>
      <td><div style="font-weight:500">${esc(r.unit_no || r.unit_code || '—')}</div><div class="nx-mono" style="font-size:11px;color:var(--fk-text-muted)">${esc(r.transfer_voucher_no || '')}</div></td>
      <td style="color:var(--fk-text-muted)">${esc(r.project_name || '—')}</td>
      <td>${esc(r.old_client_name || '—')}</td>
      <td>${esc(r.new_client_name || '—')}</td>
      <td class="num">${_tlFM(+r.old_total_paid || 0)}</td>
      <td class="num">${_tlFM(+r.new_sale_price || 0)}</td>
      <td class="num" style="color:var(--fk-success);font-weight:600">${_tlFM(+r.total_transfer_charges || 0)}</td>
      <td>${_tlBadge(r.settlement_status)}</td>
    </tr>`).join('')}</tbody></table>`;
  wrap.innerHTML = NX.card(body, { flush:true });
}

function _tlBadge(s) {
  const v = (s || '').toLowerCase();
  if (v === 'completed' || v === 'paid') return NX.badge('Completed', 'success', { dot:true });
  if (v === 'partial') return NX.badge('Partial', 'warning', { dot:true });
  return NX.badge('Active', 'info', { dot:true });
}

function _tlOpenDetail(idx) {
  const r = _tlList[idx];
  if (!r) return;
  const host = document.getElementById('tl-modal-host');
  if (!host) return;

  const grp = (icon, tone, title, rows) =>
    `<div class="ldg-grp"><div class="ldg-grp-hd">${NX.ichip(icon, tone, { size:'sm' })}${esc(title)}</div>${rows}</div>`;
  const row = (l, v, cls) => `<div class="ldg-row"><span class="l">${esc(l)}</span><span class="r ${cls||''}">${v}</span></div>`;

  const body =
    `<div style="margin-bottom:14px">${_tlBadge(r.settlement_status)}</div>` +
    grp('git-branch', '', 'Unit',
      row('Unit', esc(r.unit_no || r.unit_code || '—')) +
      row('Project', esc(r.project_name || '—')) +
      row('New Sale No', esc(r.new_sale_number || '—'))) +
    grp('user', '', 'Previous Owner',
      row('Name', esc(r.old_client_name || '—')) +
      row('Old Sale Price', 'PKR ' + _tlFM(+r.old_sale_price || 0)) +
      row('Pre-Paid', 'PKR ' + _tlFM(+r.old_total_paid || 0), 'ldg-pos') +
      row('Pre-Outstanding', 'PKR ' + _tlFM(+r.old_outstanding || 0), 'ldg-neg')) +
    grp('user', 'success', 'New Owner',
      row('Name', esc(r.new_client_name || '—')) +
      row('New Net Amount', '<span style="color:var(--fk-primary)">PKR ' + _tlFM(+r.new_sale_price || 0) + '</span>')) +
    grp('hand-coins', '', 'Transfer Charges',
      row('Transfer Fee', 'PKR ' + _tlFM(+r.transfer_fee || 0)) +
      row('Documentation', 'PKR ' + _tlFM(+r.documentation_charges || 0)) +
      row('Other', 'PKR ' + _tlFM(+r.other_charges || 0)) +
      row('Total Charges', 'PKR ' + _tlFM(+r.total_transfer_charges || 0), 'is-total ldg-pos') +
      row('Paid By', esc(r.charges_paid_by || '—')) +
      row('Method', esc(r.charges_payment_method || '—'))) +
    (r.notes ? `<div style="padding:12px 14px;background:var(--fk-bg-subtle);border-radius:var(--fk-radius-control);font-size:12.5px;color:var(--fk-text-muted);line-height:1.5"><strong style="color:var(--fk-text)">Notes: </strong>${esc(r.notes)}</div>` : '');

  host.innerHTML = NX.modal({
    id:'tl-detail', title:'Transfer detail', size:'m', onClose:'_tlCloseDetail()', body,
    footer: NX.button('Ownership chain', { variant:'secondary', icon:'git-branch', onclick:`_tlCloseDetail();rUnitChain('${esc(r.unit_id)}')` }) +
            NX.button('Print letter', { variant:'primary', icon:'printer', onclick:`printTransferLetter('${esc(r.id)}')` })
  });
}
function _tlCloseDetail() { const h = document.getElementById('tl-modal-host'); if (h) h.innerHTML = ''; }

function _tlFM(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function _tlK(n) {
  n = Number(n || 0); const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return Math.round(n / 1e3) + 'K';
  return _tlFM(n);
}
function _tlDate(d) {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

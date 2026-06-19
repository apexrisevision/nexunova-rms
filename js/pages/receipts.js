// ══ RECEIPT VOUCHERS PAGE ══════════════════════════════════════════════════
// Phase-3 batch-1: restyled onto the nx- foundation kit. Logic/RPCs unchanged
// (list_payments_filtered · get_sales_unit_map · cancel_payment) and the A4
// receipt still delegates to openReceiptReport / NXPrint.

let _rvList     = [];
let _rvFiltered = [];
let _rvPage     = 0;
const _RV_PG    = 15;
let _rvSaleMap  = {};
let _rvDetail   = null;
let _rvFilter   = { voucherNo:'', client:'', fr:'', to:'', mode:'All', amount:'', status:'All' };
let _rvSearchTimer = null;
let _rvEntry = null;          // CRV/BRV entry state: { unitId, summary }
let _rvEntrySearchTimer = null;

const _RV_MODE_LBL = { cash:'Cash', bank_transfer:'Bank Transfer', bank:'Bank', cheque:'Cheque / PDC', adjustment:'Adjustment', online:'Online', other:'Other' };

function rReceipts() {
  const el = document.getElementById('pg-receipts');
  if (!el) return;
  _rvList = []; _rvFiltered = []; _rvPage = 0; _rvDetail = null; _rvSaleMap = {};

  const { from: _dfl_fr, to: _dfl_to } = _ldgFiscalYear();
  if (!_rvFilter.fr) _rvFilter.fr = _dfl_fr;
  if (!_rvFilter.to) _rvFilter.to = _dfl_to;

  const modeOpts = [
    { value:'All', label:'All modes' }, { value:'cash', label:'Cash' },
    { value:'bank_transfer', label:'Bank Transfer' }, { value:'cheque', label:'Cheque / PDC' },
    { value:'adjustment', label:'Adjustment' }
  ].map(o => '<option value="' + o.value + '"' + (_rvFilter.mode === o.value ? ' selected' : '') + '>' + o.label + '</option>').join('');
  const statusOpts = [
    { value:'All', label:'All' }, { value:'active', label:'Active' }, { value:'cancelled', label:'Cancelled' }
  ].map(o => '<option value="' + o.value + '"' + (_rvFilter.status === o.value ? ' selected' : '') + '>' + o.label + '</option>').join('');

  el.innerHTML =
    NX.pageHeader('Receipt vouchers',
      NX.button('New CRV / BRV', { variant:'primary', size:'sm', icon:'plus', onclick:'_rvNewVoucher()' })) +
    '<div id="rv-entry-view" style="display:none"></div>' +
    '<div id="rv-list-view">' +
      NX.card(
        '<div style="display:flex;gap:var(--fk-sp-2);flex-wrap:wrap;align-items:flex-end">' +
          '<div class="nx-field" style="margin:0;min-width:170px"><label class="nx-label">Voucher / Receipt #</label>' +
            '<input class="nx-input" type="text" placeholder="PRV-2526-… or R# 1907" oninput="_rvFilter.voucherNo=this.value;clearTimeout(_rvSearchTimer);_rvSearchTimer=setTimeout(_rvApplyFilter,220)"></div>' +
          '<div class="nx-field" style="margin:0;min-width:150px"><label class="nx-label">Client name</label>' +
            '<input class="nx-input" type="text" placeholder="Search client…" oninput="_rvFilter.client=this.value;clearTimeout(_rvSearchTimer);_rvSearchTimer=setTimeout(_rvApplyFilter,220)"></div>' +
          '<div class="nx-field" style="margin:0"><label class="nx-label">From</label>' +
            '<input class="nx-input" type="date" value="' + _rvFilter.fr + '" onchange="_rvFilter.fr=this.value;_rvLoadAndRender()"></div>' +
          '<div class="nx-field" style="margin:0"><label class="nx-label">To</label>' +
            '<input class="nx-input" type="date" value="' + _rvFilter.to + '" onchange="_rvFilter.to=this.value;_rvLoadAndRender()"></div>' +
          '<div class="nx-field" style="margin:0"><label class="nx-label">Mode</label>' +
            '<select class="nx-select" onchange="_rvFilter.mode=this.value;_rvLoadAndRender()">' + modeOpts + '</select></div>' +
          '<div class="nx-field" style="margin:0"><label class="nx-label">Status</label>' +
            '<select class="nx-select" onchange="_rvFilter.status=this.value;_rvApplyFilter()">' + statusOpts + '</select></div>' +
          '<div class="nx-field" style="margin:0;min-width:110px"><label class="nx-label">Amount</label>' +
            '<input class="nx-input num" type="text" placeholder="50,000" oninput="_rvFilter.amount=this.value;clearTimeout(_rvSearchTimer);_rvSearchTimer=setTimeout(_rvApplyFilter,220)"></div>' +
          '<div style="display:flex;align-items:flex-end">' +
            NX.button('Reset', { variant:'ghost', size:'sm', onclick:"_rvFilter={voucherNo:'',client:'',fr:'',to:'',mode:'All',amount:'',status:'All'};rReceipts()" }) + '</div>' +
        '</div>', { compact:true }) +
      '<div id="rv-tbl" style="margin-top:var(--fk-sp-3)"></div>' +
    '</div>' +
    '<div id="rv-detail-view" style="display:none"></div>';

  _rvLoadAndRender();
}

async function _rvLoadAndRender() {
  const tbl = document.getElementById('rv-tbl');
  if (!tbl) return;
  tbl.innerHTML = NX.card(NX.empty({ icon:'info', message:'Loading…' }));

  try {
    const filters = { date_from: _rvFilter.fr || null, date_to: _rvFilter.to || null, limit: 1000 };
    if (_rvFilter.mode !== 'All') filters.payment_method = _rvFilter.mode;
    const { data, error } = await supabase.rpc('list_payments_filtered', { p_company_id: S.cid, p_filters: filters });
    if (error) throw error;
    _rvList = data || [];

    // Batch-resolve sale → unit_id
    const sids = [...new Set(_rvList.map(r => r.sale_id).filter(Boolean))];
    _rvSaleMap = {};
    if (sids.length) {
      const { data: sd = [] } = await supabase.rpc('get_sales_unit_map', { p_company_id: S.cid, p_sale_ids: sids });
      (sd || []).forEach(s => { _rvSaleMap[s.id] = s.unit_id; });
    }

    _rvPage = 0;
    _rvApplyFilter();
  } catch(e) {
    if (tbl) tbl.innerHTML = NX.card(NX.empty({ icon:'alert-triangle', message:'Could not load receipts — ' + (e.message || 'error') }));
  }
}

function _rvApplyFilter() {
  const vn = (_rvFilter.voucherNo || '').toLowerCase().trim();
  const cl = (_rvFilter.client    || '').toLowerCase().trim();
  const am = (_rvFilter.amount    || '').trim();
  const st =  _rvFilter.status;

  _rvFiltered = _rvList.filter(r => {
    // match system voucher code OR the physical receipt/book number (R#) stored in reference_no
    if (vn && !((r.voucher_code || '') + ' ' + (r.payment_code || '') + ' ' + (r.reference_no || '')).toLowerCase().includes(vn)) return false;
    if (cl) {
      const cn = (gclient(r.client_id)?.fullName || gclient(r.client_id)?.name || '').toLowerCase();
      if (!cn.includes(cl)) return false;
    }
    if (am && !fM(r.amount).includes(am) && !String(r.amount).includes(am)) return false;
    if (st === 'active'    && r.status === 'cancelled') return false;
    if (st === 'cancelled' && r.status !== 'cancelled') return false;
    return true;
  });

  _rvPage = 0;
  _rvRender();
}

function _rvRender() {
  const tbl = document.getElementById('rv-tbl');
  if (!tbl) return;

  const total = _rvFiltered.length;
  const pages = Math.ceil(total / _RV_PG) || 1;
  const start = _rvPage * _RV_PG;
  const items = _rvFiltered.slice(start, start + _RV_PG);

  if (!total) {
    tbl.innerHTML = NX.card(NX.empty({
      icon:'inbox',
      message: _rvList.length === 0 ? 'No receipt vouchers recorded yet.' : 'No results match your filters.'
    }));
    return;
  }

  const rows = items.map(r => {
    const cancelled = r.status === 'cancelled';
    const code = r.voucher_code || r.payment_code;
    const client = gclient(r.client_id);
    const cName  = client?.fullName || client?.name || '—';
    const uid    = _rvSaleMap[r.sale_id];
    const unit   = uid ? gunit(uid) : null;
    const proj   = unit?.projectId ? gproject(unit.projectId) : null;
    const unitLbl = unit ? `${proj?.name||''} · ${unit.unitNo}` : (proj?.name || '—');
    const mode   = _RV_MODE_LBL[r.payment_method] || r.payment_method || '—';
    const strike = cancelled ? 'text-decoration:line-through;color:var(--fk-text-muted)' : '';
    return '<tr style="cursor:pointer' + (cancelled ? ';opacity:.6' : '') + '" onclick="_rvShowDetail(\'' + r.id + '\')">' +
      '<td><span class="num" style="' + (cancelled ? strike : 'color:var(--fk-primary)') + '">' + NX.esc(code) + '</span></td>' +
      '<td><span class="num">' + NX.esc(r.reference_no || '—') + '</span></td>' +
      '<td>' + fD(r.payment_date) + '</td>' +
      '<td>' + NX.esc(cName) + '</td>' +
      '<td><span style="color:var(--fk-text-muted)">' + NX.esc(unitLbl) + '</span></td>' +
      '<td class="num"><span style="' + (cancelled ? strike : 'color:var(--fk-success)') + '">PKR ' + fM(r.amount) + '</span></td>' +
      '<td>' + NX.esc(mode) + '</td>' +
      '<td>' + NX.badge(cancelled ? 'Cancelled' : 'Active', cancelled ? 'danger' : 'success', { dot: !cancelled }) + '</td>' +
    '</tr>';
  }).join('');

  const pager =
    '<div style="display:flex;align-items:center;gap:6px;padding-top:var(--fk-sp-3);border-top:1px solid var(--fk-border);margin-top:var(--fk-sp-2)">' +
      NX.button('First', { variant:'secondary', size:'sm', disabled:_rvPage===0, onclick:"_rvGoPage('first')" }) +
      NX.button('Prev',  { variant:'secondary', size:'sm', disabled:_rvPage===0, onclick:'_rvGoPage(-1)' }) +
      '<span class="nx-kpi-label" style="flex:1;text-align:center">Page ' + (_rvPage+1) + ' of ' + pages + ' · ' + total + ' voucher' + (total!==1?'s':'') + '</span>' +
      NX.button('Next',  { variant:'secondary', size:'sm', disabled:_rvPage>=pages-1, onclick:'_rvGoPage(1)' }) +
      NX.button('Last',  { variant:'secondary', size:'sm', disabled:_rvPage>=pages-1, onclick:"_rvGoPage('last')" }) +
    '</div>';

  tbl.innerHTML = NX.card(
    '<table class="nx-table nx-table--flush"><thead><tr>' +
      '<th>Receipt #</th><th>Book #</th><th>Date</th><th>Client</th><th>Project / Unit</th><th class="num">Amount</th><th>Mode</th><th>Status</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' + pager, { flush:true });
}

function _rvGoPage(dir) {
  const pages = Math.ceil(_rvFiltered.length / _RV_PG) || 1;
  if      (dir === 'first') _rvPage = 0;
  else if (dir === 'last')  _rvPage = pages - 1;
  else _rvPage = Math.max(0, Math.min(pages - 1, _rvPage + dir));
  _rvRender();
  document.getElementById('rv-tbl')?.scrollIntoView({ behavior:'smooth', block:'start' });
}

function _rvShowDetail(paymentId) {
  const r = _rvFiltered.find(x => x.id === paymentId) || _rvList.find(x => x.id === paymentId);
  if (!r) return;
  _rvDetail = r;

  document.getElementById('rv-list-view').style.display   = 'none';
  const _ev = document.getElementById('rv-entry-view'); if (_ev) _ev.style.display = 'none';
  document.getElementById('rv-detail-view').style.display = 'block';

  const cancelled = r.status === 'cancelled';
  const code      = r.voucher_code || r.payment_code;
  const client    = gclient(r.client_id);
  const cName     = client?.fullName || client?.name || '—';
  const cPhone    = client?.phone    || client?.phonePrimary || '';
  const uid       = _rvSaleMap[r.sale_id];
  const unit      = uid ? gunit(uid) : null;
  const proj      = unit?.projectId ? gproject(unit.projectId) : null;
  const mode      = _RV_MODE_LBL[r.payment_method] || r.payment_method || '—';
  const amtStyle  = cancelled ? 'color:var(--fk-text-muted);text-decoration:line-through' : 'color:var(--fk-success)';

  const detailItem = (label, value, valStyle) =>
    '<div><div class="nx-kpi-label">' + label + '</div><div style="font-size:var(--fk-fs-body);color:var(--fk-text)' + (valStyle ? ';' + valStyle : '') + '">' + value + '</div></div>';

  // position within the current (filtered) list → flip through receipts one-by-one
  const navList = _rvFiltered.length ? _rvFiltered : _rvList;
  const pos = navList.findIndex(x => x.id === r.id);
  const total = navList.length;
  const actions =
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:var(--fk-sp-3);flex-wrap:wrap">' +
      NX.button('Back to list', { variant:'ghost', size:'sm', icon:'arrow-left', onclick:'_rvBackToList()' }) +
      '<span style="width:1px;height:20px;background:var(--fk-border);margin:0 4px"></span>' +
      NX.button('First', { variant:'secondary', size:'sm', disabled: pos<=0, onclick:"_rvNavTo('first')" }) +
      NX.button('Prev',  { variant:'secondary', size:'sm', disabled: pos<=0, onclick:"_rvNavTo('prev')" }) +
      '<span class="nx-kpi-label" style="white-space:nowrap;min-width:64px;text-align:center">' + (total ? (pos+1) + ' of ' + total : '—') + '</span>' +
      NX.button('Next', { variant:'secondary', size:'sm', disabled: pos<0 || pos>=total-1, onclick:"_rvNavTo('next')" }) +
      NX.button('Last', { variant:'secondary', size:'sm', disabled: pos<0 || pos>=total-1, onclick:"_rvNavTo('last')" }) +
      '<span style="flex:1"></span>' +
      (!cancelled ? NX.button('Cancel voucher', { variant:'danger', size:'sm', onclick:"_rvCancelFromDetail('" + r.id + "','" + esc(code) + "'," + r.amount + ")" }) : '') +
      NX.button('Print Receipt', { variant:'primary', size:'sm', icon:'printer', onclick:"openReceiptReport('" + r.id + "')" }) +
    '</div>';

  const receipt =
    '<div id="rv-print-area" class="nx-card nx-card--flush" style="max-width:640px;margin:0 auto">' +
      // Header
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:var(--fk-sp-4);border-bottom:1px solid var(--fk-border)">' +
        '<div>' +
          '<div class="nx-kpi-label">Receipt voucher</div>' +
          '<div class="num" style="font-size:var(--fk-fs-page);color:var(--fk-text);margin-top:2px">' + NX.esc(code) + '</div>' +
          (cancelled ? '<div style="margin-top:6px">' + NX.badge('Cancelled', 'danger') + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right">' +
          '<div class="nx-kpi-label">Date</div>' +
          '<div style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + fD(r.payment_date) + '</div>' +
          '<div class="nx-kpi-label" style="margin-top:10px">Received</div>' +
          '<div class="num" style="font-size:var(--fk-fs-kpi);' + amtStyle + '">PKR ' + fM(r.amount) + '</div>' +
        '</div>' +
      '</div>' +
      // Client + property
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--fk-border)">' +
        '<div style="padding:var(--fk-sp-3) var(--fk-sp-4);border-right:1px solid var(--fk-border)">' +
          '<div class="nx-kpi-label">Received from</div>' +
          '<div style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + NX.esc(cName) + '</div>' +
          (cPhone ? '<div class="nx-kpi-label" style="text-transform:none;margin-top:2px">' + NX.esc(cPhone) + '</div>' : '') +
        '</div>' +
        '<div style="padding:var(--fk-sp-3) var(--fk-sp-4)">' +
          '<div class="nx-kpi-label">Property</div>' +
          '<div style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + NX.esc(proj?.name || '—') + '</div>' +
          (unit ? '<div class="nx-kpi-label" style="text-transform:none;margin-top:2px">Unit ' + NX.esc(unit.unitNo) + '</div>' : '') +
        '</div>' +
      '</div>' +
      // Payment details
      '<div style="padding:var(--fk-sp-3) var(--fk-sp-4);border-bottom:1px solid var(--fk-border)">' +
        '<div class="nx-kpi-label" style="margin-bottom:var(--fk-sp-2)">Payment details</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:var(--fk-sp-4)">' +
          detailItem('Mode', NX.esc(mode)) +
          (r.payment_category && r.payment_category !== 'regular' ? detailItem('Category', NX.esc(r.payment_category), 'color:var(--fk-warning);text-transform:capitalize') : '') +
          (r.reference_no ? detailItem('Reference no', '<span class="num">' + NX.esc(r.reference_no) + '</span>') : '') +
          (r.bank_name ? detailItem('Bank', NX.esc(r.bank_name)) : '') +
        '</div>' +
        (r.notes ? '<div style="margin-top:var(--fk-sp-2);padding:8px 12px;background:var(--fk-bg-subtle);border-radius:var(--fk-radius-control);font-size:var(--fk-fs-label);color:var(--fk-text-muted)">' + NX.esc(r.notes) + '</div>' : '') +
      '</div>' +
      // Footer
      '<div style="padding:var(--fk-sp-2) var(--fk-sp-4);display:flex;align-items:center;justify-content:space-between;background:var(--fk-bg-subtle)">' +
        '<div class="nx-kpi-label" style="text-transform:none">Ref: <span class="num">' + NX.esc(r.payment_code) + '</span></div>' +
        '<div class="nx-kpi-label" style="text-transform:none">' + new Date(r.created_at).toLocaleString() + '</div>' +
      '</div>' +
    '</div>';

  document.getElementById('rv-detail-view').innerHTML = actions + receipt;
}

function _rvBackToList() {
  _rvDetail = null; _rvEntry = null;
  document.getElementById('rv-list-view').style.display   = 'block';
  document.getElementById('rv-detail-view').style.display = 'none';
  const _ev = document.getElementById('rv-entry-view'); if (_ev) _ev.style.display = 'none';
}

// ══ CRV / BRV — voucher-first entry (no need to drill into a client first) ══
const _RVE_MODES = [
  { value:'cash',          label:'Cash Receipt (CRV)' },
  { value:'bank_transfer', label:'Bank Receipt (BRV)' },
  { value:'cheque',        label:'Cheque / PDC' }
];
function _rvToday(){ return (typeof td === 'function') ? td() : new Date().toISOString().slice(0,10); }

function _rvNewVoucher() {
  _rvEntry = { unitId:null, summary:null };
  document.getElementById('rv-list-view').style.display   = 'none';
  document.getElementById('rv-detail-view').style.display = 'none';
  const v = document.getElementById('rv-entry-view');
  v.style.display = 'block';
  v.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:var(--fk-sp-3)">' +
      NX.button('Back to list', { variant:'ghost', size:'sm', icon:'arrow-left', onclick:'_rvBackToList()' }) +
      '<span style="font-weight:600;color:var(--fk-text)">New Receipt Voucher</span>' +
    '</div>' +
    NX.card(
      '<div class="nx-field" style="margin-bottom:0"><label class="nx-label">1 — Find the account (client / unit / project / booking #)</label>' +
        '<input class="nx-input" id="rve-q" autocomplete="off" placeholder="Search client, unit no or project…" ' +
        'oninput="clearTimeout(_rvEntrySearchTimer);_rvEntrySearchTimer=setTimeout(()=>_rvEntryRenderAccounts(this.value),180)"></div>' +
      '<div id="rve-results" style="margin-top:var(--fk-sp-2);max-height:240px;overflow:auto"></div>',
      { compact:true }) +
    '<div id="rve-form" style="display:none;margin-top:var(--fk-sp-3)"></div>';
  _rvEntryRenderAccounts('');
  document.getElementById('rve-q')?.focus();
}

function _rvEntryRenderAccounts(q) {
  const wrap = document.getElementById('rve-results'); if (!wrap) return;
  const query = (q || '').trim().toLowerCase();
  const projName = id => { const p = (typeof gproject==='function') ? gproject(id) : null; return p ? (p.name||p.projectName||'') : ''; };
  const rows = (typeof gunits === 'function' ? gunits() : (window._unitsCache || []))
    .filter(u => u.isAvailable === false)
    .filter(u => !query
      || (u.customerName||'').toLowerCase().includes(query)
      || (u.unitNo||'').toLowerCase().includes(query)
      || projName(u.projectId).toLowerCase().includes(query))
    .sort((a,b) => Number(b.pendingAmount||0) - Number(a.pendingAmount||0))
    .slice(0, 50)
    .map(u => {
      const pend = Number(u.pendingAmount||0);
      const sel = _rvEntry && _rvEntry.unitId === u.id;
      return '<tr style="cursor:pointer'+(sel?';background:var(--fk-primary-surface,#eef2ff)':'')+'" onclick="_rvEntryPick(\''+u.id+'\')">' +
        '<td>'+NX.esc(u.customerName||'—')+'</td>' +
        '<td>'+NX.esc(u.unitNo||'—')+(projName(u.projectId)?' · <span style="color:var(--fk-text-muted)">'+NX.esc(projName(u.projectId))+'</span>':'')+'</td>' +
        '<td class="num" style="text-align:right">'+(pend<=0?NX.badge('Paid','success'):('PKR '+fM(pend)))+'</td></tr>';
    }).join('');
  wrap.innerHTML = rows
    ? '<table class="nx-table nx-table--flush"><thead><tr><th>Client</th><th>Unit / Project</th><th class="num">Outstanding</th></tr></thead><tbody>'+rows+'</tbody></table>'
    : '<div style="padding:14px;text-align:center;color:var(--fk-text-muted);font-size:13px">No matching sold units.</div>';
}

async function _rvEntryPick(unitId) {
  _rvEntry.unitId = unitId;
  _rvEntryRenderAccounts(document.getElementById('rve-q')?.value || '');
  const form = document.getElementById('rve-form');
  form.style.display = 'block';
  form.innerHTML = NX.card(NX.empty({ icon:'info', message:'Loading sale…' }));
  try {
    const { data, error } = await supabase.rpc('get_unit_payment_summary', { p_unit_id: unitId, p_company_id: S.cid });
    if (error) throw error;
    if (!data || !data.success) throw new Error(data?.error || 'No sale found for this unit');
    _rvEntry.summary = data;
    form.innerHTML = _rvEntryFormHtml(data);
    _rvEntryModeChange();
    document.getElementById('rve-amount')?.focus();
    form.scrollIntoView({ behavior:'smooth', block:'start' });
  } catch (e) {
    form.innerHTML = NX.card(NX.empty({ icon:'alert-triangle', message:'Failed to load sale — ' + (e.message || 'error') }));
  }
}

function _rvEntryFormHtml(data) {
  const s    = data.sale || {};
  const inst = Array.isArray(data.installments) ? data.installments : [];
  const net  = Number(s.net_amount || 0);
  const paid = inst.reduce((a,r)=>a+Number(r.amount_paid||0), 0);
  const out  = inst.reduce((a,r)=>a+Number(r.outstanding||0), 0);
  const today = _rvToday();
  const ctx =
    '<div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-bottom:var(--fk-sp-3);padding-bottom:var(--fk-sp-3);border-bottom:1px solid var(--fk-border)">' +
      '<div><div style="font-size:14px;font-weight:600;color:var(--fk-text)">'+NX.esc(s.client_name||'—')+'</div>' +
        '<div style="font-size:11px;color:var(--fk-text-muted);margin-top:2px">Unit '+NX.esc(s.unit_no||'—')+(s.project_name?' · '+NX.esc(s.project_name):'')+(s.sale_number?' · '+NX.esc(s.sale_number):'')+'</div></div>' +
      '<div style="text-align:right"><div class="nx-kpi-label">Balance</div><div class="num" style="font-size:18px;color:'+(out>0?'var(--fk-danger)':'var(--fk-success)')+'">PKR '+fM(out)+'</div></div>' +
    '</div>';
  const form =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">' +
      NX.field({ label:'Voucher type', name:'rve-mode', el:'select', value:'cash', options:_RVE_MODES, attrs:'onchange="_rvEntryModeChange()"' }) +
      NX.field({ label:'Amount (PKR)', name:'rve-amount', type:'number', required:true, attrs:'min="1" step="0.01" class="nx-input num"' }) +
      NX.field({ label:'Date', name:'rve-date', type:'date', value:today, required:true }) +
      NX.field({ label:'Reference / Txn no', name:'rve-ref', placeholder:'Bank / transaction reference (optional)' }) +
    '</div>' +
    '<div id="rve-bankbox" style="display:none;margin-top:var(--fk-sp-3)">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--fk-sp-3)">' +
        NX.field({ label:'Bank', name:'rve-bank' }) +
        NX.field({ label:'Cheque no', name:'rve-chqno' }) +
        NX.field({ label:'Cheque date', name:'rve-chqdate', type:'date', value:today, attrs:'onchange="_rvEntryModeChange()"' }) +
      '</div>' +
      '<div id="rve-pdc-note" style="margin-top:var(--fk-sp-2)"></div>' +
    '</div>' +
    '<div style="margin-top:var(--fk-sp-3)">' + NX.field({ label:'Notes', name:'rve-notes', el:'textarea', placeholder:'Optional' }) + '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:var(--fk-sp-2);margin-top:var(--fk-sp-4)">' +
      NX.button('Save voucher', { variant:'primary', icon:'check', attrs:'id="rve-save"', onclick:'_rvEntrySave()' }) +
    '</div>';
  return NX.card(ctx + form);
}

// Bank/cheque fields visibility + PDC detection
function _rvEntryModeChange() {
  const mode = document.getElementById('rve-mode')?.value;
  const box  = document.getElementById('rve-bankbox');
  const chqOnly = (mode === 'cheque');
  const showBank = (mode === 'bank_transfer' || mode === 'cheque');
  if (box) box.style.display = showBank ? 'block' : 'none';
  // hide cheque-only fields when plain bank transfer
  ['rve-chqno','rve-chqdate'].forEach(id => { const f = document.getElementById(id); if (f) f.closest('.nx-field').style.display = chqOnly ? '' : 'none'; });
  const today = _rvToday();
  const chqDate = document.getElementById('rve-chqdate')?.value;
  const isPDC = chqOnly && chqDate && chqDate > today;
  const note = document.getElementById('rve-pdc-note');
  if (note) note.innerHTML = isPDC
    ? NX.banner('Cheque date is in the future — this is a post-dated cheque. It goes to the PDC register, not booked as a payment yet.', 'warn')
    : '';
  const save = document.getElementById('rve-save');
  if (save) { const sp = save.querySelector('span'); if (sp) sp.textContent = isPDC ? 'Add to PDC register' : 'Save voucher'; }
}

async function _rvEntrySave() {
  const s = _rvEntry?.summary?.sale;
  if (!s?.sale_id) { toast('No account selected', 'warn'); return; }
  const mode   = document.getElementById('rve-mode')?.value;
  const amount = parseFloat(document.getElementById('rve-amount')?.value || '0');
  const date   = document.getElementById('rve-date')?.value;
  const ref    = (document.getElementById('rve-ref')?.value || '').trim();
  const bank   = (document.getElementById('rve-bank')?.value || '').trim();
  const chqNo  = (document.getElementById('rve-chqno')?.value || '').trim();
  const chqDt  = document.getElementById('rve-chqdate')?.value;
  const notes  = (document.getElementById('rve-notes')?.value || '').trim();
  const today  = _rvToday();
  if (!(amount > 0)) { toast('Enter a positive amount', 'warn'); return; }
  if (!date)         { toast('Enter the date', 'warn'); return; }
  if (mode === 'cheque' && (!chqNo || !chqDt)) { toast('Cheque needs a number and a date', 'warn'); return; }
  const isPDC = mode === 'cheque' && chqDt > today;
  const btn = document.getElementById('rve-save');
  if (btn) { btn.disabled = true; const sp = btn.querySelector('span'); if (sp) sp.textContent = 'Saving…'; }
  try {
    if (isPDC) {
      const { data, error } = await supabase.rpc('create_pdc_cheque', {
        p_company_id: S.cid,
        p_data: { sale_id:s.sale_id, client_id:s.client_id||null, cheque_no:chqNo, bank_name:bank||null,
          amount, cheque_date:chqDt, received_date:today, status:'pending', notes:notes||null,
          created_by: S.userId || S.name || 'system' }
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to add PDC');
      toast('Added to PDC register', 'ok');
      _rvBackToList(); await _rvLoadAndRender();
      return;
    }
    const { data, error } = await supabase.rpc('record_payment_simple', {
      p_company_id: S.cid, p_sale_id: s.sale_id, p_amount: amount, p_payment_date: date,
      p_payment_method: mode, p_reference_no: ref || (mode==='cheque' ? chqNo : null) || null,
      p_bank_name: bank || null, p_notes: notes || null, p_created_by: S.userId || null,
      p_cheque_date: mode === 'cheque' ? chqDt : null, p_bank_id: null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || data?.message || 'Payment failed');
    toast('Receipt voucher saved', 'ok');
    const newId = data.payment_id || null;
    await _rvLoadAndRender();
    if (newId) _rvShowDetail(newId); else _rvBackToList();
  } catch (e) {
    if (btn) { btn.disabled = false; const sp = btn.querySelector('span'); if (sp) sp.textContent = 'Save voucher'; }
    toast('Could not save — ' + (e.message || 'error'), 'err');
  }
}

// Flip through receipts one-by-one (within the current filtered list)
function _rvNavTo(dir) {
  if (!_rvDetail) return;
  const list = _rvFiltered.length ? _rvFiltered : _rvList;
  let i = list.findIndex(x => x.id === _rvDetail.id);
  if (i < 0) return;
  if      (dir === 'first') i = 0;
  else if (dir === 'last')  i = list.length - 1;
  else if (dir === 'prev')  i = Math.max(0, i - 1);
  else if (dir === 'next')  i = Math.min(list.length - 1, i + 1);
  _rvShowDetail(list[i].id);
  document.getElementById('rv-detail-view')?.scrollIntoView({ block: 'start' });
}

async function _rvCancelFromDetail(paymentId, code, amount) {
  // _voidReasonPrompt is defined in payments.js (global scope). A void is approval-gated
  // server-side; non-admins receive a pending_approval response.
  const _run = (reason) => (async () => {
    try {
      const { data, error } = await supabase.rpc('cancel_payment', {
        p_payment_id:   paymentId,
        p_company_id:   S.cid,
        p_cancelled_by: S.userId,
        p_reason:       reason
      });
      if (error) throw error;
      if (data?.status === 'pending_approval') {
        toast('Void request submitted for Admin approval', 'ok');
        if (typeof refreshApprovalsBadge === 'function') refreshApprovalsBadge();
        return;
      }
      if (!data?.success) throw new Error(data?.error || 'Cancel failed');
      toast(`${code} cancelled`, 'ok');
      await _rvLoadAndRender();
      _rvBackToList();
    } catch(e) {
      notify.error('Cancel Failed', { detail: e.message });
    }
  })();
  if (typeof _voidReasonPrompt === 'function') {
    _voidReasonPrompt(`${code} — PKR ${fM(amount)} will be reversed`, _run);
  } else {
    _run(null);
  }
}

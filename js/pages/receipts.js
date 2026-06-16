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
    NX.pageHeader('Receipt vouchers') +
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
      '<th>Voucher no</th><th>Receipt #</th><th>Date</th><th>Client</th><th>Project / Unit</th><th class="num">Amount</th><th>Mode</th><th>Status</th>' +
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

  const actions =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:var(--fk-sp-3)">' +
      NX.button('Back to list', { variant:'ghost', size:'sm', onclick:'_rvBackToList()' }) +
      '<span style="flex:1"></span>' +
      (!cancelled ? NX.button('Cancel voucher', { variant:'danger', size:'sm', onclick:"_rvCancelFromDetail('" + r.id + "','" + esc(code) + "'," + r.amount + ")" }) : '') +
      NX.button('A4 Receipt', { variant:'secondary', size:'sm', onclick:"openReceiptReport('" + r.id + "')" }) +
      NX.button('Print', { variant:'ghost', size:'sm', onclick:'window.print()' }) +
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
  _rvDetail = null;
  document.getElementById('rv-list-view').style.display   = 'block';
  document.getElementById('rv-detail-view').style.display = 'none';
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

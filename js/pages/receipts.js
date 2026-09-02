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
let _rvView = 'voucher';      // 'voucher' (default single-window) | 'entry' | 'list'
let _rvAccTimer = null;
let _rvPendingReceive = null; // a unit id passed from a "Receive" button → auto-open its entry

const _RV_MODE_LBL = { cash:'Cash', bank_transfer:'Bank Transfer', bank:'Bank', cheque:'Cheque / PDC', adjustment:'Adjustment', online:'Online', other:'Other' };

function rReceipts(receiveUnitId) {
  const el = document.getElementById('pg-receipts');
  if (!el) return;
  _rvList = []; _rvFiltered = []; _rvPage = 0; _rvDetail = null; _rvSaleMap = {};
  _rvPendingReceive = (receiveUnitId && typeof receiveUnitId === 'string') ? receiveUnitId : null;

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

  _rvView = 'voucher';
  el.innerHTML =
    '<style>' +
      '.rv-acc-drop{position:absolute;left:0;right:0;top:100%;z-index:30;margin-top:4px;background:var(--fk-bg-card);border:1px solid var(--fk-border);border-radius:10px;box-shadow:0 10px 30px rgba(15,23,42,.12);max-height:320px;overflow:auto;display:none}' +
      '.rv-acc-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--fk-border)}' +
      '.rv-acc-item:last-child{border-bottom:0}' +
      '.rv-acc-item:hover{background:var(--fk-bg-subtle)}' +
    '</style>' +
    NX.pageHeader('Receipt Vouchers',
      NX.button('Add Voucher', { variant:'primary', size:'sm', icon:'plus', onclick:'_rvNewVoucher()' }) +
      ' ' + NX.button('Browse all', { variant:'ghost', size:'sm', icon:'list', onclick:'_rvShowListView()' }) +
      ((S?.role==='admin' || S?.role==='owner') ? ' ' + NX.button('Shift amount', { variant:'secondary', size:'sm', icon:'shuffle', onclick:'_rvOpenShift()' }) : '')) +
    '<div id="rv-shift-host"></div>' +
    '<div id="rv-detail-view" style="margin-top:var(--fk-sp-3)"></div>' +
    '<div id="rv-entry-view" style="display:none;margin-top:var(--fk-sp-3)"></div>' +
    '<div id="rv-list-view" style="display:none;margin-top:var(--fk-sp-3)">' +
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
    '</div>';

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
    if (_rvPendingReceive) { const u = _rvPendingReceive; _rvPendingReceive = null; _rvNewVoucher(); _rvEntryAccPick(u); }
    else if (_rvView === 'voucher') _rvOpenLast();
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
    // match system voucher code OR the manual receipt-book number (its own column
    // now; older rows still carry it in reference_no, so search both)
    if (vn && !((r.voucher_code || '') + ' ' + (r.payment_code || '') + ' ' + (r.manual_number || '') + ' ' + (r.reference_no || '')).toLowerCase().includes(vn)) return false;
    if (cl) {
      const cn = (gclient(r.client_id)?.fullName || gclient(r.client_id)?.name || '').toLowerCase();
      if (!cn.includes(cl)) return false;
    }
    if (am && !fM(r.amount).includes(am) && !String(r.amount).includes(am)) return false;
    if (st === 'active'    && r.status === 'cancelled') return false;
    if (st === 'cancelled' && r.status !== 'cancelled') return false;
    return true;
  });

  // chronological order → index 0 = First (oldest), last = Last (newest entry)
  _rvFiltered.sort((a, b) =>
    String(a.payment_date||'').localeCompare(String(b.payment_date||'')) ||
    String(a.created_at||'').localeCompare(String(b.created_at||'')));

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
      // Book # = the manual receipt-book number. Older rows have it typed into
      // Reference (there was nowhere else to put it), so fall back to that.
      '<td><span class="num">' + NX.esc(r.manual_number || r.reference_no || '—') + '</span></td>' +
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

  _rvView = 'voucher';
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
      NX.button('All vouchers', { variant:'ghost', size:'sm', icon:'list', onclick:'_rvShowListView()' }) +
      '<span style="width:1px;height:20px;background:var(--fk-border);margin:0 4px"></span>' +
      NX.button('First', { variant:'secondary', size:'sm', disabled: pos<=0, onclick:"_rvNavTo('first')" }) +
      NX.button('Prev',  { variant:'secondary', size:'sm', disabled: pos<=0, onclick:"_rvNavTo('prev')" }) +
      '<span class="nx-kpi-label" style="white-space:nowrap;min-width:64px;text-align:center">' + (total ? (pos+1) + ' of ' + total : '—') + '</span>' +
      NX.button('Next', { variant:'secondary', size:'sm', disabled: pos<0 || pos>=total-1, onclick:"_rvNavTo('next')" }) +
      NX.button('Last', { variant:'secondary', size:'sm', disabled: pos<0 || pos>=total-1, onclick:"_rvNavTo('last')" }) +
      '<span style="flex:1"></span>' +
      NX.button('Add Voucher', { variant:'primary', size:'sm', icon:'plus', onclick:'_rvNewVoucher()' }) +
      ((!cancelled && (S?.role==='admin' || S?.role==='owner')) ? NX.button('Edit voucher', { variant:'secondary', size:'sm', icon:'pencil', onclick:"_rvEditFromDetail('" + r.id + "')" }) : '') +
      (!cancelled ? NX.button('Cancel voucher', { variant:'danger', size:'sm', onclick:"_rvCancelFromDetail('" + r.id + "','" + esc(code) + "'," + r.amount + ")" }) : '') +
      NX.button('Print Receipt', { variant:'secondary', size:'sm', icon:'printer', onclick:"openReceiptReport('" + r.id + "')" }) +
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
          (r.manual_number ? detailItem('Manual receipt no', '<span class="num">' + NX.esc(r.manual_number) + '</span>') : '') +
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

// Kept for ESC/back compatibility → returns to the default voucher window.
function _rvBackToList() { _rvEntry = null; _rvOpenLast(); }

const _RVE_MODES = [
  { value:'cash',          label:'Cash Receipt (CRV)' },
  { value:'bank_transfer', label:'Bank Receipt (BRV)' },
  { value:'cheque',        label:'Cheque / PDC' },
  { value:'adjustment',    label:'Adjustment (ARV)' }
];
function _rvToday(){ return (typeof td === 'function') ? td() : new Date().toISOString().slice(0,10); }

// ── default window: the LAST (most recent) voucher + First/Back/Next/Last ──
function _rvOpenLast() {
  _rvView = 'voucher';
  document.getElementById('rv-list-view').style.display  = 'none';
  document.getElementById('rv-entry-view').style.display = 'none';
  const dv = document.getElementById('rv-detail-view'); dv.style.display = 'block';
  if (_rvFiltered.length) _rvShowDetail(_rvFiltered[_rvFiltered.length - 1].id);  // last = newest
  else dv.innerHTML = NX.card(NX.empty({ icon:'inbox', message:'No vouchers yet. Click “Add Voucher” to record the first receiving.' }));
}

// ── secondary: full searchable list/table of all vouchers ──
function _rvShowListView() {
  _rvView = 'list';
  document.getElementById('rv-detail-view').style.display = 'none';
  document.getElementById('rv-entry-view').style.display  = 'none';
  document.getElementById('rv-list-view').style.display   = 'block';
  _rvRender();
}

// ── Add Voucher: ONE form — "Receive from" is a field, like date/amount ──
function _rvNewVoucher() {
  _rvEntry = { unitId:null, summary:null };
  _rvView = 'entry';
  document.getElementById('rv-detail-view').style.display = 'none';
  document.getElementById('rv-list-view').style.display   = 'none';
  const ev = document.getElementById('rv-entry-view'); ev.style.display = 'block';
  ev.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:var(--fk-sp-3)">' +
      NX.button('Cancel', { variant:'ghost', size:'sm', icon:'arrow-left', onclick:'_rvOpenLast()' }) +
      '<span style="font-weight:600;color:var(--fk-text)">New Receipt Voucher</span>' +
    '</div>' +
    _rvEntryFormHtml();
  _rvEntryModeChange();
  document.getElementById('rve-acc')?.focus();
}

// the voucher form — Receive-from combobox + type / amount / date / etc, all in one card
function _rvEntryFormHtml() {
  const today = _rvToday();
  return NX.card(
    // Receive from — a searchable account field (same row family as the others)
    '<div class="nx-field" style="position:relative;margin-bottom:var(--fk-sp-3)">' +
      '<label class="nx-label">Receive from — client / unit <span class="nx-req">*</span></label>' +
      '<input class="nx-input" id="rve-acc" autocomplete="off" placeholder="Type client name or unit no, then pick…" ' +
        'oninput="_rvEntry.unitId=null;_rvEntry.summary=null;clearTimeout(_rvEntrySearchTimer);_rvEntrySearchTimer=setTimeout(()=>_rvEntryAccSearch(this.value),140)" ' +
        'onfocus="_rvEntryAccSearch(this.value)">' +
      '<div id="rve-acc-results" class="rv-acc-drop"></div>' +
      '<div id="rve-acc-bal" style="font-size:11.5px;margin-top:5px;color:var(--fk-text-muted)"></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">' +
      NX.field({ label:'Voucher type', name:'rve-mode', el:'select', value:'cash', options:_RVE_MODES, attrs:'onchange="_rvEntryModeChange()"' }) +
      NX.field({ label:'Amount (PKR)', name:'rve-amount', type:'number', required:true, attrs:'min="1" step="0.01" class="nx-input num"' }) +
      NX.field({ label:'Date', name:'rve-date', type:'date', value:today, required:true }) +
      // The number on the slip torn from the physical receipt book the officer
      // hands the client in the field — the only reference the client holds.
      // It used to be typed into Reference; it now has its own column.
      NX.field({ label:'Manual receipt no', name:'rve-manual', placeholder:'Number on the receipt book slip' }) +
      NX.field({ label:'Reference / Txn no', name:'rve-ref', placeholder:'Bank / transaction reference (optional)' }) +
      // Bank stays on the form for every voucher type — cash gets banked too, and
      // hiding it meant the officer could not say where the money went.
      NX.field({ label:'Bank', name:'rve-bank', placeholder:'Bank the money went to (optional)' }) +
    '</div>' +
    // Cheque-only box: the number and the date that decide PDC vs booked payment.
    '<div id="rve-bankbox" style="display:none;margin-top:var(--fk-sp-3)">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">' +
        NX.field({ label:'Cheque no', name:'rve-chqno' }) +
        NX.field({ label:'Cheque date', name:'rve-chqdate', type:'date', value:today, attrs:'onchange="_rvEntryModeChange()"' }) +
      '</div>' +
      '<div id="rve-pdc-note" style="margin-top:var(--fk-sp-2)"></div>' +
    '</div>' +
    // Adjustment (ARV) — non-cash: money settled against services / stock / barter, no cash received
    '<div id="rve-adjbox" style="display:none;margin-top:var(--fk-sp-3)">' +
      NX.field({ label:'Adjustment against', name:'rve-adjagainst', placeholder:'e.g. against services, stock, barter — no cash received' }) +
      '<div style="margin-top:var(--fk-sp-2);padding:10px 13px;background:var(--fk-bg-subtle);border-radius:var(--fk-radius-control);font-size:12px;color:var(--fk-text-muted);line-height:1.5"><strong style="color:var(--fk-text)">Adjustment (ARV):</strong> no cash/bank received — booked to settle against services, stock, etc.</div>' +
    '</div>' +
    '<div style="margin-top:var(--fk-sp-3)">' + NX.field({ label:'Notes', name:'rve-notes', el:'textarea', placeholder:'Optional' }) + '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:var(--fk-sp-2);margin-top:var(--fk-sp-4)">' +
      NX.button('Save voucher', { variant:'primary', icon:'check', attrs:'id="rve-save"', onclick:'_rvEntrySave()' }) +
    '</div>');
}

// suggestions dropdown for the "Receive from" field
function _rvEntryAccSearch(q) {
  const wrap = document.getElementById('rve-acc-results'); if (!wrap) return;
  const query = (q || '').trim().toLowerCase();
  if (!query) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
  const projName = id => { const p = (typeof gproject==='function') ? gproject(id) : null; return p ? (p.name||p.projectName||'') : ''; };
  const rows = (typeof gunits === 'function' ? gunits() : (window._unitsCache || []))
    .filter(u => u.isAvailable === false)
    .filter(u => (u.customerName||'').toLowerCase().includes(query)
      || (u.unitNo||'').toLowerCase().includes(query)
      || projName(u.projectId).toLowerCase().includes(query))
    .sort((a,b) => Number(b.pendingAmount||0) - Number(a.pendingAmount||0))
    .slice(0, 8)
    .map(u => {
      const pend = Number(u.pendingAmount||0);
      return '<div class="rv-acc-item" onclick="_rvEntryAccPick(\''+u.id+'\')">' +
        '<div style="min-width:0"><div style="font-weight:600;color:var(--fk-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+NX.esc(u.customerName||'—')+'</div>' +
        '<div style="font-size:11px;color:var(--fk-text-muted)">Unit '+NX.esc(u.unitNo||'—')+(projName(u.projectId)?' · '+NX.esc(projName(u.projectId)):'')+'</div></div>' +
        '<div class="num" style="font-size:12px;white-space:nowrap;color:'+(pend>0?'var(--fk-danger)':'var(--fk-success)')+'">'+(pend>0?('PKR '+fM(pend)):'Paid')+'</div>' +
      '</div>';
    }).join('');
  wrap.innerHTML = rows || '<div class="rv-acc-item" style="justify-content:center;color:var(--fk-text-muted)">No matching sold units</div>';
  wrap.style.display = 'block';
}

// pick an account in the "Receive from" field → fill it + show balance
async function _rvEntryAccPick(unitId) {
  if (!document.getElementById('rve-acc')) _rvNewVoucher();   // ensure the form exists
  _rvEntry.unitId = unitId;
  const res = document.getElementById('rve-acc-results'); if (res) { res.innerHTML = ''; res.style.display = 'none'; }
  const u   = (typeof gunits === 'function' ? gunits() : (window._unitsCache || [])).find(x => x.id === unitId);
  const acc = document.getElementById('rve-acc');
  const bal = document.getElementById('rve-acc-bal');
  if (acc && u) acc.value = (u.customerName || '—') + ' — Unit ' + (u.unitNo || '—');
  if (bal) bal.textContent = 'Loading account…';
  try {
    const { data, error } = await supabase.rpc('get_unit_payment_summary', { p_unit_id: unitId, p_company_id: S.cid });
    if (error) throw error;
    if (!data || !data.success) throw new Error(data?.error || 'No sale found for this unit');
    _rvEntry.summary = data;
    const s = data.sale || {};
    const out = (data.installments || []).reduce((a,r) => a + Number(r.outstanding||0), 0) - Number(data.net_shift || 0);
    if (bal) bal.innerHTML = (s.sale_number ? NX.esc(s.sale_number) + ' · ' : '') +
      'Balance <b style="color:'+(out>0?'var(--fk-danger)':'var(--fk-success)')+'">PKR ' + fM(out) + '</b>';
    document.getElementById('rve-amount')?.focus();
  } catch (e) {
    _rvEntry.summary = null;
    if (bal) bal.innerHTML = '<span style="color:var(--fk-danger)">Could not load this account.</span>';
  }
}

// shortcut (unit-detail "Receive" button etc.): open the form with the account prefilled
function _rvReceiveFrom(unitId) { _rvNewVoucher(); _rvEntryAccPick(unitId); }

// Bank/cheque fields visibility + PDC detection
function _rvEntryModeChange() {
  const mode = document.getElementById('rve-mode')?.value;
  const box  = document.getElementById('rve-bankbox');
  const chqOnly = (mode === 'cheque');
  // Bank now lives in the main grid and is always shown; this box holds only the
  // cheque number and date, so it follows the cheque mode alone.
  if (box) box.style.display = chqOnly ? 'block' : 'none';
  const adjBox = document.getElementById('rve-adjbox');
  if (adjBox) adjBox.style.display = (mode === 'adjustment') ? 'block' : 'none';
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
  if (!s?.sale_id) { toast('Pick an account in “Receive from” first', 'warn'); document.getElementById('rve-acc')?.focus(); return; }
  const mode   = document.getElementById('rve-mode')?.value;
  const amount = parseFloat(document.getElementById('rve-amount')?.value || '0');
  const date   = document.getElementById('rve-date')?.value;
  const ref    = (document.getElementById('rve-ref')?.value || '').trim();
  const manual = (document.getElementById('rve-manual')?.value || '').trim();
  const bank   = (document.getElementById('rve-bank')?.value || '').trim();
  const chqNo  = (document.getElementById('rve-chqno')?.value || '').trim();
  const chqDt  = document.getElementById('rve-chqdate')?.value;
  const adjAgainst = (document.getElementById('rve-adjagainst')?.value || '').trim();
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
    const _isAdj = (mode === 'adjustment');
    const { data, error } = await supabase.rpc('record_payment_simple', {
      p_company_id: S.cid, p_sale_id: s.sale_id, p_amount: amount, p_payment_date: date,
      p_payment_method: mode,
      p_reference_no: (_isAdj ? (adjAgainst || ref) : (ref || (mode==='cheque' ? chqNo : null))) || null,
      p_bank_name: bank || null,
      p_notes: (_isAdj && adjAgainst ? ('Adjustment against: ' + adjAgainst + (notes ? (' — ' + notes) : '')) : (notes || null)),
      p_created_by: S.userId || null,
      p_cheque_date: mode === 'cheque' ? chqDt : null, p_bank_id: null,
      p_manual_number: manual || null
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
  // A void is destructive: a reason is REQUIRED (min 10 chars) and recorded on the
  // immutable audit trail. Non-admins receive a pending_approval response server-side.
  const reason = await requireReason({
    title:  'Void payment',
    detail: `${code} — PKR ${fM(amount)} will be reversed`,
    okLabel:'Void payment'
  });
  if (reason === null) return; // cancelled
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
    if (!data?.success) {
      if (data?.error === 'reason_required') { notify.error('Reason Required', { detail: data.message }); return; }
      throw new Error(data?.error || 'Cancel failed');
    }
    toast(`${code} cancelled`, 'ok');
    await _rvLoadAndRender();
    _rvBackToList();
  } catch(e) {
    notify.error('Cancel Failed', { detail: e.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EDIT VOUCHER (admin/owner) — correct a wrongly-posted receipt IN PLACE.
// Same voucher number is kept; edit_payment re-FIFOs the sale and audit-logs the
// old->new change with a mandatory reason. Non-admins never see the button.
// ════════════════════════════════════════════════════════════════════════════
function _rvEditFromDetail(paymentId) {
  if (!(S?.role === 'admin' || S?.role === 'owner')) { toast('Admins only', 'warn'); return; }
  const r = _rvFiltered.find(x => x.id === paymentId) || _rvList.find(x => x.id === paymentId);
  if (!r) return;
  if (r.status === 'cancelled') { toast('Cancelled voucher can’t be edited', 'warn'); return; }
  const host = document.getElementById('rv-shift-host'); if (!host) return;
  const code = r.voucher_code || r.payment_code;
  // keep the voucher's current mode selectable even if it isn't a standard entry mode
  const modeOpts = _RVE_MODES.slice();
  if (r.payment_method && !modeOpts.some(m => m.value === r.payment_method))
    modeOpts.unshift({ value:r.payment_method, label:(_RV_MODE_LBL[r.payment_method] || r.payment_method) });
  host.innerHTML = NX.modal({
    id:'rv-edit', title:'Edit voucher · ' + esc(code), size:'m', onClose:'_rvCloseEdit()',
    body:
      '<div style="font-size:12px;color:var(--fk-text-muted);margin-bottom:var(--fk-sp-3);line-height:1.5">' +
        'Corrects this receipt in place — the voucher number stays the same. The change is recorded on the audit trail and the unit’s balance is recomputed. No new cash is received.' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">' +
        NX.field({ label:'Amount (PKR)', name:'rved-amount', type:'number', value:(r.amount ?? ''), required:true, attrs:'min="1" step="0.01" class="nx-input num"' }) +
        NX.field({ label:'Date', name:'rved-date', type:'date', value:(r.payment_date || _rvToday()), required:true }) +
      '</div>' +
      '<div style="margin-top:var(--fk-sp-3)">' +
        NX.field({ label:'Mode', name:'rved-mode', el:'select', value:(r.payment_method || 'cash'), options:modeOpts }) +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3);margin-top:var(--fk-sp-3)">' +
        NX.field({ label:'Reference no', name:'rved-ref', value:(r.reference_no || '') }) +
        NX.field({ label:'Bank', name:'rved-bank', value:(r.bank_name || '') }) +
      '</div>' +
      '<div style="margin-top:var(--fk-sp-3)">' +
        NX.field({ label:'Notes', name:'rved-notes', value:(r.notes || '') }) +
      '</div>' +
      '<div style="margin-top:var(--fk-sp-3)">' +
        NX.field({ label:'Reason for edit', name:'rved-reason', required:true, placeholder:'e.g. Wrong amount posted — receipt was PKR 50,000 not 500,000' }) +
      '</div>' +
      '<div id="rved-err" style="font-size:12px;color:var(--fk-danger);min-height:16px;margin-top:var(--fk-sp-2)"></div>',
    footer:
      NX.button('Cancel', { variant:'ghost', onclick:'_rvCloseEdit()' }) +
      NX.button('Save changes', { variant:'primary', icon:'check', attrs:'id="rved-save" data-id="' + esc(r.id) + '"', onclick:'_rvEditSave()' })
  });
  setTimeout(() => document.getElementById('rved-amount')?.focus(), 40);
}
function _rvCloseEdit() { const h = document.getElementById('rv-shift-host'); if (h) h.innerHTML = ''; }

async function _rvEditSave() {
  const err = document.getElementById('rved-err'); if (err) err.textContent = '';
  const btn = document.getElementById('rved-save');
  const id  = btn?.getAttribute('data-id'); if (!id) return;
  const amount = parseFloat(document.getElementById('rved-amount')?.value || '0');
  const date   = document.getElementById('rved-date')?.value;
  const mode   = document.getElementById('rved-mode')?.value;
  const ref    = (document.getElementById('rved-ref')?.value || '').trim();
  const bank   = (document.getElementById('rved-bank')?.value || '').trim();
  const notes  = (document.getElementById('rved-notes')?.value || '').trim();
  const reason = (document.getElementById('rved-reason')?.value || '').trim();
  if (!(amount > 0))          { if (err) err.textContent = 'Enter a positive amount.'; return; }
  if (!date)                  { if (err) err.textContent = 'Enter the date.'; return; }
  if (reason.length < 10)     { if (err) err.textContent = 'Reason must be at least 10 characters.'; return; }
  if (btn) { btn.disabled = true; const sp = btn.querySelector('span'); if (sp) sp.textContent = 'Saving…'; }
  try {
    const { data, error } = await supabase.rpc('edit_payment', {
      p_payment_id: id, p_company_id: S.cid,
      p_data: { amount, payment_date: date, payment_method: mode,
        reference_no: ref || null, bank_name: bank || null, notes: notes || null },
      p_reason: reason, p_edited_by: S.userId || null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.message || data?.error || 'Edit failed');
    _rvCloseEdit();
    toast('Voucher updated', 'ok');
    await _rvLoadAndRender();
    _rvShowDetail(id);
  } catch (e) {
    if (btn) { btn.disabled = false; const sp = btn.querySelector('span'); if (sp) sp.textContent = 'Save changes'; }
    if (err) err.textContent = e.message || 'Could not save';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SHIFT AMOUNT BETWEEN UNITS (admin/owner) — DR source ledger, CR destination.
// Records a unit_amount_shifts row via shift_unit_amount RPC. No cash movement;
// reallocates already-received money from one unit's account to another's.
// ════════════════════════════════════════════════════════════════════════════
let _rvShift = { from:null, to:null };
let _rvShSearchTimer = null;

function _rvOpenShift() {
  if (!(S?.role === 'admin' || S?.role === 'owner')) { toast('Admins only', 'warn'); return; }
  _rvShift = { from:null, to:null };
  const host = document.getElementById('rv-shift-host'); if (!host) return;
  const today = _rvToday();
  const box = (side, label) =>
    '<div class="nx-field" style="position:relative;margin-bottom:var(--fk-sp-3)">' +
      '<label class="nx-label">' + label + ' <span class="nx-req">*</span></label>' +
      '<input class="nx-input" id="rvsh-' + side + '" autocomplete="off" placeholder="Search client name or unit no…" ' +
        'oninput="_rvShift.' + side + '=null;clearTimeout(_rvShSearchTimer);_rvShSearchTimer=setTimeout(()=>_rvShiftSearch(\'' + side + '\',this.value),140)" ' +
        'onfocus="_rvShiftSearch(\'' + side + '\',this.value)">' +
      '<div id="rvsh-' + side + '-results" class="rv-acc-drop"></div>' +
      '<div id="rvsh-' + side + '-bal" style="font-size:11.5px;margin-top:5px;color:var(--fk-text-muted)"></div>' +
    '</div>';
  host.innerHTML = NX.modal({
    id:'rv-shift', title:'Shift amount between units', size:'m', onClose:'_rvCloseShift()',
    body:
      '<div style="font-size:12px;color:var(--fk-text-muted);margin-bottom:var(--fk-sp-3);line-height:1.5">' +
        'Moves already-received money from one unit to another — the source is <b>debited</b> (balance goes up) and the destination <b>credited</b> (balance goes down). No cash is received.' +
      '</div>' +
      box('from', 'From unit (debit — money leaves here)') +
      box('to', 'To unit (credit — money goes here)') +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">' +
        NX.field({ label:'Amount (PKR)', name:'rvsh-amount', type:'number', required:true, attrs:'min="1" step="0.01" class="nx-input num"' }) +
        NX.field({ label:'Date', name:'rvsh-date', type:'date', value:today, required:true }) +
      '</div>' +
      '<div style="margin-top:var(--fk-sp-3)">' + NX.field({ label:'Narration', name:'rvsh-narr', placeholder:'Leave blank for auto: Amount shifted to <to> from <from>' }) + '</div>' +
      '<div id="rvsh-err" style="font-size:12px;color:var(--fk-danger);min-height:16px;margin-top:var(--fk-sp-2)"></div>',
    footer:
      NX.button('Cancel', { variant:'ghost', onclick:'_rvCloseShift()' }) +
      NX.button('Shift amount', { variant:'primary', icon:'shuffle', attrs:'id="rvsh-save"', onclick:'_rvShiftSave()' })
  });
  setTimeout(() => document.getElementById('rvsh-from')?.focus(), 40);
}
function _rvCloseShift() { const h = document.getElementById('rv-shift-host'); if (h) h.innerHTML = ''; _rvShift = { from:null, to:null }; }

function _rvShiftSearch(side, q) {
  const wrap = document.getElementById('rvsh-' + side + '-results'); if (!wrap) return;
  const query = (q || '').trim().toLowerCase();
  if (!query) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
  const rows = (typeof gunits === 'function' ? gunits() : (window._unitsCache || []))
    .filter(u => u.isAvailable === false && u.saleId)
    .filter(u => (u.customerName||'').toLowerCase().includes(query) || (u.unitNo||'').toLowerCase().includes(query))
    .slice(0, 8)
    .map(u => {
      const pend = Number(u.pendingAmount||0);
      return '<div class="rv-acc-item" onclick="_rvShiftPick(\'' + side + '\',\'' + u.id + '\')">' +
        '<div style="min-width:0"><div style="font-weight:600;color:var(--fk-text)">' + NX.esc(u.customerName||'—') + '</div>' +
        '<div style="font-size:11px;color:var(--fk-text-muted)">Unit ' + NX.esc(u.unitNo||'—') + '</div></div>' +
        '<div class="num" style="font-size:12px;color:' + (pend>0?'var(--fk-danger)':'var(--fk-success)') + '">' + (pend>0?('PKR '+fM(pend)):'Paid') + '</div>' +
      '</div>';
    }).join('');
  wrap.innerHTML = rows || '<div class="rv-acc-item" style="justify-content:center;color:var(--fk-text-muted)">No matching sold units</div>';
  wrap.style.display = 'block';
}
function _rvShiftPick(side, unitId) {
  const u = (typeof gunits === 'function' ? gunits() : (window._unitsCache || [])).find(x => x.id === unitId);
  if (!u || !u.saleId) return;
  _rvShift[side] = { unitId, saleId:u.saleId, unitNo:u.unitNo, name:u.customerName, received:Number(u.totalPaid||0), pending:Number(u.pendingAmount||0) };
  const res = document.getElementById('rvsh-' + side + '-results'); if (res) { res.innerHTML = ''; res.style.display = 'none'; }
  const inp = document.getElementById('rvsh-' + side); if (inp) inp.value = (u.customerName||'—') + ' — Unit ' + (u.unitNo||'—');
  const bal = document.getElementById('rvsh-' + side + '-bal');
  if (bal) bal.innerHTML = 'Received <b>PKR ' + fM(Number(u.totalPaid||0)) + '</b> · Balance <b style="color:' + (u.pendingAmount>0?'var(--fk-danger)':'var(--fk-success)') + '">PKR ' + fM(Number(u.pendingAmount||0)) + '</b>';
}

async function _rvShiftSave() {
  const err = document.getElementById('rvsh-err'); if (err) err.textContent = '';
  const from = _rvShift.from, to = _rvShift.to;
  const amount = parseFloat(document.getElementById('rvsh-amount')?.value || '0');
  const date = document.getElementById('rvsh-date')?.value;
  const narr = (document.getElementById('rvsh-narr')?.value || '').trim();
  const fail = m => { if (err) err.textContent = m; toast(m, 'warn'); };
  if (!from?.saleId) return fail('Pick the source (From) unit.');
  if (!to?.saleId)   return fail('Pick the destination (To) unit.');
  if (from.saleId === to.saleId) return fail('Source and destination must be different.');
  if (!(amount > 0)) return fail('Enter a positive amount.');
  if (amount > from.received + 0.01) return fail('Source unit only received PKR ' + fM(from.received) + ' — cannot shift more.');
  const btn = document.getElementById('rvsh-save');
  if (btn) { btn.disabled = true; const sp = btn.querySelector('span'); if (sp) sp.textContent = 'Shifting…'; }
  try {
    const { data, error } = await supabase.rpc('shift_unit_amount', {
      p_company_id: S.cid, p_from_sale_id: from.saleId, p_to_sale_id: to.saleId,
      p_amount: amount, p_shift_date: date, p_narration: narr || null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Shift failed');
    toast('Shifted PKR ' + fM(amount) + ' from ' + from.unitNo + ' to ' + to.unitNo, 'ok');
    _rvCloseShift();
    if (typeof loadUnitsCache === 'function') { try { await loadUnitsCache(S.cid); } catch(e){} }
  } catch (e) {
    if (btn) { btn.disabled = false; const sp = btn.querySelector('span'); if (sp) sp.textContent = 'Shift amount'; }
    fail('Could not shift — ' + (e.message || 'error'));
  }
}

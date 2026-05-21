// ══ RECEIPT VOUCHERS PAGE ══════════════════════════════════════════════════

let _rvList     = [];
let _rvFiltered = [];
let _rvPage     = 0;
const _RV_PG    = 15;
let _rvSaleMap  = {};
let _rvDetail   = null;
let _rvFilter   = { voucherNo:'', client:'', fr:'', to:'', mode:'All', amount:'', status:'All' };
let _rvSearchTimer = null;

function rReceipts() {
  const el = document.getElementById('pg-receipts');
  if (!el) return;
  _rvList = []; _rvFiltered = []; _rvPage = 0; _rvDetail = null; _rvSaleMap = {};

  const { from: _dfl_fr, to: _dfl_to } = _ldgFiscalYear();
  if (!_rvFilter.fr) _rvFilter.fr = _dfl_fr;
  if (!_rvFilter.to) _rvFilter.to = _dfl_to;

  el.innerHTML = `
  <div class="ani">
    <div class="ph">
      <div class="ph-l">
        <h2>Receipt Vouchers</h2>
        <p>All payment receipts across all clients and projects</p>
      </div>
    </div>

    <div id="rv-list-view">
      <div class="fbar" style="flex-wrap:wrap;gap:8px;margin-bottom:14px">
        <div class="fg">
          <label class="fl" style="font-size:10px">Voucher No</label>
          <input class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px;min-width:140px"
            type="text" placeholder="PRV-2526-…"
            oninput="_rvFilter.voucherNo=this.value;clearTimeout(_rvSearchTimer);_rvSearchTimer=setTimeout(_rvApplyFilter,220)">
        </div>
        <div class="fg">
          <label class="fl" style="font-size:10px">Client Name</label>
          <input class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px;min-width:140px"
            type="text" placeholder="Search client…"
            oninput="_rvFilter.client=this.value;clearTimeout(_rvSearchTimer);_rvSearchTimer=setTimeout(_rvApplyFilter,220)">
        </div>
        <div class="fg">
          <label class="fl" style="font-size:10px">From</label>
          <input class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px"
            type="date" value="${_rvFilter.fr}" onchange="_rvFilter.fr=this.value;_rvLoadAndRender()">
        </div>
        <div class="fg">
          <label class="fl" style="font-size:10px">To</label>
          <input class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px"
            type="date" value="${_rvFilter.to}" onchange="_rvFilter.to=this.value;_rvLoadAndRender()">
        </div>
        <div class="fg">
          <label class="fl" style="font-size:10px">Mode</label>
          <select class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px"
            onchange="_rvFilter.mode=this.value;_rvLoadAndRender()">
            <option value="All"${_rvFilter.mode==='All'?' selected':''}>All Modes</option>
            <option value="cash"${_rvFilter.mode==='cash'?' selected':''}>Cash</option>
            <option value="bank_transfer"${_rvFilter.mode==='bank_transfer'?' selected':''}>Bank Transfer</option>
            <option value="cheque"${_rvFilter.mode==='cheque'?' selected':''}>Cheque / PDC</option>
            <option value="adjustment"${_rvFilter.mode==='adjustment'?' selected':''}>Adjustment</option>
          </select>
        </div>
        <div class="fg">
          <label class="fl" style="font-size:10px">Status</label>
          <select class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px"
            onchange="_rvFilter.status=this.value;_rvApplyFilter()">
            <option value="All"${_rvFilter.status==='All'?' selected':''}>All</option>
            <option value="active"${_rvFilter.status==='active'?' selected':''}>Active</option>
            <option value="cancelled"${_rvFilter.status==='cancelled'?' selected':''}>Cancelled</option>
          </select>
        </div>
        <div class="fg">
          <label class="fl" style="font-size:10px">Amount</label>
          <input class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px;min-width:100px"
            type="text" placeholder="50,000"
            oninput="_rvFilter.amount=this.value;clearTimeout(_rvSearchTimer);_rvSearchTimer=setTimeout(_rvApplyFilter,220)">
        </div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-gh btn-sm"
            onclick="_rvFilter={voucherNo:'',client:'',fr:'',to:'',mode:'All',amount:'',status:'All'};rReceipts()">Reset</button>
        </div>
      </div>

      <div id="rv-tbl">
        <div style="padding:20px;text-align:center;color:var(--t3);font-size:12px">⏳ Loading…</div>
      </div>
    </div>

    <div id="rv-detail-view" style="display:none"></div>
  </div>`;

  _rvLoadAndRender();
}

async function _rvLoadAndRender() {
  const tbl = document.getElementById('rv-tbl');
  if (!tbl) return;
  tbl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--t3);font-size:12px">⏳ Loading…</div>';

  try {
    let q = supabase
      .from('payments')
      .select('id,payment_code,voucher_code,payment_date,amount,payment_method,payment_category,status,reference_no,bank_name,notes,sale_id,client_id,created_at')
      .eq('company_id', S.cid)
      .order('payment_date', { ascending: false })
      .order('created_at',   { ascending: false })
      .limit(1000);

    if (_rvFilter.fr)             q = q.gte('payment_date', _rvFilter.fr);
    if (_rvFilter.to)             q = q.lte('payment_date', _rvFilter.to);
    if (_rvFilter.mode !== 'All') q = q.eq('payment_method', _rvFilter.mode);

    const { data, error } = await q;
    if (error) throw error;
    _rvList = data || [];

    // Batch-resolve sale → unit_id
    const sids = [...new Set(_rvList.map(r => r.sale_id).filter(Boolean))];
    _rvSaleMap = {};
    if (sids.length) {
      const { data: sd = [] } = await supabase
        .from('sales').select('id,unit_id').in('id', sids);
      sd.forEach(s => { _rvSaleMap[s.id] = s.unit_id; });
    }

    _rvPage = 0;
    _rvApplyFilter();
  } catch(e) {
    if (tbl) tbl.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Could not load receipts</div>
      <div class="es">${esc(e.message)}</div></div></div>`;
  }
}

function _rvApplyFilter() {
  const vn = (_rvFilter.voucherNo || '').toLowerCase().trim();
  const cl = (_rvFilter.client    || '').toLowerCase().trim();
  const am = (_rvFilter.amount    || '').trim();
  const st =  _rvFilter.status;

  _rvFiltered = _rvList.filter(r => {
    if (vn && !(r.voucher_code || r.payment_code || '').toLowerCase().includes(vn)) return false;
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

  const modeIco   = { cash:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="22" height="16" x="1" y="4" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>', bank_transfer:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>', bank:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>', cheque:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', adjustment:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>', online:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>', other:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>' };
  const modeLbl   = { cash:'Cash', bank_transfer:'Bank Transfer', bank:'Bank', cheque:'Cheque/PDC', adjustment:'Adjustment', online:'Online', other:'Other' };

  if (!total) {
    tbl.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>
      <div class="et">${_rvList.length === 0 ? 'No receipt vouchers recorded yet.' : 'No results match your filters.'}</div>
    </div></div>`;
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
    const ico    = modeIco[r.payment_method] || '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="22" height="16" x="1" y="4" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>';
    const mode   = modeLbl[r.payment_method] || r.payment_method || '—';
    const badge  = cancelled
      ? `<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:10px;background:rgba(239,68,68,.12);color:var(--err);border:1px solid rgba(239,68,68,.2)">CANCELLED</span>`
      : `<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:10px;background:rgba(34,197,94,.1);color:#16a34a;border:1px solid rgba(34,197,94,.2)">ACTIVE</span>`;
    return `<tr class="cr" onclick="_rvShowDetail('${r.id}')" style="${cancelled?'opacity:.55':''}">
      <td style="font-family:monospace;font-size:11px;font-weight:700;color:${cancelled?'var(--t3)':'var(--brand)'}${cancelled?';text-decoration:line-through':''}">${esc(code)}</td>
      <td style="font-size:12px">${fD(r.payment_date)}</td>
      <td style="font-size:12px;font-weight:600">${esc(cName)}</td>
      <td style="font-size:11px;color:var(--t3)">${esc(unitLbl)}</td>
      <td class="r" style="font-size:13px;font-weight:800;color:${cancelled?'var(--t3)':'var(--ok)'}${cancelled?';text-decoration:line-through':''}">PKR ${fM(r.amount)}</td>
      <td style="font-size:11px"><span style="display:inline-flex;align-items:center;gap:4px">${ico}${esc(mode)}</span></td>
      <td>${badge}</td>
    </tr>`;
  }).join('');

  const navBar = `
  <div style="padding:10px 14px;display:flex;align-items:center;gap:6px;border-top:1px solid var(--line)">
    <button onclick="_rvGoPage('first')" ${_rvPage===0?'disabled':''} title="First"
      style="padding:5px 10px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--t2);font-size:12px;cursor:pointer;${_rvPage===0?'opacity:.4':''}">⏮</button>
    <button onclick="_rvGoPage(-1)" ${_rvPage===0?'disabled':''} title="Previous"
      style="padding:5px 10px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--t2);font-size:12px;cursor:pointer;${_rvPage===0?'opacity:.4':''}">◀ Prev</button>
    <span style="flex:1;text-align:center;font-size:11px;color:var(--t3)">Page ${_rvPage+1} of ${pages} &nbsp;·&nbsp; ${total} voucher${total!==1?'s':''}</span>
    <button onclick="_rvGoPage(1)" ${_rvPage>=pages-1?'disabled':''} title="Next"
      style="padding:5px 10px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--t2);font-size:12px;cursor:pointer;${_rvPage>=pages-1?'opacity:.4':''}">Next ▶</button>
    <button onclick="_rvGoPage('last')" ${_rvPage>=pages-1?'disabled':''} title="Last"
      style="padding:5px 10px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--t2);font-size:12px;cursor:pointer;${_rvPage>=pages-1?'opacity:.4':''}">⏭</button>
  </div>`;

  tbl.innerHTML = `
  <div class="card" style="padding:0;overflow:hidden">
    <div class="tw" style="overflow-x:auto">
      <table class="t">
        <thead><tr>
          <th>Voucher No</th><th>Date</th><th>Client</th>
          <th>Project / Unit</th><th class="r">Amount</th>
          <th>Mode</th><th>Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${navBar}
  </div>`;
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
  const modeIco   = { cash:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="22" height="16" x="1" y="4" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>', bank_transfer:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>', bank:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>', cheque:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', adjustment:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>', online:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>', other:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>' };
  const modeLbl   = { cash:'Cash', bank_transfer:'Bank Transfer', bank:'Bank', cheque:'Cheque/PDC', adjustment:'Adjustment', online:'Online', other:'Other' };

  document.getElementById('rv-detail-view').innerHTML = `
  <div class="ani">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <button class="btn btn-gh btn-sm" onclick="_rvBackToList()">← Back to List</button>
      <span style="flex:1"></span>
      ${!cancelled ? `<button class="btn btn-sm"
        style="border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.07);color:var(--err)"
        onclick="_rvCancelFromDetail('${r.id}','${esc(code)}',${r.amount})" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Cancel Voucher</button>` : ''}
      <button class="btn btn-gh btn-sm" onclick="window.print()" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button>
    </div>

    <div id="rv-print-area" class="card" style="max-width:640px;margin:0 auto;padding:0;overflow:hidden">
      <!-- Receipt header -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:20px 24px;border-bottom:2px solid var(--brand);background:linear-gradient(135deg,rgba(99,102,241,.07),transparent)">
        <div>
          <div style="font-size:20px;font-weight:900;color:var(--brand);letter-spacing:-.5px">RECEIPT VOUCHER</div>
          <div style="font-family:monospace;font-size:15px;font-weight:700;color:var(--text);margin-top:4px">${esc(code)}</div>
          ${cancelled ? `<div style="margin-top:6px"><span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px;background:rgba(239,68,68,.12);color:var(--err);border:1px solid rgba(239,68,68,.2)">CANCELLED</span></div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px">Date</div>
          <div style="font-size:14px;font-weight:700;color:var(--text)">${fD(r.payment_date)}</div>
          <div style="font-size:10px;color:var(--t3);margin-top:10px;text-transform:uppercase;letter-spacing:.4px">Received</div>
          <div style="font-size:22px;font-weight:900;color:${cancelled?'var(--t3)':'var(--ok)'}${cancelled?';text-decoration:line-through':''}">PKR ${fM(r.amount)}</div>
        </div>
      </div>

      <!-- Client + Property row -->
      <div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--line)">
        <div style="padding:14px 20px;border-right:1px solid var(--line)">
          <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Received From</div>
          <div style="font-size:14px;font-weight:700;color:var(--text)">${esc(cName)}</div>
          ${cPhone ? `<div style="font-size:11px;color:var(--t3);margin-top:2px">${esc(cPhone)}</div>` : ''}
        </div>
        <div style="padding:14px 20px">
          <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Property</div>
          <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(proj?.name || '—')}</div>
          ${unit ? `<div style="font-size:11px;color:var(--t3);margin-top:2px">Unit ${esc(unit.unitNo)}</div>` : ''}
        </div>
      </div>

      <!-- Payment details -->
      <div style="padding:14px 20px;border-bottom:1px solid var(--line)">
        <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Payment Details</div>
        <div style="display:flex;flex-wrap:wrap;gap:20px">
          <div>
            <div style="font-size:10px;color:var(--t3)">Mode</div>
            <div style="font-size:13px;font-weight:700;color:var(--text);display:inline-flex;align-items:center;gap:5px">${modeIco[r.payment_method]||'<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="22" height="16" x="1" y="4" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>'}${modeLbl[r.payment_method]||r.payment_method}</div>
          </div>
          ${r.payment_category && r.payment_category !== 'regular' ? `<div>
            <div style="font-size:10px;color:var(--t3)">Category</div>
            <div style="font-size:13px;font-weight:700;color:#d97706;text-transform:capitalize">${esc(r.payment_category)}</div>
          </div>` : ''}
          ${r.reference_no ? `<div>
            <div style="font-size:10px;color:var(--t3)">Reference No</div>
            <div style="font-size:13px;font-weight:600;font-family:monospace;color:var(--text)">${esc(r.reference_no)}</div>
          </div>` : ''}
          ${r.bank_name ? `<div>
            <div style="font-size:10px;color:var(--t3)">Bank</div>
            <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(r.bank_name)}</div>
          </div>` : ''}
        </div>
        ${r.notes ? `<div style="margin-top:10px;padding:8px 12px;background:rgba(0,0,0,.03);border-radius:6px;font-size:11px;color:var(--t2);line-height:1.5">${esc(r.notes)}</div>` : ''}
      </div>

      <!-- Footer -->
      <div style="padding:10px 20px;display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,.02)">
        <div style="font-size:10px;color:var(--t3)">Ref: <span style="font-family:monospace">${esc(r.payment_code)}</span></div>
        <div style="font-size:10px;color:var(--t3)">${new Date(r.created_at).toLocaleString()}</div>
      </div>
    </div>
  </div>`;
}

function _rvBackToList() {
  _rvDetail = null;
  document.getElementById('rv-list-view').style.display   = 'block';
  document.getElementById('rv-detail-view').style.display = 'none';
}

async function _rvCancelFromDetail(paymentId, code, amount) {
  notify.warning(`Cancel ${code}?`, {
    detail: `PKR ${fM(amount)} will be reversed from the installment. The record will be kept for audit. This cannot be undone.`,
    okText: 'Yes, Cancel It',
    onOk: async () => {
      try {
        const { data, error } = await supabase.rpc('cancel_payment', {
          p_payment_id:   paymentId,
          p_company_id:   S.cid,
          p_cancelled_by: S.userId
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Cancel failed');
        toast(`${code} cancelled`, 'ok');
        await _rvLoadAndRender();
        _rvBackToList();
      } catch(e) {
        notify.error('Cancel Failed', { detail: e.message });
      }
    }
  });
}

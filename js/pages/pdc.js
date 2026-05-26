// ══ PDC REGISTER ════════════════════════════════════════════

let _pdcList     = [];
let _pdcFiltered = [];
let _pdcActiveId = null;
let _pdcFilter   = { status:'All', client:'', project:'', bank:'', fr:'', to:'' };
let _pdcSearchTimer = null;

function rPDC() {
  const pg = document.getElementById('pg-pdc');
  if (!pg) return;

  const { from: _dfl_fr, to: _dfl_to } = _ldgFiscalYear();
  if (!_pdcFilter.fr) _pdcFilter.fr = _dfl_fr;
  if (!_pdcFilter.to) _pdcFilter.to = _dfl_to;

  const projects = window._projectsCache || [];
  const projOpts = projects.map(p =>
    `<option value="${p.id}">${esc(p.projectName || p.name || '')}</option>`
  ).join('');

  pg.innerHTML = `<div class="ani">
    <div class="ph no-p">
      <div><h2>PDC Register</h2><p>Post-dated cheque tracking and status management</p></div>
    </div>

    <!-- Filters -->
    <div class="card mb14">
      <div class="cb" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;align-items:end">
        <div>
          <label class="lb">Status</label>
          <select id="pdc-f-status" class="inp" onchange="_pdcOnFilter()">
            <option value="All">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="presented">Presented (deposited)</option>
            <option value="cleared">Cleared</option>
            <option value="bounced">Bounced</option>
          </select>
        </div>
        <div>
          <label class="lb">Client</label>
          <input id="pdc-f-client" class="inp" placeholder="Search client…" oninput="clearTimeout(_pdcSearchTimer);_pdcSearchTimer=setTimeout(_pdcApplyFilter,220)">
        </div>
        <div>
          <label class="lb">Project</label>
          <select id="pdc-f-project" class="inp" onchange="_pdcOnFilter()">
            <option value="">All Projects</option>
            ${projOpts}
          </select>
        </div>
        <div>
          <label class="lb">Bank</label>
          <input id="pdc-f-bank" class="inp" placeholder="Search bank…" oninput="clearTimeout(_pdcSearchTimer);_pdcSearchTimer=setTimeout(_pdcApplyFilter,220)">
        </div>
        <div>
          <label class="lb">Cheque Date From</label>
          <input id="pdc-f-fr" class="inp" type="date" onchange="_pdcOnFilter()">
        </div>
        <div>
          <label class="lb">Cheque Date To</label>
          <input id="pdc-f-to" class="inp" type="date" onchange="_pdcOnFilter()">
        </div>
        <div style="padding-bottom:1px">
          <button class="btn btn-gh" onclick="_pdcClearFilter()" style="width:100%;margin-top:20px">✕ Clear Filters</button>
        </div>
      </div>
    </div>

    <!-- Aging / analytics panel -->
    <div id="pdc-aging" style="margin-bottom:16px"></div>

    <!-- Summary cards -->
    <div id="pdc-summary" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-bottom:16px"></div>

    <!-- Table container -->
    <div id="pdc-table-wrap" class="card">
      <div class="empty" style="padding:32px"><div class="es" style="color:var(--t3)">Loading…</div></div>
    </div>

    <!-- Mark Cleared modal -->
    <div id="pdc-modal-cleared" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;align-items:center;justify-content:center" onclick="if(event.target===this)_pdcCloseModals()">
      <div style="background:var(--card);border-radius:12px;padding:24px;width:min(420px,90vw);box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <h3 style="margin-bottom:16px;font-size:15px;color:var(--t1)">Mark Cheque Cleared</h3>
        <div style="margin-bottom:12px">
          <label class="lb">Cleared Date</label>
          <input id="pdc-cleared-date" type="date" class="inp">
        </div>
        <div style="margin-bottom:20px">
          <label class="lb">Deposit Reference <span style="color:var(--t4)">(optional)</span></label>
          <input id="pdc-deposit-ref" type="text" class="inp" placeholder="Bank deposit slip or reference number…">
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-gh" onclick="_pdcCloseModals()">Cancel</button>
          <button id="pdc-btn-cleared" class="btn btn-g" onclick="_pdcConfirmCleared()">Confirm Cleared</button>
        </div>
      </div>
    </div>

    <!-- Mark Bounced modal -->
    <div id="pdc-modal-bounced" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;align-items:center;justify-content:center" onclick="if(event.target===this)_pdcCloseModals()">
      <div style="background:var(--card);border-radius:12px;padding:24px;width:min(420px,90vw);box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <h3 style="margin-bottom:16px;font-size:15px;color:var(--t1)">Mark Cheque Bounced</h3>
        <div style="margin-bottom:12px">
          <label class="lb">Bounce Date</label>
          <input id="pdc-bounce-date" type="date" class="inp">
        </div>
        <div style="margin-bottom:20px">
          <label class="lb">Bounce Reason</label>
          <input id="pdc-bounce-reason" type="text" class="inp" placeholder="Insufficient funds / Account closed…">
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-gh" onclick="_pdcCloseModals()">Cancel</button>
          <button id="pdc-btn-bounced" class="btn btn-r" onclick="_pdcConfirmBounced()">Confirm Bounced</button>
        </div>
      </div>
    </div>
  </div>`;

  // Restore filter state
  document.getElementById('pdc-f-status').value  = _pdcFilter.status;
  document.getElementById('pdc-f-client').value  = _pdcFilter.client;
  document.getElementById('pdc-f-project').value = _pdcFilter.project;
  document.getElementById('pdc-f-bank').value    = _pdcFilter.bank;
  document.getElementById('pdc-f-fr').value      = _pdcFilter.fr;
  document.getElementById('pdc-f-to').value      = _pdcFilter.to;

  _pdcLoad();
}

async function _pdcLoad() {
  const wrap = document.getElementById('pdc-table-wrap');
  if (!wrap) return;

  const status  = document.getElementById('pdc-f-status')?.value  || 'All';
  const project = document.getElementById('pdc-f-project')?.value || '';
  const fr      = document.getElementById('pdc-f-fr')?.value      || '';
  const to      = document.getElementById('pdc-f-to')?.value      || '';

  wrap.innerHTML = `<div class="empty" style="padding:32px"><div class="es" style="color:var(--t3)">Loading…</div></div>`;

  const { data, error } = await supabase.rpc('get_pdc_register', {
    p_company_id: S.cid,
    p_status:     status,
    p_project_id: project || null,
    p_date_from:  fr      || null,
    p_date_to:    to      || null
  });

  if (error || !data?.success) {
    wrap.innerHTML = `<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Could not load PDC register</div><div class="es">${esc(data?.error || error?.message || 'Error')}</div></div>`;
    return;
  }

  _pdcList = data.rows || [];
  _pdcFilter.status  = status;
  _pdcFilter.project = project;
  _pdcFilter.fr      = fr;
  _pdcFilter.to      = to;

  _pdcApplyFilter();
  _pdcLoadAnalytics();
}

function _pdcApplyFilter() {
  const client = (document.getElementById('pdc-f-client')?.value || '').toLowerCase();
  const bank   = (document.getElementById('pdc-f-bank')?.value   || '').toLowerCase();

  _pdcFilter.client = client;
  _pdcFilter.bank   = bank;

  _pdcFiltered = _pdcList.filter(r => {
    if (client && !(r.client_name || '').toLowerCase().includes(client)) return false;
    if (bank   && !(r.bank_name   || '').toLowerCase().includes(bank))   return false;
    return true;
  });

  _pdcRenderSummary();
  _pdcRenderTable();
}

function _pdcOnFilter() {
  _pdcLoad();
}

function _pdcClearFilter() {
  _pdcFilter = { status:'All', client:'', project:'', bank:'', fr:'', to:'' };
  document.getElementById('pdc-f-status').value  = 'All';
  document.getElementById('pdc-f-client').value  = '';
  document.getElementById('pdc-f-project').value = '';
  document.getElementById('pdc-f-bank').value    = '';
  document.getElementById('pdc-f-fr').value      = '';
  document.getElementById('pdc-f-to').value      = '';
  _pdcLoad();
}

// ── Summary cards ─────────────────────────────────────────────────────

function _pdcRenderSummary() {
  const el = document.getElementById('pdc-summary');
  if (!el) return;

  const groups = {
    pending: { amt: 0, cnt: 0 },
    cleared: { amt: 0, cnt: 0 },
    bounced: { amt: 0, cnt: 0 }
  };
  _pdcList.forEach(r => {
    const st = (r.status || '').toLowerCase();
    if (groups[st]) { groups[st].amt += Number(r.amount || 0); groups[st].cnt++; }
  });

  const card = (icon, label, clr, bg, amt, cnt) => `
    <div class="card" style="padding:14px 16px;border-left:3px solid ${clr}">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center">${icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${label}</div>
          <div style="font-size:18px;font-weight:800;color:${clr}">PKR ${fM(amt)}</div>
          <div style="font-size:11px;color:var(--t3)">${cnt} cheque${cnt !== 1 ? 's' : ''}</div>
        </div>
      </div>
    </div>`;

  el.innerHTML =
    card('<svg width="24" height="24" fill="none" stroke="var(--warn)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', 'Total Pending', 'var(--warn)', 'rgba(245,158,11,.06)', groups.pending.amt, groups.pending.cnt) +
    card('<svg width="24" height="24" fill="none" stroke="var(--ok)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>', 'Total Cleared', 'var(--ok)',   'rgba(34,197,94,.06)',  groups.cleared.amt, groups.cleared.cnt) +
    card('<svg width="24" height="24" fill="none" stroke="var(--err)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>', 'Total Bounced', 'var(--err)',  'rgba(239,68,68,.06)',  groups.bounced.amt, groups.bounced.cnt);
}

// ── Table ─────────────────────────────────────────────────────────────

function _pdcStatusBadge(status) {
  const map = {
    pending:   ['rgba(245,158,11,.12)', '#d97706', 'Pending'],
    presented: ['rgba(59,130,246,.12)', '#2563eb', 'Presented'],
    cleared:   ['rgba(34,197,94,.12)',  '#16a34a', 'Cleared'],
    bounced:   ['rgba(239,68,68,.12)',  '#dc2626', 'Bounced'],
  };
  const [bg, c, lbl] = map[(status||'').toLowerCase()] || ['rgba(100,116,139,.1)', 'var(--t3)', status || '—'];
  return `<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;background:${bg};color:${c};white-space:nowrap">${lbl}</span>`;
}

function _pdcRenderTable() {
  const wrap = document.getElementById('pdc-table-wrap');
  if (!wrap) return;
  const rows = _pdcFiltered;
  const isA  = S.role === 'admin' || S.role === 'owner';

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty" style="padding:40px"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg></div><div class="et">No PDC cheques found</div><div class="es">Adjust filters or add PDC cheques when recording payments</div></div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="ch">
      <div><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>PDC Cheques</h3><p>${rows.length} record${rows.length !== 1 ? 's' : ''}</p></div>
    </div>
    <div class="tw"><table class="t">
      <thead><tr>
        <th>Cheque No</th>
        <th>Client</th>
        <th>Project / Unit</th>
        <th>Bank</th>
        <th class="r">Amount</th>
        <th>Cheque Date</th>
        <th>Received</th>
        <th>Status</th>
        ${isA ? '<th>Actions</th>' : ''}
      </tr></thead>
      <tbody>
      ${rows.map(r => {
        const st          = (r.status || '').toLowerCase();
        const isPending   = st === 'pending';
        const isPresented = st === 'presented';
        const isCleared   = st === 'cleared';
        const isBounced   = st === 'bounced';

        const _btnCleared = `<button class="btn btn-g btn-xs" onclick="_pdcOpenCleared('${r.id}')" style="display:inline-flex;align-items:center;gap:3px"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>Cleared</button>`;
        const _btnBounced = `<button class="btn btn-r btn-xs" onclick="_pdcOpenBounced('${r.id}')" style="display:inline-flex;align-items:center;gap:3px"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Bounced</button>`;

        let actions = '';
        if (isA) {
          if (isPending) {
            actions = `<div style="display:flex;gap:5px">
              <button class="btn btn-gh btn-xs" onclick="_pdcDeposit('${r.id}')" title="Mark deposited (presented to bank)">Deposit</button>
              ${_btnCleared}${_btnBounced}
            </div>`;
          } else if (isPresented) {
            actions = `<div style="display:flex;gap:5px">${_btnCleared}${_btnBounced}</div>`;
          } else if (isCleared && r.clearance_date) {
            actions = `<span style="font-size:11px;color:var(--ok)">Cleared ${fD(r.clearance_date)}</span>`;
          } else if (isBounced) {
            const short = (r.bounce_reason||'').length > 18 ? r.bounce_reason.slice(0, 18) + '…' : (r.bounce_reason||'');
            actions = `<div style="display:flex;gap:5px;align-items:center">
              <button class="btn btn-gh btn-xs" onclick="_pdcRedeposit('${r.id}')" title="Schedule re-deposit">Re-deposit</button>
              ${short?`<span style="font-size:11px;color:var(--err)" title="${esc(r.bounce_reason)}">${esc(short)}</span>`:''}
            </div>`;
          }
        }

        return `<tr style="${isBounced ? 'opacity:.65' : ''}">
          <td style="font-family:monospace;font-weight:700;white-space:nowrap">${esc(r.cheque_no || '—')}</td>
          <td style="font-weight:600;white-space:nowrap">${esc(r.client_name || '—')}</td>
          <td style="font-size:12px">
            ${r.project_name ? `<div style="color:var(--t2)">${esc(r.project_name)}</div>` : ''}
            ${r.unit_no      ? `<div style="font-family:monospace;color:var(--t3);font-size:11px">${esc(r.unit_no)}</div>` : ''}
          </td>
          <td style="font-size:12px;color:var(--t2)">${esc(r.bank_name || '—')}</td>
          <td class="r mono" style="font-weight:700">PKR ${fM(r.amount)}</td>
          <td style="white-space:nowrap;font-size:12px">${fD(r.cheque_date)}</td>
          <td style="white-space:nowrap;font-size:12px;color:var(--t3)">${r.received_date ? fD(r.received_date) : '—'}</td>
          <td>${_pdcStatusBadge(r.status)}</td>
          ${isA ? `<td style="white-space:nowrap">${actions}</td>` : ''}
        </tr>`;
      }).join('')}
      </tbody>
    </table></div>`;
}

// ── Mark Cleared ──────────────────────────────────────────────────────

function _pdcOpenCleared(chequeId) {
  _pdcActiveId = chequeId;
  document.getElementById('pdc-cleared-date').value = td();
  document.getElementById('pdc-deposit-ref').value  = '';
  document.getElementById('pdc-modal-cleared').style.display = 'flex';
}

async function _pdcConfirmCleared() {
  const clearedDate = document.getElementById('pdc-cleared-date').value;
  const depositRef  = (document.getElementById('pdc-deposit-ref').value || '').trim();
  if (!clearedDate) { toast('Please enter the cleared date', 'warn'); return; }

  const btn = document.getElementById('pdc-btn-cleared');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const { data, error } = await supabase.rpc('mark_pdc_cleared', {
      p_cheque_id:    _pdcActiveId,
      p_company_id:   S.cid,
      p_cleared_date: clearedDate,
      p_deposit_ref:  depositRef || null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed to mark cleared');

    toast(`Cheque ${data.cheque_no || ''} marked cleared`, 'ok');
    _pdcCloseModals();
    await _pdcLoad();
  } catch(e) {
    toast(e.message || 'Error updating cheque', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Cleared'; }
  }
}

// ── Mark Bounced ──────────────────────────────────────────────────────

function _pdcOpenBounced(chequeId) {
  _pdcActiveId = chequeId;
  document.getElementById('pdc-bounce-date').value   = td();
  document.getElementById('pdc-bounce-reason').value = '';
  document.getElementById('pdc-modal-bounced').style.display = 'flex';
}

async function _pdcConfirmBounced() {
  const bounceDate   = document.getElementById('pdc-bounce-date').value;
  const bounceReason = (document.getElementById('pdc-bounce-reason').value || '').trim();
  if (!bounceDate)   { toast('Please enter the bounce date', 'warn');   return; }
  if (!bounceReason) { toast('Please enter a bounce reason', 'warn');   return; }

  const btn = document.getElementById('pdc-btn-bounced');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const { data, error } = await supabase.rpc('mark_pdc_bounced', {
      p_cheque_id:     _pdcActiveId,
      p_company_id:    S.cid,
      p_bounce_date:   bounceDate,
      p_bounce_reason: bounceReason
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed to mark bounced');

    if (data.auto_escalated) {
      toast(`Cheque ${data.cheque_no||''} bounced — client auto-escalated to manager`, 'warn');
    } else {
      toast(`Cheque ${data.cheque_no || ''} marked bounced`, 'warn');
    }
    _pdcCloseModals();
    await _pdcLoad();
  } catch(e) {
    toast(e.message || 'Error updating cheque', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Bounced'; }
  }
}

function _pdcCloseModals() {
  document.getElementById('pdc-modal-cleared').style.display = 'none';
  document.getElementById('pdc-modal-bounced').style.display = 'none';
  _pdcActiveId = null;
}

// ── Aging / analytics (Module 3) ──────────────────────────────────────
let _pdcAnalytics = null;

async function _pdcLoadAnalytics() {
  const el = document.getElementById('pdc-aging');
  if (!el) return;
  try {
    const { data, error } = await supabase.rpc('get_pdc_analytics', { p_company_id: S.cid });
    if (error) throw error;
    if (!data?.success) return;
    _pdcAnalytics = data;
    _pdcRenderAging();
  } catch(e) { console.warn('[pdc analytics]', e); }
}

function _pdcRenderAging() {
  const el = document.getElementById('pdc-aging');
  if (!el || !_pdcAnalytics) return;
  const a  = _pdcAnalytics.aging || {};
  const wk = a.due_this_week  || { count:0, amount:0 };
  const mo = a.due_this_month || { count:0, amount:0 };
  const od = a.overdue        || { count:0, amount:0 };
  const banks = (_pdcAnalytics.by_bank || []).slice(0, 5);
  const isA = S.role === 'admin' || S.role === 'owner';

  const cell = (label, c, amt, cnt) => `<div style="flex:1;min-width:150px;padding:12px 14px;border-radius:10px;background:var(--surface);border:1px solid var(--line);border-top:3px solid ${c}">
    <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px">${label}</div>
    <div style="font-size:18px;font-weight:800;color:${c};margin-top:3px">PKR ${fM(amt)}</div>
    <div style="font-size:11px;color:var(--t3)">${cnt} cheque${cnt!==1?'s':''}</div>
  </div>`;

  el.innerHTML = `<div class="card"><div class="cb">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <h3 style="margin:0;font-size:14px">Deposit Aging</h3>
      ${isA ? `<div style="display:flex;gap:6px;align-items:center">
        <input id="pdc-bulk-date" type="date" class="inp" style="width:auto;padding:5px 8px" value="${td()}">
        <button class="btn btn-gh btn-sm" onclick="_pdcBulkSchedule()">Schedule deposit for pending shown</button>
      </div>` : ''}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${cell('Overdue to deposit', '#ef4444', od.amount, od.count)}
      ${cell('Due this week',      '#f59e0b', wk.amount, wk.count)}
      ${cell('Due this month',     '#3b82f6', mo.amount, mo.count)}
    </div>
    ${banks.length ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      ${banks.map(b => `<span style="font-size:11px;padding:4px 10px;border-radius:8px;background:var(--canvas);color:var(--t2)"><b>${esc(b.bank_name)}</b>: PKR ${fM(b.amount)} (${b.count})${b.bounced?` · <span style="color:var(--err)">${b.bounced} bounced</span>`:''}</span>`).join('')}
    </div>` : ''}
  </div></div>`;
}

async function _pdcDeposit(id) {
  if (!confirm('Mark this cheque as deposited (presented to bank) today?')) return;
  try {
    const { data, error } = await supabase.rpc('mark_pdc_deposited', { p_cheque_id: id, p_company_id: S.cid, p_deposit_date: td() });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast('Cheque marked deposited', 'ok');
    await _pdcLoad();
  } catch(e) { toast(e.message || 'Error', 'err'); }
}

async function _pdcRedeposit(id) {
  const def = new Date(Date.now() + 86400000*7).toISOString().slice(0,10);
  const nd  = prompt('Re-deposit date (YYYY-MM-DD):', def);
  if (!nd) return;
  try {
    const { data, error } = await supabase.rpc('redeposit_pdc', { p_cheque_id: id, p_company_id: S.cid, p_new_deposit_date: nd });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast('Cheque scheduled for re-deposit', 'ok');
    await _pdcLoad();
  } catch(e) { toast(e.message || 'Error', 'err'); }
}

async function _pdcBulkSchedule() {
  const date = document.getElementById('pdc-bulk-date')?.value;
  if (!date) { toast('Pick a deposit date', 'warn'); return; }
  const ids = (_pdcFiltered || []).filter(r => (r.status||'').toLowerCase() === 'pending').map(r => r.id);
  if (!ids.length) { toast('No pending cheques in the current view', 'warn'); return; }
  if (!confirm('Schedule deposit on ' + date + ' for ' + ids.length + ' pending cheque(s)?')) return;
  try {
    const { data, error } = await supabase.rpc('schedule_pdc_deposit_bulk', { p_company_id: S.cid, p_cheque_ids: ids, p_deposit_date: date });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast((data.scheduled || 0) + ' cheque(s) scheduled for deposit', 'ok');
    await _pdcLoad();
  } catch(e) { toast(e.message || 'Error', 'err'); }
}

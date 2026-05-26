// ══ ADD PAYMENT MODULE ════════════════════════════════════════════
// RPCs: get_unit_payment_summary, record_payment

let _pymCurrentSale     = null;
let _pymReceiveRow      = null;
let _pymRows            = [];
let _pymBanks           = null;
let _pymSelectedProject = null;
let _pymSubStep         = null;   // 'projects' | 'clients' | 'payment'
let _pymCurrentUnitId   = null;

// ── Method selector state ─────────────────────────────────────────
let _pymPickedIdx   = -1;    // row index that triggered method pick
let _pymPickBanner  = false; // was triggered from "Pay All Due" banner
let _pymCustAllocs  = {};    // {installmentId: allocatedAmount} for Custom Allocation
let _pymCustTotal   = 0;     // total received amount in Custom Allocation mode
let _pymTxList      = [];    // payment transactions for current sale (history panel)
let _pymTxFiltered  = [];    // after search filter
let _pymTxPage      = 0;     // current page (0-indexed)
const _PYM_TX_PG    = 8;     // rows per page

// ── Main entry ───────────────────────────────────────────────────
async function rAddPayment(preUnitId) {
  const cid = S?.cid;
  const el  = document.getElementById('pg-addpayment');
  if (!el) return;
  if (!cid) {
    el.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div><div class="et">No company selected</div></div></div>`;
    return;
  }
  _pymCurrentSale = null; _pymReceiveRow = null; _pymRows = []; _pymSelectedProject = null;

  if (preUnitId) {
    const u = (window._unitsCache || []).find(u => u.id === preUnitId);
    _pymSelectedProject = u?.projectId || null;
    await _pymShowPaymentView(preUnitId);
    return;
  }

  _pymShowProjectPicker();
}

// ── Step 1: Project cards ─────────────────────────────────────────
function _pymShowProjectPicker() {
  _pymSubStep = 'projects';
  const el = document.getElementById('pg-addpayment');
  if (!el) return;

  const soldUnits = (window._unitsCache || []).filter(u => u.isAvailable === false);
  const stats     = {};
  soldUnits.forEach(u => {
    if (!u.projectId) return;
    if (!stats[u.projectId]) stats[u.projectId] = { count: 0, outstanding: 0 };
    stats[u.projectId].count++;
    stats[u.projectId].outstanding += Number(u.pendingAmount || 0);
  });

  const active = (window._projectsCache || []).filter(p => stats[p.id]);

  if (active.length === 0) {
    el.innerHTML = `<div class="ani"><div class="ph"><div class="ph-l"><h2>Add Payment</h2></div></div>
      ${_pymStepWizard(1)}
      <div class="inv-empty"><span class="inv-empty-ic"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg></span><p class="inv-empty-tx">No sold units yet</p><p class="inv-empty-sub">Create a sale first to receive payments.</p></div></div>`;
    return;
  }

  if (active.length === 1) { _pymShowClientSearch(active[0].id); return; }

  const ACCENT = ['#6366f1','#10b981','#f59e0b','#3b82f6','#8b5cf6','#ec4899'];

  el.innerHTML = `<div class="ani module-financial">
    <div class="ph"><div class="ph-l"><h2>Add Payment</h2><p>Select a project to continue</p></div></div>
    ${_pymStepWizard(1)}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;max-width:920px">
      ${active.map((p, i) => {
        const s   = stats[p.id];
        const acc = ACCENT[i % ACCENT.length];
        const soldPaid    = (window._unitsCache||[]).filter(u=>u.isAvailable===false&&u.projectId===p.id&&Number(u.pendingAmount||0)<=0).length;
        const soldPartial = s.count - soldPaid;
        return `
        <div onclick="_pymShowClientSearch('${p.id}')"
          style="background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;cursor:pointer;transition:box-shadow .18s,transform .18s,border-color .18s"
          onmouseenter="this.style.cssText+=';box-shadow:0 8px 24px rgba(0,0,0,.14);transform:translateY(-4px);border-color:${acc}66'"
          onmouseleave="this.style.boxShadow='none';this.style.transform='none';this.style.borderColor='var(--line)'">
          <div style="height:4px;background:linear-gradient(90deg,${acc},${acc}99)"></div>
          <div style="padding:18px 16px">
            <div style="width:40px;height:40px;border-radius:11px;background:${acc}18;border:1px solid ${acc}33;display:flex;align-items:center;justify-content:center;margin-bottom:12px;color:${acc}"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M8 10h.01M16 10h.01M12 14h.01M8 14h.01M16 14h.01"/></svg></div>
            <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px;line-height:1.3">${esc(p.name)}</div>
            <div style="font-size:11px;color:var(--t3);margin-bottom:14px">${s.count} unit${s.count!==1?'s':''} sold</div>
            ${s.outstanding > 0
              ? `<div style="font-size:13px;font-weight:800;color:${acc}">PKR ${fM(s.outstanding)}</div>
                 <div style="font-size:10px;color:var(--t3);margin-top:1px">outstanding</div>
                 <div style="margin-top:10px;height:3px;background:${acc}22;border-radius:2px;overflow:hidden">
                   <div style="height:100%;width:${soldPaid > 0 ? Math.round(soldPaid/s.count*100) : 0}%;background:${acc};border-radius:2px"></div>
                 </div>
                 <div style="font-size:10px;color:var(--t3);margin-top:3px">${soldPaid} of ${s.count} fully paid</div>`
              : `<div style="font-size:12px;font-weight:700;color:var(--ok);display:flex;align-items:center;gap:5px"><span>✓</span> All paid</div>`}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// ── Step 2: Client / unit search ──────────────────────────────────
function _pymShowClientSearch(projectId) {
  if (!projectId) { _pymShowProjectPicker(); return; }
  _pymSubStep = 'clients';
  const el = document.getElementById('pg-addpayment');
  if (!el) return;
  _pymSelectedProject = projectId;

  const proj      = (window._projectsCache || []).find(p => p.id === projectId);
  const soldHere  = (window._unitsCache || []).filter(u => u.isAvailable === false && u.projectId === projectId);
  const multiProj = ((window._unitsCache || []).reduce((s, u) => {
    if (u.isAvailable === false && u.projectId) s.add(u.projectId); return s;
  }, new Set())).size > 1;

  const overdueCount  = soldHere.filter(u => Number(u.pendingAmount||0) > 0).length;
  const paidCount     = soldHere.filter(u => Number(u.pendingAmount||0) <= 0).length;

  el.innerHTML = `<div class="ani module-financial">
    <div class="ph">
      <div class="ph-l" style="align-items:center;gap:10px">
        ${multiProj ? `<button class="bk" onclick="_pymShowProjectPicker()">← Projects</button>` : ''}
        <div><h2>Add Payment</h2><p>${esc(proj?.name || '')} — Select a client</p></div>
      </div>
    </div>
    ${_pymStepWizard(2)}

    <div class="card mb14" style="border-top:3px solid var(--brand)">
      <div class="cb" style="padding-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <div class="sbar" style="flex:1;min-width:220px;max-width:480px">
            <span class="sbar-ic"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span>
            <input id="pym-srch" class="sinp" placeholder="Search by client name or unit #…"
              oninput="_pymRenderClientList(this.value)" autocomplete="off">
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <span style="font-size:11px;background:rgba(239,68,68,.1);color:var(--err);padding:3px 9px;border-radius:20px;font-weight:600">${overdueCount} outstanding</span>
            <span style="font-size:11px;background:rgba(16,185,129,.1);color:var(--ok);padding:3px 9px;border-radius:20px;font-weight:600">${paidCount} paid</span>
          </div>
        </div>
        <div style="font-size:11px;color:var(--t3)">${soldHere.length} sold unit${soldHere.length !== 1 ? 's' : ''} in ${esc(proj?.name || 'this project')} — type to filter</div>
      </div>
    </div>

    <div id="pym-clist"></div>
  </div>`;

  document.getElementById('pym-srch')?.focus();
  _pymRenderClientList('');
}

function _pymRenderClientList(q) {
  const el    = document.getElementById('pym-clist');
  if (!el) return;
  const query = (q || '').trim().toLowerCase();
  const pid   = _pymSelectedProject;

  const matches = (window._unitsCache || []).filter(u => {
    if (u.isAvailable !== false || u.projectId !== pid) return false;
    if (!query) return true;
    return (u.customerName || '').toLowerCase().includes(query)
        || (u.unitNo       || '').toLowerCase().includes(query)
        || (u.bookingNo    || '').toLowerCase().includes(query);
  });

  if (matches.length === 0) {
    el.innerHTML = `<div class="inv-empty"><span class="inv-empty-ic"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span><p class="inv-empty-tx">No matches</p><p class="inv-empty-sub">Try a different name or unit number</p></div>`;
    return;
  }

  el.innerHTML = `<div class="card" style="overflow:hidden">
    ${matches.map((u, i) => {
      const pend  = Number(u.pendingAmount || 0);
      const paid  = Number(u.totalPaid || 0);
      const total = Number(u.totalPrice || 0);
      const pct   = total > 0 ? Math.min(100, Math.round(paid / total * 100)) : 0;
      const acol  = pend <= 0 ? 'var(--ok)' : paid > 0 ? 'var(--warn)' : 'var(--err)';
      const badge = pend <= 0
        ? `<div style="font-size:10px;font-weight:700;color:var(--ok);background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);padding:2px 9px;border-radius:12px;white-space:nowrap">✓ Paid</div>`
        : `<div style="text-align:right">
             <div style="font-size:13px;font-weight:700;color:${acol}">PKR ${fM(pend)}</div>
             <div style="font-size:10px;color:var(--t3)">outstanding</div>
           </div>`;
      const unitInitial = (u.unitNo || '').replace(/[^A-Z0-9]/gi, '').slice(0, 3) || '?';
      return `
      <div onclick="_pymShowPaymentView('${u.id}')"
        style="display:flex;align-items:center;gap:14px;padding:12px 16px;cursor:pointer;transition:background .1s;${i > 0 ? 'border-top:1px solid var(--line);' : ''}"
        onmouseenter="this.style.background='var(--hover)'"
        onmouseleave="this.style.background=''">
        <div style="flex-shrink:0;width:40px;height:40px;border-radius:10px;background:var(--hover);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:var(--brand);font-family:monospace;letter-spacing:-.5px">
          ${esc(unitInitial)}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.customerName || '—')}</div>
          <div style="font-size:11px;color:var(--t3);margin-top:1px">
            Unit ${esc(u.unitNo)}${u.floorLabel ? ' · ' + esc(u.floorLabel) : ''}${u.bookingNo ? ' · ' + esc(u.bookingNo) : ''}
          </div>
          <div style="height:3px;background:var(--line);border-radius:2px;margin-top:6px;max-width:140px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${acol};border-radius:2px"></div>
          </div>
        </div>
        ${badge}
        <div style="color:var(--t3);font-size:16px;font-weight:300">›</div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── Step 3: Payment view for a specific unit ──────────────────────
async function _pymShowPaymentView(unitId) {
  _pymSubStep = 'payment';
  const el = document.getElementById('pg-addpayment');
  if (!el) return;
  const u     = (window._unitsCache || []).find(u => u.id === unitId);
  const projId = _pymSelectedProject || u?.projectId || null;
  const proj   = (window._projectsCache || []).find(p => p.id === projId);
  const avInit = ini(u?.customerName || '');
  const avPend = Number(u?.pendingAmount || 0);
  const avPaid = Number(u?.totalPaid     || 0);
  const avTot  = Number(u?.totalPrice    || 0);
  const avPct  = avTot > 0 ? Math.min(100, Math.round(avPaid / avTot * 100)) : 0;

  el.innerHTML = `<div class="ani module-financial">
    <div class="ph">
      <div class="ph-l" style="align-items:center;gap:10px">
        <button class="bk" onclick="_pymShowClientSearch('${projId || ''}')">← Clients</button>
        <div>
          <h2>Add Payment</h2>
          <p>${esc(proj?.name || '')}${u?.unitNo ? ' · Unit ' + esc(u.unitNo) : ''}</p>
        </div>
      </div>
    </div>
    ${_pymStepWizard(3)}

    <!-- Client hero card -->
    <div style="display:flex;align-items:center;gap:16px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin-bottom:16px;overflow:hidden;position:relative">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--brand),#8b5cf6)"></div>
      <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--brand) 0%,#8b5cf6 100%);display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800;color:#fff;flex-shrink:0;letter-spacing:-.5px">
        ${esc(avInit)}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u?.customerName || '—')}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:2px">
          Unit <b style="color:var(--t2)">${esc(u?.unitNo || '—')}</b>${u?.floorLabel ? ' · ' + esc(u.floorLabel) : ''}${u?.bookingNo ? ' · #' + esc(u.bookingNo) : ''}
        </div>
        <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:4px;background:var(--line);border-radius:2px;overflow:hidden;max-width:160px">
            <div style="height:100%;width:${avPct}%;background:${avPend<=0?'var(--ok)':'var(--brand)'};border-radius:2px;transition:width .4s ease"></div>
          </div>
          <span style="font-size:10px;color:var(--t3);flex-shrink:0">${avPct}% paid</span>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        ${avPend > 0
          ? `<div style="font-size:14px;font-weight:800;color:var(--err)">PKR ${fM(avPend)}</div><div style="font-size:10px;color:var(--t3);margin-top:1px">outstanding</div>`
          : `<div style="font-size:13px;font-weight:700;color:var(--ok)">✓ Fully Paid</div>`}
        <div style="font-size:10px;color:var(--t3);margin-top:4px">of PKR ${fM(avTot)}</div>
      </div>
    </div>

    <div id="pym-pdc-alert"></div>
    <div id="pym-info-section"     style="display:none"></div>
    <div id="pym-schedule-section" style="display:none"></div>
    <div id="pym-pdc-section"      style="display:none"></div>
    <div id="pym-tx-section"></div>
  </div>`;

  await _pymOnUnitChange(unitId);
}

// ── Unit load ─────────────────────────────────────────────────────
async function _pymOnUnitChange(unitId) {
  _pymCurrentUnitId = unitId;
  const infoSec = document.getElementById('pym-info-section');
  const scheSec = document.getElementById('pym-schedule-section');
  if (!infoSec || !scheSec) return;

  infoSec.style.display = 'block';
  scheSec.style.display = 'none';
  infoSec.innerHTML = `<div class="card mb14"><div class="cb"><div class="empty">
    <div class="ei"><svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;opacity:.4"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/></svg></div><div class="et">Loading sale info…</div>
  </div></div></div>`;

  try {
    const { data, error } = await supabase.rpc('get_unit_payment_summary', {
      p_unit_id:    unitId,
      p_company_id: S.cid
    });
    if (error) throw error;
    if (!data || !data.success) throw new Error(data?.error || 'No sale found for this unit');

    _pymCurrentSale = data;
    scheSec.style.display = 'block';
    _pymRenderAll(data);
    _pymRenderPDC(data.sale.sale_id);
    _pymLoadAndRenderTx(data.sale.sale_id);
  } catch (e) {
    infoSec.innerHTML = `<div class="card mb14"><div class="cb"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Failed to load sale</div>
      <div class="es">${esc(e.message)}</div>
    </div></div></div>`;
    scheSec.style.display = 'none';
  }
}

// ── Render both sections ──────────────────────────────────────────
function _pymRenderAll(data) {
  _pymRenderInfo(data.sale);
  _pymRenderSchedule(data);
}

// ── Sale info card — hidden; everything rendered inside _pymRenderSchedule ──
function _pymRenderInfo(s) {
  const el = document.getElementById('pym-info-section');
  if (el) el.style.display = 'none';
}

// ── Payment schedule — summary card + alert banner + always-visible table ──
function _pymRenderSchedule(data) {
  const el = document.getElementById('pym-schedule-section');
  if (!el) return;

  const s    = data.sale;
  const rows = Array.isArray(data.installments) ? data.installments : [];

  const totalDue    = Number(s.net_amount || 0);
  const totalAmtDue = rows.reduce((a, r) => a + Number(r.amount_due  || 0), 0);
  const totalPaid   = rows.reduce((a, r) => a + Number(r.amount_paid || 0), 0);
  const totalOut    = rows.reduce((a, r) => a + Number(r.outstanding  || 0), 0);
  const pct         = totalDue > 0 ? Math.min(100, Math.round(totalPaid / totalDue * 100)) : 0;

  // Build indexed _pymRows
  _pymRows = [];
  rows.forEach(r => {
    const isDP = r.installment_type === 'down_payment';
    let label;
    if (r.notes) {
      label = r.notes;
    } else if (isDP) {
      label = 'Down Payment';
    } else {
      label = _ordinal(r.installment_number) + ' Installment';
    }
    _pymRows.push({
      isDownPayment:   isDP,
      installmentId:   r.installment_id || null,
      outstanding:     Number(r.outstanding || 0),
      label,
      dueDate:         r.due_date || null,
      status:          r.status || 'pending',
      installmentType: r.installment_type || 'installment'
    });
  });

  const todayStr    = new Date().toISOString().split('T')[0];
  const _isItemDue  = r => r.outstanding > 0 && (r.isDownPayment || !r.dueDate || r.dueDate <= todayStr);
  const dueRows     = _pymRows.filter(_isItemDue);
  const totalDueNow = dueRows.reduce((sum, r) => sum + r.outstanding, 0);
  const firstDueIdx = _pymRows.indexOf(dueRows[0]);

  // Unit info from cache
  const u = (window._unitsCache || []).find(x => x.id === _pymCurrentUnitId);

  // Table rows with color coding
  const tableRows = rows.map((r, i) => {
    const out      = Number(r.outstanding || 0);
    const paid     = Number(r.amount_paid || 0);
    const isPaid   = r.status === 'paid';
    const isDP     = r.installment_type === 'down_payment';
    const isOver   = r.status === 'overdue';
    const rowIsDue = _pymRows[i] && _isItemDue(_pymRows[i]);
    const numDisp  = isDP ? 'Bk' : (r.installment_number || i + 1);
    const desc     = r.notes || (isDP ? 'Down Payment' : _ordinal(r.installment_number) + ' Installment');
    const overDays = (isOver && r.due_date) ? Math.floor((new Date(todayStr) - new Date(r.due_date)) / 86400000) : 0;

    let rowStyle = '';
    if (isPaid)        rowStyle = 'background:rgba(16,185,129,.04)';
    else if (rowIsDue) rowStyle = 'background:rgba(239,68,68,.04)';

    const actionBtn = isPaid
      ? `<span style="font-size:11px;color:var(--ok);font-weight:600">✓ Paid</span>`
      : `<button class="btn ${rowIsDue ? 'btn-g' : 'btn-gh'} btn-xs" onclick="_pymPickMethod(${i}, false)">Receive</button>`;

    const _instId  = _pymRows[i] ? _pymRows[i].installmentId : null;
    const deferBtn = (!isPaid && (S.role === 'admin' || S.role === 'owner') && _instId && !isDP)
      ? `<button class="btn btn-gh btn-xs" style="margin-left:4px" onclick="_pymDefer('${_instId}')" title="Defer due date">Defer</button>` : '';

    return `<tr${rowStyle ? ` style="${rowStyle}"` : ''}>
      <td style="font-family:monospace;font-size:11px;font-weight:600;color:${isDP ? 'var(--brand)' : 'var(--t3)'}">${numDisp}</td>
      <td>
        <div style="font-size:12px;font-weight:600;color:var(--text)">${esc(desc)}</div>
        <div style="margin-top:2px">${_pymTypeBadge(r.installment_type || 'installment')}</div>
      </td>
      <td style="font-size:11px;color:${isOver ? 'var(--err)' : 'var(--t3)'}">
        ${r.due_date ? fD(r.due_date) : '—'}
        ${isOver && overDays > 0 ? `<div style="font-size:9px;font-weight:700;color:var(--err);background:rgba(239,68,68,.1);display:inline-block;padding:1px 5px;border-radius:3px;margin-top:2px">${overDays}d late</div>` : ''}
      </td>
      <td class="r mono" style="font-size:12px">${fM(r.amount_due || 0)}</td>
      <td class="r mono" style="font-size:12px;color:${paid > 0 ? 'var(--ok)' : 'var(--t3)'}">${paid > 0 ? fM(paid) : '—'}</td>
      <td class="r mono" style="font-size:12px;color:${out > 0 ? 'var(--err)' : 'var(--t3)'}">${out > 0 ? fM(out) : '—'}</td>
      <td>${_pymStatusBadge(r.status || 'pending')}</td>
      <td style="white-space:nowrap">${actionBtn}${deferBtn}</td>
    </tr>`;
  }).join('');

  // Alert banner
  let alertBanner = '';
  if (totalOut <= 0) {
    alertBanner = `<div style="display:flex;align-items:center;gap:12px;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);border-radius:10px;padding:14px 18px;margin-bottom:16px">
      <div style="color:var(--ok);flex-shrink:0"><svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--ok);text-transform:uppercase;letter-spacing:.5px">Fully Paid</div>
        <div style="font-size:13px;color:var(--t2);margin-top:2px">All installments have been received</div>
      </div>
    </div>`;
  } else if (dueRows.length > 0) {
    const btnLabel = dueRows.length > 1 ? 'Pay All Due →' : 'Receive →';
    alertBanner = `<div style="display:flex;align-items:center;gap:12px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.22);border-radius:10px;padding:14px 18px;margin-bottom:16px">
      <div style="color:var(--err);flex-shrink:0"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>
      <div style="flex:1">
        <div style="font-size:11px;font-weight:700;color:var(--err);text-transform:uppercase;letter-spacing:.5px">${dueRows.length} item${dueRows.length > 1 ? 's' : ''} currently due</div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-top:2px">PKR ${fM(totalDueNow)} due now</div>
      </div>
      <button class="btn btn-g btn-sm" onclick="_pymPickMethod(${firstDueIdx}, true)" style="white-space:nowrap">${btnLabel}</button>
    </div>`;
  } else {
    alertBanner = `<div style="display:flex;align-items:center;gap:12px;background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.2);border-radius:10px;padding:12px 16px;margin-bottom:16px">
      <div style="color:#3b82f6;flex-shrink:0"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg></div>
      <div>
        <div style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:.5px">No payment due today</div>
        <div style="font-size:12px;color:var(--t3);margin-top:2px">Use the Receive button on any installment below to record an early payment</div>
      </div>
    </div>`;
  }

  el.innerHTML = `
    <!-- Summary card -->
    <div class="card mb14">
      <div class="cb">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px">
          <div>
            <div style="font-size:16px;font-weight:700;color:var(--text)">${esc(u?.customerName || '—')}</div>
            <div style="font-size:12px;color:var(--t3);margin-top:3px">Unit ${esc(u?.unitNo || '—')}${u?.floorLabel ? ' · ' + esc(u.floorLabel) : ''}${u?.bookingNo ? ' · ' + esc(u.bookingNo) : ''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-gh btn-sm" onclick="_pymOpenCompare()" style="display:inline-flex;align-items:center;gap:5px" title="Compare original vs current schedule"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>Compare</button>
            <button class="btn btn-gh btn-sm" onclick="_pymPrintSchedule()" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button>
          </div>
          ${(S.role==='admin'||S.role==='owner')&&typeof openAuditHistory==='function'?`<button class="btn btn-gh btn-sm" style="flex-shrink:0;display:inline-flex;align-items:center;gap:5px" onclick="openAuditHistory('sales','${_pymCurrentSale?.sale?.sale_id||''}','Sale History')"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>History</button>`:''}

        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
          <div style="padding:12px 14px;border:1px solid var(--line);border-left:3px solid var(--brand);border-radius:var(--r);background:var(--surface)">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Total Sale</div>
            <div style="font-size:15px;font-weight:700;color:var(--text)">PKR ${fM(totalDue)}</div>
          </div>
          <div style="padding:12px 14px;border:1px solid var(--line);border-left:3px solid var(--ok);border-radius:var(--r);background:var(--surface)">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Collected</div>
            <div style="font-size:15px;font-weight:700;color:var(--ok)">PKR ${fM(totalPaid)}</div>
          </div>
          <div style="padding:12px 14px;border:1px solid var(--line);border-left:3px solid ${totalOut > 0 ? 'var(--err)' : 'var(--ok)'};border-radius:var(--r);background:var(--surface)">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Balance</div>
            <div style="font-size:15px;font-weight:700;color:${totalOut > 0 ? 'var(--err)' : 'var(--ok)'}">PKR ${fM(totalOut)}</div>
          </div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <span style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Payment Progress</span>
            <span style="font-size:11px;font-weight:700;color:${pct >= 100 ? 'var(--ok)' : 'var(--t2)'}">${pct}%</span>
          </div>
          <div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${pct >= 100 ? 'var(--ok)' : 'var(--brand)'};border-radius:3px;transition:width .4s ease"></div>
          </div>
        </div>
      </div>
    </div>

    ${alertBanner}

    <!-- Schedule table -->
    <div class="card mb14">
      <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Payment Schedule</h3></div>
      <div class="cb" style="padding:0">
        <div class="tw">
          <table class="t">
            <thead>
              <tr>
                <th style="width:36px">#</th>
                <th>Description</th>
                <th>Due Date</th>
                <th class="r">Amount Due</th>
                <th class="r">Paid</th>
                <th class="r">Balance</th>
                <th>Status</th>
                <th style="width:90px">Action</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
            <tfoot>
              <tr style="border-top:2px solid var(--line)">
                <td colspan="3" style="font-size:11px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.4px">Total</td>
                <td class="r mono" style="font-weight:700;font-size:13px">PKR ${fM(totalAmtDue)}</td>
                <td class="r mono" style="font-weight:700;font-size:13px;color:var(--ok)">PKR ${fM(totalPaid)}</td>
                <td class="r mono" style="font-weight:700;font-size:13px;color:${totalOut > 0 ? 'var(--err)' : 'var(--ok)'}">PKR ${fM(totalOut)}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>`;
}

// ── Receive dropdown handlers ─────────────────────────────────────
function _pymOnReceiveForChange(val) {
  const btn   = document.getElementById('pym-receive-btn');
  const valEl = document.getElementById('pym-outstanding-val');
  const hint  = document.getElementById('pym-cascade-hint');
  if (!val) {
    if (btn) btn.disabled = true;
    if (valEl) valEl.textContent = '—';
    if (hint) hint.style.display = 'none';
    return;
  }
  const row = _pymRows[parseInt(val)];
  if (!row) return;
  if (btn) btn.disabled = false;
  if (valEl) valEl.textContent = 'PKR ' + fM(row.outstanding);

  // Cascade hint: only for currently-due items, not for advance (upcoming) payments
  const todayStr = new Date().toISOString().split('T')[0];
  const rowIsDue = row.isDownPayment || !row.dueDate || row.dueDate <= todayStr;
  if (rowIsDue) {
    const allDue = _pymRows.filter(r => r.outstanding > 0 && (r.isDownPayment || !r.dueDate || r.dueDate <= todayStr));
    const startPos = allDue.findIndex(r => r === row);
    const queueFromHere = startPos >= 0 ? allDue.slice(startPos) : [row];
    const totalFromHere = queueFromHere.reduce((s, r) => s + r.outstanding, 0);
    if (hint) {
      if (queueFromHere.length > 1) {
        hint.style.display = 'block';
        hint.textContent = `Enter up to PKR ${fM(totalFromHere)} to auto-clear all ${queueFromHere.length} due items`;
      } else {
        hint.style.display = 'none';
      }
    }
  } else {
    if (hint) hint.style.display = 'none'; // advance payment — no cascade
  }
}

function _pymClickReceiveSelected() {
  const sel = document.getElementById('pym-receive-for');
  const idx = parseInt(sel?.value);
  if (isNaN(idx)) { toast('Please select an item first', 'warn'); return; }
  _pymClickReceiveIdx(idx);
}

function _pymToggleSchedule() {
  const wrap = document.getElementById('pym-schedule-wrap');
  if (!wrap) return;
  const shown = wrap.style.display !== 'none';
  wrap.style.display = shown ? 'none' : 'block';
  const viewBtn = document.querySelector('#pym-schedule-section .btn-gh');
  if (viewBtn && (viewBtn.textContent.includes('View Schedule') || viewBtn.textContent.includes('Hide Schedule'))) {
    viewBtn.textContent = shown ? 'View Schedule' : 'Hide Schedule';
  }
}

// ── PDC cheques section render ────────────────────────────────────
async function _pymRenderPDC(saleId) {
  const el      = document.getElementById('pym-pdc-section');
  const alertEl = document.getElementById('pym-pdc-alert');
  if (!el) return;
  el.style.display = 'none';
  if (alertEl) alertEl.innerHTML = '';
  if (!saleId) return;

  el.style.display = 'block';
  el.innerHTML = `<div class="card mt14"><div class="cb"><div class="empty"><div class="ei"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;opacity:.4"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/></svg></div><div class="et">Loading PDC cheques…</div></div></div></div>`;

  try {
    // RPC (not .from('pdc_cheques')) — pdc_cheques carries deny_all_anon RLS, direct reads return nothing.
    const { data: cheques, error } = await supabase.rpc('list_pdc_for_sale', {
      p_sale_id:    saleId,
      p_company_id: S.cid
    });
    if (error) throw error;

    const statusBadge = s => {
      const map = {
        pending:   ['#f59e0b', 'Pending'],
        presented: ['#3b82f6', 'Presented'],
        cleared:   ['#22c55e', '✓ Cleared'],
        bounced:   ['#ef4444', '✗ Bounced'],
        cancelled: ['#94a3b8', 'Cancelled'],
      };
      const [c, l] = map[s] || ['#94a3b8', s || '?'];
      return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${c}22;color:${c};border:1px solid ${c}44">${l}</span>`;
    };

    const todayStr = td();
    const allList  = cheques || [];
    const pending  = allList.filter(c => c.status === 'pending');
    const presented = allList.filter(c => c.status === 'presented');
    const cleared  = allList.filter(c => c.status === 'cleared');
    const bounced  = allList.filter(c => c.status === 'bounced');
    const dueToday = pending.filter(c => c.cheque_date === todayStr);
    const overdue  = pending.filter(c => c.cheque_date && c.cheque_date < todayStr);

    // ── Top alert banner (pym-pdc-alert, above schedule) ──────────
    if (alertEl) {
      if (dueToday.length > 0) {
        const totToday = dueToday.reduce((s, c) => s + Number(c.amount || 0), 0);
        alertEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:14px;background:rgba(239,68,68,.08);border:2px solid rgba(239,68,68,.4);border-radius:12px;padding:14px 18px;margin-bottom:14px;animation:pulse-border 1.5s ease infinite">
            <div style="color:var(--err);flex-shrink:0"><svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>
            <div style="flex:1">
              <div style="font-size:12px;font-weight:800;color:var(--err);text-transform:uppercase;letter-spacing:.5px">Post-Dated Cheque Due TODAY</div>
              <div style="font-size:14px;font-weight:700;color:var(--text);margin-top:3px">${dueToday.length} cheque${dueToday.length>1?'s':''} — PKR ${fM(totToday)} — Present to bank now</div>
              <div style="font-size:11px;color:var(--t3);margin-top:2px">${dueToday.map(c=>`Cheque #${esc(c.cheque_no||'—')} (${esc(c.bank_name||'?')})`).join(', ')}</div>
            </div>
            <button class="btn btn-xs" style="background:var(--err);color:#fff;border:none;flex-shrink:0;padding:8px 14px;font-weight:700" onclick="document.getElementById('pym-pdc-section').scrollIntoView({behavior:'smooth'})">View Cheques ↓</button>
          </div>`;
      } else if (overdue.length > 0) {
        const totOverdue = overdue.reduce((s, c) => s + Number(c.amount || 0), 0);
        alertEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:14px;background:rgba(249,115,22,.07);border:1.5px solid rgba(249,115,22,.35);border-radius:12px;padding:12px 18px;margin-bottom:14px">
            <div style="color:#f97316;flex-shrink:0"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
            <div style="flex:1">
              <div style="font-size:11px;font-weight:800;color:#f97316;text-transform:uppercase;letter-spacing:.5px">Overdue PDC — Past Cheque Date</div>
              <div style="font-size:13px;font-weight:700;color:var(--text);margin-top:2px">${overdue.length} cheque${overdue.length>1?'s':''} — PKR ${fM(totOverdue)} not yet cleared</div>
            </div>
            <button class="btn btn-xs btn-gh" style="border-color:#f97316;color:#f97316;flex-shrink:0" onclick="document.getElementById('pym-pdc-section').scrollIntoView({behavior:'smooth'})">View ↓</button>
          </div>`;
      } else if (pending.length > 0 || presented.length > 0) {
        const totPend = [...pending,...presented].reduce((s,c)=>s+Number(c.amount||0),0);
        alertEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;background:rgba(245,158,11,.07);border:1.5px solid rgba(245,158,11,.3);border-radius:10px;padding:10px 16px;margin-bottom:14px">
            <div style="color:#f59e0b;flex-shrink:0"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h4"/><path d="M14 8h4"/><path d="M6 12h12"/><path d="M6 16h4"/></svg></div>
            <div style="flex:1;font-size:12px;color:var(--t2)">
              <b style="color:#f59e0b">${pending.length+presented.length} PDC cheque${pending.length+presented.length>1?'s':''}</b> totalling <b>PKR ${fM(totPend)}</b> received but <b style="color:#f59e0b">not yet cleared</b>
            </div>
            <button class="btn btn-xs btn-gh" onclick="document.getElementById('pym-pdc-section').scrollIntoView({behavior:'smooth'})">PDC ↓</button>
          </div>`;
      }
    }

    const bounceLabels = {insufficient_funds:'Insufficient Funds',signature_mismatch:'Signature Mismatch',account_closed:'Account Closed',payment_stopped:'Payment Stopped',stale_cheque:'Stale / Expired',other:'Other'};

    let rows = '';
    if (!allList.length) {
      rows = `<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:20px;font-size:12px">No PDC cheques recorded. Use the + Add PDC button above to add one.</td></tr>`;
    } else {
      rows = allList.map(c => {
        const isSettled = c.status === 'cleared' || c.status === 'cancelled';
        const isToday   = c.cheque_date === todayStr;
        const isOverdue = c.status === 'pending' && c.cheque_date && c.cheque_date < todayStr;
        const rowBg     = isToday && c.status === 'pending' ? 'background:rgba(239,68,68,.04)'
                        : isOverdue ? 'background:rgba(249,115,22,.04)' : '';
        const actions = `
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            ${c.status === 'pending'
              ? `<button class="btn btn-gh btn-xs" onclick="updatePDCStatus('${c.id}','presented')">Deposited</button>
                 <button class="btn btn-xs" style="background:var(--ok);color:#fff;border:none" onclick="updatePDCStatus('${c.id}','cleared')" title="Mark Cleared">Clear</button>`
              : ''}
            ${c.status === 'presented'
              ? `<button class="btn btn-xs" style="background:var(--ok);color:#fff;border:none" onclick="updatePDCStatus('${c.id}','cleared')">Clear</button>
                 <button class="btn btn-gh btn-xs" style="color:var(--err);border-color:var(--err)" onclick="openBounceModal('${c.id}','${esc(c.cheque_no||'')}',${c.amount||0})">Bounce</button>`
              : ''}
            <button class="btn btn-gh btn-xs" onclick="openPDCModal('${c.id}','${c.sale_id}')" title="Edit"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>
            ${!isSettled ? `<button class="btn btn-gh btn-xs" style="color:var(--err)" onclick="deletePDCConfirm('${c.id}')" title="Delete"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>` : ''}
          </div>`;
        const bounceCell = c.status === 'bounced'
          ? `<div style="font-size:11px;color:var(--err);font-weight:600">${bounceLabels[c.bounce_reason] || c.bounce_reason || '—'}</div>${c.penalty_amount ? `<div style="font-size:10px;color:var(--t3)">Penalty: PKR ${fM(c.penalty_amount)}</div>` : ''}`
          : `<span style="font-size:11px;color:var(--t3)">${c.notes ? esc(c.notes) : '—'}</span>`;
        return `<tr${rowBg ? ` style="${rowBg}"` : ''}>
          <td>
            <div style="font-family:monospace;font-weight:700">${esc(c.cheque_no || '—')}</div>
            ${isToday && c.status==='pending' ? `<div style="font-size:9px;font-weight:800;color:var(--err);text-transform:uppercase;margin-top:1px">Due Today!</div>` : ''}
            ${isOverdue ? `<div style="font-size:9px;font-weight:800;color:#f97316;text-transform:uppercase;margin-top:1px">Overdue</div>` : ''}
          </td>
          <td style="font-size:11px">${esc(c.bank_name || '—')}</td>
          <td class="r mono" style="font-weight:700">PKR ${fM(c.amount || 0)}</td>
          <td style="font-size:11px;color:${isToday&&c.status==='pending'?'var(--err)':'var(--t2)'}">${c.cheque_date ? fD(c.cheque_date) : '—'}</td>
          <td>${statusBadge(c.status)}</td>
          <td style="max-width:140px">${bounceCell}</td>
          <td>${actions}</td>
        </tr>`;
      }).join('');
    }

    const totAmt      = allList.reduce((s, c) => s + Number(c.amount || 0), 0);
    const totPending  = pending.reduce((s, c) => s + Number(c.amount || 0), 0);
    const totCleared  = cleared.reduce((s, c) => s + Number(c.amount || 0), 0);

    // Status pill summary
    const statusPills = ['pending','presented','cleared','bounced','cancelled'].map(st => {
      const cnt = allList.filter(c => c.status === st).length;
      if (!cnt) return '';
      const colors = {pending:'#f59e0b',presented:'#3b82f6',cleared:'#22c55e',bounced:'#ef4444',cancelled:'#94a3b8'};
      const col = colors[st] || '#94a3b8';
      const lbl = {pending:'Pending',presented:'Presented',cleared:'Cleared',bounced:'Bounced',cancelled:'Cancelled'}[st] || st;
      return `<div style="display:flex;align-items:center;gap:5px;background:${col}14;border:1px solid ${col}33;border-radius:6px;padding:5px 11px">
        <span style="font-size:14px;font-weight:700;color:${col}">${cnt}</span>
        <span style="font-size:10px;color:${col};font-weight:600">${lbl}</span>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="card mt14">
        <div class="ch" style="align-items:flex-start;gap:10px">
          <div>
            <h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h4"/><path d="M14 8h4"/><path d="M6 12h12"/><path d="M6 16h4"/></svg>PDC / Post-Dated Cheques</h3>
            ${totPending > 0 ? `<div style="font-size:11px;color:#f59e0b;font-weight:600;margin-top:2px">PKR ${fM(totPending)} pending clearance</div>` : ''}
          </div>
          <button class="btn btn-g btn-sm" onclick="openPDCModal('','${saleId}')">+ Add PDC</button>
        </div>
        <div class="cb">
          ${allList.length > 0 ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
            ${statusPills}
            <div style="display:flex;align-items:center;gap:5px;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:5px 11px;margin-left:auto">
              <span style="font-size:10px;color:var(--t3)">Total</span>
              <span style="font-size:13px;font-weight:700">PKR ${fM(totAmt)}</span>
            </div>
          </div>` : ''}
          <div class="tw">
            <table class="t">
              <thead>
                <tr>
                  <th>Cheque No</th><th>Bank</th><th class="r">Amount</th>
                  <th>Cheque Date</th><th>Status</th><th>Notes</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
              ${allList.length > 0 ? `<tfoot>
                <tr style="border-top:2px solid var(--line)">
                  <td colspan="2" style="font-size:11px;font-weight:700;color:var(--t2)">Summary</td>
                  <td class="r mono" style="font-weight:700;font-size:12px">PKR ${fM(totAmt)}</td>
                  <td colspan="4" style="font-size:11px;color:var(--t3)">
                    ${totPending>0?`<span style="color:#f59e0b;font-weight:600">PKR ${fM(totPending)} pending</span>`:''}
                    ${totPending>0&&totCleared>0?' · ':''}
                    ${totCleared>0?`<span style="color:var(--ok);font-weight:600">PKR ${fM(totCleared)} cleared</span>`:''}
                  </td>
                </tr>
              </tfoot>` : ''}
            </table>
          </div>
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="card mt14"><div class="cb"><div style="color:var(--err);font-size:12px">Failed to load PDC records: ${esc(e.message)}</div></div></div>`;
    const alertEl2 = document.getElementById('pym-pdc-alert');
    if (alertEl2) alertEl2.innerHTML = '';
  }
}

// ── Print schedule statement ──────────────────────────────────────
function _pymPrintSchedule() {
  if (!_pymCurrentSale) { toast('Select a unit first', 'warn'); return; }
  printPaymentStatement(_pymCurrentSale);
}

// ── Badge helpers ─────────────────────────────────────────────────
function _pymStatusBadge(s) {
  const map = {
    pending: ['#f59e0b', 'Pending'],
    paid:    ['#22c55e', 'Paid'],
    partial: ['#38bdf8', 'Partial'],
    overdue: ['#ef4444', 'Overdue'],
  };
  const [color, label] = map[s] || ['#94a3b8', s || '?'];
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${color}22;color:${color};border:1px solid ${color}44">${label}</span>`;
}

function _pymTypeBadge(t) {
  const map = {
    down_payment: ['#c9a84c', 'Down Pmt'],
    installment:  ['#94a3b8', 'Installment'],
    possession:   ['#22c55e', 'Possession'],
    custom:       ['#38bdf8', 'Custom'],
  };
  const [color, label] = map[t] || ['#94a3b8', t || '?'];
  return `<span style="font-size:10px;font-weight:600;padding:1px 7px;border-radius:12px;background:${color}18;color:${color}">${label}</span>`;
}

function _pymStepWizard(step) {
  const steps = [['1','Project'],['2','Client'],['3','Payment']];
  const items = steps.map(([n, label], i) => {
    const s      = i + 1;
    const done   = step > s;
    const active = step === s;
    const circ   = done   ? 'background:rgba(99,102,241,.15);color:var(--brand)'
                 : active ? 'background:var(--brand);color:#fff'
                 :          'background:var(--hover);color:var(--t3)';
    const lc     = (active || done) ? 'var(--brand)' : 'var(--t3)';
    const fw     = active ? '700' : '500';
    const divider = i < 2 ? `<div style="flex:1;height:1.5px;background:${done ? 'rgba(99,102,241,.45)' : 'var(--line)'};margin:0 10px;min-width:18px"></div>` : '';
    return `<div style="display:flex;align-items:center;gap:6px;color:${lc}">
      <div style="width:22px;height:22px;border-radius:50%;${circ};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${done ? '✓' : n}</div>
      <span style="font-size:11px;font-weight:${fw};white-space:nowrap">${label}</span>
    </div>${divider}`;
  }).join('');
  return `<div style="display:flex;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 14px;margin-bottom:18px">${items}</div>`;
}

// ══ METHOD SELECTOR ══════════════════════════════════════════════

// Entry point — replaces direct _pymClickReceiveIdx calls from buttons
// Shows method selector if multiple outstanding exist, else goes directly
function _pymPickMethod(idx, fromBanner) {
  const row = _pymRows[idx];
  if (!row) return;
  if (row.outstanding <= 0) { toast('This installment is already fully paid', 'warn'); return; }

  const outRows = _pymRows.filter(r => r.outstanding > 0);

  // Only 1 outstanding → skip selector, go straight to receive modal
  if (outRows.length === 1) {
    _pymClickReceiveIdx(idx, false);
    return;
  }

  _pymPickedIdx  = idx;
  _pymPickBanner = !!fromBanner;

  const todayStr  = new Date().toISOString().split('T')[0];
  const isDue     = r => r.outstanding > 0 && (r.isDownPayment || !r.dueDate || r.dueDate <= todayStr);
  const dueRows   = _pymRows.filter(isDue);
  const totalDueNow = dueRows.reduce((s, r) => s + r.outstanding, 0);
  const totalOut    = outRows.reduce((s, r) => s + r.outstanding, 0);
  const u = (window._unitsCache || []).find(x => x.id === _pymCurrentUnitId);

  // Recommend Auto-Clear when multiple overdue items exist (especially from banner)
  const recAuto = dueRows.length >= 2 || (fromBanner && dueRows.length >= 1);

  const body = document.getElementById('m-method-select-body');
  if (!body) return;

  body.innerHTML = `
    <div style="padding:11px 14px;background:var(--surface);border:1px solid var(--line);border-radius:10px;margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px">${esc(u?.customerName || '—')}</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap">
        ${dueRows.length > 0
          ? `<div style="font-size:11px;color:var(--err);font-weight:600;display:flex;align-items:center;gap:4px"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg> ${dueRows.length} installment${dueRows.length>1?'s':''} overdue &mdash; PKR ${fM(totalDueNow)}</div>`
          : ''}
        <div style="font-size:11px;color:var(--t3)">Total outstanding: <b style="color:var(--t2)">PKR ${fM(totalOut)}</b></div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div id="ms-card-auto" onclick="_pymSelectMethod('auto')"
        style="cursor:pointer;padding:18px 16px;border:2px solid var(--line);border-radius:12px;background:var(--surface);transition:border-color .15s,background .15s;position:relative"
        onmouseenter="this.style.borderColor='#f97316';this.style.background='rgba(249,115,22,.06)'"
        onmouseleave="this.style.borderColor='var(--line)';this.style.background='var(--surface)'">
        ${recAuto ? `<div style="position:absolute;top:10px;right:10px;font-size:9px;font-weight:700;background:#f97316;color:#fff;padding:2px 8px;border-radius:20px;text-transform:uppercase;letter-spacing:.3px">Recommended</div>` : ''}
        <div style="margin-bottom:10px;color:#f97316"><svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:5px">Auto-Clear</div>
        <div style="font-size:11px;color:var(--t3);line-height:1.55">Entered amount fills oldest outstanding installment first, then the next, and so on — automatically.</div>
        ${dueRows.length > 0 ? `<div style="margin-top:10px;font-size:11px;font-weight:700;color:#f97316">Targets ${dueRows.length} overdue item${dueRows.length>1?'s':''}</div>` : ''}
      </div>

      <div id="ms-card-custom" onclick="_pymSelectMethod('custom')"
        style="cursor:pointer;padding:18px 16px;border:2px solid var(--line);border-radius:12px;background:var(--surface);transition:border-color .15s,background .15s"
        onmouseenter="this.style.borderColor='var(--brand)';this.style.background='rgba(99,102,241,.06)'"
        onmouseleave="this.style.borderColor='var(--line)';this.style.background='var(--surface)'">
        <div style="margin-bottom:10px;color:var(--brand)"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:5px">Custom Allocation</div>
        <div style="font-size:11px;color:var(--t3);line-height:1.55">You decide which installments to clear and exactly how much to apply to each one.</div>
        <div style="margin-top:10px;font-size:11px;font-weight:700;color:var(--brand)">${outRows.length} installment${outRows.length>1?'s':''} available</div>
      </div>
    </div>`;

  om('m-method-select');
}

function _pymSelectMethod(method) {
  cm('m-method-select');
  if (method === 'auto') {
    // Route to existing cascade / single flow
    const todayStr = new Date().toISOString().split('T')[0];
    const isDue    = r => r.outstanding > 0 && (r.isDownPayment || !r.dueDate || r.dueDate <= todayStr);
    const dueRows  = _pymRows.filter(isDue);
    if (dueRows.length > 0) {
      // Full cascade from oldest
      const firstDueIdx = _pymRows.indexOf(dueRows[0]);
      _pymClickReceiveIdx(firstDueIdx, true);
    } else {
      // No due items — single installment from picked row
      _pymClickReceiveIdx(_pymPickedIdx, false);
    }
  } else {
    _pymOpenCustomAlloc();
  }
}

// ══ CUSTOM ALLOCATION ═════════════════════════════════════════════

function _pymOpenCustomAlloc() {
  _pymCustAllocs = {};
  _pymCustTotal  = 0;

  const outRows = _pymRows.filter(r => r.outstanding > 0);
  const u = (window._unitsCache || []).find(x => x.id === _pymCurrentUnitId);

  // Pre-select picked row with its full outstanding if from single row click
  if (!_pymPickBanner && _pymPickedIdx >= 0 && _pymRows[_pymPickedIdx]) {
    const pr = _pymRows[_pymPickedIdx];
    if (pr.outstanding > 0) _pymCustAllocs[pr.installmentId] = pr.outstanding;
  }

  _pymRenderCustomAlloc(outRows, u);
  om('m-custom-alloc');
}

function _pymRenderCustomAlloc(outRows, u) {
  const body = document.getElementById('m-custom-alloc-body');
  if (!body) return;
  const todayStr = new Date().toISOString().split('T')[0];

  const tableRows = outRows.map((r, i) => {
    const isOverdue  = r.dueDate && r.dueDate < todayStr && !r.isDownPayment;
    const overDays   = isOverdue ? Math.floor((new Date(todayStr) - new Date(r.dueDate)) / 86400000) : 0;
    const checked    = !!_pymCustAllocs[r.installmentId];
    const initAmt    = checked ? _pymCustAllocs[r.installmentId] : '';
    const rowIdPfx   = 'ca-row-' + i;
    return `
    <div id="${rowIdPfx}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line);background:${checked ? 'rgba(99,102,241,.05)' : 'transparent'}">
      <input type="checkbox" id="${rowIdPfx}-chk" ${checked ? 'checked' : ''}
        style="width:16px;height:16px;cursor:pointer;accent-color:var(--brand);flex-shrink:0"
        onchange="_pymCustToggleRow(${i},'${r.installmentId}',${r.outstanding})">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.label)}</div>
        <div style="font-size:10px;color:${isOverdue ? 'var(--err)' : 'var(--t3)'};margin-top:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span>${r.dueDate ? fD(r.dueDate) : '—'}</span>
          ${isOverdue ? `<span style="background:rgba(239,68,68,.1);color:var(--err);font-weight:700;padding:1px 5px;border-radius:4px;font-size:9px">${overDays}d overdue</span>` : ''}
          <span style="color:var(--t3)">· <b style="color:var(--t2)">PKR ${fM(r.outstanding)}</b></span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:5px;flex-shrink:0">
        <span style="font-size:11px;color:var(--t3)">PKR</span>
        <input id="${rowIdPfx}-amt" type="number" min="0" max="${r.outstanding}" step="1"
          value="${initAmt}" placeholder="0"
          ${checked ? '' : 'disabled'}
          style="width:108px;padding:6px 8px;border:1px solid ${checked ? 'var(--brand)' : 'var(--line)'};border-radius:7px;font-size:13px;font-weight:700;text-align:right;background:var(--surface);color:var(--text);${checked ? '' : 'opacity:.4'}"
          oninput="_pymCustAmtChange(${i},'${r.installmentId}',${r.outstanding},this.value)">
      </div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <!-- Received amount + date + method -->
    <div style="background:rgba(16,185,129,.04);border:1px solid rgba(16,185,129,.18);border-radius:10px;padding:14px;margin-bottom:12px">
      <div style="font-size:10px;font-weight:800;color:#10b981;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px;display:flex;align-items:center;gap:5px"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>Payment Details</div>
      <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:10px;margin-bottom:12px">
        <div>
          <div style="font-size:10px;color:var(--t3);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Amount Received (PKR) *</div>
          <input id="ca-total" class="inp-amt" type="text" inputmode="numeric" value="${_pymCustTotal ? fM(_pymCustTotal) : ''}"
            placeholder="0"
            style="width:100%;padding:9px 10px;border:1.5px solid var(--brand);border-radius:8px;font-size:15px;font-weight:700;background:var(--surface);color:var(--ok);text-align:right;box-sizing:border-box"
            oninput="_pymCustTotalChange(this.value)">
        </div>
        <div>
          <div style="font-size:10px;color:var(--t3);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Payment Date *</div>
          <input id="ca-date" type="date" value="${td()}"
            style="width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);box-sizing:border-box">
        </div>
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:10px;color:var(--t3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px">Payment Method *</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
          <button id="ca-m-cash" onclick="_pymCustSetMethod('cash')"
            style="padding:8px 4px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;border:2px solid var(--brand);background:rgba(99,102,241,.12);color:var(--brand);display:flex;flex-direction:column;align-items:center;gap:5px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>Cash</button>
          <button id="ca-m-bank" onclick="_pymCustSetMethod('bank')"
            style="padding:8px 4px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;border:2px solid var(--line);background:var(--surface);color:var(--t2);display:flex;flex-direction:column;align-items:center;gap:5px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 22h18M3 10h18M5 6l7-4 7 4M4 10v12M20 10v12M8 14v4M12 14v4M16 14v4"/></svg>Bank</button>
          <button id="ca-m-cheque" onclick="_pymCustSetMethod('cheque_pdc')"
            style="padding:8px 4px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;border:2px solid var(--line);background:var(--surface);color:var(--t2);display:flex;flex-direction:column;align-items:center;gap:5px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h4"/><path d="M14 8h4"/><path d="M6 12h12"/><path d="M6 16h4"/></svg>Cheque</button>
          <button id="ca-m-adj" onclick="_pymCustSetMethod('adjustment')"
            style="padding:8px 4px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;border:2px solid var(--line);background:var(--surface);color:var(--t2);display:flex;flex-direction:column;align-items:center;gap:5px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>Adj</button>
        </div>
      </div>
      <div id="ca-bank-row" style="display:none;margin-bottom:8px">
        <select id="ca-bank-id" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);margin-bottom:6px" onchange="_pymCustBankSelect(this.value)">
          <option value="">— Select bank account —</option>
        </select>
        <div id="ca-no-bank-note" style="display:none;margin-bottom:6px;padding:8px 12px;background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.3);border-radius:8px;align-items:center;justify-content:space-between;gap:10px">
          <span style="font-size:11px;color:#f97316;font-weight:600">No bank accounts set up</span>
          <button type="button" class="btn btn-gh btn-xs" style="border-color:#f97316;color:#f97316;flex-shrink:0" onclick="cm('m-custom-alloc');nav('projects')">→ Add Bank</button>
        </div>
        <input id="ca-refno" type="text" placeholder="Reference / transaction no." style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-size:12px;background:var(--surface);color:var(--text)">
      </div>
      <div id="ca-cheque-row" style="display:none;margin-bottom:8px;background:rgba(245,158,11,.04);border:1px solid rgba(245,158,11,.3);border-radius:8px;padding:10px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div>
            <div style="font-size:10px;color:var(--t3);margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px">Cheque Number *</div>
            <input id="ca-cheque-no" type="text" placeholder="e.g. 001234" style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-size:12px;font-family:monospace;font-weight:700;background:var(--surface);color:var(--text);box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:10px;color:var(--t3);margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px">Cheque Date *</div>
            <input id="ca-cheque-date-vis" type="date" style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-size:12px;background:var(--surface);color:var(--text);box-sizing:border-box" onchange="_pymCaChequeDate(this.value)">
            <input id="ca-cheque-date" type="hidden">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <input id="ca-cheque-bank" type="text" placeholder="Client's bank (e.g. HBL)" style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-size:12px;background:var(--surface);color:var(--text);box-sizing:border-box">
          <input id="ca-cheque-drawer" type="text" placeholder="Drawer name (optional)" style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-size:12px;background:var(--surface);color:var(--text);box-sizing:border-box">
        </div>
        <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--hover);border:1px solid var(--line);border-radius:7px;cursor:pointer">
          <input type="checkbox" id="ca-is-pdc" style="width:15px;height:15px;accent-color:#f59e0b" onchange="_pymCaTogglePDC(this.checked)">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--text)">Post-Dated Cheque (PDC)</div>
            <div style="font-size:10px;color:var(--t3)">Cheque date is in the future — auto-registers in PDC ledger</div>
          </div>
        </label>
        <div id="ca-pdc-info" style="display:none;margin-top:6px;padding:8px 10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);border-radius:7px;font-size:11px;color:#92400e">
          This cheque will be auto-registered as Pending in the PDC ledger. Update status once it clears.
        </div>
      </div>
      <input id="ca-method" type="hidden" value="cash">
      <input id="ca-notes" type="text" placeholder="Notes (optional)" style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-size:12px;background:var(--surface);color:var(--text)">
    </div>

    <!-- Allocation table -->
    <div style="background:var(--surface);border:1px solid var(--line);border-radius:10px;margin-bottom:10px;overflow:hidden">
      <div style="padding:10px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:11px;font-weight:800;color:var(--text);text-transform:uppercase;letter-spacing:.4px;display:flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>Allocate to Installments</div>
        <div style="font-size:11px;color:var(--t3)">${outRows.length} outstanding</div>
      </div>
      <div id="ca-table">${tableRows}</div>
    </div>

    <!-- Progress bar + preview -->
    <div id="ca-progress-wrap" style="margin-bottom:6px"></div>
  `;

  // Load banks async
  _pymLoadBanks().then(banks => {
    const sel = document.getElementById('ca-bank-id');
    if (!sel) return;
    sel.innerHTML = `<option value="">— Select bank account —</option>` +
      banks.map(b => `<option value="${esc(b.id)}">${esc(b.bank_name)} — ${esc(b.account_title)}</option>`).join('');
    if (banks.length === 1) { sel.value = banks[0].id; _pymCustBankSelect(banks[0].id); }
    const noBankNote = document.getElementById('ca-no-bank-note');
    if (noBankNote) noBankNote.style.display = banks.length === 0 ? 'flex' : 'none';
  });

  _pymUpdateCustProgress();
}

function _pymCustSetMethod(method) {
  const keyMap = { cash: 'cash', bank: 'bank', cheque: 'cheque_pdc', adj: 'adjustment' };
  ['cash', 'bank', 'cheque', 'adj'].forEach(k => {
    const btn = document.getElementById('ca-m-' + k);
    if (!btn) return;
    const isActive = keyMap[k] === method;
    btn.style.border     = isActive ? '2px solid var(--brand)' : '2px solid var(--line)';
    btn.style.background = isActive ? 'rgba(99,102,241,.12)' : 'var(--surface)';
    btn.style.color      = isActive ? 'var(--brand)' : 'var(--t2)';
  });
  const m = document.getElementById('ca-method'); if (m) m.value = method;
  const bankRow   = document.getElementById('ca-bank-row');
  const chequeRow = document.getElementById('ca-cheque-row');
  if (bankRow)   bankRow.style.display   = method === 'bank'       ? '' : 'none';
  if (chequeRow) chequeRow.style.display = method === 'cheque_pdc' ? '' : 'none';
}

function _pymCaChequeDate(val) {
  const hidden = document.getElementById('ca-cheque-date');
  if (hidden) hidden.value = val || '';
  if (!val) return;
  const isPDC = val > td();
  const pdcChk = document.getElementById('ca-is-pdc');
  if (pdcChk) { pdcChk.checked = isPDC; _pymCaTogglePDC(isPDC); }
}

function _pymCaTogglePDC(checked) {
  const info = document.getElementById('ca-pdc-info');
  if (info) info.style.display = checked ? '' : 'none';
}

function _pymCustBankSelect(bankId) {
  const banks = _pymBanks || [];
  const bank  = banks.find(b => b.id === bankId);
  // store bank name for later use in save
  if (document.getElementById('ca-bank-id'))
    document.getElementById('ca-bank-id').dataset.bankName = bank ? bank.bank_name : '';
}

function _pymCustTotalChange(val) {
  _pymCustTotal = parseAmt(String(val).replace(/,/g, '')) || 0;

  // If exactly one installment is checked, auto-match its amount to received
  const activeEntries = Object.entries(_pymCustAllocs).filter(([, v]) => v > 0);
  if (activeEntries.length === 1 && _pymCustTotal > 0) {
    const [instId] = activeEntries[0];
    const row = _pymRows.find(r => r.installmentId === instId);
    const maxOut = row ? row.outstanding : _pymCustTotal;
    const newAmt = Math.min(_pymCustTotal, maxOut);
    _pymCustAllocs[instId] = newAmt;
    const inp = document.querySelector('[id^="ca-row-"][id$="-amt"]:not([disabled])');
    if (inp) inp.value = newAmt;
  }

  _pymUpdateCustProgress();
}

function _pymCustToggleRow(rowIdx, installmentId, maxOut) {
  const chk    = document.getElementById('ca-row-' + rowIdx + '-chk');
  const amtInp = document.getElementById('ca-row-' + rowIdx + '-amt');
  const rowDiv = document.getElementById('ca-row-' + rowIdx);
  if (!chk || !amtInp) return;
  const checked = chk.checked;
  if (checked) {
    _pymCustAllocs[installmentId] = maxOut;
    amtInp.value   = maxOut;
    amtInp.disabled = false;
    amtInp.style.opacity = '1';
  } else {
    delete _pymCustAllocs[installmentId];
    amtInp.value   = '';
    amtInp.disabled = true;
    amtInp.style.opacity = '.4';
  }
  if (rowDiv) rowDiv.style.background = checked ? 'rgba(99,102,241,.04)' : '';
  _pymUpdateCustProgress();
}

function _pymCustAmtChange(rowIdx, installmentId, maxOut, val) {
  let amt = parseAmt(val) || 0;
  if (amt > maxOut) { amt = maxOut; document.getElementById('ca-row-' + rowIdx + '-amt').value = maxOut; }
  if (amt <= 0) { delete _pymCustAllocs[installmentId]; }
  else { _pymCustAllocs[installmentId] = amt; }
  _pymUpdateCustProgress();
}

function _pymUpdateCustProgress() {
  const totalAlloc = Object.values(_pymCustAllocs).reduce((s, v) => s + v, 0);
  const totalRecvd = _pymCustTotal;
  const pct        = totalRecvd > 0 ? Math.min(100, Math.round(totalAlloc / totalRecvd * 100)) : 0;
  const unalloc    = Math.max(0, totalRecvd - totalAlloc);
  const over       = totalAlloc > totalRecvd + 0.01;

  const wrap = document.getElementById('ca-progress-wrap');
  if (!wrap) return;

  // Live preview rows
  const outRows = _pymRows.filter(r => r.outstanding > 0);
  let remaining = totalRecvd;
  const previewLines = outRows.filter(r => _pymCustAllocs[r.installmentId] > 0).map(r => {
    const alloc = _pymCustAllocs[r.installmentId] || 0;
    const willClear = alloc >= r.outstanding - 0.005;
    remaining -= alloc;
    return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;padding:5px 0;border-bottom:1px solid var(--line)">
      <span style="color:${willClear ? 'var(--ok)' : 'var(--brand)'}">${willClear ? `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>` : `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`}</span>
      <span style="flex:1;color:var(--t2);font-weight:600">${esc(r.label)}</span>
      <span style="font-weight:700;color:${willClear ? 'var(--ok)' : 'var(--brand)'}">PKR ${fM(alloc)}</span>
      <span style="color:var(--t3)">${willClear ? 'CLEARED' : `${fM(r.outstanding - alloc)} remaining`}</span>
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <div style="background:var(--surface);border:1px solid ${over ? 'var(--err)' : 'var(--line)'};border-radius:10px;padding:12px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:11px;font-weight:700;color:var(--t2)">Allocation Progress</span>
        <span style="font-size:11px;font-weight:700;color:${over ? 'var(--err)' : pct >= 100 ? 'var(--ok)' : 'var(--brand)'}">
          PKR ${fM(totalAlloc)} / PKR ${fM(totalRecvd)}
        </span>
      </div>
      <div style="height:8px;background:var(--line);border-radius:4px;overflow:hidden;margin-bottom:8px">
        <div style="height:100%;width:${pct}%;background:${over ? 'var(--err)' : pct >= 100 ? 'var(--ok)' : 'var(--brand)'};border-radius:4px;transition:width .2s ease"></div>
      </div>
      <div style="display:flex;gap:16px;font-size:11px;margin-bottom:${previewLines ? '10px' : '0'}">
        <span style="color:var(--t3)">Received: <b style="color:var(--text)">PKR ${fM(totalRecvd)}</b></span>
        <span style="color:var(--t3)">Allocated: <b style="color:${over ? 'var(--err)' : 'var(--brand)'}">PKR ${fM(totalAlloc)}</b></span>
        ${unalloc > 0.005 && !over ? `<span style="color:var(--t3)">Unallocated: <b style="color:var(--warn)">PKR ${fM(unalloc)}</b></span>` : ''}
        ${over ? `<span style="font-weight:700;color:var(--err)">Exceeds received amount</span>` : ''}
      </div>
      ${previewLines ? `
      <div style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px">
        <div style="font-size:10px;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Preview</div>
        ${previewLines}
      </div>` : ''}
    </div>`;
}

async function _pymSaveCustomAlloc() {
  const errEl = document.getElementById('ca-err');
  if (errEl) errEl.textContent = '';

  const totalRecvd   = _pymCustTotal;
  const totalAlloc   = Object.values(_pymCustAllocs).reduce((s, v) => s + v, 0);
  const pdate        = document.getElementById('ca-date')?.value;
  const method       = document.getElementById('ca-method')?.value || 'cash';
  const bankId       = document.getElementById('ca-bank-id')?.value || null;
  const bankName     = document.getElementById('ca-bank-id')?.dataset?.bankName || '';
  const refno        = document.getElementById('ca-refno')?.value?.trim() || '';
  const notes        = document.getElementById('ca-notes')?.value?.trim() || '';
  const isCheque     = method === 'cheque_pdc';
  const chequeNo     = document.getElementById('ca-cheque-no')?.value?.trim()     || '';
  const chequeDate   = document.getElementById('ca-cheque-date')?.value || document.getElementById('ca-cheque-date-vis')?.value || null;
  const chequeBank   = document.getElementById('ca-cheque-bank')?.value?.trim()   || '';
  const chequeDrawer = document.getElementById('ca-cheque-drawer')?.value?.trim() || '';
  const isPDC        = document.getElementById('ca-is-pdc')?.checked || false;
  const rpcMethod    = isCheque ? 'cheque' : method === 'bank' ? 'bank_transfer' : method;

  if (!totalRecvd || totalRecvd <= 0) {
    notify.error('Enter the total amount received.'); return;
  }
  if (totalAlloc <= 0) {
    notify.error('Select at least one installment and enter an amount.'); return;
  }
  if (totalAlloc > totalRecvd + 0.01) {
    notify.error(`Allocated (PKR ${fM(totalAlloc)}) exceeds received (PKR ${fM(totalRecvd)}).`); return;
  }
  if (totalAlloc < totalRecvd - 0.01) {
    notify.error(`Allocated (PKR ${fM(totalAlloc)}) is less than received (PKR ${fM(totalRecvd)}). Please distribute the full amount.`); return;
  }
  if (!pdate) {
    notify.error('Payment date is required.'); return;
  }
  if (method === 'bank' && !bankId) {
    notify.error('Select a bank account.'); return;
  }
  if (isCheque) {
    if (!chequeNo)   { notify.error('Cheque number is required.'); return; }
    if (!chequeDate) { notify.error('Cheque date is required.'); return; }
  }

  const allocEntries = Object.entries(_pymCustAllocs).filter(([, v]) => v > 0);
  if (allocEntries.length === 0) {
    notify.error('No amounts allocated.'); return;
  }

  const btn = document.getElementById('ca-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    let isFirst = true;
    const clearedItems = [];

    for (const [installmentId, amount] of allocEntries) {
      const row = _pymRows.find(r => r.installmentId === installmentId);
      if (!row) continue;

      const { data: pData, error: pErr } = await supabase.rpc('record_payment', {
        p_company_id:       S.cid,
        p_sale_id:          _pymCurrentSale.sale.sale_id,
        p_installment_id:   installmentId,
        p_is_down_payment:  row.isDownPayment,
        p_amount:           amount,
        p_payment_method:   rpcMethod,
        p_payment_date:     pdate,
        p_reference_no:     refno      || null,
        p_bank_name:        bankName   || null,
        p_notes:            notes      || null,
        p_created_by:       S.userId,
        p_proof_url:        null,
        p_payment_category: 'regular',
        p_penalty_amount:   0,
        p_tax_amount:       0,
        p_tax_type:         null,
        p_cheque_date:      chequeDate || null,
        p_bank_id:          bankId     || null,
        p_adjustment_note:  null,
        p_adjustment_type:  null
      });
      if (pErr) throw pErr;
      if (!pData || !pData.success) throw new Error(pData?.error || 'Payment failed');
      clearedItems.push({ row, amount, data: pData });
      isFirst = false;
    }

    // Auto-create PDC entry when post-dated cheque is received
    if (isCheque && isPDC && _pymCurrentSale?.sale?.sale_id) {
      const pdcNotes = [chequeDrawer ? `Drawer: ${chequeDrawer}` : '', notes || ''].filter(Boolean).join(' | ') || null;
      await supabase.rpc('create_pdc_cheque', {
        p_company_id: S.cid,
        p_data: {
          sale_id:       _pymCurrentSale.sale.sale_id,
          client_id:     _pymCurrentSale.sale.client_id || null,
          cheque_no:     chequeNo,
          bank_name:     chequeBank || null,
          amount:        totalAlloc,
          cheque_date:   chequeDate,
          received_date: pdate,
          status:        'pending',
          notes:         pdcNotes,
          created_by:    S.name || S.userId || 'system'
        }
      });
    }

    cm('m-custom-alloc');
    toast(`PKR ${fM(totalAlloc)} received — ${clearedItems.length} installment${clearedItems.length>1?'s':''} updated`, 'ok');

    // Print receipt for first cleared item
    if (clearedItems.length > 0) {
      const sale = _pymCurrentSale.sale;
      const receiptOpts = {
        paymentCode:      clearedItems[0].data.payment_code || '',
        amount:           totalAlloc,
        paymentMethod:    method,
        paymentDate:      pdate,
        referenceNo:      refno   || '',
        bankName:         bankName|| '',
        notes:            notes   || '',
        penaltyAmount:    0,
        taxAmount:        0,
        taxType:          '',
        clientName:       sale.client_name  || '',
        unitNo:           sale.unit_no      || '',
        floorLabel:       sale.floor_label  || '',
        unitType:         sale.unit_type    || '',
        projectName:      sale.project_name || '',
        saleNumber:       sale.sale_number  || '',
        receivingAgainst: clearedItems.map(c => c.row.label).join(' + '),
        newAmtPaid:       clearedItems[clearedItems.length-1].data.new_amt_paid    || 0,
        newOutstanding:   clearedItems[clearedItems.length-1].data.new_outstanding || 0,
        netAmount:        sale.net_amount   || 0,
        recordedBy:       S.name || ''
      };
      printPaymentReceiptSupa(receiptOpts);
    }

    // Refresh schedule
    await _pymOnUnitChange(_pymCurrentUnitId);

  } catch (e) {
    notify.error('Payment Failed', { detail: e.message || 'Failed to save.' });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save & Print'; }
  }
}

// ── Receive click (by index into _pymRows) ────────────────────────
// cascade=true  → auto mode: clears all due items oldest-first (used by "Pay All Due" banner btn)
// cascade=false → manual mode: receives against THIS installment only, max = its outstanding
// Defer an installment's due date (Module 4). Admin/owner only (button-gated).
async function _pymDefer(installmentId) {
  const def = new Date(Date.now() + 86400000 * 15).toISOString().slice(0, 10);
  const nd  = prompt('Defer this installment to which due date? (YYYY-MM-DD)', def);
  if (!nd) return;
  const reason = prompt('Reason for deferral (optional):', '') || null;
  try {
    const { data, error } = await supabase.rpc('defer_installment', {
      p_installment_id: installmentId, p_company_id: S.cid, p_new_due_date: nd, p_reason: reason
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast('Installment deferred to ' + nd, 'ok');
    if (_pymCurrentUnitId) _pymShowPaymentView(_pymCurrentUnitId);
  } catch(e) { toast(e.message || 'Defer failed', 'err'); }
}

function _pymClickReceiveIdx(idx, cascade) {
  cascade = cascade === true;
  const row = _pymRows[idx];
  if (!row) return;
  if (row.outstanding <= 0) { toast('This item is fully paid', 'warn'); return; }
  const todayStr = new Date().toISOString().split('T')[0];
  const isDue = r => r.outstanding > 0 && (r.isDownPayment || !r.dueDate || r.dueDate <= todayStr);
  const allDue = _pymRows.filter(isDue);
  const isRowDue = isDue(row);

  const maxPayable = (cascade && isRowDue)
    ? allDue.reduce((s, r) => s + r.outstanding, 0)
    : row.outstanding;
  const cascadesFromOldest = cascade && isRowDue && allDue.length > 0;

  _pymClickReceive(row.isDownPayment, row.installmentId, row.outstanding, row.label, maxPayable, cascadesFromOldest);
}

// ── Toggle conditional fields based on method/category ───────────
function _pymSetMethod(method) {
  const keyToMethod = { cash: 'cash', bank: 'bank', cheque: 'cheque_pdc', adj: 'adjustment' };
  ['cash', 'bank', 'cheque', 'adj'].forEach(key => {
    const btn = document.getElementById('pm-m-' + key);
    if (!btn) return;
    const isActive = keyToMethod[key] === method;
    btn.style.border     = isActive ? '2px solid var(--brand)' : '2px solid var(--line)';
    btn.style.background = isActive ? 'rgba(99,102,241,.12)' : 'var(--surface)';
    btn.style.color      = isActive ? 'var(--brand)' : 'var(--t2)';
    btn.style.fontWeight = isActive ? '700' : '600';
  });
  const sel = document.getElementById('pm-method');
  if (sel) sel.value = method;
  _pymToggleFields();
}

function _pymToggleTax() {
  const body    = document.getElementById('pm-tax-body');
  const chevron = document.getElementById('pm-tax-chevron');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'grid';
  if (chevron) chevron.textContent = isOpen ? '▾' : '▴';
}

function _pymToggleFields() {
  const method   = document.getElementById('pm-method')?.value   || '';
  const category = document.getElementById('pm-category')?.value || '';
  const isBank   = method === 'bank';
  const isCash   = method === 'cash';
  const isAdj    = method === 'adjustment';
  const isCheque = method === 'cheque_pdc';
  const isPenalty= category === 'penalty';
  const s = id => document.getElementById(id);
  if (s('pm-bank-section'))   s('pm-bank-section').style.display   = isBank   ? '' : 'none';
  if (s('pm-cash-section'))   s('pm-cash-section').style.display   = isCash   ? '' : 'none';
  if (s('pm-adj-section'))    s('pm-adj-section').style.display    = isAdj    ? '' : 'none';
  if (s('pm-cheque-section')) s('pm-cheque-section').style.display = isCheque ? '' : 'none';
  if (s('pm-penalty-wrap'))   s('pm-penalty-wrap').style.display   = isPenalty? '' : 'none';
  const taxSection = s('pm-tax-section');
  if (taxSection) taxSection.style.display = isAdj ? 'none' : '';
}

function _pymTogglePDC(checked) {
  const info = document.getElementById('pm-pdc-info');
  if (info) info.style.display = checked ? '' : 'none';
}

function _pymOnChequeDateChange(val) {
  const hidden = document.getElementById('pm-cheque-date');
  if (hidden) hidden.value = val || '';
  if (!val) return;
  const isPDC  = val > td();
  const pdcChk = document.getElementById('pm-is-pdc');
  if (pdcChk) { pdcChk.checked = isPDC; _pymTogglePDC(isPDC); }
}

// ── Load banks from DB (cached) ───────────────────────────────────
async function _pymLoadBanks() {
  if (_pymBanks !== null) return _pymBanks;
  try {
    // RPC (not .from('banks')) — banks carries deny_all_anon RLS, direct reads return nothing.
    const { data, error } = await supabase.rpc('list_banks_active', { p_company_id: S.cid });
    if (error) throw error;
    _pymBanks = Array.isArray(data) ? data : [];
  } catch (e) {
    _pymBanks = [];
    console.warn('[_pymLoadBanks]', e.message);
  }
  return _pymBanks;
}

// ── Bank selected in dropdown ─────────────────────────────────────
function _pymOnBankSelect(bankId) {
  const banks = _pymBanks || [];
  const bank  = banks.find(b => b.id === bankId);
  const info  = document.getElementById('pm-bank-info');
  if (!bank || !info) { if (info) info.style.display = 'none'; return; }
  info.style.display = '';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || '—'; };
  set('pm-bi-title',  bank.account_title);
  set('pm-bi-acno',   bank.account_number);
  set('pm-bi-iban',   bank.iban);
  set('pm-bi-branch', bank.branch);
  // Also populate the legacy pm-bank hidden field with bank name
  const legacyBank = document.getElementById('pm-bank');
  if (legacyBank) legacyBank.value = bank.bank_name || '';
}

async function _pymClickReceive(isDownPayment, installmentId, outstanding, label, maxPayable, cascadesFromOldest) {
  if (!_pymCurrentSale) return;
  _pymReceiveRow = { isDownPayment, installmentId, outstanding, label, maxPayable: maxPayable || outstanding, cascadeMode: !!cascadesFromOldest };

  const maxPay = _pymReceiveRow.maxPayable;
  document.getElementById('pm-label').textContent       = label;

  // Style context strip based on cascade vs manual mode
  const strip    = document.getElementById('pm-context-strip');
  const modeInfo = document.getElementById('pm-mode-info');
  const outEl    = document.getElementById('pm-outstanding');
  if (strip) {
    if (cascadesFromOldest) {
      strip.style.background = 'rgba(249,115,22,.08)';
      strip.style.border     = '1.5px solid rgba(249,115,22,.35)';
    } else {
      strip.style.background = 'rgba(99,102,241,.07)';
      strip.style.border     = '1.5px solid rgba(99,102,241,.25)';
    }
  }
  if (modeInfo) {
    modeInfo.style.color = cascadesFromOldest ? '#f97316' : 'var(--brand)';
    modeInfo.textContent = cascadesFromOldest
      ? 'Auto-cascade — clears oldest due first'
      : 'Manual — this installment only';
  }
  if (outEl) outEl.textContent = 'PKR ' + fM(maxPay);

  document.getElementById('pm-amount').value             = '';
  document.getElementById('pm-amount').max               = maxPay;
  document.getElementById('pm-amount').placeholder       = `Max: PKR ${fM(maxPay)}`;
  _pymSetMethod('cash');
  document.getElementById('pm-category').value           = 'regular';
  document.getElementById('pm-date').value               = td();
  document.getElementById('pm-refno').value              = '';
  document.getElementById('pm-bank').value               = '';
  document.getElementById('pm-notes').value              = '';
  _clearFileUpload('pm-proof', 'pm-proof-prev');
  const _proofFile = document.getElementById('pm-proof-file'); if (_proofFile) _proofFile.value = '';
  document.getElementById('pm-penalty').value            = '';
  document.getElementById('pm-tax-amount').value         = '';
  document.getElementById('pm-tax-type').value           = '';
  document.getElementById('pm-cheque-date').value        = '';
  document.getElementById('pm-deposit-confirmed').value  = 'no';
  document.getElementById('pm-print-receipt').checked   = true;
  document.getElementById('pm-print-voucher').checked   = false;
  document.getElementById('pm-err').textContent          = '';
  document.querySelectorAll('#m-payment .inp-err').forEach(el => el.classList.remove('inp-err'));

  // Reset method-specific fields
  const g = id => document.getElementById(id);
  if (g('pm-cash-refno'))  g('pm-cash-refno').value       = '';
  if (g('pm-tx-date'))     g('pm-tx-date').value          = '';
  if (g('pm-adj-note'))    g('pm-adj-note').value         = '';
  if (g('pm-adj-type'))    g('pm-adj-type').value         = '';
  if (g('e-pm-adj-note'))  g('e-pm-adj-note').textContent = '';
  if (g('pm-bank-info'))       g('pm-bank-info').style.display   = 'none';
  if (g('pm-cheque-no'))       g('pm-cheque-no').value           = '';
  if (g('pm-cheque-date-vis')) g('pm-cheque-date-vis').value     = '';
  if (g('pm-cheque-bank'))     g('pm-cheque-bank').value         = '';
  if (g('pm-cheque-drawer'))   g('pm-cheque-drawer').value       = '';
  if (g('pm-is-pdc'))          g('pm-is-pdc').checked            = false;
  if (g('pm-pdc-info'))        g('pm-pdc-info').style.display    = 'none';

  // Load banks and populate dropdown
  const banks   = await _pymLoadBanks();
  const bankSel = g('pm-bank-id');
  const noBankNote = g('pm-no-bank-note');
  if (bankSel) {
    bankSel.innerHTML = `<option value="">— Select bank account —</option>` +
      banks.map(b => `<option value="${esc(b.id)}">${esc(b.bank_name)} — ${esc(b.account_title)}</option>`).join('');
    if (banks.length === 1) {
      bankSel.value = banks[0].id;
      _pymOnBankSelect(banks[0].id);
    }
  }
  if (noBankNote) noBankNote.style.display = banks.length === 0 ? 'flex' : 'none';

  _pymToggleFields();
  om('m-payment');
}

// ── Save payment ──────────────────────────────────────────────────
async function _pymSavePayment() {
  if (typeof demoGuard === 'function' && demoGuard('Record Payment')) return;
  if (!_pymCurrentSale || !_pymReceiveRow) return;

  const amtInput = document.getElementById('pm-amount');
  const errEl    = document.getElementById('pm-err');
  const amt      = parseAmt(amtInput.value);

  errEl.textContent = '';
  amtInput.classList.remove('inp-err');
  const pdateEl = document.getElementById('pm-date');
  if (pdateEl) pdateEl.classList.remove('inp-err');

  if (!amt || amt <= 0) {
    notify.error('Enter a valid amount greater than zero.');
    amtInput.classList.add('inp-err');
    amtInput.focus();
    return;
  }
  const maxAllowed = _pymReceiveRow.maxPayable || _pymReceiveRow.outstanding;
  if (amt > maxAllowed + 0.01) {
    notify.error(`Amount cannot exceed total due of PKR ${fM(maxAllowed)}.`);
    amtInput.classList.add('inp-err');
    return;
  }

  const pdate = document.getElementById('pm-date').value;
  if (!pdate) {
    notify.error('Payment date is required.');
    if (pdateEl) pdateEl.classList.add('inp-err');
    return;
  }

  const method    = document.getElementById('pm-method').value;
  const category  = document.getElementById('pm-category').value    || 'regular';
  const bankId    = document.getElementById('pm-bank-id')?.value    || null;
  const refno     = method === 'cash'
    ? (document.getElementById('pm-cash-refno')?.value?.trim() || '')
    : (document.getElementById('pm-refno')?.value?.trim()      || '');
  const adjNote   = document.getElementById('pm-adj-note')?.value?.trim()  || '';
  const adjType   = document.getElementById('pm-adj-type')?.value           || null;
  const bankObj   = (_pymBanks || []).find(b => b.id === bankId);
  const bank      = bankObj ? bankObj.bank_name : (document.getElementById('pm-bank')?.value?.trim() || '');
  const notes     = document.getElementById('pm-notes').value.trim();
  const proof     = document.getElementById('pm-proof').value.trim();
  const penalty   = parseAmt(document.getElementById('pm-penalty').value);
  const taxAmt    = parseAmt(document.getElementById('pm-tax-amount').value);
  const taxType   = document.getElementById('pm-tax-type').value || null;
  const chqDate   = document.getElementById('pm-cheque-date-vis')?.value || document.getElementById('pm-cheque-date')?.value || null;
  const depConf   = document.getElementById('pm-deposit-confirmed').value === 'yes';
  const doPrint   = document.getElementById('pm-print-receipt').checked;
  const doVoucher = document.getElementById('pm-print-voucher').checked;
  const isCheque    = method === 'cheque_pdc';
  const chequeNo    = document.getElementById('pm-cheque-no')?.value?.trim()     || '';
  const chequeBank  = document.getElementById('pm-cheque-bank')?.value?.trim()   || '';
  const chequeDrawer= document.getElementById('pm-cheque-drawer')?.value?.trim() || '';
  const isPDC       = document.getElementById('pm-is-pdc')?.checked || false;
  const rpcMethod   = isCheque ? 'cheque' : method === 'bank' ? 'bank_transfer' : method;

  // Method-specific validation
  if (method === 'bank' && !bankId) {
    notify.error('Please select a bank account for bank transfer.');
    document.getElementById('pm-bank-id')?.classList.add('inp-err');
    return;
  }
  if (method === 'adjustment') {
    const adjErr = document.getElementById('e-pm-adj-note');
    if (adjNote.length < 10) {
      notify.error('Adjustment note must be at least 10 characters.');
      if (adjErr) adjErr.textContent = 'Adjustment note must be at least 10 characters.';
      document.getElementById('pm-adj-note')?.classList.add('inp-err');
      return;
    }
    if (adjErr) adjErr.textContent = '';
    document.getElementById('pm-adj-note')?.classList.remove('inp-err');
  }
  if (isCheque) {
    if (!chequeNo) {
      notify.error('Cheque number is required.');
      document.getElementById('pm-cheque-no')?.classList.add('inp-err');
      return;
    }
    if (!chqDate) {
      notify.error('Cheque date is required.');
      document.getElementById('pm-cheque-date-vis')?.classList.add('inp-err');
      return;
    }
  }

  const btn = document.getElementById('pm-save-btn');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    // Build queue based on mode stored in _pymReceiveRow.cascadeMode:
    //   true  → auto-cascade: clear all due items from oldest first
    //   false → manual: receive against the specific selected installment only
    const todayStr2 = new Date().toISOString().split('T')[0];
    const _isDueNow = r => r.outstanding > 0 && (r.isDownPayment || !r.dueDate || r.dueDate <= todayStr2);
    const allDueNow = _pymRows.filter(_isDueNow);
    const selectedRow = _pymRows.find(r =>
      r.isDownPayment === _pymReceiveRow.isDownPayment &&
      r.installmentId === _pymReceiveRow.installmentId
    );
    const queue = (_pymReceiveRow.cascadeMode && allDueNow.length > 0)
      ? allDueNow
      : (selectedRow ? [selectedRow] : []);

    let remaining = amt;
    const clearedItems = [];
    let lastPaymentData = null;
    let isFirst = true;

    for (const item of queue) {
      if (remaining < 0.005) break;
      const toApply = Math.min(remaining, item.outstanding);
      if (toApply < 0.005) break;

      const { data: pData, error: pErr } = await supabase.rpc('record_payment', {
        p_company_id:       S.cid,
        p_sale_id:          _pymCurrentSale.sale.sale_id,
        p_installment_id:   item.installmentId || null,
        p_is_down_payment:  item.isDownPayment,
        p_amount:           toApply,
        p_payment_method:   rpcMethod,
        p_payment_date:     pdate,
        p_reference_no:     refno    || null,
        p_bank_name:        bank     || null,
        p_notes:            notes    || null,
        p_created_by:       S.userId,
        p_proof_url:        isFirst ? (proof || null) : null,
        p_payment_category: category,
        p_penalty_amount:   isFirst ? penalty : 0,
        p_tax_amount:       isFirst ? taxAmt  : 0,
        p_tax_type:         isFirst ? taxType : null,
        p_cheque_date:      chqDate,
        p_bank_id:          bankId   || null,
        p_adjustment_note:  isFirst ? (adjNote || null) : null,
        p_adjustment_type:  isFirst ? (adjType || null) : null
      });
      if (pErr) throw pErr;
      if (!pData || !pData.success) throw new Error(pData?.error || 'Payment could not be saved');

      clearedItems.push({ item, toApply, data: pData });
      lastPaymentData = pData;
      remaining -= toApply;
      isFirst = false;
    }

    if (!lastPaymentData) throw new Error('No payment was processed');

    // Deposit confirmation (first payment only)
    if (depConf && clearedItems[0]?.data?.payment_id) {
      await supabase.rpc('confirm_payment_deposit', {
        p_payment_id:   clearedItems[0].data.payment_id,
        p_company_id:   S.cid,
        p_deposit_date: pdate
      });
    }

    // Auto-create PDC entry when post-dated cheque is received
    if (isCheque && isPDC && _pymCurrentSale?.sale?.sale_id) {
      const pdcNotes = [chequeDrawer ? `Drawer: ${chequeDrawer}` : '', notes || ''].filter(Boolean).join(' | ') || null;
      await supabase.rpc('create_pdc_cheque', {
        p_company_id: S.cid,
        p_data: {
          sale_id:       _pymCurrentSale.sale.sale_id,
          client_id:     _pymCurrentSale.sale.client_id || null,
          cheque_no:     chequeNo,
          bank_name:     chequeBank || null,
          amount:        amt,
          cheque_date:   chqDate,
          received_date: pdate,
          status:        'pending',
          notes:         pdcNotes,
          created_by:    S.name || S.userId || 'system'
        }
      });
    }

    cm('m-payment');
    const numCleared = clearedItems.length;
    toast(
      numCleared > 1
        ? `PKR ${fM(amt)} received — ${numCleared} items cleared`
        : `PKR ${fM(amt)} received — ${esc(clearedItems[0]?.data?.payment_code || '')}`,
      'ok'
    );

    const sale = _pymCurrentSale.sale;
    const receivingLabel = numCleared > 1
      ? clearedItems.map(c => c.item.label).join(' + ')
      : (_pymReceiveRow.label || '—');

    const receiptOpts = {
      paymentCode:      clearedItems[0]?.data?.payment_code || '',
      amount:           amt,
      paymentMethod:    method,
      paymentDate:      pdate,
      referenceNo:      refno  || '',
      bankName:         bank   || '',
      notes:            notes  || '',
      penaltyAmount:    penalty,
      taxAmount:        taxAmt,
      taxType:          taxType || '',
      clientName:       sale.client_name   || '',
      unitNo:           sale.unit_no       || '',
      floorLabel:       sale.floor_label   || '',
      unitType:         sale.unit_type     || '',
      projectName:      sale.project_name  || '',
      saleNumber:       sale.sale_number   || '',
      receivingAgainst: receivingLabel,
      newAmtPaid:       lastPaymentData.new_amt_paid    || 0,
      newOutstanding:   lastPaymentData.new_outstanding  || 0,
      netAmount:        sale.net_amount                  || 0,
      recordedBy:       S.name || ''
    };

    if (doPrint)   printPaymentReceiptSupa(receiptOpts);
    if (doVoucher) printPaymentVoucher(receiptOpts);

    // Refresh schedule
    if (_pymCurrentUnitId) await _pymOnUnitChange(_pymCurrentUnitId);

  } catch (e) {
    notify.error('Payment Failed', { detail: e.message || 'Failed to save payment.' });
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Save & Print';
  }
}

// ── PDC Cheque functions ──────────────────────────────────────────

function openPDCModal(id, saleId) {
  document.getElementById('pdc-id').value      = id || '';
  document.getElementById('pdc-sale-id').value = saleId || (_pymCurrentSale?.sale?.sale_id || '');
  document.getElementById('pdc-mtl').textContent = id ? 'Edit PDC Cheque' : 'Add PDC Cheque';
  ['pdc-chq-no','pdc-bank','pdc-notes'].forEach(fid => { const el=document.getElementById(fid); if(el) el.value=''; });
  document.getElementById('pdc-amount').value     = '';
  document.getElementById('pdc-date').value       = '';
  document.getElementById('pdc-recv-date').value  = td();
  document.getElementById('pdc-status').value     = 'pending';
  document.getElementById('e-pdc-chq').textContent = '';
  document.getElementById('e-pdc-amt').textContent = '';
  document.querySelectorAll('#m-pdc .inp-err').forEach(el => el.classList.remove('inp-err'));
  om('m-pdc');
}

async function savePDCForm() {
  const chqNo  = document.getElementById('pdc-chq-no')?.value?.trim();
  const amount = parseAmt(document.getElementById('pdc-amount')?.value);
  let hasErr = false;
  const setE = (eid, msg, inputId) => {
    const el = document.getElementById(eid); if (el) el.textContent = msg;
    const inp = document.getElementById(inputId || eid.slice(2)); if (inp) inp.classList.toggle('inp-err', !!msg);
    if (msg) hasErr = true;
  };
  setE('e-pdc-chq', !chqNo ? 'Cheque number is required' : '', 'pdc-chq-no');
  setE('e-pdc-amt', (!amount || amount <= 0) ? 'Enter a valid amount' : '', 'pdc-amount');
  if (hasErr) return;

  const id     = document.getElementById('pdc-id')?.value?.trim() || null;
  const saleId = document.getElementById('pdc-sale-id')?.value?.trim() || null;
  const btn    = document.getElementById('pdc-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const clientId = _pymCurrentSale?.sale?.client_id || null;
    const payload = {
      company_id:    S.cid,
      sale_id:       saleId,
      client_id:     clientId,
      cheque_no:     chqNo,
      bank_name:     document.getElementById('pdc-bank')?.value?.trim()      || null,
      amount:        amount,
      cheque_date:   document.getElementById('pdc-date')?.value              || null,
      received_date: document.getElementById('pdc-recv-date')?.value         || null,
      status:        document.getElementById('pdc-status')?.value            || 'pending',
      notes:         document.getElementById('pdc-notes')?.value?.trim()     || null,
      created_by:    S.name || S.userId || 'system'
    };

    let result;
    if (id) {
      const { data, error } = await supabase.rpc('update_pdc_cheque', { p_id: id, p_company_id: S.cid, p_data: payload });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Update failed');
      result = { id };
    } else {
      const { data, error } = await supabase.rpc('create_pdc_cheque', { p_company_id: S.cid, p_data: payload });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Create failed');
      result = { id: data.id };
    }
    if (!result) { toast('Could not save PDC record', 'err'); return; }

    cm('m-pdc');
    toast(id ? 'PDC updated' : 'PDC cheque added', 'ok');
    if (_pymCurrentUnitId) await _pymOnUnitChange(_pymCurrentUnitId);
  } catch (err) { toast('Error: ' + err.message, 'err'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Save PDC'; } }
}

async function deletePDCConfirm(id) {
  if (!confirm('Delete this PDC record?')) return;
  const { data, error } = await supabase.rpc('delete_pdc_cheque', { p_id: id, p_company_id: S.cid });
  if (error || !data?.success) { toast('Could not delete PDC', 'err'); return; }
  toast('PDC deleted', 'ok');
  if (_pymCurrentUnitId) await _pymOnUnitChange(_pymCurrentUnitId);
}

async function updatePDCStatus(id, status) {
  // Route status transitions through the dedicated RPCs (proper side-effects:
  // deposit_date / clearance_date / auto-escalation) instead of a blind update.
  try {
    let res;
    if (status === 'presented' || status === 'deposited') {
      res = await supabase.rpc('mark_pdc_deposited', { p_cheque_id: id, p_company_id: S.cid, p_deposit_date: td() });
    } else if (status === 'cleared') {
      res = await supabase.rpc('mark_pdc_cleared', { p_cheque_id: id, p_company_id: S.cid, p_cleared_date: td() });
    } else {
      res = await supabase.rpc('update_pdc_cheque', { p_id: id, p_company_id: S.cid, p_data: { status } });
    }
    const { data, error } = res;
    if (error || !data?.success) { toast(data?.error || 'Could not update PDC status', 'err'); return; }
    toast('PDC status updated', 'ok');
    if (_pymCurrentUnitId) await _pymOnUnitChange(_pymCurrentUnitId);
  } catch (e) {
    toast(e.message || 'Could not update PDC status', 'err');
  }
}

// ── PDC Bounce modal ──────────────────────────────────────────────

function openBounceModal(pdcId, chqNo, amount) {
  document.getElementById('pdc-bounce-id').value           = pdcId  || '';
  document.getElementById('pdc-bounce-chq-display').value  = chqNo  || '';
  document.getElementById('pdc-bounce-amt-display').value  = amount ? `PKR ${fM(Number(amount))}` : '';
  document.getElementById('pdc-bounce-reason').value       = '';
  document.getElementById('pdc-bounce-date').value         = td();
  document.getElementById('pdc-penalty-amt').value         = '';
  document.getElementById('pdc-penalty-date').value        = '';
  document.getElementById('pdc-penalty-collected').checked = false;
  document.getElementById('pdc-penalty-notes').value       = '';
  om('m-pdc-bounce');
}

async function saveBounceForm() {
  const id     = document.getElementById('pdc-bounce-id')?.value?.trim();
  const reason = document.getElementById('pdc-bounce-reason')?.value;
  const bdate  = document.getElementById('pdc-bounce-date')?.value;
  const btn    = document.getElementById('pdc-bounce-save-btn');

  if (!reason) { toast('Select a bounce reason', 'warn'); return; }
  if (!bdate)  { toast('Bounce date is required', 'warn'); return; }
  if (!id)     { toast('Invalid cheque record', 'err'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    const penaltyAmt       = parseAmt(document.getElementById('pdc-penalty-amt')?.value);
    const penaltyDate      = document.getElementById('pdc-penalty-date')?.value    || null;
    const penaltyCollected = document.getElementById('pdc-penalty-collected')?.checked || false;
    const penaltyNotes     = document.getElementById('pdc-penalty-notes')?.value?.trim() || null;

    // Route through mark_pdc_bounced (status transition + client auto-escalation).
    const { data, error } = await supabase.rpc('mark_pdc_bounced', {
      p_cheque_id:     id,
      p_company_id:    S.cid,
      p_bounce_date:   bdate,
      p_bounce_reason: reason
    });
    if (error || !data?.success) throw new Error(error?.message || data?.error || 'Bounce update failed');

    // mark_pdc_bounced doesn't capture penalty details — persist them separately if entered.
    if (penaltyAmt || penaltyDate || penaltyCollected || penaltyNotes) {
      const { error: pErr } = await supabase.rpc('update_pdc_cheque', {
        p_id: id, p_company_id: S.cid, p_data: {
          penalty_amount:    penaltyAmt || null,
          penalty_date:      penaltyDate,
          penalty_collected: penaltyCollected,
          penalty_notes:     penaltyNotes,
        }
      });
      if (pErr) throw pErr;
    }

    cm('m-pdc-bounce');
    toast(data.auto_escalated ? 'Cheque bounced — client auto-escalated to manager' : 'Cheque marked as bounced', data.auto_escalated ? 'warn' : 'ok');
    if (_pymCurrentUnitId) await _pymOnUnitChange(_pymCurrentUnitId);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Bounce'; }
  }
}

// ══ PAYMENT TRANSACTION HISTORY ═══════════════════════════════════

async function _pymLoadAndRenderTx(saleId) {
  _pymTxList = []; _pymTxFiltered = []; _pymTxPage = 0;
  const sec = document.getElementById('pym-tx-section');
  if (!sec) return;
  sec.innerHTML = '';
  try {
    // RPC (not .from('payments')) — payments carries deny_all_anon RLS, direct reads return nothing.
    // list_payments_for_sale_full returns the full row (incl. id/status/codes) so edit/cancel + cancelled rows work.
    const { data, error } = await supabase.rpc('list_payments_for_sale_full', {
      p_sale_id:    saleId,
      p_company_id: S.cid
    });
    if (error) throw error;
    _pymTxList     = Array.isArray(data) ? data : [];
    _pymTxFiltered = [..._pymTxList];
    _pymRenderTxSection();
  } catch(e) {
    if (sec) sec.innerHTML = `<div style="color:var(--err);font-size:12px;padding:10px">Could not load transactions: ${esc(e.message)}</div>`;
  }
}

function _pymTxDoSearch(q) {
  const qn = (q || '').toLowerCase().trim();
  _pymTxFiltered = !qn ? [..._pymTxList] : _pymTxList.filter(t =>
    (t.voucher_code   || '').toLowerCase().includes(qn) ||
    (t.payment_code   || '').toLowerCase().includes(qn) ||
    (t.reference_no   || '').toLowerCase().includes(qn) ||
    (t.notes          || '').toLowerCase().includes(qn) ||
    (t.payment_method || '').toLowerCase().includes(qn) ||
    fM(t.amount).includes(qn)
  );
  _pymTxPage = 0;
  _pymRenderTxSection();
}

function _pymTxGo(dir) {
  const maxPage = Math.max(0, Math.ceil(_pymTxFiltered.length / _PYM_TX_PG) - 1);
  _pymTxPage = Math.max(0, Math.min(maxPage, _pymTxPage + dir));
  _pymRenderTxSection();
}

function _pymRenderTxSection() {
  const sec = document.getElementById('pym-tx-section');
  if (!sec) return;

  const total = _pymTxFiltered.length;
  const pages = Math.ceil(total / _PYM_TX_PG) || 1;
  const start = _pymTxPage * _PYM_TX_PG;
  const items = _pymTxFiltered.slice(start, start + _PYM_TX_PG);
  const mIco  = { cash:'Cash', bank:'Bank', adjustment:'Adj', cheque:'Cheque', cheque_pdc:'PDC' };

  const rowsHtml = items.map(t => {
    const ico         = mIco[t.payment_method] || 'Other';
    const isCancelled = t.status === 'cancelled';
    const displayCode = t.voucher_code || t.payment_code;
    const catBadge = (t.payment_category && t.payment_category !== 'regular')
      ? `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;background:rgba(245,158,11,.15);color:#d97706;text-transform:uppercase">${esc(t.payment_category)}</span>`
      : '';
    const cancelBadge = isCancelled
      ? `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;background:rgba(239,68,68,.12);color:var(--err);text-transform:uppercase">CANCELLED</span>`
      : '';
    const meta = [
      fD(t.payment_date),
      `${ico} ${esc(t.payment_method)}`,
      t.reference_no ? `Ref: ${esc(t.reference_no)}` : '',
      t.notes        ? esc(t.notes) : ''
    ].filter(Boolean).join(' · ');
    const editBtn = isCancelled
      ? `<button disabled style="padding:5px 9px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--t2);font-size:11px;opacity:.3;cursor:default" title="Cannot edit cancelled"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>`
      : `<button onclick="_pymOpenEditTx('${t.id}')" style="padding:5px 9px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--t2);font-size:11px;cursor:pointer" title="Edit"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>`;
    const delBtn = isCancelled
      ? `<button disabled style="padding:5px 9px;border-radius:6px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.07);color:var(--err);font-size:11px;opacity:.3;cursor:default" title="Already cancelled"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>`
      : `<button onclick="_pymDeleteTx('${t.id}','${esc(displayCode)}',${t.amount})" style="padding:5px 9px;border-radius:6px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.07);color:var(--err);font-size:11px;cursor:pointer" title="Cancel payment"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>`;
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line);${isCancelled?'opacity:.6':''}">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span style="font-family:monospace;color:${isCancelled?'var(--t3)':'var(--brand)'};letter-spacing:.3px;${isCancelled?'text-decoration:line-through':''}">${esc(displayCode)}</span>${catBadge}${cancelBadge}
        </div>
        <div style="font-size:10px;color:var(--t3);margin-top:2px">${meta}</div>
      </div>
      <div style="font-size:13px;font-weight:800;color:${isCancelled?'var(--t3)':'var(--ok)'};flex-shrink:0;margin-right:6px;${isCancelled?'text-decoration:line-through':''}">PKR ${fM(t.amount)}</div>
      <div style="display:flex;gap:4px;flex-shrink:0">${editBtn}${delBtn}</div>
    </div>`;
  }).join('');

  const emptyHtml = total === 0
    ? `<div style="padding:24px;text-align:center;color:var(--t3);font-size:12px">${_pymTxList.length === 0 ? 'No payment transactions recorded yet.' : 'No transactions match your search.'}</div>`
    : '';

  const navHtml = pages > 1
    ? `<div style="padding:8px 14px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">
        <button onclick="_pymTxGo(-1)" ${_pymTxPage===0?'disabled':''}
          style="padding:5px 12px;border-radius:7px;border:1px solid var(--line);background:var(--surface);color:var(--t2);font-size:12px;cursor:pointer;${_pymTxPage===0?'opacity:.4':''}">← Prev</button>
        <span style="font-size:11px;color:var(--t3)">Page ${_pymTxPage+1} of ${pages} · ${total} records</span>
        <button onclick="_pymTxGo(1)" ${_pymTxPage>=pages-1?'disabled':''}
          style="padding:5px 12px;border-radius:7px;border:1px solid var(--line);background:var(--surface);color:var(--t2);font-size:12px;cursor:pointer;${_pymTxPage>=pages-1?'opacity:.4':''}">Next →</button>
      </div>`
    : (total > 0 ? `<div style="padding:6px 14px;font-size:10px;color:var(--t3);text-align:right">${total} transaction${total!==1?'s':''}</div>` : '');

  sec.innerHTML = `
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-top:16px">
    <div style="padding:10px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px">
      <div style="font-size:11px;font-weight:800;color:var(--text);text-transform:uppercase;letter-spacing:.5px;flex:1;display:flex;align-items:center;gap:6px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg> Payment Transactions</div>
      <span style="font-size:11px;color:var(--t3)">${_pymTxList.length} total</span>
    </div>
    <div style="padding:8px 14px;border-bottom:1px solid var(--line)">
      <input type="text" placeholder="Search by voucher no., amount, method, notes…"
        style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-size:12px;background:var(--surface);color:var(--text);box-sizing:border-box;outline:none"
        oninput="_pymTxDoSearch(this.value)">
    </div>
    <div>${total > 0 ? rowsHtml : emptyHtml}</div>
    ${navHtml}
  </div>`;
}

async function _pymDeleteTx(paymentId, paymentCode, amount) {
  if (typeof demoGuard === 'function' && demoGuard('Cancel Payment')) return;
  notify.warning(`Cancel ${paymentCode}?`, {
    detail: `PKR ${fM(amount)} will be reversed from the installment. The record will be marked cancelled and kept for audit. This cannot be undone.`,
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
        toast(`${paymentCode} cancelled — PKR ${fM(amount)} reversed`, 'ok');
        if (_pymCurrentUnitId) await _pymOnUnitChange(_pymCurrentUnitId);
      } catch(e) {
        notify.error('Cancel Failed', { detail: e.message });
      }
    }
  });
}

async function _pymOpenEditTx(txId) {
  const tx = _pymTxList.find(t => t.id === txId);
  if (!tx) return;
  const s = id => document.getElementById(id);
  if (s('ep-id'))     s('ep-id').value        = tx.id;
  if (s('ep-code'))   s('ep-code').textContent = `${tx.voucher_code || tx.payment_code} · PKR ${fM(tx.amount)}`;
  if (s('ep-date'))   s('ep-date').value       = tx.payment_date   || td();
  if (s('ep-method')) s('ep-method').value     = tx.payment_method || 'cash';
  if (s('ep-refno'))  s('ep-refno').value      = tx.reference_no   || '';
  if (s('ep-notes'))  s('ep-notes').value      = tx.notes          || '';

  // Bank account dropdown — lets the edit pass a real p_bank_id to edit_payment_meta.
  const banks   = await _pymLoadBanks();
  const bankSel  = s('ep-bank-id');
  if (bankSel) {
    bankSel.innerHTML = `<option value="">— None / Cash —</option>` +
      banks.map(b => `<option value="${esc(b.id)}">${esc(b.bank_name)} — ${esc(b.account_title)}</option>`).join('');
    const match = tx.bank_id ? banks.find(b => b.id === tx.bank_id)
                             : (tx.bank_name ? banks.find(b => b.bank_name === tx.bank_name) : null);
    bankSel.value = match ? match.id : '';
  }
  // Keep the legacy free-text bank name when no saved account matches.
  if (s('ep-bank')) s('ep-bank').value = tx.bank_name || '';
  om('m-edit-pym');
}

// Sync the hidden bank-name field to the selected bank account.
function _pymEpBankSelect(bankId) {
  const bank   = (_pymBanks || []).find(b => b.id === bankId);
  const nameEl = document.getElementById('ep-bank');
  if (nameEl) nameEl.value = bank ? (bank.bank_name || '') : '';
}

async function _pymSaveEditTx() {
  const s   = id => document.getElementById(id);
  const pid = s('ep-id')?.value;
  const btn = s('ep-save-btn');
  if (!pid) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const { data, error } = await supabase.rpc('edit_payment_meta', {
      p_payment_id:     pid,
      p_company_id:     S.cid,
      p_payment_date:   s('ep-date')?.value    || null,
      p_payment_method: s('ep-method')?.value  || null,
      p_reference_no:   s('ep-refno')?.value   || null,
      p_bank_name:      s('ep-bank')?.value    || null,
      p_bank_id:        s('ep-bank-id')?.value || null,
      p_notes:          s('ep-notes')?.value   || null,
      p_updated_by:     S.userId
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Edit failed');
    cm('m-edit-pym');
    toast('Payment record updated', 'ok');
    if (_pymCurrentUnitId) await _pymOnUnitChange(_pymCurrentUnitId);
  } catch(e) {
    notify.error('Edit Failed', { detail: e.message });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
  }
}

// ── Schedule Comparison (original vs current) ─────────────────────────────────

let _pymCompareModal = null;

function _pymCloseCompare() {
  const m = document.getElementById('pym-compare-modal');
  if (m) m.style.display = 'none';
}

async function _pymOpenCompare() {
  if (!_pymCurrentSale?.sale?.sale_id) { toast('Select a unit first', 'warn'); return; }

  // Inject modal if not present
  if (!document.getElementById('pym-compare-modal')) {
    const div = document.createElement('div');
    div.id = 'pym-compare-modal';
    div.className = 'mo';
    div.style.display = 'none';
    div.onclick = function(e) { if (e.target === this) _pymCloseCompare(); };
    div.innerHTML = `
      <div class="mo-box" style="max-width:900px;width:96vw">
        <div class="mo-hd"><span>Schedule Comparison</span><button class="mo-cl" onclick="_pymCloseCompare()">✕</button></div>
        <div class="mo-bd" id="pym-compare-body" style="padding:0"></div>
        <div class="mo-ft">
          <span id="pym-compare-caption" style="font-size:11px;color:var(--t3)"></span>
          <div style="display:flex;gap:8px">
            <button class="btn btn-gh btn-sm" id="pym-snapshot-btn" onclick="_pymCaptureSnapshot()">Capture Baseline Now</button>
            <button class="btn btn-g btn-sm" onclick="_pymCloseCompare()">Close</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(div);
  }

  const modal = document.getElementById('pym-compare-modal');
  const body  = document.getElementById('pym-compare-body');
  const cap   = document.getElementById('pym-compare-caption');
  const snapBtn = document.getElementById('pym-snapshot-btn');

  modal.style.display = 'flex';
  body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3)">Loading…</div>';
  cap.textContent = '';

  const saleId = _pymCurrentSale.sale.sale_id;
  const { data, error } = await supabase.rpc('get_schedule_comparison', {
    p_company_id: S.cid,
    p_sale_id:    saleId
  });

  if (error) {
    body.innerHTML = `<div style="padding:24px;color:var(--err)">${error.message}</div>`;
    return;
  }

  if (!data.has_snapshot) {
    body.innerHTML = `
      <div style="padding:40px 24px;text-align:center">
        <div style="font-size:36px;margin-bottom:12px">📋</div>
        <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:8px">No baseline captured yet</div>
        <div style="font-size:13px;color:var(--t3);max-width:380px;margin:0 auto;line-height:1.6">
          Capture the current schedule as a baseline before making changes (deferrals, restructures).
          After capturing, future changes will be visible here as a side-by-side diff.
        </div>
      </div>`;
    cap.textContent = '';
    if (snapBtn) snapBtn.style.display = '';
    return;
  }

  if (snapBtn) snapBtn.style.display = 'none';
  const takenAt = data.taken_at ? new Date(data.taken_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';
  cap.textContent = `Baseline captured: ${takenAt}`;

  const snap = Array.isArray(data.snapshot) ? data.snapshot : [];
  const curr = Array.isArray(data.current)  ? data.current  : [];

  // Build unified row list aligned by installment_number
  const allNums = [...new Set([...snap.map(r => r.installment_number), ...curr.map(r => r.installment_number)])].sort((a,b) => (a||0)-(b||0));

  const typeLabel = t => ({ down_payment:'Down Pmt', installment:'Installment', possession:'Possession', custom:'Custom' }[t] || t || '—');
  const statusBadge = s => {
    const map = { pending:'#f59e0b', paid:'#22c55e', partial:'#38bdf8', overdue:'#ef4444' };
    const c = map[s] || '#94a3b8';
    return `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:12px;background:${c}22;color:${c}">${s||'—'}</span>`;
  };
  const fD = d => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';

  let changed = 0;
  const rows = allNums.map(num => {
    const s = snap.find(r => r.installment_number === num);
    const c = curr.find(r => r.installment_number === num);
    const dateChanged = s && c && s.due_date !== c.due_date;
    const amtChanged  = s && c && Number(s.amount) !== Number(c.amount);
    if (dateChanged || amtChanged || (!s && c) || (s && !c)) changed++;
    const diffMark = (dateChanged || amtChanged) ? `<span title="Changed" style="color:#f59e0b;font-weight:700">△</span>` : '';
    return `
      <tr style="${(!s || !c) ? 'background:rgba(239,68,68,.04)' : (dateChanged||amtChanged)?'background:rgba(245,158,11,.05)':''}">
        <td style="width:28px;text-align:center;font-size:11px;color:var(--t3)">${num||'—'}</td>
        <td style="font-size:11px;color:var(--t2)">${typeLabel(s?.installment_type||c?.installment_type)}</td>
        <!-- Original -->
        <td class="r mono" style="font-size:12px;${amtChanged?'color:#f59e0b;font-weight:700':''}">${s ? 'PKR '+fM(s.amount) : '<span style="color:var(--t3)">—</span>'}</td>
        <td style="font-size:12px;${dateChanged?'color:#f59e0b;font-weight:700':''}">${s ? fD(s.due_date) : '<span style="color:var(--t3)">—</span>'}</td>
        <!-- Current -->
        <td class="r mono" style="font-size:12px;${amtChanged?'color:#3b82f6;font-weight:700':''}">${c ? 'PKR '+fM(c.amount) : '<span style="color:var(--err)">Removed</span>'}</td>
        <td style="font-size:12px;${dateChanged?'color:#3b82f6;font-weight:700':''}">${c ? fD(c.due_date) : '—'}</td>
        <td>${c ? statusBadge(c.status) : ''}</td>
        <td style="text-align:center">${diffMark}</td>
      </tr>`;
  }).join('');

  const legend = changed > 0
    ? `<div style="display:flex;gap:16px;align-items:center;font-size:11px;color:var(--t3)"><span style="color:#f59e0b;font-weight:700">△</span> ${changed} change${changed>1?'s':''} detected &nbsp;|&nbsp; <span style="color:#f59e0b">amber</span> = original &nbsp;·&nbsp; <span style="color:#3b82f6">blue</span> = current</div>`
    : `<div style="font-size:11px;color:var(--ok)">✓ No changes from baseline</div>`;

  body.innerHTML = `
    <div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
      ${legend}
      <div style="display:flex;gap:24px;font-size:11px">
        <span style="font-weight:700;padding:2px 10px;border-radius:4px;background:rgba(245,158,11,.1);color:#f59e0b">Original</span>
        <span style="font-weight:700;padding:2px 10px;border-radius:4px;background:rgba(59,130,246,.1);color:#3b82f6">Current</span>
      </div>
    </div>
    <div class="tw">
      <table class="t">
        <thead>
          <tr>
            <th style="width:28px">#</th>
            <th>Type</th>
            <th class="r" style="color:#f59e0b">Orig. Amount</th>
            <th style="color:#f59e0b">Orig. Due Date</th>
            <th class="r" style="color:#3b82f6">Curr. Amount</th>
            <th style="color:#3b82f6">Curr. Due Date</th>
            <th>Status</th>
            <th style="width:24px"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function _pymCaptureSnapshot() {
  if (!_pymCurrentSale?.sale?.sale_id) return;
  const btn = document.getElementById('pym-snapshot-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Capturing…'; }
  try {
    const { data, error } = await supabase.rpc('snapshot_installment_schedule', {
      p_company_id: S.cid,
      p_sale_id:    _pymCurrentSale.sale.sale_id
    });
    if (error) throw error;
    toast(`Baseline captured (${data?.count || 0} installments)`, 'ok');
    await _pymOpenCompare();
  } catch(e) {
    notify.error('Snapshot Failed', { detail: e.message });
    if (btn) { btn.disabled = false; btn.textContent = 'Capture Baseline Now'; }
  }
}

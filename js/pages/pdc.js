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
  if (_pdcFilter.q == null) _pdcFilter.q = '';

  const anyFilter = (_pdcFilter.status && _pdcFilter.status !== 'All') || _pdcFilter.project || _pdcFilter.q;
  const prjLbl = _pdcFilter.project
    ? esc((window._projectsCache||[]).find(p=>p.id===_pdcFilter.project)?.projectName || '?')
    : 'Project';

  pg.innerHTML = `<div class="ani rb-page">

    <!-- ── HERO ─────────────────────────────────────────────────── -->
    <div class="rb-crumb">
      <span class="lnk" onclick="nav('dashboard')">Home</span>
      <span class="sep">·</span>
      <span class="cur">PDC Register</span>
    </div>
    <div class="rb-hero">
      <div class="rb-hero-text">
        <h1 class="rb-title">PDC Register</h1>
        <p class="rb-lede">Post-dated cheque intelligence — <b>deposit</b>, <b>clearance</b>, and <b>bounce</b> tracked from issue to settlement across every recovery flow.</p>
      </div>
      <div class="rb-hero-actions">
        <button class="dx-tool" onclick="_pdcLoad()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg><span>Refresh</span></button>
      </div>
    </div>

    <!-- ── KPI COMPOSITION (asymmetric: featured + secondary stack) ── -->
    <div id="pdc-summary"></div>

    <!-- ── AGING ANALYTICS ─────────────────────────────────────────── -->
    <div id="pdc-aging" class="rb-section"></div>

    <!-- ── OPERATIONAL TABLE ───────────────────────────────────────── -->
    <div class="rb-section">
    <div class="rb-section-eyebrow">Cheques</div>
    <div class="dx">
      <div class="dx-toolbar">
        <div class="dx-toolbar-l">
          <div class="dx-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input id="pdc-q" type="search" placeholder="Search client, bank, cheque no…" value="${esc(_pdcFilter.q||'')}" oninput="clearTimeout(_pdcSearchTimer);_pdcSearchTimer=setTimeout(_pdcApplyFilter,180)" autocomplete="off">
          </div>
          <button class="dx-tool${_pdcFilter.project?' primary':''}" onclick="_pdcProjectMenu(this)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/></svg><span>${prjLbl}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
          <div style="display:inline-flex;align-items:center;gap:6px">
            <input class="dx-tool" id="pdc-f-fr" type="date" value="${esc(_pdcFilter.fr)}" onchange="_pdcOnFilter()" style="font-family:inherit;color:var(--text-primary);min-width:140px;padding:0 10px">
            <span style="font-size:12px;color:var(--text-muted)">→</span>
            <input class="dx-tool" id="pdc-f-to" type="date" value="${esc(_pdcFilter.to)}" onchange="_pdcOnFilter()" style="font-family:inherit;color:var(--text-primary);min-width:140px;padding:0 10px">
          </div>
          ${anyFilter?`<button class="dx-tool" onclick="_pdcClearFilter()" title="Clear all filters"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg><span>Clear</span></button>`:''}
        </div>
        <div class="dx-toolbar-r">
          <button class="dx-tool icon" title="Row density" onclick="var w=document.getElementById('pdc-wrap');if(w)DX.density(w,this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
        </div>
      </div>
      <div id="pdc-table-wrap"></div>
    </div>
    </div>

    <!-- Mark Cleared modal -->
    <div id="pdc-modal-cleared" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1100;align-items:center;justify-content:center" onclick="if(event.target===this)_pdcCloseModals()">
      <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:14px;padding:24px;width:min(440px,90vw);box-shadow:0 24px 60px rgba(0,0,0,.4)">
        <h3 style="margin:0 0 16px;font-size:16px;font-weight:700;color:var(--text-primary)">Mark Cheque Cleared</h3>
        <div style="margin-bottom:12px">
          <label class="lb">Cleared Date</label>
          <input id="pdc-cleared-date" type="date" class="inp">
        </div>
        <div style="margin-bottom:20px">
          <label class="lb">Deposit Reference <span style="color:var(--text-muted)">(optional)</span></label>
          <input id="pdc-deposit-ref" type="text" class="inp" placeholder="Bank deposit slip or reference…">
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-gh btn-sm" onclick="_pdcCloseModals()">Cancel</button>
          <button id="pdc-btn-cleared" class="btn btn-g btn-sm" onclick="_pdcConfirmCleared()">Confirm Cleared</button>
        </div>
      </div>
    </div>

    <!-- Mark Bounced modal -->
    <div id="pdc-modal-bounced" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1100;align-items:center;justify-content:center" onclick="if(event.target===this)_pdcCloseModals()">
      <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:14px;padding:24px;width:min(440px,90vw);box-shadow:0 24px 60px rgba(0,0,0,.4)">
        <h3 style="margin:0 0 16px;font-size:16px;font-weight:700;color:var(--text-primary)">Mark Cheque Bounced</h3>
        <div style="margin-bottom:12px">
          <label class="lb">Bounce Date</label>
          <input id="pdc-bounce-date" type="date" class="inp">
        </div>
        <div style="margin-bottom:20px">
          <label class="lb">Bounce Reason</label>
          <input id="pdc-bounce-reason" type="text" class="inp" placeholder="Insufficient funds / Account closed…">
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-gh btn-sm" onclick="_pdcCloseModals()">Cancel</button>
          <button id="pdc-btn-bounced" class="btn btn-r btn-sm" onclick="_pdcConfirmBounced()">Confirm Bounced</button>
        </div>
      </div>
    </div>
  </div>`;

  _pdcLoad();
}

/* KPI tile click → set status filter and reload */
function _pdcSetStatus(s) {
  _pdcFilter.status = s;
  rPDC();
}

/* Project filter menu (DX.menu) */
function _pdcProjectMenu(btn) {
  const prjs = window._projectsCache || [];
  DX.menu(btn, [
    { label:'All Projects', toggle:true, checked:!_pdcFilter.project, onClick:()=>{ _pdcFilter.project=''; rPDC(); } },
    ...prjs.map(p => ({ label: p.projectName || p.name || '?', toggle:true, checked:_pdcFilter.project===p.id, onClick: () => { _pdcFilter.project=p.id; rPDC(); } }))
  ], { label:'Project', align:'left' });
}

async function _pdcLoad() {
  const wrap = document.getElementById('pdc-table-wrap');
  if (!wrap) return;

  // Read filter state directly (KPI-driven status, menu-driven project, input-driven dates)
  const status  = _pdcFilter.status || 'All';
  const project = _pdcFilter.project || '';
  const fr      = document.getElementById('pdc-f-fr')?.value || _pdcFilter.fr || '';
  const to      = document.getElementById('pdc-f-to')?.value || _pdcFilter.to || '';

  wrap.innerHTML = `<div class="dx-wrap" id="pdc-wrap">${DX.skeleton(8, 7)}</div>`;

  const { data, error } = await supabase.rpc('get_pdc_register', {
    p_company_id: S.cid,
    p_status:     status,
    p_project_id: project || null,
    p_date_from:  fr      || null,
    p_date_to:    to      || null
  });

  if (error || !data?.success) {
    wrap.innerHTML = `<div class="dx-wrap" id="pdc-wrap">` + DX.empty({
      icon:'<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
      title:'Could not load PDC register',
      sub: data?.error || error?.message || 'Error'
    }) + `</div>`;
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
  const q = (document.getElementById('pdc-q')?.value || '').toLowerCase().trim();
  _pdcFilter.q = q;
  _pdcFiltered = !q ? _pdcList.slice() : _pdcList.filter(r =>
    (r.client_name||'').toLowerCase().includes(q) ||
    (r.bank_name||'').toLowerCase().includes(q)   ||
    (r.cheque_no||'').toLowerCase().includes(q)   ||
    (r.unit_no||'').toLowerCase().includes(q)
  );
  _pdcRenderSummary();
  _pdcRenderTable();
}

function _pdcOnFilter() {
  _pdcFilter.fr = document.getElementById('pdc-f-fr')?.value || _pdcFilter.fr;
  _pdcFilter.to = document.getElementById('pdc-f-to')?.value || _pdcFilter.to;
  _pdcLoad();
}

function _pdcClearFilter() {
  _pdcFilter = { status:'All', q:'', project:'', bank:'', fr:_pdcFilter.fr, to:_pdcFilter.to };
  rPDC();
}

// ── Asymmetric KPI composition (featured cheque portfolio + secondary stack) ──

function _pdcRenderSummary() {
  const el = document.getElementById('pdc-summary');
  if (!el) return;

  const total  = { amt: 0, cnt: 0 };
  const groups = { pending:{amt:0,cnt:0}, presented:{amt:0,cnt:0}, cleared:{amt:0,cnt:0}, bounced:{amt:0,cnt:0} };
  _pdcList.forEach(r => {
    const st  = (r.status || '').toLowerCase();
    const amt = Number(r.amount || 0);
    total.amt += amt; total.cnt++;
    if (groups[st]) { groups[st].amt += amt; groups[st].cnt++; }
  });

  const clearedPct = total.cnt ? Math.round(groups.cleared.cnt / total.cnt * 100) : 0;
  const bouncedPct = total.cnt ? Math.round(groups.bounced.cnt / total.cnt * 100) : 0;

  // Percentage of TOTAL value for the distribution bar
  const pPe = total.amt ? (groups.pending.amt   / total.amt) * 100 : 0;
  const pPr = total.amt ? (groups.presented.amt / total.amt) * 100 : 0;
  const pCl = total.amt ? (groups.cleared.amt   / total.amt) * 100 : 0;
  const pBo = total.amt ? (groups.bounced.amt   / total.amt) * 100 : 0;

  const _sec = (key, title, sub, group, accent) => {
    const on = (_pdcFilter.status || 'All').toLowerCase() === key.toLowerCase();
    return `<div class="rb-stat-sec${on?' on':''}" style="--rb-accent:${accent}" onclick="_pdcSetStatus('${key}')">
      <span class="v">${group.cnt}</span>
      <div class="l"><span class="l-t">${esc(title)}</span><span class="l-s">${esc(sub)} · PKR ${fM(group.amt)}</span></div>
      <svg class="arr" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
    </div>`;
  };

  el.innerHTML = `<div class="rb-kpi-grid">
    <div class="rb-stat-feature" onclick="_pdcSetStatus('All')" style="cursor:pointer">
      <div class="rb-feat-label">Cheque Portfolio</div>
      <div class="rb-feat-value"><span class="cur">PKR</span><span>${fM(total.amt)}</span><small>${total.cnt} cheque${total.cnt!==1?'s':''} tracked · ${clearedPct}% cleared${bouncedPct?` · ${bouncedPct}% bounced`:''}</small></div>
      ${total.amt ? `
      <div class="rb-feat-bar">
        <span style="background:#D97706;width:${pPe}%" title="Pending"></span>
        <span style="background:#0891B2;width:${pPr}%" title="Presented"></span>
        <span style="background:#16A34A;width:${pCl}%" title="Cleared"></span>
        <span style="background:#DC2626;width:${pBo}%" title="Bounced"></span>
      </div>
      <div class="rb-feat-legend">
        <span class="li" onclick="event.stopPropagation();_pdcSetStatus('pending')"><span class="dot" style="background:#D97706"></span>Pending <b>${groups.pending.cnt}</b></span>
        <span class="li" onclick="event.stopPropagation();_pdcSetStatus('presented')"><span class="dot" style="background:#0891B2"></span>Presented <b>${groups.presented.cnt}</b></span>
        <span class="li" onclick="event.stopPropagation();_pdcSetStatus('cleared')"><span class="dot" style="background:#16A34A"></span>Cleared <b>${groups.cleared.cnt}</b></span>
        <span class="li" onclick="event.stopPropagation();_pdcSetStatus('bounced')"><span class="dot" style="background:#DC2626"></span>Bounced <b>${groups.bounced.cnt}</b></span>
      </div>` : `<div style="font-size:13px;color:var(--text-muted)">No cheques in this range.</div>`}
    </div>
    <div class="rb-sec-stack">
      ${_sec('pending',   'Pending',   'awaiting deposit',     groups.pending,   '#D97706')}
      ${_sec('presented', 'Presented', 'awaiting clearance',   groups.presented, '#0891B2')}
      ${_sec('cleared',   'Cleared',   'funds received',       groups.cleared,   '#16A34A')}
      ${_sec('bounced',   'Bounced',   'recovery escalated',   groups.bounced,   '#DC2626')}
    </div>
  </div>`;
}

// ── DX table (sticky, severity rows, aging chips, hover actions) ──────

function _pdcRenderTable() {
  const wrap = document.getElementById('pdc-table-wrap');
  if (!wrap) return;
  const rows = _pdcFiltered;
  const isA  = S.role === 'admin' || S.role === 'owner';

  if (!rows.length) {
    wrap.innerHTML = `<div class="dx-wrap" id="pdc-wrap">` + DX.empty({
      icon:'<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
      title:'No PDC cheques found',
      sub: 'Adjust filters, or PDC cheques will appear here when recorded during payment entry.'
    }) + `</div>`;
    return;
  }

  const today = new Date(); today.setHours(0,0,0,0);
  const clrPal = ['#6366f1','#8b5cf6','#ec4899','#06b6d4','#10b981','#f59e0b','#f97316','#3b82f6'];

  wrap.innerHTML = `<div class="dx-wrap" id="pdc-wrap"><div class="dx-scroll"><table class="dx-table" id="pdc-table">
    <thead><tr>
      <th>Cheque</th>
      <th>Client / Unit</th>
      <th class="dx-hide-sm">Bank</th>
      <th class="num">Amount</th>
      <th class="dx-hide-sm">Cheque Date</th>
      <th class="num">Aging</th>
      <th>Status</th>
      ${isA?'<th class="num" style="width:120px"></th>':''}
    </tr></thead>
    <tbody>${rows.map(r => {
      const st = (r.status || '').toLowerCase();
      const chDate = r.cheque_date ? new Date(r.cheque_date) : null;
      const daysToCheque = chDate ? Math.round((chDate - today) / 86400000) : null;

      // Operational severity for the row left-accent
      const sev = st === 'bounced' ? 'sev-critical'
                : (st === 'pending' && daysToCheque !== null && daysToCheque < 0) ? 'sev-warn'
                : st === 'presented' ? 'sev-info'
                : st === 'cleared' ? 'sev-ok'
                : '';

      const statusKind = st==='cleared'?'ok':st==='bounced'?'danger':st==='presented'?'info':st==='pending'?'warn':'neutral';
      const statusLbl  = st==='cleared'?'Cleared':st==='bounced'?'Bounced':st==='presented'?'Presented':st==='pending'?'Pending':(r.status || '—');

      // Aging chip — context-aware
      let agingHtml = '<span class="dx-aging a0">—</span>';
      if (chDate) {
        if (st === 'pending') {
          if (daysToCheque < 0) {
            const d = Math.abs(daysToCheque);
            agingHtml = `<span class="dx-aging ${d>=90?'a90':d>=60?'a60':d>=30?'a30':'a30'}">${d}d overdue</span>`;
          } else if (daysToCheque === 0) {
            agingHtml = `<span class="dx-aging a30">Today</span>`;
          } else {
            agingHtml = `<span class="dx-aging a0">in ${daysToCheque}d</span>`;
          }
        } else if (st === 'presented') {
          agingHtml = `<span class="dx-aging a0" style="color:#0284c7;background:rgba(8,145,178,.12)">Awaiting</span>`;
        } else if (st === 'cleared' && r.clearance_date) {
          const cd = new Date(r.clearance_date);
          const d  = Math.max(0, Math.round((cd - chDate) / 86400000));
          agingHtml = `<span class="dx-aging a0" style="color:#15803d;background:rgba(22,163,74,.13)">+${d}d</span>`;
        } else if (st === 'bounced') {
          agingHtml = `<span class="dx-aging a90">Bounced</span>`;
        }
      }

      // Hover quick-actions per status
      let acts = '';
      if (isA) {
        if (st === 'pending') {
          acts = `<button class="dx-act" title="Mark deposited" onclick="_pdcDeposit('${r.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
                  <button class="dx-act" title="Mark cleared" onclick="_pdcOpenCleared('${r.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>
                  <button class="dx-act danger" title="Mark bounced" onclick="_pdcOpenBounced('${r.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
        } else if (st === 'presented') {
          acts = `<button class="dx-act" title="Mark cleared" onclick="_pdcOpenCleared('${r.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>
                  <button class="dx-act danger" title="Mark bounced" onclick="_pdcOpenBounced('${r.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
        } else if (st === 'bounced') {
          acts = `<button class="dx-act" title="Schedule re-deposit" onclick="_pdcRedeposit('${r.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></button>`;
        }
        acts += `<button class="dx-act" title="View details" onclick="_pdcOpenDrawer('${r.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
      }

      // Client monogram (color-stable per name)
      const cname    = r.client_name || '—';
      const initials = cname.split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase() || '?';
      const clr      = clrPal[cname.split('').reduce((a,ch)=>a+ch.charCodeAt(0),0) % clrPal.length];
      const sd = (cname+' '+(r.bank_name||'')+' '+(r.cheque_no||'')+' '+(r.unit_no||'')+' '+(r.project_name||'')).toLowerCase();

      return `<tr class="clickable ${sev}" data-search="${esc(sd)}" onclick="_pdcOpenDrawer('${r.id}')">
        <td><span class="dx-code">${esc(r.cheque_no || '—')}</span></td>
        <td>
          <span class="dx-cell"><span class="dx-mono" style="background:${clr}1a;color:${clr}">${esc(initials)}</span>
            <span class="dx-cell-main"><span class="dx-cell-t">${esc(cname)}</span><span class="dx-cell-s">${r.project_name?esc(r.project_name):''}${r.unit_no?(r.project_name?' · ':'')+esc(r.unit_no):''}</span></span>
          </span>
        </td>
        <td class="dx-hide-sm muted" style="white-space:nowrap">${esc(r.bank_name || '—')}</td>
        <td class="num"><span class="dx-money"><span class="cur">PKR</span>${fM(r.amount)}</span></td>
        <td class="dx-hide-sm muted" style="white-space:nowrap">${r.cheque_date?fD(r.cheque_date):'—'}</td>
        <td class="num">${agingHtml}</td>
        <td>${DX.statusChip(statusLbl, statusKind)}</td>
        ${isA?`<td class="num"><span class="dx-acts" onclick="event.stopPropagation()">${acts}</span></td>`:''}
      </tr>`;
    }).join('')}</tbody>
  </table></div></div>`;
  DX.density(document.getElementById('pdc-wrap'));
}

// ── Quick-view drawer with full cheque journey timeline ──────────────

function _pdcOpenDrawer(id) {
  const r = _pdcList.find(x => String(x.id) === String(id));
  if (!r) return;
  const isA = S.role === 'admin' || S.role === 'owner';
  const st  = (r.status || '').toLowerCase();
  const statusKind = st==='cleared'?'ok':st==='bounced'?'danger':st==='presented'?'info':'warn';
  const statusLbl  = st==='cleared'?'Cleared':st==='bounced'?'Bounced':st==='presented'?'Presented':'Pending';

  const cname    = r.client_name || '—';
  const initials = cname.split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase() || '?';

  const hero = `<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
    <div style="width:56px;height:56px;border-radius:15px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;display:grid;place-items:center;font-size:20px;font-weight:800">${esc(initials)}</div>
    <div style="min-width:0;flex:1">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${DX.statusChip(statusLbl, statusKind)}${r.bank_name?`<span class="dx-status info">${esc(r.bank_name)}</span>`:''}</div>
      <div style="font-size:11px;color:var(--text-muted);font-family:var(--mono);margin-top:7px">Cheque ${esc(r.cheque_no || '—')}</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:22px;font-weight:800;color:var(--text-primary);letter-spacing:-.015em;font-variant-numeric:tabular-nums">PKR ${fM(r.amount)}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Cheque value</div>
    </div>
  </div>`;

  const facts = [
    ['Project',     r.project_name || '—'],
    ['Unit',        r.unit_no || '—'],
    ['Cheque Date', r.cheque_date ? fD(r.cheque_date) : '—'],
    ['Received',    r.received_date ? fD(r.received_date) : '—']
  ];
  const factsBlock = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--border-color);border-radius:11px;overflow:hidden;margin-bottom:18px">
    ${facts.map((f,i)=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:11px 13px;border-bottom:${i<facts.length-2?'1px solid var(--border-color)':'none'};${i%2===0?'border-right:1px solid var(--border-color)':''}"><span style="font-size:11px;color:var(--text-muted)">${f[0]}</span><span style="font-size:12.5px;font-weight:500;color:var(--text-primary);text-align:right">${esc(f[1])}</span></div>`).join('')}
  </div>`;

  // Cheque journey timeline
  const tl = [];
  if (r.received_date) tl.push({ type:'info', title:'Cheque received', time:fD(r.received_date), body:'Logged into PDC register.' });
  if (r.cheque_date)   tl.push({ type:'info', title:'Cheque date',     time:fD(r.cheque_date),   body: st==='pending' ? 'Awaiting deposit to bank.' : 'Eligible for deposit.' });
  if (r.deposit_date || st==='presented' || st==='cleared' || st==='bounced') {
    tl.push({ type:'info', title:'Presented to bank', time:r.deposit_date?fD(r.deposit_date):'—', body: r.deposit_reference ? 'Ref: '+r.deposit_reference : '' });
  }
  if (st==='cleared' && r.clearance_date) tl.push({ type:'ok',     title:'Cleared',  time:fD(r.clearance_date), body:'Funds cleared.' });
  if (st==='bounced' && r.bounce_date)    tl.push({ type:'danger', title:'Bounced',  time:fD(r.bounce_date),    body:r.bounce_reason || 'Bounced.' });
  const tlBlock = tl.length
    ? `<div style="font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:12px">Cheque journey</div>` + DX.timeline(tl)
    : '';

  // Footer actions driven by status
  let footer = `<button class="btn btn-g btn-sm" onclick="document.querySelector('.dx-drawer-x').click()">Close</button>`;
  if (isA) {
    if (st === 'pending') {
      footer += `<button class="btn btn-gh btn-sm" onclick="document.querySelector('.dx-drawer-x').click();_pdcDeposit('${id}')">Mark Deposited</button>
                 <button class="btn btn-g btn-sm" onclick="document.querySelector('.dx-drawer-x').click();_pdcOpenCleared('${id}')">Mark Cleared</button>
                 <button class="btn btn-r btn-sm" onclick="document.querySelector('.dx-drawer-x').click();_pdcOpenBounced('${id}')">Mark Bounced</button>`;
    } else if (st === 'presented') {
      footer += `<button class="btn btn-g btn-sm" onclick="document.querySelector('.dx-drawer-x').click();_pdcOpenCleared('${id}')">Mark Cleared</button>
                 <button class="btn btn-r btn-sm" onclick="document.querySelector('.dx-drawer-x').click();_pdcOpenBounced('${id}')">Mark Bounced</button>`;
    } else if (st === 'bounced') {
      footer += `<button class="btn btn-p btn-sm" onclick="document.querySelector('.dx-drawer-x').click();_pdcRedeposit('${id}')">Schedule Re-deposit</button>`;
    }
  }

  DX.drawer({
    eyebrow: 'PDC · ' + (r.cheque_no || ''),
    title: cname,
    subtitle: [r.project_name, r.unit_no].filter(Boolean).join(' · ') || '—',
    body: hero + factsBlock + tlBlock,
    footer
  });
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

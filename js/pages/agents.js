// ══ AGENTS MODULE — Supabase ════════════════════════════════════════

let _agSearch       = '';
let _agStatus       = '';
let _agSort         = 'name';
let _agId           = null;
let _agIti          = null;
let _agCache        = [];
let _agPrintData    = null;
let _agCommPayTarget = null; // stored at openCommPayModal time for voucher generation

const _canEditAgent = () => S && ['owner','admin','manager'].includes(S.role);

function _agPreviewPhoto(input) {
  const file = input.files?.[0];
  if (!file) return;
  const prev = document.getElementById('af-photo-preview');
  if (!prev) return;
  const reader = new FileReader();
  reader.onload = e => { prev.src = e.target.result; prev.style.display = 'block'; };
  reader.readAsDataURL(file);
}

// ── Helpers ─────────────────────────────────────────────────────────

// One-time agents CSS — list grid, detail, commissions, transactions.
// NOTE: class names deliberately avoid the substring "-card" (visual-overhaul.css
// #s-app [class*="-card"] would box them). Safe prefixes: agc-/agd-.
function _agCSS() {
  if (document.getElementById('_ag_css')) return;
  const s = document.createElement('style'); s.id = '_ag_css';
  s.textContent = `
    .agc-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
    @media(max-width:900px){.agc-kpis{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:520px){.agc-kpis{grid-template-columns:1fr}}
    .agc-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
    .agc-search{position:relative;flex:1;min-width:200px;max-width:320px}
    .agc-search .nx-input{padding-left:32px}
    .agc-search-ic{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--fk-text-muted);display:inline-flex;pointer-events:none}
    .agc-count{margin-left:auto;font-size:12px;color:var(--fk-text-muted)}
    .agc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(288px,1fr));gap:14px}
    .agc-tile{cursor:pointer;display:flex;flex-direction:column;padding:0;overflow:hidden;position:relative}
    .agc-hd{display:flex;align-items:flex-start;gap:12px;padding:15px 16px 13px}
    .agc-id{flex:1;min-width:0}
    .agc-name{font-size:14px;font-weight:600;color:var(--fk-text);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .agc-code{font-size:10px;font-family:var(--fk-font-mono,ui-monospace,monospace);color:var(--fk-text-muted);margin-top:2px}
    .agc-contact{font-size:11px;color:var(--fk-text-muted);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .agc-rank{position:absolute;top:13px;right:14px;font-size:10px;font-weight:600;color:var(--fk-text-muted);background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:99px;padding:1px 7px}
    .agc-stats{display:grid;grid-template-columns:auto 1fr;border-top:1px solid var(--fk-border);background:var(--fk-bg-subtle)}
    .agc-sales{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px 20px;border-right:1px solid var(--fk-border)}
    .agc-sales-v{font-size:24px;font-weight:600;color:var(--fk-text);font-variant-numeric:tabular-nums;line-height:1}
    .agc-sales-l{font-size:9px;color:var(--fk-text-muted);text-transform:uppercase;letter-spacing:.06em;margin-top:4px}
    .agc-comm{padding:11px 14px;display:flex;flex-direction:column;justify-content:center;gap:7px}
    .agc-comm-row{display:flex;align-items:baseline;justify-content:space-between;font-size:11px;color:var(--fk-text-muted)}
    .agc-comm-row .num{font-weight:600;font-variant-numeric:tabular-nums}
    .agc-foot{padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-size:10.5px;color:var(--fk-text-muted);border-top:1px solid var(--fk-border)}
    .agd-hero{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}
    .agd-hero-id{flex:1;min-width:0}
    .agd-hero-code{font-size:12px;font-family:var(--fk-font-mono,ui-monospace,monospace);color:var(--fk-text-muted);margin-top:3px}
    .agd-hero-acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}
    .agd-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px;margin-top:16px;padding-top:16px;border-top:1px solid var(--fk-border)}
    .agd-target{margin-top:14px;padding:12px 14px;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:var(--fk-radius-control)}
    .agd-target-hd{display:flex;justify-content:space-between;font-size:11px;color:var(--fk-text-muted);margin-bottom:6px}
    .agd-pb{height:7px;background:var(--fk-bg-card);border:1px solid var(--fk-border);border-radius:99px;overflow:hidden}
    .agd-pf{height:100%;border-radius:99px;background:var(--fk-primary)}
    .agd-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    @media(max-width:900px){.agd-cols{grid-template-columns:1fr}}
    .agd-col{display:flex;flex-direction:column;gap:14px}
    .agd-op{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--fk-border)}
    .agd-op:last-child{border-bottom:none}
    .agd-op-t{font-size:13px;font-weight:500;color:var(--fk-text)}
    .agd-op-s{font-size:11px;color:var(--fk-text-muted);margin-top:2px}
    .agc-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
    @media(max-width:560px){.agc-summary{grid-template-columns:1fr}}
    .ag-doc-img{width:100%;border-radius:var(--fk-radius-control);border:1px solid var(--fk-border)}
    .ag-sub{display:flex;align-items:center;gap:8px;margin:18px 0 10px}
    .ag-sub:first-child{margin-top:2px}
    .ag-sub span{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--fk-text-muted)}
    .ag-up{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:11px;background:var(--fk-bg-subtle);border:1.5px dashed var(--fk-border);border-radius:var(--fk-radius-control);font-size:12.5px;font-weight:500;cursor:pointer;color:var(--fk-text-muted);transition:border-color .15s,color .15s}
    .ag-up:hover{border-color:var(--fk-primary);color:var(--fk-primary)}
    .ag-photo-wrap{display:flex;align-items:center;gap:12px}
    .ag-photo-prev{width:54px;height:54px;border-radius:50%;object-fit:cover;border:1px solid var(--fk-border)}
  `;
  document.head.appendChild(s);
}

// Compact nx-field builder for the agent form (stable af-* ids preserved).
function _agFld(label, id, o) {
  o = o || {};
  const tag = o.el || 'input';
  const ph  = o.ph ? ` placeholder="${esc(o.ph)}"` : '';
  const ax  = o.attrs ? ` ${o.attrs}` : '';
  const req = o.req ? ' <span class="nx-req">*</span>' : '';
  const lbl = `<label class="nx-label" for="${id}">${esc(label)}${req}</label>`;
  let ctrl;
  if (tag === 'textarea') ctrl = `<textarea class="nx-textarea" id="${id}"${ph}${ax} rows="${o.rows||2}"></textarea>`;
  else if (tag === 'select') ctrl = `<select class="nx-select" id="${id}"${ax}>${o.options||''}</select>`;
  else ctrl = `<input class="nx-input" id="${id}" type="${o.type||'text'}"${ph}${ax}>`;
  const foot = o.errId ? `<div class="nx-error" id="${o.errId}"></div>`
             : o.hint  ? `<div class="nx-error" style="color:var(--fk-text-muted)">${esc(o.hint)}</div>` : '';
  return `<div class="nx-field"${o.fieldId?` id="${o.fieldId}"`:''}>${lbl}${ctrl}${foot}</div>`;
}
function _agSub(icon, title) { return `<div class="ag-sub">${NX.ichip(icon, '', { size:'sm' })}<span>${esc(title)}</span></div>`; }

function _agModalHost() {
  let h = document.getElementById('ag-modal-host');
  if (!h) { h = document.createElement('div'); h.id = 'ag-modal-host'; document.body.appendChild(h); }
  return h;
}

function _agAvatar(agent, size = 40) {
  if (agent.profile_photo_url) {
    return `<img src="${esc(agent.profile_photo_url)}" alt="${esc(agent.full_name)}"
      style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0">`;
  }
  const initials = ini(agent.full_name);
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:var(--fk-primary-tint);color:var(--fk-primary);
    display:flex;align-items:center;justify-content:center;font-weight:600;
    font-size:${Math.round(size * 0.38)}px;flex-shrink:0">${initials}</div>`;
}

// Status → kit badge (success / neutral). Single source for list, detail, commissions.
function _agStatusBadge(status) {
  return status === 'active'
    ? NX.badge('Active', 'success', { dot:true })
    : NX.badge('Inactive', '', { dot:true });
}

// Compact PKR (K/M/B) for tight stat surfaces — Western locale.
function _agK(n) {
  n = Number(n || 0); const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return Math.round(n / 1e3) + 'K';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ── LIST PAGE ────────────────────────────────────────────────────────
async function rAgents() {
  const cid = S?.cid;
  const pg  = document.getElementById('pg-agents');
  if (!pg) return;
  if (!cid) { pg.innerHTML = NX.card(NX.empty({ icon:'users', message:'Not logged in.' })); return; }
  _agCSS();

  const canEdit = _canEditAgent();
  const statusSel = [['','Status: All'],['active','Active'],['inactive','Inactive']]
    .map(([v,l]) => `<option value="${v}"${_agStatus===v?' selected':''}>${l}</option>`).join('');
  const sortSel = [['name','Sort: Name'],['sales','Top Sales'],['commission','Top Commission']]
    .map(([v,l]) => `<option value="${v}"${_agSort===v?' selected':''}>${l}</option>`).join('');

  pg.innerHTML =
    '<div class="ani module-agent">' +
      NX.pageHeader('Sales Agents',
        canEdit ? NX.button('Add agent', { variant:'primary', icon:'plus', attrs:'id="um-add-agent-btn"', onclick:'openAgentModal(null)' }) : '',
        { icon:'users', sub:'Your sales team — attribution, targets and commission.' }) +
      '<div class="agc-kpis" id="ag-stats"></div>' +
      `<div class="agc-toolbar">
        <div class="agc-search"><span class="agc-search-ic">${NX.icon('search',15)}</span>
          <input class="nx-input" id="ag-search" placeholder="Name, CNIC, phone, code…" value="${esc(_agSearch)}" oninput="_agDoSearch(this.value)" autocomplete="off"></div>
        <select class="nx-select" id="ag-status-sel" style="max-width:150px" onchange="_agSetStatus(this.value)">${statusSel}</select>
        <select class="nx-select" id="ag-sort-sel" style="max-width:170px" onchange="_agSetSort(this.value)">${sortSel}</select>
        <span class="agc-count" id="ag-count-lbl"></span>
      </div>` +
      '<div id="ag-grid"></div>' +
    '</div>';

  await _loadAgentList();
  _checkAgentLimitUI();
}

async function _checkAgentLimitUI() {
  const btn = document.getElementById('um-add-agent-btn');
  if (!btn) return;
  try {
    const { data, error } = await supabase.rpc('get_plan_limits_with_usage', { p_company_id: S.cid });
    if (error) return;
    const maxAgents     = data?.max_agents || 0;
    const currentAgents = data?.count_agents || 0;
    if (maxAgents > 0 && currentAgents >= maxAgents) {
      btn.disabled    = true;
      btn.title       = `Agent limit reached (${currentAgents}/${maxAgents}). Upgrade your plan to add more.`;
      btn.textContent = `+ Add Agent (${currentAgents}/${maxAgents})`;
    }
  } catch(e) { /* UI hint only — not blocking */ }
}

let _agSearchTimer = null;
function _agDoSearch(v) { _agSearch = v; clearTimeout(_agSearchTimer); _agSearchTimer = setTimeout(_loadAgentList, 300); }
function _agSetStatus(v) { _agStatus = v; _loadAgentList(); }
function _agSetSort(v)   { _agSort   = v; _loadAgentList(); }

async function _loadAgentList() {
  const cid  = S?.cid;
  const grid = document.getElementById('ag-grid');
  if (!grid || !cid) return;
  grid.innerHTML = NX.card(NX.empty({ icon:'users', message:'Loading agents…' }));

  try {
    const { data, error } = await supabase.rpc('list_agents', {
      p_company_id: cid,
      p_search:     _agSearch || null,
      p_status:     _agStatus || null,
      p_sort:       _agSort
    });
    if (error) throw error;

    _agCache = (Array.isArray(data) ? data : []).filter(a => typeof inProj !== 'function' || inProj(a));  // global project lens
    _renderAgentStats(_agCache);
    _renderAgentGrid(_agCache);
  } catch(e) {
    grid.innerHTML = NX.card(NX.banner('Failed to load agents: ' + (e.message || 'Error'), 'danger'));
  }
}

function _renderAgentStats(agents) {
  const el = document.getElementById('ag-stats');
  if (!el) return;
  const active   = agents.filter(a => a.status === 'active').length;
  const totalComm = agents.reduce((s, a) => s + Number(a.total_commission_earned || 0), 0);
  const pendingComm = agents.reduce((s, a) => s + Number(a.total_commission_pending || 0), 0);
  el.innerHTML =
    NX.kpi({ icon:'users',        label:'Total Agents',       value:String(agents.length) }) +
    NX.kpi({ icon:'check-circle', tone:'success', label:'Active', value:String(active) }) +
    NX.kpi({ icon:'hand-coins',   tone:'success', label:'Commission Earned',  value:`PKR ${fM(totalComm)}` }) +
    NX.kpi({ icon:'clock',        tone:'warning', label:'Commission Pending', value:`PKR ${fM(pendingComm)}` });

  const lbl = document.getElementById('ag-count-lbl');
  if (lbl) lbl.textContent = agents.length + (agents.length === 1 ? ' agent' : ' agents');
}

// Warm agent card grid (avatar indigo, kit badge, tinted stat strip, hover lift).
function _renderAgentGrid(agents) {
  const grid = document.getElementById('ag-grid');
  if (!grid) return;
  const canEdit  = _canEditAgent();
  const showRank = _agSort === 'sales' || _agSort === 'commission';

  if (!agents.length) {
    grid.innerHTML = NX.card(NX.empty({
      icon:'users',
      message: (_agSearch||_agStatus) ? 'No agents match your filters.' : (canEdit ? 'No agents yet — add your first sales agent to get started.' : 'No agents added yet.'),
      action: (!_agSearch && !_agStatus && canEdit) ? NX.button('Add agent', { variant:'primary', icon:'plus', onclick:'openAgentModal(null)' }) : ''
    }));
    return;
  }

  grid.innerHTML = `<div class="agc-grid">${agents.map((a, idx) => {
    const pending = Number(a.total_commission_pending || 0);
    const earned  = Number(a.total_commission_earned  || 0);
    const contact = [a.phone, a.email].filter(Boolean).join(' · ') || a.territory || '';
    return `<div class="nx-card nx-card--hover agc-tile" onclick="openAgentDetail('${a.id}')">
      ${showRank ? `<span class="agc-rank">#${idx+1}</span>` : ''}
      <div class="agc-hd">
        ${_agAvatar(a, 44)}
        <div class="agc-id">
          <div class="agc-name">${esc(a.full_name)}</div>
          ${a.agent_code ? `<div class="agc-code">${esc(a.agent_code)}</div>` : ''}
          ${contact ? `<div class="agc-contact">${esc(contact)}</div>` : ''}
        </div>
      </div>
      <div class="agc-stats">
        <div class="agc-sales"><span class="agc-sales-v">${a.total_sales_count || 0}</span><span class="agc-sales-l">Sales</span></div>
        <div class="agc-comm">
          <div class="agc-comm-row"><span>Earned</span><span class="num" style="color:var(--fk-success)">${fM(earned)}</span></div>
          <div class="agc-comm-row"><span>Pending</span><span class="num"${pending>0?' style="color:var(--fk-warning)"':''}>${fM(pending)}</span></div>
        </div>
      </div>
      <div class="agc-foot">
        <span>${Number(a.commission_percent||0)}% commission</span>
        ${_agStatusBadge(a.status)}
      </div>
    </div>`;
  }).join('')}</div>`;
}

// ── DETAIL VIEW ──────────────────────────────────────────────────────
function openAgentDetail(id) { _agId = id; nav('agentdetail'); }

async function rAgentDetail() {
  const pg = document.getElementById('pg-agentdetail');
  if (!pg) return;
  if (!_agId) { nav('agents'); return; }

  pg.innerHTML = `<div class="ani"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div><div class="et">Loading…</div></div></div>`;

  try {
    const [rpcRes, extRes, commRes, subRes] = await Promise.all([
      supabase.rpc('get_agent_360', { p_id: _agId, p_company_id: S.cid }),
      supabase.rpc('get_agent_extended', { p_id: _agId, p_company_id: S.cid }),
      supabase.rpc('list_agent_commission_payments', { p_company_id: S.cid, p_agent_id: _agId }),
      supabase.rpc('list_sub_agents', { p_parent_id: _agId, p_company_id: S.cid })
    ]);

    if (rpcRes.error) throw rpcRes.error;
    if (!rpcRes.data?.success) { nav('agents'); return; }

    const ext      = extRes.data  || {};
    const commPays = commRes.data || [];
    const subAgents= subRes.data  || [];

    // Fetch parent agent name if linked
    let parentAgent = null;
    if (ext.parent_agent_id) {
      const { data: pa } = await supabase.rpc('get_agent_name', { p_id: ext.parent_agent_id });
      parentAgent = pa;
    }

    _renderAgentDetail(rpcRes.data.agent, rpcRes.data.sales || [], ext, commPays, subAgents, parentAgent);
  } catch(e) {
    pg.innerHTML = `<div class="ani"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Failed to load agent</div><div class="es">${esc(e.message)}</div></div></div>`;
  }
}

function _renderAgentDetail(a, sales, ext, commPays, subAgents, parentAgent) {
  _agPrintData = { a, ext, sales, commPays };
  const pg      = document.getElementById('pg-agentdetail');
  const canEdit = _canEditAgent();
  const row     = (l, v) => v ? `<div class="ir"><span class="ir-l">${l}</span><span class="ir-r">${v}</span></div>` : '';

  // Commission totals
  const commPaidTotal   = commPays.reduce((s, p) => s + Number(p.amount || 0), 0);
  const commEarned      = Number(a.total_commission_earned || 0);
  const commPending     = Math.max(0, commEarned - commPaidTotal);

  // Target progress
  const monthlyTarget   = Number(ext.monthly_target || 0);
  const salesAmt        = Number(a.total_sales_amount || 0);
  const targetPct       = monthlyTarget > 0 ? Math.min(100, Math.round(salesAmt / monthlyTarget * 100)) : null;

  // Method label helper
  const methodLbl = m => ({ bank_transfer:'Bank Transfer', cash:'Cash', cheque:'Cheque', online:'Online/Mobile' }[m] || m || '—');

  _agCSS();
  const sec = (icon, tone, title, sub, body, flush) => NX.card(body, { header:{ icon, tone, title, sub }, flush });

  // Anchor contact buttons — NX.button emits <button>, so anchors are hand-built.
  const linkBtn = (href, ic, label, ext2='') => `<a class="nx-btn nx-btn--secondary nx-btn--sm" href="${href}"${ext2}>${NX.icon(ic,15)}<span>${label}</span></a>`;
  const heroActs =
    (a.phone ? linkBtn(`tel:${esc(a.phone)}`, 'phone', 'Call') : '') +
    (a.phone ? linkBtn(`https://wa.me/${(a.phone||'').replace(/\D/g,'')}`, 'message-circle', 'WhatsApp', ' target="_blank"') : '') +
    (a.email ? linkBtn(`mailto:${esc(a.email)}`, 'mail', 'Email') : '') +
    NX.button('Print', { variant:'secondary', size:'sm', icon:'printer', onclick:'printAgentProfile()' }) +
    (canEdit ? NX.button('Edit', { variant:'secondary', size:'sm', icon:'pencil', onclick:`openAgentModal('${a.id}')` }) : '');

  const heroStats =
    NX.kpi({ tint:'primary', label:'Total Sales',   value:String(a.total_sales_count || 0) }) +
    NX.kpi({ label:'Portfolio',      value:`PKR ${_agK(salesAmt)}` }) +
    NX.kpi({ tint:'success', label:'Comm. Earned',  value:`PKR ${_agK(commEarned)}` }) +
    NX.kpi({ label:'Comm. Paid',     value:`PKR ${_agK(commPaidTotal)}` }) +
    NX.kpi({ tint: commPending>0?'warning':'success', label:'Comm. Pending', value:`PKR ${_agK(commPending)}` });

  const targetBar = targetPct !== null ? `<div class="agd-target">
    <div class="agd-target-hd"><span>Monthly Target Progress</span><span style="color:var(--fk-text)">${targetPct}% · PKR ${_agK(salesAmt)} / ${_agK(monthlyTarget)}</span></div>
    <div class="agd-pb"><div class="agd-pf" style="width:${targetPct}%;background:${targetPct>=100?'var(--fk-success)':targetPct>=30?'var(--fk-primary)':'var(--fk-danger)'}"></div></div>
  </div>` : '';

  const heroCard = NX.card(
    `<div class="agd-hero">${_agAvatar(a, 60)}
      <div class="agd-hero-id">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h1 class="nx-page-title" style="font-size:22px">${esc(a.full_name)}</h1>${_agStatusBadge(a.status)}</div>
        <div class="agd-hero-code">${esc(a.agent_code||'')}</div>
        ${parentAgent ? `<div style="font-size:12px;color:var(--fk-text-muted);margin-top:4px">Reports to <strong style="color:var(--fk-text)">${esc(parentAgent.full_name)}</strong></div>` : ''}
        <div class="agd-hero-acts">${heroActs}</div>
      </div>
    </div>
    <div class="agd-stats">${heroStats}</div>${targetBar}`);

  const commLedgerBody = commPays.length === 0
    ? NX.empty({ icon:'hand-coins', message:'No commission payments recorded yet.' })
    : `<table class="nx-table"><thead><tr><th>Date</th><th class="num">Amount</th><th>Method</th><th>Reference</th><th>Notes</th>${canEdit?'<th></th>':''}</tr></thead><tbody>
       ${commPays.map(p => `<tr>
         <td>${fD(p.payment_date)}</td>
         <td class="num" style="color:var(--fk-success);font-weight:600">PKR ${fM(p.amount)}</td>
         <td>${methodLbl(p.payment_method)}</td>
         <td class="nx-mono">${esc(p.reference_no||'—')}</td>
         <td style="color:var(--fk-text-muted)">${esc(p.notes||'')}</td>
         ${canEdit?`<td class="num">${NX.button('Delete',{variant:'ghost',size:'sm',onclick:`deleteCommPay('${p.id}')`})}</td>`:''}
       </tr>`).join('')}</tbody></table>
       <div style="padding:10px 14px;border-top:1px solid var(--fk-border);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12px">
         <span>Total Paid: <strong style="color:var(--fk-success)">PKR ${fM(commPaidTotal)}</strong></span>
         <span>Still Pending: <strong style="color:var(--fk-warning)">PKR ${fM(commPending)}</strong></span>
       </div>`;

  const salesBody = !sales.length
    ? NX.empty({ icon:'trending-up', message:'No sales yet — units sold by this agent will appear here.' })
    : `<table class="nx-table"><thead><tr><th>Unit</th><th>Project</th><th>Client</th><th>Date</th><th class="num">Price</th><th class="num">Commission</th></tr></thead><tbody>
       ${sales.map(s => `<tr>
         <td style="font-weight:600">${esc(s.unit_no||s.unit_code||'—')}</td>
         <td style="color:var(--fk-text-muted)">${esc(s.project_name||'—')}</td>
         <td>${esc(s.client_name||'—')}</td>
         <td style="color:var(--fk-text-muted)">${fD(s.sale_date)}</td>
         <td class="num">${fMF(s.net_amount)}</td>
         <td class="num" style="color:var(--fk-success);font-weight:600">${fMF(s.commission_amount)}</td>
       </tr>`).join('')}</tbody></table>
       <div style="padding:10px 14px;border-top:1px solid var(--fk-border);font-size:12px;color:var(--fk-text-muted);display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
         <span>Portfolio: <strong style="color:var(--fk-text)">${fMF(a.total_sales_amount)}</strong></span>
         <span>Commission: <strong style="color:var(--fk-success)">${fMF(commEarned)}</strong></span>
       </div>`;

  const subAgentsBody = !subAgents.length ? '' :
    `<table class="nx-table"><thead><tr><th>Name</th><th>Code</th><th class="num">Sales</th><th class="num">Comm %</th><th>Status</th><th></th></tr></thead><tbody>
     ${subAgents.map(s => `<tr>
       <td style="font-weight:500">${esc(s.full_name)}</td>
       <td class="nx-mono">${esc(s.agent_code||'')}</td>
       <td class="num">${s.total_sales_count||0}</td>
       <td class="num">${Number(s.commission_percent||0)}%</td>
       <td>${_agStatusBadge(s.status)}</td>
       <td class="num">${NX.button('View',{variant:'ghost',size:'sm',onclick:`_agId='${s.id}';rAgentDetail()`})}</td>
     </tr>`).join('')}</tbody></table>`;

  const opsBody = canEdit ? `
    <div class="agd-op"><div><div class="agd-op-t">Edit agent profile</div><div class="agd-op-s">Contact info, commission rate, bank details</div></div>${NX.button('Edit',{variant:'secondary',size:'sm',icon:'pencil',onclick:`openAgentModal('${a.id}')`})}</div>
    <div class="agd-op"><div><div class="agd-op-t">Pay commission</div><div class="agd-op-s">Record a disbursement · Pending <strong style="color:var(--fk-warning)">PKR ${fM(commPending)}</strong></div></div>${NX.button('Pay',{variant:'primary',size:'sm',icon:'hand-coins',onclick:`openCommPayModal('${a.id}','${esc(a.full_name)}',${commPending})`})}</div>
    <div class="agd-op"><div><div class="agd-op-t">Merge into another agent</div><div class="agd-op-s">Same person, two records? Move all sales, commission &amp; login to the keeper, then remove this duplicate</div></div>${NX.button('Merge',{variant:'secondary',size:'sm',icon:'git-merge',onclick:`openMergeAgentModal('${a.id}','${esc(a.full_name)}')`})}</div>
    ${a.status==='active'
      ? `<div class="agd-op"><div><div class="agd-op-t">Deactivate agent</div><div class="agd-op-s">Remove from active duty — sales history preserved</div></div>${NX.button('Deactivate',{variant:'danger-soft',size:'sm',onclick:`deactivateAgent('${a.id}')`})}</div>`
      : `<div class="agd-op"><div><div class="agd-op-t">Reactivate agent</div><div class="agd-op-s">Restore this agent to active status</div></div>${NX.button('Reactivate',{variant:'secondary',size:'sm',onclick:`reactivateAgent('${a.id}')`})}</div>`}
    <div class="agd-op"><div><div class="agd-op-t" style="color:var(--fk-danger)">Delete agent</div><div class="agd-op-s">Permanent — only if no sales on record</div></div>${NX.button('Delete',{variant:'danger-soft',size:'sm',icon:'trash-2',onclick:`deleteAgentConfirm('${a.id}')`})}</div>` : '';

  const docsBody = (a.cnic_front_url || a.cnic_back_url || ext.contract_doc_url) ? `
    ${(a.cnic_front_url || a.cnic_back_url) ? `<div style="display:flex;gap:10px;flex-wrap:wrap">
      ${a.cnic_front_url ? `<div style="flex:1;min-width:110px"><div style="font-size:11px;color:var(--fk-text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">CNIC Front</div><a href="${esc(a.cnic_front_url)}" target="_blank"><img class="ag-doc-img" src="${esc(a.cnic_front_url)}"></a></div>` : ''}
      ${a.cnic_back_url ? `<div style="flex:1;min-width:110px"><div style="font-size:11px;color:var(--fk-text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">CNIC Back</div><a href="${esc(a.cnic_back_url)}" target="_blank"><img class="ag-doc-img" src="${esc(a.cnic_back_url)}"></a></div>` : ''}
    </div>` : ''}
    ${ext.contract_doc_url ? `<div style="margin-top:12px"><div style="font-size:11px;color:var(--fk-text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">Agent Contract</div><a href="${esc(ext.contract_doc_url)}" target="_blank" class="nx-btn nx-btn--secondary nx-btn--sm">${NX.icon('file-text',15)}<span>View contract</span></a></div>` : ''}` : '';

  pg.innerHTML = `<div class="ani">
    <div id="ad-form-nav"></div>
    <div class="pd-actions no-p" style="margin-bottom:16px">${NX.button('Back',{variant:'ghost',icon:'arrow-left',onclick:"nav('agents')"})}</div>
    <div style="margin-bottom:16px">${heroCard}</div>
    <div id="ag-tabs" style="margin-bottom:14px"></div>
    <div id="ag-tab-overview">
      <div class="agd-cols">
        <div class="agd-col">
          ${sec('user','','Personal Info','',
            row('Full Name', esc(a.full_name)) +
            row('Agent Code', `<span class="nx-mono">${esc(a.agent_code)}</span>`) +
            row('Phone', a.phone ? `<a href="tel:${esc(a.phone)}" style="color:var(--fk-info)">${esc(a.phone)}</a>` : null) +
            row('Email', a.email ? `<a href="mailto:${esc(a.email)}" style="color:var(--fk-info)">${esc(a.email)}</a>` : null) +
            row('CNIC', esc(a.cnic)) +
            row('Address', esc(a.address)) +
            row('Join Date', fD(a.join_date)) +
            (a.termination_date ? row('Termination', fD(a.termination_date)) : '') +
            row('Status', _agStatusBadge(a.status)))}
          ${(ext.territory || ext.monthly_target || ext.quarterly_target || parentAgent) ? sec('map-pin','','Territory & Targets','',
            row('Territory', esc(ext.territory)) +
            row('Reports To', parentAgent ? `<strong>${esc(parentAgent.full_name)}</strong> <span class="nx-mono" style="font-size:11px;color:var(--fk-text-muted)">${esc(parentAgent.agent_code||'')}</span>` : null) +
            row('Monthly Target', ext.monthly_target ? `PKR ${fM(ext.monthly_target)}` : null) +
            row('Quarterly Target', ext.quarterly_target ? `PKR ${fM(ext.quarterly_target)}` : null)) : ''}
          ${sec('banknote','','Commission & Bank','',
            row('Commission Rate', `<strong style="color:var(--fk-success)">${Number(a.commission_percent || 0)}%</strong>`) +
            row('Bank', esc(a.bank_name)) +
            row('Account No.', a.bank_account_no ? `<span class="nx-mono">${esc(a.bank_account_no)}</span>` : null) +
            row('Account Title', esc(a.bank_account_title)))}
          ${a.notes ? sec('file-text','','Notes','', `<div style="font-size:13px;color:var(--fk-text);line-height:1.6">${esc(a.notes)}</div>`) : ''}
          ${docsBody ? sec('image','','Documents','', docsBody) : ''}
        </div>
        <div class="agd-col">
          ${canEdit ? sec('settings','','Operations','', opsBody) : ''}
          ${NX.card(commLedgerBody, { header:{ icon:'hand-coins', tone:'success', title:'Commission Ledger', sub:`${commPays.length} payment${commPays.length !== 1 ? 's' : ''} recorded` }, flush: commPays.length>0 })}
          ${NX.card(salesBody, { header:{ icon:'trending-up', title:'Sales History', sub:`${sales.length} sale${sales.length !== 1 ? 's' : ''}` }, flush: sales.length>0 })}
          ${subAgentsBody ? NX.card(subAgentsBody, { header:{ icon:'users', title:'Sub-agents', sub:`${subAgents.length}` }, flush:true }) : ''}
        </div>
      </div>
    </div>
    <div id="ag-tab-ledger" data-agent-id="${a.id}" style="display:none"><div id="ag-ledger-body"></div></div>
  </div>`;

  _agRenderTabs('overview');

  // Mount reusable form-nav bar
  if (typeof mountFormNav === 'function') {
    mountFormNav({
      targetSel: '#ad-form-nav',
      entity:    'agent',
      dateField: 'created_at',
      currentId: a.id,
      storageKey:'rms.fnav.agent',
      loadList: async () => {
        try {
          const { data } = await supabase.rpc('list_agents_for_fnav', { p_company_id: S.cid });
          return data || [];
        } catch (e) { console.error('[fnav agent]', e); return []; }
      },
      openEntry: (id) => openAgentDetail(id),
      onEdit:    (id) => canEdit && (typeof openAgentModal === 'function') && openAgentModal(id),
      onDelete:  async () => {
        if (typeof toast === 'function') toast('Use Deactivate instead — agents with sales cannot be hard-deleted.', 'warn');
      }
    });
  }
}

// ── AGENT LEDGER TAB ─────────────────────────────────────────────────

function _agRenderTabs(active) {
  const el = document.getElementById('ag-tabs');
  if (!el) return;
  el.innerHTML = NX.tabs({ tabs: [
    { k:'overview', label:'Overview', icon:'list' },
    { k:'ledger',   label:'Ledger',   icon:'banknote' }
  ], active, onSelect:"agSwitchTab('%k')" });
}

function agSwitchTab(tab) {
  ['overview','ledger'].forEach(t => {
    const c = document.getElementById('ag-tab-'+t);
    if (c) c.style.display = t === tab ? '' : 'none';
  });
  _agRenderTabs(tab);
  if (tab === 'ledger') {
    const el   = document.getElementById('ag-tab-ledger');
    const body = document.getElementById('ag-ledger-body');
    const aid  = el?.dataset?.agentId;
    if (aid && body && body.dataset.loaded !== aid) _agLoadLedger(aid);
  }
}

async function _agLoadLedger(agentId) {
  const el = document.getElementById('ag-ledger-body');
  if (!el) return;
  el.innerHTML = NX.card(NX.empty({ icon:'banknote', message:'Loading…' }));

  const { data, error } = await supabase.rpc('get_agent_ledger', {
    p_agent_id: agentId, p_company_id: S.cid
  });
  if (error || !data?.success) {
    el.innerHTML = NX.card(NX.banner('Could not load ledger: ' + (data?.error || error?.message || 'Error'), 'danger'));
    return;
  }

  const rows = data.rows || [];

  if (!rows.length) {
    el.innerHTML = NX.card(NX.empty({ icon:'banknote', message:'No transactions yet — commission earned and payment records will appear here.' }),
      { header:{ icon:'hand-coins', tone:'success', title:'Commission Ledger' } });
    el.dataset.loaded = agentId;
    return;
  }

  // Compute running balance in JS
  let totalEarned = 0, totalPaid = 0, balance = 0;
  const enriched = rows.map(r => {
    const earned = Number(r.earned || 0);
    const paid   = Number(r.paid   || 0);
    totalEarned += earned;
    totalPaid   += paid;
    balance      = balance + earned - paid;
    return { ...r, _earned: earned, _paid: paid, _balance: balance };
  });
  const pending = totalEarned - totalPaid;

  const body = `<table class="nx-table">
      <thead><tr>
        <th>Date</th><th>Description</th>
        <th class="num">Earned</th><th class="num">Paid</th><th class="num">Balance</th>
      </tr></thead>
      <tbody>
      ${enriched.map(r => `<tr>
        <td style="white-space:nowrap;color:var(--fk-text-muted)">${fD(r.row_date)}</td>
        <td style="color:var(--fk-text-muted)">${esc(r.description || '')}</td>
        <td class="num" style="color:var(--fk-success);font-weight:600">${r._earned > 0 ? fM(r._earned) : '<span style="color:var(--fk-text-muted)">—</span>'}</td>
        <td class="num" style="font-weight:600">${r._paid   > 0 ? fM(r._paid)   : '<span style="color:var(--fk-text-muted)">—</span>'}</td>
        <td class="num" style="font-weight:600;color:${r._balance > 0 ? 'var(--fk-danger)' : 'var(--fk-success)'}">${fM(Math.abs(r._balance))}</td>
      </tr>`).join('')}
      </tbody>
    </table>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--fk-border)">
      <div style="padding:12px 16px;border-right:1px solid var(--fk-border);text-align:center">
        <div style="font-size:10px;color:var(--fk-text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Total Earned</div>
        <div class="num" style="font-size:15px;font-weight:600;color:var(--fk-success)">PKR ${fM(totalEarned)}</div>
      </div>
      <div style="padding:12px 16px;border-right:1px solid var(--fk-border);text-align:center">
        <div style="font-size:10px;color:var(--fk-text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Total Paid</div>
        <div class="num" style="font-size:15px;font-weight:600;color:var(--fk-text)">PKR ${fM(totalPaid)}</div>
      </div>
      <div style="padding:12px 16px;text-align:center">
        <div style="font-size:10px;color:var(--fk-text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Pending Balance</div>
        <div class="num" style="font-size:15px;font-weight:600;color:${pending > 0 ? 'var(--fk-danger)' : 'var(--fk-success)'}">${pending > 0 ? 'PKR ' + fM(pending) : 'Nil'}</div>
      </div>
    </div>`;

  el.innerHTML = NX.card(body, { header:{ icon:'hand-coins', tone:'success', title:'Commission Ledger', sub:`${rows.length} entr${rows.length !== 1 ? 'ies' : 'y'}` }, flush:true });
  el.dataset.loaded = agentId;
}

// ── AGENT FORM — lean, host-injected nx-modal (essentials + More disclosure) ──
function _agFormBody(isEdit) {
  const bankOpts = ['Meezan Bank','HBL','UBL','MCB Bank','Standard Chartered','Bank Alfalah','Faysal Bank','Allied Bank','Habib Metropolitan Bank','Askari Bank','Bank Al-Habib','JS Bank','Silk Bank','Summit Bank','Other'];
  const bankSel  = '<option value="">— Select bank —</option>' + bankOpts.map(b => `<option>${esc(b)}</option>`).join('');
  const statusOpts = '<option value="active">Active</option><option value="inactive">Inactive</option>';
  const moreOpen = isEdit;   // editors usually touch the extended fields

  const essentials =
    `<input type="hidden" id="af-agent-id">` +
    _agFld('Full name', 'af-name', { ph:'Agent full name', req:true, errId:'e-af-name', fieldId:'af-name-field' }) +
    `<div class="nx-grid-2">` +
      _agFld('Phone', 'af-phone', { type:'tel', ph:'Phone number', req:true, errId:'e-af-phone', fieldId:'af-phone-field' }) +
      (isEdit
        ? _agFld('Project', 'af-project', { el:'select', attrs:'disabled', hint:'Project is fixed after creation.' })
        : _agFld('Project', 'af-project', { el:'select', req:true, errId:'e-af-project', fieldId:'af-project-field' })) +
    `</div>` +
    `<div class="nx-grid-2">` +
      _agFld('Default commission %', 'af-commission', { type:'number', ph:'Optional — set at sale time', attrs:'min="0" max="100" step="0.01"', errId:'e-af-comm', fieldId:'af-comm-field' }) +
      _agFld('Status', 'af-status', { el:'select', options:statusOpts }) +
    `</div>`;

  const more =
    _agSub('user', 'Contact & identity') +
    `<div class="nx-grid-2">` + _agFld('Email', 'af-email', { type:'email', ph:'agent@business.com' }) + _agFld('CNIC', 'af-cnic', { ph:'42101-1234567-1', attrs:'maxlength="15"', errId:'e-af-cnic', fieldId:'af-cnic-field' }) + `</div>` +
    `<div class="nx-grid-2">` + _agFld('Join date', 'af-join-date', { type:'date' }) + _agFld('Address', 'af-address', { ph:'Home or office address' }) + `</div>` +
    `<div class="ag-photo-wrap">
      <img id="af-photo-preview" src="data:," alt="" class="ag-photo-prev" style="display:none">
      <label class="ag-up" style="flex:1">${NX.icon('image',15)}<span>Profile photo</span><input id="af-photo-file" type="file" accept="image/jpeg,image/png" style="display:none" onchange="_agPreviewPhoto(this)"></label>
      <label class="ag-up" style="flex:none">📷<span>Camera</span><input id="af-photo-cam" type="file" accept="image/jpeg,image/png" capture="user" style="display:none" onchange="_agPreviewPhoto(this)"></label>
    </div>` +
    `<div class="nx-grid-2" style="margin-top:10px">
      <label class="ag-up">${NX.icon('image',15)}<span id="af-cnic-front-lbl">CNIC front · Browse</span><input id="af-cnic-front-file" type="file" accept="image/jpeg,image/png,application/pdf" style="display:none" onchange="document.getElementById('af-cnic-front-lbl').textContent=this.files[0]?.name||'CNIC front · Browse'"></label>
      <label class="ag-up">📷<span id="af-cnic-front-cam-lbl">CNIC front · Camera</span><input id="af-cnic-front-cam" type="file" accept="image/jpeg,image/png" capture="environment" style="display:none" onchange="document.getElementById('af-cnic-front-cam-lbl').textContent=this.files[0]?.name||'CNIC front · Camera'"></label>
    </div>` +
    `<div class="nx-grid-2" style="margin-top:10px">
      <label class="ag-up">${NX.icon('image',15)}<span id="af-cnic-back-lbl">CNIC back · Browse</span><input id="af-cnic-back-file" type="file" accept="image/jpeg,image/png,application/pdf" style="display:none" onchange="document.getElementById('af-cnic-back-lbl').textContent=this.files[0]?.name||'CNIC back · Browse'"></label>
      <label class="ag-up">📷<span id="af-cnic-back-cam-lbl">CNIC back · Camera</span><input id="af-cnic-back-cam" type="file" accept="image/jpeg,image/png" capture="environment" style="display:none" onchange="document.getElementById('af-cnic-back-cam-lbl').textContent=this.files[0]?.name||'CNIC back · Camera'"></label>
    </div>` +

    _agSub('banknote', 'Commission & bank') +
    `<div class="nx-grid-2">` + _agFld('Bank name', 'af-bank-name', { el:'select', options:bankSel }) + _agFld('Account number', 'af-bank-acct', { ph:'Account number' }) + `</div>` +
    _agFld('Account title', 'af-bank-title', { ph:'As per bank records' }) +

    _agSub('map-pin', 'Territory & targets') +
    `<div class="nx-grid-2">` + _agFld('Territory / area', 'af-territory', { ph:'e.g. Falcon Heights, Sapphire Town' }) + _agFld('Reports to', 'af-parent-agent', { el:'select', options:'<option value="">— Independent agent —</option>', hint:'Leave blank unless under a senior agent.' }) + `</div>` +
    `<div class="nx-grid-2">` + _agFld('Monthly target (PKR)', 'af-monthly-target', { type:'number', ph:'0', attrs:'min="0" step="10000"' }) + _agFld('Quarterly target (PKR)', 'af-quarterly-target', { type:'number', ph:'0', attrs:'min="0" step="10000"' }) + `</div>` +

    _agSub('file-text', 'Contract & notes') +
    `<label class="ag-up">${NX.icon('file-text',15)}<span id="af-contract-lbl">Browse contract (PDF / image)</span><input id="af-contract-file" type="file" accept="image/jpeg,image/png,application/pdf" style="display:none" onchange="document.getElementById('af-contract-lbl').textContent=this.files[0]?.name||'Browse contract (PDF / image)'"></label>
    <div id="af-contract-prev"></div>` +
    `<div style="margin-top:10px">` + _agFld('Notes', 'af-notes', { el:'textarea', ph:'Any additional notes…' }) + `</div>`;

  return essentials +
    `<button type="button" class="nx-btn nx-btn--secondary nx-btn--sm" id="af-more-btn" onclick="agToggleMore()" style="margin-top:6px">` +
      `<span id="af-more-ico" style="display:inline-flex">${NX.icon(moreOpen?'chevron-up':'chevron-down',15)}</span><span id="af-more-txt">${moreOpen?'Fewer details':'More details'}</span></button>` +
    `<div id="af-more"${moreOpen?'':' style="display:none"'}>${more}</div>`;
}

function agToggleMore() {
  const more = document.getElementById('af-more'), txt = document.getElementById('af-more-txt'), ico = document.getElementById('af-more-ico');
  if (!more) return;
  const open = more.style.display === 'none';
  more.style.display = open ? '' : 'none';
  if (txt) txt.textContent = open ? 'Fewer details' : 'More details';
  if (ico) ico.innerHTML = NX.icon(open ? 'chevron-up' : 'chevron-down', 15);
}

async function openAgentModal(agentId) {
  if (!_canEditAgent()) { toast('You do not have permission to edit agents', 'warn'); return; }
  _agCSS();
  const isEdit = !!agentId;

  _agModalHost().innerHTML = NX.modal({
    id:'m-agent', title: isEdit ? 'Edit agent' : 'New agent', size:'l',
    onClose:'closeAgentModal()',
    body: _agFormBody(isEdit),
    footer: NX.button('Cancel', { variant:'secondary', onclick:'closeAgentModal()' }) +
            NX.button(isEdit ? 'Save changes' : 'Create agent', { variant:'primary', attrs:'id="ag-save-btn"', onclick:'saveAgentForm()' })
  });

  document.getElementById('af-agent-id').value = agentId || '';
  const sv = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };

  // Parent-agent dropdown — ALL agents (inactive flagged) so an assigned inactive parent isn't dropped.
  const parentSel = document.getElementById('af-parent-agent');
  if (parentSel) {
    try {
      const { data: allAgents } = await supabase.rpc('list_agents_lookup', { p_company_id: S.cid });
      const candidates = (allAgents || []).filter(a => a.id !== agentId);
      parentSel.innerHTML = `<option value="">— Independent agent —</option>` +
        candidates.map(a => { const inactive = a.status && a.status !== 'active';
          return `<option value="${a.id}">${esc(a.full_name)}${inactive?' (inactive)':''}</option>`; }).join('');
    } catch(e) { parentSel.innerHTML = `<option value="">— Could not load agents (will retry on save) —</option>`; }
  }

  if (isEdit) {
    const a = _agCache.find(x => x.id === agentId);
    if (a) {
      sv('af-name', a.full_name); sv('af-email', a.email); sv('af-cnic', a.cnic);
      sv('af-commission', a.commission_percent); sv('af-status', a.status || 'active');
      sv('af-address', a.address); sv('af-notes', a.notes); sv('af-bank-name', a.bank_name);
      sv('af-bank-acct', a.bank_account_no); sv('af-bank-title', a.bank_account_title); sv('af-join-date', a.join_date || '');
      const prevPhoto = document.getElementById('af-photo-preview');
      if (a.profile_photo_url && prevPhoto) { prevPhoto.src = a.profile_photo_url; prevPhoto.style.display = 'block'; }
    }
    try {
      const { data: ext } = await supabase.rpc('get_agent_extended', { p_id: agentId, p_company_id: S.cid });
      if (ext) {
        sv('af-territory', ext.territory); sv('af-monthly-target', ext.monthly_target); sv('af-quarterly-target', ext.quarterly_target);
        if (parentSel && ext.parent_agent_id) parentSel.value = ext.parent_agent_id;
        if (ext.contract_doc_url) {
          const cl = document.getElementById('af-contract-lbl'); if (cl) cl.textContent = 'Contract on file — browse to replace';
          const cp = document.getElementById('af-contract-prev');
          if (cp) cp.innerHTML = `<a href="${esc(ext.contract_doc_url)}" target="_blank" style="display:inline-block;margin-top:8px;font-size:12px;color:var(--fk-info)">View existing contract</a>`;
        }
      }
    } catch(e) {}
  } else {
    sv('af-join-date', new Date().toISOString().slice(0,10));
  }

  _afPopulateProjects('', isEdit);

  // Lazy-load intl-tel-input on demand (perf Win #3), then wire the phone field.
  (window.ensureIntlTel ? window.ensureIntlTel() : Promise.resolve()).catch(function(){}).then(() => {
    const phoneInp = document.getElementById('af-phone');
    if (!phoneInp) return;
    if (_agIti) { try { _agIti.destroy(); } catch(e) {} _agIti = null; }
    if (window.intlTelInput) {
      _agIti = window.intlTelInput(phoneInp, {
        initialCountry: 'pk', preferredCountries: ['pk','ae','sa','gb','us'],
        separateDialCode: true, utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@23.1.0/build/js/utils.js'
      });
      if (isEdit) { const a = _agCache.find(x => x.id === agentId); if (a?.phone) { try { _agIti.setNumber(a.phone); } catch(e) { phoneInp.value = a.phone; } } }
    } else if (isEdit) { const a = _agCache.find(x => x.id === agentId); if (a?.phone) phoneInp.value = a.phone; }
  });
}

function closeAgentModal() { if (_agIti) { try { _agIti.destroy(); } catch(e) {} _agIti = null; } const h = document.getElementById('ag-modal-host'); if (h) h.innerHTML = ''; }

// Fill the picker with the caller's accessible projects. Disabled on edit (project is immutable).
function _afPopulateProjects(selectedId, isEdit) {
  const sel = document.getElementById('af-project');
  if (!sel) return;
  const all = (typeof gprojects === 'function' ? gprojects() : (window._projectsCache || []))
    .filter(p => typeof hasProjectAccess !== 'function' || hasProjectAccess(p.id));
  sel.innerHTML = ['<option value="">— Select project —</option>']
    .concat(all.map(p => `<option value="${esc(p.id)}">${esc(p.projectName || p.name || 'Project')}</option>`))
    .join('');
  if (selectedId) sel.value = selectedId;
  else if (!isEdit && all.length === 1) sel.value = all[0].id;
  sel.disabled = !!isEdit;
}

// ── File upload helper ───────────────────────────────────────────────
async function _uploadAgentFile(file, agentId, field) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${S.cid}/agents/${agentId || 'new'}/${field}_${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage.from('agent-documents').upload(path, file, { upsert: true });
  if (error) throw new Error('Upload failed: ' + error.message);
  const { data: urlData } = supabase.storage.from('agent-documents').getPublicUrl(path);
  return urlData.publicUrl;
}

// ── Save ─────────────────────────────────────────────────────────────
async function saveAgentForm() {
  const name       = document.getElementById('af-name')?.value?.trim();
  const rawPhone   = document.getElementById('af-phone')?.value?.trim() || '';
  const itiNum     = _agIti ? _agIti.getNumber() : '';
  const phone      = itiNum.replace(/\D/g,'').length > 4 ? itiNum : rawPhone;
  const commission = parseFloat(document.getElementById('af-commission')?.value);

  let hasErr = false;
  const setErr = (id, msg, inputId) => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    const inp = document.getElementById(inputId || id.slice(2));
    const fld = inp ? inp.closest('.nx-field') : null;
    if (fld) fld.classList.toggle('nx-field--error', !!msg);
    if (msg) hasErr = true;
  };

  setErr('e-af-name',
    !name            ? 'Full name is required' :
    name.length < 2  ? 'Min 2 characters' :
    /\d/.test(name)  ? 'Name cannot contain numbers' : '');

  setErr('e-af-phone',
    !phone || phone.replace(/\D/g,'').length < 7 ? 'Valid phone is required' : '');

  setErr('e-af-comm',
    (!isNaN(commission) && (commission < 0 || commission > 100)) ? 'Must be 0–100%' : '', 'af-commission');

  const cnic = document.getElementById('af-cnic')?.value?.trim() || '';
  if (cnic && !/^\d{5}-\d{7}-\d$/.test(cnic)) {
    setErr('e-af-cnic', 'Format: 12345-1234567-1');
    hasErr = true;
  } else {
    setErr('e-af-cnic', '');
  }

  // Project is required on create (immutable on edit, where the picker is disabled)
  const _afIsCreate = !(document.getElementById('af-agent-id')?.value?.trim());
  const projId = (document.getElementById('af-project')?.value || '').trim();
  if (_afIsCreate) setErr('e-af-project', !projId ? 'Project is required' : '', 'af-project');

  if (hasErr) return;

  const saveBtn = document.getElementById('ag-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  const _wasEdit = !!(document.getElementById('af-agent-id')?.value?.trim());

  try {
    const existingId = document.getElementById('af-agent-id')?.value?.trim() || '';
    const isEdit     = !!existingId;

    // Handle file uploads (browse OR camera input)
    const photoFile    = document.getElementById('af-photo-file')?.files?.[0]       || document.getElementById('af-photo-cam')?.files?.[0];
    const cnicFFile    = document.getElementById('af-cnic-front-file')?.files?.[0]   || document.getElementById('af-cnic-front-cam')?.files?.[0];
    const cnicBFile    = document.getElementById('af-cnic-back-file')?.files?.[0]    || document.getElementById('af-cnic-back-cam')?.files?.[0];

    const agentIdForUpload = existingId || 'temp-' + Date.now();
    let profilePhotoUrl = null, cnicFrontUrl = null, cnicBackUrl = null;

    if (photoFile)  profilePhotoUrl = await _uploadAgentFile(photoFile,  agentIdForUpload, 'photo');
    if (cnicFFile)  cnicFrontUrl    = await _uploadAgentFile(cnicFFile,  agentIdForUpload, 'cnic_front');
    if (cnicBFile)  cnicBackUrl     = await _uploadAgentFile(cnicBFile,  agentIdForUpload, 'cnic_back');

    let result;
    if (isEdit) {
      const params = {
        p_id:                 existingId,
        p_company_id:         S.cid,
        p_full_name:          name,
        p_phone:              phone,
        p_email:              document.getElementById('af-email')?.value?.trim()      || null,
        p_cnic:               cnic || null,
        p_address:            document.getElementById('af-address')?.value?.trim()    || null,
        p_commission_percent: isNaN(commission) ? null : commission,
        p_bank_name:          document.getElementById('af-bank-name')?.value?.trim()  || null,
        p_bank_account_no:    document.getElementById('af-bank-acct')?.value?.trim()  || null,
        p_bank_account_title: document.getElementById('af-bank-title')?.value?.trim() || null,
        p_join_date:          document.getElementById('af-join-date')?.value          || null,
        p_notes:              document.getElementById('af-notes')?.value?.trim()      || null,
        p_status:             document.getElementById('af-status')?.value             || 'active'
      };
      if (profilePhotoUrl) params.p_profile_photo_url = profilePhotoUrl;
      if (cnicFrontUrl)    params.p_cnic_front_url    = cnicFrontUrl;
      if (cnicBackUrl)     params.p_cnic_back_url     = cnicBackUrl;
      const { data, error } = await supabase.rpc('update_agent', params);
      if (error) throw error;
      result = data;
    } else {
      let limRes;
      try {
        limRes = await supabase.rpc('get_plan_limits_with_usage', { p_company_id: S.cid });
      } catch(e) {
        toast('Could not verify plan limits. Check your connection and try again.', 'err');
        return;
      }
      if (limRes?.error) {
        toast('Could not verify plan limits. Check your connection and try again.', 'err');
        return;
      }
      const maxAgents     = limRes.data?.max_agents || 0;
      const currentAgents = limRes.data?.count_agents || 0;
      if (maxAgents > 0 && currentAgents >= maxAgents) {
        toast(`Agent limit reached — your plan allows ${maxAgents} agents. Upgrade your plan to add more.`, 'err');
        return;
      }
      const { data, error } = await supabase.rpc('create_agent', {
        p_company_id:         S.cid,
        p_project_id:         projId,
        p_created_by:         S.userId,
        p_full_name:          name,
        p_phone:              phone,
        p_email:              document.getElementById('af-email')?.value?.trim()      || null,
        p_cnic:               cnic || null,
        p_address:            document.getElementById('af-address')?.value?.trim()    || null,
        p_commission_percent: isNaN(commission) ? null : commission,
        p_bank_name:          document.getElementById('af-bank-name')?.value?.trim()  || null,
        p_bank_account_no:    document.getElementById('af-bank-acct')?.value?.trim()  || null,
        p_bank_account_title: document.getElementById('af-bank-title')?.value?.trim() || null,
        p_join_date:          document.getElementById('af-join-date')?.value          || null,
        p_notes:              document.getElementById('af-notes')?.value?.trim()      || null,
        p_status:             document.getElementById('af-status')?.value             || 'active'
      });
      if (error) throw error;
      result = data;
    }

    if (!result?.success) {
      if (result?.error === 'plan_limit') {
        toast(result.message || 'Plan limit reached. Upgrade to add more agents.', 'warn');
      } else if (result?.error === 'duplicate_cnic') {
        setErr('e-af-cnic', result.message || 'CNIC already exists');
      } else {
        toast(result?.message || 'Failed to save agent', 'err');
      }
      return;
    }

    // If new agent and we uploaded files with temp ID, re-upload with real ID
    if (!isEdit && (photoFile || cnicFFile || cnicBFile) && result.agent_id) {
      const patchParams = { p_id: result.agent_id, p_company_id: S.cid };
      if (profilePhotoUrl) patchParams.p_profile_photo_url = profilePhotoUrl;
      if (cnicFrontUrl)    patchParams.p_cnic_front_url    = cnicFrontUrl;
      if (cnicBackUrl)     patchParams.p_cnic_back_url     = cnicBackUrl;
      await supabase.rpc('update_agent', patchParams);
    }

    // Save extended fields via direct update
    const finalId = isEdit ? existingId : result.agent_id;
    if (finalId) {
      const contractFile = document.getElementById('af-contract-file')?.files?.[0];
      const extPatch = {
        territory:        document.getElementById('af-territory')?.value?.trim()           || null,
        monthly_target:   parseFloat(document.getElementById('af-monthly-target')?.value)  || null,
        quarterly_target: parseFloat(document.getElementById('af-quarterly-target')?.value)|| null,
        parent_agent_id:  document.getElementById('af-parent-agent')?.value                || null,
      };
      if (contractFile) {
        extPatch.contract_doc_url = await _uploadAgentFile(contractFile, finalId, 'contract');
      }
      await supabase.rpc('update_agent_extended', { p_id: finalId, p_company_id: S.cid, p_data: extPatch });
    }

    toast(isEdit ? 'Agent updated!' : `Agent added! Code: ${result.agent_code || ''}`, 'ok');
    closeAgentModal();
    await _loadAgentList();
    if (!isEdit && result.agent_id) { _agId = result.agent_id; nav('agentdetail'); }

  } catch(e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = _wasEdit ? 'Save changes' : 'Create agent'; }
  }
}

// ── Status actions ───────────────────────────────────────────────────
async function deactivateAgent(id) {
  if (!confirm('Deactivate this agent? They will no longer appear as active.')) return;
  const { data, error } = await supabase.rpc('update_agent', {
    p_id: id, p_company_id: S.cid, p_status: 'inactive',
    p_termination_date: new Date().toISOString().slice(0,10)
  });
  if (error || !data?.success) { toast('Failed to deactivate agent', 'err'); return; }
  toast('Agent deactivated', 'ok');
  await rAgentDetail();
  _loadAgentList();
}

async function reactivateAgent(id) {
  const { data, error } = await supabase.rpc('update_agent', {
    p_id: id, p_company_id: S.cid, p_status: 'active', p_termination_date: null
  });
  if (error || !data?.success) { toast('Failed to reactivate agent', 'err'); return; }
  toast('Agent reactivated', 'ok');
  await rAgentDetail();
  _loadAgentList();
}

async function deleteAgentConfirm(id) {
  const agent = _agCache.find(a => a.id === id);
  const name  = agent?.full_name || 'this agent';

  if (typeof cascadeDelete === 'function') {
    await cascadeDelete({
      entity:      'agent',
      displayName: name,
      id:          id,
      checks: [
        { table: 'sales',                      fk: 'agent_id', label: 'sale record' },
        { table: 'agent_commission_payments',  fk: 'agent_id', label: 'commission payment' },
        { table: 'agents',                     fk: 'parent_agent_id', label: 'sub-agent reporting to this one' }
      ],
      onDelete: async () => {
        const { data, error } = await supabase.rpc('delete_agent', { p_id: id, p_company_id: S.cid });
        if (error) throw error;
        if (data?.action === 'deactivated') {
          // Server soft-deleted instead — surface as a warning, not an error
          throw new Error('Server deactivated this agent instead of deleting (some data still references them).');
        }
      },
      onSuccess: async () => { nav('agents'); _loadAgentList(); }
    });
    return;
  }

  // Legacy fallback
  const salesCount = Number(agent?.total_sales_count || 0);
  if (salesCount > 0) {
    toast(`Cannot delete — "${name}" has ${salesCount} sale record${salesCount > 1 ? 's' : ''}. Use Deactivate instead.`, 'err');
    return;
  }
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  const { data, error } = await supabase.rpc('delete_agent', { p_id: id, p_company_id: S.cid });
  if (error) { toast('Error: ' + error.message, 'err'); return; }
  if (data?.action === 'deactivated') {
    toast(`"${name}" has sales on record — deactivated to preserve data integrity.`, 'warn');
    await rAgentDetail();
  } else {
    toast('Agent deleted', 'ok'); nav('agents');
  }
  _loadAgentList();
}

// ── Merge duplicate agent into a keeper ──────────────────────────────
function openMergeAgentModal(sourceId, sourceName) {
  if (!_canEditAgent()) { toast('You do not have permission to merge agents', 'warn'); return; }
  const opts = (_agCache || [])
    .filter(a => a.id !== sourceId)
    .map(a => `<option value="${a.id}">${esc(a.full_name || '?')}${a.agent_code ? ' — ' + esc(a.agent_code) : ''}${Number(a.total_sales_count) ? ' · ' + a.total_sales_count + ' sales' : ''}</option>`)
    .join('');
  const body =
    `<div style="font-size:13px;color:var(--fk-text);margin-bottom:var(--fk-sp-3)">
       Merge <b>${esc(sourceName)}</b> into the agent you pick below. All of <b>${esc(sourceName)}</b>'s sales,
       commissions, transactions and sign-in will move to the keeper, then <b>${esc(sourceName)}</b> will be removed.
       This cannot be undone.
     </div>
     <label class="nx-label">Keep this agent (merge target)</label>
     <select id="merge-target" class="nx-select"><option value="">— pick the agent to keep —</option>${opts}</select>
     <div class="nx-error" id="merge-err" style="display:none;margin-top:var(--fk-sp-2)"></div>`;
  _agModalHost().innerHTML = NX.modal({
    id: 'm-merge', title: 'Merge agent', size: 'm', onClose: 'closeAgentModal()',
    body,
    footer: NX.button('Cancel', { variant:'secondary', onclick:'closeAgentModal()' }) +
            NX.button('Merge & remove duplicate', { variant:'danger-soft', attrs:'id="merge-go-btn"', onclick:`doMergeAgent('${sourceId}','${esc(sourceName)}')` })
  });
}

async function doMergeAgent(sourceId, sourceName) {
  const targetId = (document.getElementById('merge-target') || {}).value || '';
  const err = document.getElementById('merge-err');
  const showErr = (m) => { if (err) { err.textContent = m; err.style.display = 'block'; } };
  if (!targetId) { showErr('Pick the agent to keep.'); return; }
  if (targetId === sourceId) { showErr('Pick a different agent.'); return; }
  const btn = document.getElementById('merge-go-btn'); if (btn) btn.setAttribute('disabled','disabled');
  try {
    const { data, error } = await supabase.rpc('merge_agents', { p_source: sourceId, p_target: targetId });
    if (error) throw error;
    if (!data || !data.success) { if (btn) btn.removeAttribute('disabled'); showErr((data && data.message) || 'Could not merge.'); return; }
    closeAgentModal();
    toast(`Merged "${data.source_name}" into "${data.target_name}" — ${data.moved_sales} sale${data.moved_sales === 1 ? '' : 's'} moved.`, 'ok');
    _agId = targetId; nav('agentdetail'); _loadAgentList();
  } catch (e) { if (btn) btn.removeAttribute('disabled'); showErr('Could not merge this agent.'); }
}

// ── Pay Commission page (tabbed: Payouts | Structures) ───────────────
let _commTab = 'payouts';

async function rCommissions() {
  const pg = document.getElementById('pg-commissions');
  if (!pg) return;
  if (!S?.cid) { pg.innerHTML = NX.card(NX.empty({ icon:'hand-coins', message:'Not logged in.' })); return; }
  _agCSS();

  pg.innerHTML =
    '<div class="ani">' +
      NX.pageHeader('Commissions',
        '<span id="comm-ph-actions"></span>',
        { icon:'hand-coins', tone:'success', sub:'Agent payouts and per-project commission rate configuration.' }) +
      '<div id="comm-tabs" style="margin-bottom:16px"></div>' +
      '<div id="comm-tab-payouts"></div>' +
      '<div id="comm-tab-structures" style="display:none"></div>' +
    '</div>';

  _commTab = 'payouts';
  _commRenderTabs('payouts');
  await _commLoadPayouts();
}

function _commRenderTabs(active) {
  const el = document.getElementById('comm-tabs');
  if (!el) return;
  el.innerHTML = NX.tabs({ tabs: [
    { k:'payouts',    label:'Payouts',                icon:'hand-coins' },
    { k:'structures', label:'Commission Structures',  icon:'settings' }
  ], active, onSelect:"_commSwitchTab('%k')" });
}

function _commSwitchTab(tab) {
  _commTab = tab;
  ['payouts','structures'].forEach(t => {
    const el = document.getElementById('comm-tab-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  _commRenderTabs(tab);
  if (tab === 'payouts')    _commLoadPayouts();
  if (tab === 'structures') _commLoadStructures();
}

// ── Payouts tab ───────────────────────────────────────────────────────
async function _commLoadPayouts() {
  const el = document.getElementById('comm-tab-payouts');
  if (!el) return;
  const ph = document.getElementById('comm-ph-actions');
  if (ph) ph.innerHTML = '';
  el.innerHTML = NX.card(NX.empty({ icon:'hand-coins', message:'Loading…' }));
  try {
    const { data: overview, error: ovErr } = await supabase.rpc('get_commissions_overview', { p_company_id: S.cid });
    if (ovErr) throw ovErr;

    const agents = overview?.agents   || [];
    const pays   = overview?.payments || [];
    const paidMap = {};
    pays.forEach(p => { paidMap[p.agent_id] = (paidMap[p.agent_id] || 0) + Number(p.amount || 0); });

    const rows = agents.map(a => {
      const earned  = Number(a.total_commission_earned || 0);
      const paid    = paidMap[a.id] || 0;
      const pending = Math.max(0, earned - paid);
      return { ...a, earned, paid, pending };
    });
    const totalEarned  = rows.reduce((s, r) => s + r.earned,  0);
    const totalPaid    = rows.reduce((s, r) => s + r.paid,    0);
    const totalPending = rows.reduce((s, r) => s + r.pending, 0);
    const canEdit      = _canEditAgent();

    const summary = '<div class="agc-summary">' +
      NX.kpi({ icon:'hand-coins', tone:'success', label:'Total Earned',  value:`PKR ${_agK(totalEarned)}` }) +
      NX.kpi({ icon:'check-circle', label:'Total Paid', value:`PKR ${_agK(totalPaid)}` }) +
      NX.kpi({ icon:'clock', tone:'warning', label:'Total Pending', value:`PKR ${_agK(totalPending)}` }) +
      '</div>';

    const table = rows.length === 0
      ? NX.card(NX.empty({ icon:'users', message:'No agents found.' }))
      : NX.card(
          `<table class="nx-table"><thead><tr><th>Agent</th><th>Status</th><th class="num">Earned</th><th class="num">Paid</th><th class="num">Pending</th>${canEdit?'<th class="num"></th>':''}</tr></thead><tbody>
           ${rows.map(r => `<tr>
             <td><div style="font-weight:500">${esc(r.full_name)}</div><div class="nx-mono" style="font-size:11px;color:var(--fk-text-muted)">${esc(r.agent_code||'')}</div></td>
             <td>${_agStatusBadge(r.status)}</td>
             <td class="num" style="color:var(--fk-success);font-weight:600">${fMF(r.earned)}</td>
             <td class="num">${fMF(r.paid)}</td>
             <td class="num" style="font-weight:600;color:${r.pending>0?'var(--fk-warning)':'var(--fk-text-muted)'}">${fMF(r.pending)}</td>
             ${canEdit?`<td class="num"><div style="display:inline-flex;gap:6px;justify-content:flex-end">${NX.button('Pay',{variant:'primary',size:'sm',icon:'hand-coins',onclick:`openCommPayModal('${r.id}','${esc(r.full_name)}',${r.pending})`})}${NX.button('Statement',{variant:'ghost',size:'sm',onclick:`printAgentStatement('${r.id}')`})}</div></td>`:''}
           </tr>`).join('')}</tbody></table>`,
          { header:{ icon:'users', title:'Agents', sub:`${rows.length} agent${rows.length !== 1 ? 's' : ''}` }, flush:true });

    el.innerHTML = summary + table;
  } catch(e) {
    el.innerHTML = NX.card(NX.banner('Failed to load commissions: ' + (e.message || 'Error'), 'danger'));
  }
}

// ── Commission Structures tab ─────────────────────────────────────────
let _csData      = [];
let _csEditId    = null;
let _csProjects  = [];

async function _commLoadStructures() {
  const el = document.getElementById('comm-tab-structures');
  if (!el) return;
  const ph = document.getElementById('comm-ph-actions');
  if (ph && _canEditAgent()) {
    ph.innerHTML = NX.button('Add structure', { variant:'primary', size:'sm', icon:'plus', onclick:'_csOpenForm(null)' });
  }
  el.innerHTML = NX.card(NX.empty({ icon:'settings', message:'Loading…' }));

  try {
    const [csRes, prRes] = await Promise.all([
      supabase.rpc('list_commission_structures', { p_company_id: S.cid }),
      supabase.from('projects').select('id,project_name').eq('company_id', S.cid).order('project_name'),
    ]);
    _csData     = Array.isArray(csRes.data) ? csRes.data : [];
    _csProjects = Array.isArray(prRes.data) ? prRes.data : [];
    _csRender(el);
  } catch(e) {
    el.innerHTML = NX.card(NX.banner('Failed to load structures: ' + (e.message || 'Error'), 'danger'));
  }
}

function _csRender(container) {
  const el      = container || document.getElementById('comm-tab-structures');
  if (!el) return;
  const canEdit = _canEditAgent();

  const intro = NX.banner('Lookup order: Agent + Project → Project Default → Company Default → Agent\'s global rate. Milestone splits define how commission is distributed between booking and possession.', 'info');

  if (!_csData.length) {
    el.innerHTML = `<div style="margin-bottom:14px">${intro}</div>` + NX.card(NX.empty({
      icon:'settings', message:'No commission structures configured — add one to define per-project or agent-specific rates.',
      action: canEdit ? NX.button('Add structure', { variant:'primary', icon:'plus', onclick:'_csOpenForm(null)' }) : ''
    }));
    return;
  }

  el.innerHTML = `<div style="margin-bottom:14px">${intro}</div>` + NX.card(
    `<table class="nx-table"><thead><tr>
        <th>Project</th><th>Agent</th><th class="num">Rate</th><th class="num">Booking</th><th class="num">Possession</th><th>Status</th>${canEdit?'<th class="num"></th>':''}
      </tr></thead><tbody>
      ${_csData.map(cs => {
        const projLbl = cs.project_name ? esc(cs.project_name) : '<span style="color:var(--fk-text-muted);font-style:italic">Company-wide default</span>';
        const agntLbl = cs.agent_name
          ? `${esc(cs.agent_name)} <span class="nx-mono" style="font-size:10px;color:var(--fk-text-muted)">${esc(cs.agent_code||'')}</span>`
          : '<span style="color:var(--fk-text-muted);font-style:italic">All agents</span>';
        const bookPct = Number(cs.milestone_booking_pct || 50);
        const possPct = Number(cs.milestone_possession_pct || 50);
        return `<tr>
          <td style="font-weight:500">${projLbl}</td>
          <td>${agntLbl}</td>
          <td class="num" style="font-weight:600;color:var(--fk-primary)">${Number(cs.rate_percent)}%</td>
          <td class="num">${bookPct}%</td>
          <td class="num">${possPct}%</td>
          <td>${cs.is_active ? NX.badge('Active','success',{dot:true}) : NX.badge('Inactive','',{dot:true})}</td>
          ${canEdit?`<td class="num"><div style="display:inline-flex;gap:6px;justify-content:flex-end">${NX.button('Edit',{variant:'ghost',size:'sm',onclick:`_csOpenForm('${cs.id}')`})}${NX.button('Delete',{variant:'ghost',size:'sm',onclick:`_csDelete('${cs.id}')`})}</div></td>`:''}
        </tr>`;
      }).join('')}</tbody></table>`,
    { header:{ icon:'settings', title:'Commission Structures', sub:`${_csData.length} rule${_csData.length !== 1 ? 's' : ''}` }, flush:true });
}

// Host-injected lean structure form (replaces the legacy .mov inline modal).
function _csFormHost() {
  let h = document.getElementById('cs-modal-host');
  if (!h) { h = document.createElement('div'); h.id = 'cs-modal-host'; document.body.appendChild(h); }
  return h;
}

async function _csOpenForm(id) {
  _csEditId = id || null;
  _agCSS();
  const projOpts = '<option value="">— Company-wide default —</option>' + _csProjects.map(p => `<option value="${p.id}">${esc(p.project_name)}</option>`).join('');
  const body =
    `<input type="hidden" id="cs-id">` +
    `<div class="nx-grid-2">` +
      `<div class="nx-field"><label class="nx-label" for="cs-project-id">Project <span class="nx-error" style="display:inline;color:var(--fk-text-muted);text-transform:none;letter-spacing:0;font-weight:400">(blank = company default)</span></label><select class="nx-select" id="cs-project-id">${projOpts}</select></div>` +
      `<div class="nx-field"><label class="nx-label" for="cs-agent-id">Agent <span class="nx-error" style="display:inline;color:var(--fk-text-muted);text-transform:none;letter-spacing:0;font-weight:400">(blank = all agents)</span></label><select class="nx-select" id="cs-agent-id"><option value="">— All agents —</option></select></div>` +
    `</div>` +
    `<div class="nx-field"><label class="nx-label" for="cs-rate">Commission rate (%) <span class="nx-req">*</span></label><input class="nx-input" id="cs-rate" type="number" min="0" max="100" step="0.5" placeholder="e.g. 2.5"></div>` +
    `<div class="nx-field"><label class="nx-label">Milestone splits <span style="color:var(--fk-text-muted);font-weight:400;text-transform:none;letter-spacing:0">(total ≤ 100%)</span></label>
      <div class="nx-grid-2">
        <div class="nx-field" style="margin:0"><label class="nx-label" for="cs-book-pct">On booking (%)</label><input class="nx-input" id="cs-book-pct" type="number" min="0" max="100" step="5" value="50"></div>
        <div class="nx-field" style="margin:0"><label class="nx-label" for="cs-poss-pct">On possession (%)</label><input class="nx-input" id="cs-poss-pct" type="number" min="0" max="100" step="5" value="50"></div>
      </div></div>` +
    `<div class="nx-field"><label class="nx-label" for="cs-active">Status</label><select class="nx-select" id="cs-active"><option value="true">Active</option><option value="false">Inactive</option></select></div>` +
    `<div class="nx-field"><label class="nx-label" for="cs-notes">Notes</label><textarea class="nx-textarea" id="cs-notes" rows="2" placeholder="Optional notes…"></textarea></div>` +
    `<div class="nx-error" id="csm-err"></div>`;

  _csFormHost().innerHTML = NX.modal({
    id:'m-cs-form', title: id ? 'Edit commission structure' : 'Add commission structure', size:'m',
    onClose:'_csCloseForm()', body,
    footer: NX.button('Cancel', { variant:'secondary', onclick:'_csCloseForm()' }) +
            NX.button('Save structure', { variant:'primary', attrs:'id="csm-save-btn"', onclick:'_csSave()' })
  });

  document.getElementById('cs-id').value = id || '';

  // Populate agent dropdown
  const agSel = document.getElementById('cs-agent-id');
  if (agSel && _agCache.length === 0) {
    try {
      const { data } = await supabase.rpc('list_agents_lookup', { p_company_id: S.cid });
      agSel.innerHTML = `<option value="">— All agents —</option>` +
        (data||[]).map(a => `<option value="${a.id}">${esc(a.agent_name||a.full_name)} (${a.agent_code||''})</option>`).join('');
    } catch(e) {}
  } else if (agSel) {
    agSel.innerHTML = `<option value="">— All agents —</option>` +
      _agCache.map(a => `<option value="${a.id}">${esc(a.full_name)} (${a.agent_code||''})</option>`).join('');
  }

  if (id) {
    const cs = _csData.find(x => x.id === id);
    if (cs) {
      document.getElementById('cs-project-id').value = cs.project_id || '';
      if (agSel) agSel.value = cs.agent_id || '';
      document.getElementById('cs-rate').value     = cs.rate_percent;
      document.getElementById('cs-book-pct').value = cs.milestone_booking_pct;
      document.getElementById('cs-poss-pct').value = cs.milestone_possession_pct;
      document.getElementById('cs-active').value   = cs.is_active ? 'true' : 'false';
      document.getElementById('cs-notes').value    = cs.notes || '';
    }
  }
}

function _csCloseForm() { const h = document.getElementById('cs-modal-host'); if (h) h.innerHTML = ''; }

async function _csSave() {
  const rate     = parseFloat(document.getElementById('cs-rate')?.value);
  const bookPct  = parseFloat(document.getElementById('cs-book-pct')?.value || 50);
  const possPct  = parseFloat(document.getElementById('cs-poss-pct')?.value || 50);
  const errEl    = document.getElementById('csm-err');

  if (isNaN(rate) || rate < 0 || rate > 100) {
    errEl.textContent = 'Commission rate must be between 0 and 100%'; errEl.style.display = ''; return;
  }
  if (bookPct + possPct > 100.01) {
    errEl.textContent = 'Booking + Possession splits cannot exceed 100%'; errEl.style.display = ''; return;
  }
  errEl.style.display = 'none';

  const btn = document.getElementById('csm-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const { data, error } = await supabase.rpc('upsert_commission_structure', {
      p_company_id: S.cid,
      p_data: {
        id:                      document.getElementById('cs-id')?.value || '',
        project_id:              document.getElementById('cs-project-id')?.value || '',
        agent_id:                document.getElementById('cs-agent-id')?.value   || '',
        rate_percent:            rate,
        milestone_booking_pct:   bookPct,
        milestone_possession_pct: possPct,
        is_active:               document.getElementById('cs-active')?.value === 'true',
        notes:                   document.getElementById('cs-notes')?.value?.trim() || '',
        created_by:              S.name || '',
      }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Save failed');
    toast(_csEditId ? 'Structure updated' : 'Structure added', 'ok');
    _csCloseForm();
    await _commLoadStructures();
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message; errEl.style.display = '';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Structure'; }
  }
}

async function _csDelete(id) {
  if (!confirm('Delete this commission structure?')) return;
  try {
    const { data, error } = await supabase.rpc('delete_commission_structure', { p_id: id, p_company_id: S.cid });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Delete failed');
    toast('Structure deleted', 'ok');
    await _commLoadStructures();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

// ── Commission Payment Modal ─────────────────────────────────────────
function _cpFormHost() {
  let h = document.getElementById('cp-modal-host');
  if (!h) { h = document.createElement('div'); h.id = 'cp-modal-host'; document.body.appendChild(h); }
  return h;
}
function closeCommPayModal() { const h = document.getElementById('cp-modal-host'); if (h) h.innerHTML = ''; }

function openCommPayModal(agentId, agentName, commPending) {
  if (!_canEditAgent()) { toast('Permission denied', 'warn'); return; }
  _agCSS();

  // Store agent context for voucher generation
  const ac = _agCache.find(a => a.id === agentId) || {};
  const ad = (_agPrintData?.a?.id === agentId) ? _agPrintData.a : {};
  _agCommPayTarget = {
    id:          agentId,
    name:        agentName,
    code:        ac.agent_code  || ad.agent_code  || '',
    cnic:        ad.cnic        || '',
    phone:       ad.phone       || '',
    commEarned:  Number(ac.total_commission_earned || ad.total_commission_earned || 0),
    commPending: Number(commPending || 0)
  };

  const today = new Date().toISOString().slice(0, 10);
  const methodOpts = '<option value="bank_transfer">Bank Transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="online">Online / Mobile</option>';
  const body =
    `<input type="hidden" id="cp-agent-id" value="${esc(agentId)}">` +
    `<div style="display:flex;align-items:center;gap:10px;background:var(--fk-warning-surface,var(--fk-bg-subtle));border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);padding:10px 14px;margin-bottom:14px;font-size:13px;font-weight:500">${esc(agentName)} <span style="color:var(--fk-text-muted);font-weight:400">· pending</span> <span style="color:var(--fk-warning);font-weight:600">PKR ${fM(commPending)}</span></div>` +
    `<div class="nx-grid-2">` +
      `<div class="nx-field"><label class="nx-label" for="cp-amount">Amount (PKR) <span class="nx-req">*</span></label><input class="nx-input" id="cp-amount" type="number" min="1" step="1" value="${commPending > 0 ? Math.round(commPending) : ''}" placeholder="0.00"><div class="nx-error" id="e-cp-amount"></div></div>` +
      `<div class="nx-field"><label class="nx-label" for="cp-date">Payment date <span class="nx-req">*</span></label><input class="nx-input" id="cp-date" type="date" value="${today}"></div>` +
    `</div>` +
    `<div class="nx-grid-2">` +
      `<div class="nx-field"><label class="nx-label" for="cp-method">Payment method</label><select class="nx-select" id="cp-method">${methodOpts}</select></div>` +
      `<div class="nx-field"><label class="nx-label" for="cp-refno">Reference no</label><input class="nx-input" id="cp-refno" type="text" placeholder="Transaction / cheque no"></div>` +
    `</div>` +
    `<div class="nx-field"><label class="nx-label" for="cp-notes">Notes</label><textarea class="nx-textarea" id="cp-notes" rows="2" placeholder="Optional notes…"></textarea></div>` +
    `<div class="nx-error" id="cp-err"></div>`;

  _cpFormHost().innerHTML = NX.modal({
    id:'m-comm-pay', title:'Record commission payment', size:'m', onClose:'closeCommPayModal()', body,
    footer: `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--fk-text-muted);cursor:pointer;margin-right:auto"><input type="checkbox" id="cp-print-voucher" checked style="accent-color:var(--fk-primary)"> Print voucher</label>` +
            NX.button('Cancel', { variant:'secondary', onclick:'closeCommPayModal()' }) +
            NX.button('Record payment', { variant:'primary', attrs:'id="cp-save-btn"', onclick:'saveCommPayForm()' })
  });
}

async function saveCommPayForm() {
  const agentId       = document.getElementById('cp-agent-id').value;
  const amount        = parseFloat(document.getElementById('cp-amount').value);
  const date          = document.getElementById('cp-date').value;
  const paymentMethod = document.getElementById('cp-method').value || 'bank_transfer';
  const refno         = document.getElementById('cp-refno').value?.trim() || null;
  const notes         = document.getElementById('cp-notes').value?.trim() || null;
  const doPrintVoucher= document.getElementById('cp-print-voucher')?.checked;
  const errEl         = document.getElementById('cp-err');
  const amtErr        = document.getElementById('e-cp-amount');

  amtErr.textContent = '';
  errEl.textContent  = '';

  let hasErr = false;
  if (!amount || amount <= 0) { amtErr.textContent = 'Enter a valid amount'; hasErr = true; }
  if (!date) { errEl.textContent = 'Payment date is required'; hasErr = true; }
  if (hasErr) return;

  const saveBtn = document.getElementById('cp-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const { data: result, error } = await supabase.rpc('create_agent_commission_payment_full', {
      p_company_id: S.cid,
      p_data: {
        agent_id:       agentId,
        amount:         amount,
        payment_date:   date,
        payment_method: paymentMethod,
        reference_no:   refno || null,
        notes:          notes || null,
        created_by:     S.userId || null
      }
    });
    if (error) throw error;
    const inserted = result?.row || null;

    toast('Commission payment recorded', 'ok');
    closeCommPayModal();

    if (doPrintVoucher && inserted) {
      const year      = new Date().getFullYear();
      const suffix    = inserted.id.toUpperCase().slice(-6);
      const voucherNo = `CP-${year}-${suffix}`;
      const ct        = _agCommPayTarget || {};
      const earned    = ct.commEarned   || 0;
      const pendBefore= ct.commPending  || 0;
      const paidBefore= Math.max(0, earned - pendBefore);
      const paidAfter = paidBefore + amount;
      const balance   = Math.max(0, earned - paidAfter);
      const methodLbl = { bank_transfer:'Bank Transfer', cash:'Cash', cheque:'Cheque', online:'Online / Mobile Banking' };
      printCommVoucher({
        voucherNo,
        agentName:          ct.name   || '',
        agentCode:          ct.code   || '',
        agentCnic:          ct.cnic   || '',
        agentPhone:         ct.phone  || '',
        amount,
        paymentMethodLabel: methodLbl[paymentMethod] || paymentMethod,
        paymentDate:        date,
        referenceNo:        refno  || '',
        notes:              notes  || '',
        commEarned:         earned,
        commPaidBefore:     paidBefore,
        commPaidAfter:      paidAfter,
        commBalance:        balance,
        recordedBy:         S.name || ''
      });
    }

    const activePg = document.querySelector('.pg.on')?.id;
    if (activePg === 'pg-commissions') await rCommissions();
    else await rAgentDetail();
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message;
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Record payment'; }
  }
}

async function deleteCommPay(id) {
  if (!confirm('Delete this commission payment record? This cannot be undone.')) return;
  const { error } = await supabase.rpc('delete_agent_commission_payment', { p_id: id, p_company_id: S.cid });
  if (error) { toast('Error: ' + error.message, 'err'); return; }
  toast('Payment record deleted', 'ok');
  const activePg = document.querySelector('.pg.on')?.id;
  if (activePg === 'pg-commissions') await rCommissions();
  else await rAgentDetail();
}

// ── Agent Commission Statement ────────────────────────────────────────
async function printAgentStatement(agentId) {
  if (!agentId) { toast('No agent selected', 'warn'); return; }
  try {
    const [agRes, payRes] = await Promise.all([
      supabase.rpc('get_agent_360',               { p_id: agentId, p_company_id: S.cid }),
      supabase.rpc('list_agent_commission_payments',{ p_company_id: S.cid, p_agent_id: agentId })
    ]);
    if (agRes.error) throw agRes.error;

    const a      = agRes.data?.agent  || {};
    const sales  = agRes.data?.sales  || [];
    const pays   = Array.isArray(payRes.data) ? payRes.data : [];

    const commEarned  = Number(a.total_commission_earned || 0);
    const commPaidTotal = pays.reduce((s, p) => s + Number(p.amount || 0), 0);
    const commPending   = Math.max(0, commEarned - commPaidTotal);

    const fmtD = s => s ? new Date(s).toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'}) : '—';
    const fmtM = n => Number(n||0).toLocaleString('en-PK',{minimumFractionDigits:0,maximumFractionDigits:0});
    const coName   = S?.coName  || 'Company';
    const today    = fmtD(new Date());
    const stmtNo   = `CS-${new Date().getFullYear()}-${agentId.toUpperCase().slice(-6)}`;

    // group sales by project
    const byProject = {};
    sales.forEach(s => {
      const key = s.project_name || 'Unknown Project';
      if (!byProject[key]) byProject[key] = [];
      byProject[key].push(s);
    });

    const salesSections = Object.entries(byProject).map(([proj, rows]) => {
      const projTotal = rows.reduce((s, r) => s + Number(r.commission_amount || 0), 0);
      return `
        <div class="sec-title">${esc(proj)}</div>
        <table>
          <thead><tr>
            <th>Unit</th><th>Client</th><th>Sale Date</th>
            <th class="r">Sale Amount</th><th class="r">Rate</th><th class="r">Commission</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td style="font-family:monospace;font-weight:600">${esc(r.unit_no||r.unit_code||'—')}</td>
              <td>${esc(r.client_name||'—')}</td>
              <td>${fmtD(r.sale_date)}</td>
              <td class="r">PKR ${fmtM(r.net_amount)}</td>
              <td class="r">${Number(r.commission_rate||r.commission_percent||0)}%</td>
              <td class="r" style="color:#16a34a;font-weight:700">PKR ${fmtM(r.commission_amount)}</td>
            </tr>`).join('')}
            <tr class="subtotal-row">
              <td colspan="5" style="text-align:right;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#555">Project Total</td>
              <td class="r" style="font-weight:800;color:#16a34a">PKR ${fmtM(projTotal)}</td>
            </tr>
          </tbody>
        </table>`;
    }).join('') || `<div class="empty-note">No sales on record for this agent.</div>`;

    const payRows = pays.length > 0
      ? pays.map(p => `<tr>
          <td style="font-family:monospace;font-size:10px">${fmtD(p.payment_date)}</td>
          <td>${esc(p.payment_method_label||p.payment_method||'—')}</td>
          <td style="font-family:monospace;font-size:10px;color:#888">${esc(p.reference_no||'—')}</td>
          <td>${esc(p.notes||'')}</td>
          <td class="r" style="color:#16a34a;font-weight:700">PKR ${fmtM(p.amount)}</td>
        </tr>`).join('')
      : `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:10px">No payments on record</td></tr>`;

    const css = `
      body{font-family:'Segoe UI',sans-serif;background:#fff;color:#111;margin:0;padding:0;font-size:11px}
      .page{max-width:750px;margin:0 auto;padding:28px 32px}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #111;margin-bottom:20px}
      .co-name{font-size:20px;font-weight:900;color:#111;letter-spacing:-.5px}
      .co-sub{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-top:2px}
      .stmt-title{text-align:right}
      .stmt-title h1{font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin:0 0 3px;color:#111}
      .stmt-no{font-family:monospace;font-size:12px;color:#666;font-weight:600}
      .stmt-date{font-size:9px;color:#aaa;margin-top:2px}
      .agent-banner{background:#f8f9fa;border-radius:8px;padding:14px 18px;margin-bottom:20px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
      .ab-item .ab-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#888;font-weight:600;margin-bottom:3px}
      .ab-item .ab-val{font-size:13px;font-weight:700;color:#111}
      .summary-strip{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border:2px solid #e5e7eb;border-radius:8px;margin-bottom:20px;overflow:hidden}
      .ss-item{padding:14px 16px;text-align:center}
      .ss-item+.ss-item{border-left:1px solid #e5e7eb}
      .ss-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:#888;font-weight:600;margin-bottom:4px}
      .ss-val{font-size:18px;font-weight:800;font-family:monospace}
      .sec-title{font-size:9px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:#888;margin:18px 0 6px;padding-bottom:4px;border-bottom:1px solid #eee}
      table{width:100%;border-collapse:collapse;margin-bottom:4px}
      th{background:#f3f4f6;font-size:9px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;color:#555;padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb}
      td{padding:5px 8px;border-bottom:1px solid #f3f4f6;font-size:10px;color:#222}
      .r{text-align:right}
      tr.subtotal-row td{background:#f8f9fa;border-top:1px solid #e5e7eb;padding:6px 8px}
      .empty-note{padding:12px;text-align:center;color:#aaa;font-size:10px;border:1px dashed #e5e7eb;border-radius:6px;margin:8px 0}
      .sig-row{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:36px;padding-top:16px}
      .sig-box{text-align:center}
      .sig-line{border-top:1px solid #999;padding-top:6px;margin-top:52px}
      .sig-name{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#333}
      .sig-role{font-size:9px;color:#888;margin-top:1px}
      .footer{font-size:9px;color:#bbb;text-align:center;margin-top:24px;padding-top:10px;border-top:1px solid #f0f0f0}
      @media print{body{-webkit-print-color-adjust:exact}@page{margin:15mm}}
    `;

    const w = typeof _pw === 'function' ? _pw('Commission Statement — ' + (a.full_name||'Agent'), css, 'A4') : null;
    if (!w) return;

    w.document.write(`
      <div class="page">
        <div class="hdr">
          <div>
            <div class="co-name">${esc(coName)}</div>
            <div class="co-sub">Nexunova Recovery Management System</div>
          </div>
          <div class="stmt-title">
            <h1>Agent Commission Statement</h1>
            <div class="stmt-no">${esc(stmtNo)}</div>
            <div class="stmt-date">Generated: ${today}</div>
          </div>
        </div>

        <div class="agent-banner">
          <div class="ab-item">
            <div class="ab-lbl">Agent Name</div>
            <div class="ab-val">${esc(a.full_name||'—')}</div>
          </div>
          <div class="ab-item">
            <div class="ab-lbl">Agent Code</div>
            <div class="ab-val" style="font-family:monospace">${esc(a.agent_code||'—')}</div>
          </div>
          <div class="ab-item">
            <div class="ab-lbl">Phone</div>
            <div class="ab-val">${esc(a.phone||'—')}</div>
          </div>
          <div class="ab-item">
            <div class="ab-lbl">CNIC</div>
            <div class="ab-val" style="font-family:monospace">${esc(a.cnic||'—')}</div>
          </div>
          <div class="ab-item">
            <div class="ab-lbl">Base Rate</div>
            <div class="ab-val">${Number(a.commission_percent||0)}%</div>
          </div>
          <div class="ab-item">
            <div class="ab-lbl">Statement Period</div>
            <div class="ab-val">All Time</div>
          </div>
        </div>

        <div class="summary-strip">
          <div class="ss-item">
            <div class="ss-lbl">Total Earned</div>
            <div class="ss-val" style="color:#16a34a">PKR ${fmtM(commEarned)}</div>
          </div>
          <div class="ss-item">
            <div class="ss-lbl">Total Paid</div>
            <div class="ss-val" style="color:#111">PKR ${fmtM(commPaidTotal)}</div>
          </div>
          <div class="ss-item">
            <div class="ss-lbl">Balance Due</div>
            <div class="ss-val" style="color:${commPending>0?'#ef4444':'#16a34a'}">PKR ${fmtM(commPending)}</div>
          </div>
        </div>

        <!-- Sales breakdown -->
        <div class="sec-title" style="font-size:11px;font-weight:800;color:#111;letter-spacing:0;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:12px">Sales Breakdown</div>
        ${salesSections}

        <!-- Payment history -->
        <div class="sec-title" style="font-size:11px;font-weight:800;color:#111;letter-spacing:0;border-bottom:2px solid #111;padding-bottom:4px;margin:20px 0 12px">Payment History (${pays.length} record${pays.length!==1?'s':''})</div>
        <table>
          <thead><tr>
            <th>Date</th><th>Method</th><th>Reference</th><th>Notes</th><th class="r">Amount</th>
          </tr></thead>
          <tbody>${payRows}</tbody>
          ${pays.length>0?`<tfoot><tr>
            <td colspan="4" style="text-align:right;font-weight:700;font-size:10px;text-transform:uppercase;color:#555;padding:7px 8px;border-top:2px solid #e5e7eb">Total Paid</td>
            <td class="r" style="font-weight:800;color:#16a34a;padding:7px 8px;border-top:2px solid #e5e7eb">PKR ${fmtM(commPaidTotal)}</td>
          </tr></tfoot>`:''}
        </table>

        <div class="sig-row">
          <div class="sig-box">
            <div class="sig-line">
              <div class="sig-name">${esc(a.full_name||'Agent')}</div>
              <div class="sig-role">Agent — Acknowledgement</div>
            </div>
          </div>
          <div class="sig-box">
            <div class="sig-line">
              <div class="sig-name">${esc(coName)}</div>
              <div class="sig-role">Authorized Signatory &amp; Stamp</div>
            </div>
          </div>
        </div>

        <div class="footer">
          ${esc(stmtNo)} &nbsp;·&nbsp; ${esc(coName)} — Nexunova RMS &nbsp;·&nbsp; Printed ${today}
        </div>
      </div>
    `);
    if (typeof _pclose === 'function') _pclose(w);
  } catch(e) {
    toast('Failed to generate statement: ' + e.message, 'err');
  }
}

// ── Print Agent Profile ──────────────────────────────────────────────
function printAgentProfile() {
  if (!_agPrintData) { toast('No agent data loaded', 'warn'); return; }
  const { a, ext, sales, commPays } = _agPrintData;

  const commPaidTotal = commPays.reduce((s, p) => s + Number(p.amount || 0), 0);
  const commEarned    = Number(a.total_commission_earned || 0);
  const commPending   = Math.max(0, commEarned - commPaidTotal);

  const row = (l, v) => (v != null && v !== '')
    ? `<tr>
         <td style="color:#666;padding:5px 10px;width:38%;font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:600">${l}</td>
         <td style="padding:5px 10px;font-size:11px;font-weight:600;color:#111">${v}</td>
       </tr>`
    : '';

  const photoHtml = a.profile_photo_url
    ? `<img src="${a.profile_photo_url}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;float:right;margin:0 0 10px 16px;border:2px solid #C9A84C">`
    : '';

  const salesRows = sales.length > 0
    ? sales.map(s => `<tr>
        <td style="padding:4px 8px;font-size:10px"><strong>${esc(s.unit_no||s.unit_code||'—')}</strong></td>
        <td style="padding:4px 8px;font-size:10px">${esc(s.project_name||'—')}</td>
        <td style="padding:4px 8px;font-size:10px">${esc(s.client_name||'—')}</td>
        <td style="padding:4px 8px;font-size:10px">${fD(s.sale_date)}</td>
        <td style="padding:4px 8px;font-size:10px;text-align:right">PKR ${fM(s.net_amount)}</td>
        <td style="padding:4px 8px;font-size:10px;text-align:right;color:#16a34a;font-weight:700">PKR ${fM(s.commission_amount)}</td>
      </tr>`).join('')
    : `<tr><td colspan="6" style="padding:10px;text-align:center;color:#999;font-size:10px">No sales on record</td></tr>`;

  const w = typeof _pw === 'function' ? _pw('Agent — ' + a.full_name, _pCSS('A4')) : null;
  if (!w) return;

  w.document.write(typeof _lh === 'function' ? _lh('SALES AGENT REGISTRATION FORM') : '');
  w.document.write(`
    <div class="body">
      ${photoHtml}
      <div class="doc-title">${esc(a.full_name)}</div>

      <div class="info-grid">
        <div class="ig-item"><div class="ig-lbl">Agent Code</div><div class="ig-val">${esc(a.agent_code||'—')}</div></div>
        <div class="ig-item"><div class="ig-lbl">Status</div><div class="ig-val">${(a.status||'active').toUpperCase()}</div></div>
        <div class="ig-item"><div class="ig-lbl">Commission Rate</div><div class="ig-val">${Number(a.commission_percent||0)}%</div></div>
        <div class="ig-item"><div class="ig-lbl">Join Date</div><div class="ig-val">${a.join_date ? fD(a.join_date) : '—'}</div></div>
        <div class="ig-item"><div class="ig-lbl">Total Sales</div><div class="ig-val">${a.total_sales_count||0}</div></div>
        <div class="ig-item"><div class="ig-lbl">Portfolio Value</div><div class="ig-val">PKR ${fM(a.total_sales_amount)}</div></div>
      </div>

      <div class="sec-title">Personal Information</div>
      <table><tbody>
        ${row('Full Name',  esc(a.full_name))}
        ${row('CNIC',       esc(a.cnic))}
        ${row('Phone',      esc(a.phone))}
        ${row('Email',      esc(a.email))}
        ${row('Address',    esc(a.address))}
        ${row('Join Date',  a.join_date ? fD(a.join_date) : null)}
      </tbody></table>

      <div class="sec-title">Commission Summary</div>
      <table><tbody>
        ${row('Commission Earned',  'PKR ' + fM(commEarned))}
        ${row('Commission Paid',    'PKR ' + fM(commPaidTotal))}
        ${row('Commission Pending', 'PKR ' + fM(commPending))}
        ${ext?.territory       ? row('Territory',       esc(ext.territory))              : ''}
        ${ext?.monthly_target  ? row('Monthly Target',  'PKR ' + fM(ext.monthly_target)) : ''}
        ${ext?.quarterly_target? row('Quarterly Target','PKR ' + fM(ext.quarterly_target)): ''}
      </tbody></table>

      ${a.bank_name ? `
      <div class="sec-title">Bank Details</div>
      <table><tbody>
        ${row('Bank Name',      esc(a.bank_name))}
        ${row('Account Title',  esc(a.bank_account_title))}
        ${row('Account No.',    esc(a.bank_account_no))}
      </tbody></table>` : ''}

      <div class="sec-title">Sales History (${sales.length} record${sales.length !== 1 ? 's' : ''})</div>
      <table>
        <thead><tr>
          <th>Unit</th><th>Project</th><th>Client</th><th>Date</th>
          <th style="text-align:right">Sale Amount</th><th style="text-align:right">Commission</th>
        </tr></thead>
        <tbody>${salesRows}</tbody>
      </table>

      <div class="sig-row no-break" style="margin-top:32px">
        <div class="sig-box">
          <div style="height:55px"></div>
          <div class="sig-lbl">Agent Signature</div>
          <div class="sig-name">${esc(a.full_name)}</div>
        </div>
        <div class="sig-box">
          <div style="height:55px"></div>
          <div class="sig-lbl">Authorized Signature &amp; Stamp</div>
          <div class="sig-name">${esc(S?.coName || 'Company')}</div>
        </div>
      </div>

      <div class="footer-bar">
        Printed on ${new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'})} &nbsp;·&nbsp;
        ${esc(S?.coName||'Nexunova')} — Nexunova Recovery Management System &nbsp;·&nbsp; Page 1 of 1
      </div>
    </div>
  `);
  if (typeof _pclose === 'function') _pclose(w);
}

// ── Commission Payment Voucher ────────────────────────────────────────
function printCommVoucher(d) {
  const fmtDate = s => s ? new Date(s).toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'}) : '—';
  const fmtAmt  = n => Number(n||0).toLocaleString('en-PK',{minimumFractionDigits:0,maximumFractionDigits:0});

  const today = new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'});
  const coName = S?.coName || 'Company';

  const row = (l, v) => v
    ? `<tr><td style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.4px;font-weight:600;padding:5px 10px;width:40%;border-bottom:1px solid #f0f0f0">${l}</td>
            <td style="font-size:11px;font-weight:600;color:#111;padding:5px 10px;border-bottom:1px solid #f0f0f0">${v}</td></tr>`
    : '';

  const amtInWords = typeof _numToWords === 'function' ? _numToWords(d.amount) : '';

  const css = `
    body{font-family:'Segoe UI',sans-serif;background:#fff;color:#111;margin:0;padding:0}
    .page{max-width:680px;margin:0 auto;padding:28px 32px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #c9a84c}
    .co-name{font-size:18px;font-weight:800;color:#111;margin-bottom:2px}
    .co-sub{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.8px}
    .v-title{text-align:right}
    .v-title h1{font-size:15px;font-weight:800;color:#c9a84c;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px}
    .v-no{font-family:monospace;font-size:13px;color:#333;font-weight:700}
    .v-date{font-size:10px;color:#888;margin-top:2px}
    .amt-box{background:#fffbef;border:2px solid #c9a84c;border-radius:8px;padding:18px 22px;margin:20px 0;text-align:center}
    .amt-lbl{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;font-weight:600}
    .amt-val{font-size:28px;font-weight:800;color:#c9a84c;font-family:monospace}
    .amt-words{font-size:11px;color:#555;margin-top:6px;font-style:italic}
    .section-title{font-size:10px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:#888;margin:18px 0 6px;border-bottom:1px solid #eee;padding-bottom:4px}
    table{width:100%;border-collapse:collapse}
    .comm-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:12px 0}
    .cg-item{background:#f8f9fa;border-radius:6px;padding:10px 14px;text-align:center}
    .cg-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#888;font-weight:600;margin-bottom:4px}
    .cg-val{font-size:13px;font-weight:700;font-family:monospace}
    .sig-row{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:36px}
    .sig-box{text-align:center}
    .sig-line{border-top:1px solid #999;padding-top:6px;margin-top:48px}
    .sig-name{font-size:10px;font-weight:700;color:#333;text-transform:uppercase;letter-spacing:.4px}
    .sig-role{font-size:9px;color:#888;margin-top:1px}
    .footer{font-size:9px;color:#aaa;text-align:center;margin-top:28px;padding-top:10px;border-top:1px solid #eee}
    @media print{body{padding:0}@page{margin:15mm}}
  `;

  const w = typeof _pw === 'function' ? _pw('Commission Voucher ' + d.voucherNo, css, 'A4') : null;
  if (!w) return;

  w.document.write(`
    <div class="page">
      <div class="header">
        <div>
          <div class="co-name">${esc(coName)}</div>
          <div class="co-sub">Nexunova Recovery Management System</div>
        </div>
        <div class="v-title">
          <h1>Commission Payment Voucher</h1>
          <div class="v-no">${esc(d.voucherNo)}</div>
          <div class="v-date">Issued: ${today}</div>
        </div>
      </div>

      <!-- Amount box -->
      <div class="amt-box">
        <div class="amt-lbl">Amount Paid</div>
        <div class="amt-val">PKR ${fmtAmt(d.amount)}</div>
        ${amtInWords ? `<div class="amt-words">${esc(amtInWords)}</div>` : ''}
      </div>

      <!-- Agent details -->
      <div class="section-title">Agent Details</div>
      <table>
        ${row('Agent Name',  esc(d.agentName))}
        ${row('Agent Code',  `<span style="font-family:monospace">${esc(d.agentCode)}</span>`)}
        ${row('CNIC',        esc(d.agentCnic))}
        ${row('Phone',       esc(d.agentPhone))}
      </table>

      <!-- Payment details -->
      <div class="section-title">Payment Details</div>
      <table>
        ${row('Payment Date',   fmtDate(d.paymentDate))}
        ${row('Payment Method', esc(d.paymentMethodLabel))}
        ${row('Reference No',   esc(d.referenceNo) || null)}
        ${row('Notes',          esc(d.notes)        || null)}
        ${row('Recorded By',    esc(d.recordedBy)   || null)}
      </table>

      <!-- Commission summary -->
      <div class="section-title">Commission Summary</div>
      <div class="comm-grid">
        <div class="cg-item">
          <div class="cg-lbl">Total Earned</div>
          <div class="cg-val" style="color:#111">PKR ${fmtAmt(d.commEarned)}</div>
        </div>
        <div class="cg-item">
          <div class="cg-lbl">Previously Paid</div>
          <div class="cg-val" style="color:#22c55e">PKR ${fmtAmt(d.commPaidBefore)}</div>
        </div>
        <div class="cg-item">
          <div class="cg-lbl">This Payment</div>
          <div class="cg-val" style="color:#c9a84c">PKR ${fmtAmt(d.amount)}</div>
        </div>
        <div class="cg-item">
          <div class="cg-lbl">Total Paid After</div>
          <div class="cg-val" style="color:#22c55e">PKR ${fmtAmt(d.commPaidAfter)}</div>
        </div>
        <div class="cg-item">
          <div class="cg-lbl">Balance Remaining</div>
          <div class="cg-val" style="color:${d.commBalance > 0 ? '#ef4444' : '#22c55e'}">PKR ${fmtAmt(d.commBalance)}</div>
        </div>
      </div>

      <!-- Signatures -->
      <div class="sig-row">
        <div class="sig-box">
          <div class="sig-line">
            <div class="sig-name">${esc(d.agentName)}</div>
            <div class="sig-role">Agent — Received By</div>
          </div>
        </div>
        <div class="sig-box">
          <div class="sig-line">
            <div class="sig-name">${esc(coName)}</div>
            <div class="sig-role">Authorized Signatory</div>
          </div>
        </div>
      </div>

      <div class="footer">
        Voucher No: ${esc(d.voucherNo)} &nbsp;·&nbsp;
        ${esc(coName)} — Nexunova RMS &nbsp;·&nbsp;
        Printed on ${today}
      </div>
    </div>
  `);
  if (typeof _pclose === 'function') _pclose(w);
}

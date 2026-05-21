// ══ AGENTS MODULE — Supabase ════════════════════════════════════════

let _agSearch       = '';
let _agStatus       = '';
let _agSort         = 'name';
let _agView         = localStorage.getItem('nxn_ag_view') || 'cards';
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

// Hash agent's UUID → stable unique accent color across a 12-hue vibrant palette
const _AG_PALETTE = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#f59e0b', // amber
  '#84cc16', // lime
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#a855f7', // purple
];
function _agColor(agent) {
  const key = agent.id || agent.full_name || '';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return _AG_PALETTE[Math.abs(h) % _AG_PALETTE.length];
}

function _agAvatar(agent, size = 40) {
  if (agent.profile_photo_url) {
    return `<img src="${esc(agent.profile_photo_url)}" alt="${esc(agent.full_name)}"
      style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;">`;
  }
  const initials = ini(agent.full_name);
  const color    = _agColor(agent);
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};
    display:flex;align-items:center;justify-content:center;
    font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;
    font-size:${Math.round(size * 0.35)}px;color:white;flex-shrink:0;
    box-shadow:0 0 0 2px ${color}44">${initials}</div>`;
}

function _agStatusBadge(status) {
  return status === 'active'
    ? `<span class="badge ba"><span class="b-dot"></span>Active</span>`
    : `<span class="badge bd"><span class="b-dot"></span>Inactive</span>`;
}

// ── LIST PAGE ────────────────────────────────────────────────────────
async function rAgents() {
  const cid = S?.cid;
  const pg  = document.getElementById('pg-agents');
  if (!pg) return;
  if (!cid) { pg.innerHTML = `<div class="inv-empty" style="padding:60px"><div class="inv-empty-ic">${_UI.user}</div><h4>Not logged in</h4></div>`; return; }

  const canEdit = _canEditAgent();

  pg.innerHTML = `<div class="inv-page ani module-agent">

  <!-- Breadcrumb -->
  <div class="inv-breadcrumb">
    <span class="lnk" onclick="nav('dashboard')">Home</span>
    <span style="opacity:.4">${_UI.chevR}</span>
    <span style="color:var(--text-soft)">Agents</span>
  </div>

  <!-- Page Header -->
  <div class="inv-ph-row">
    <h1 class="inv-title">Sales Agents</h1>
    <div class="inv-ph-actions">
      ${canEdit ? `<button class="btn btn-g btn-sm" onclick="openAgentModal(null)" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:13px">${_UI.plus} Add Agent</button>` : ''}
    </div>
  </div>

  <!-- Stats Row -->
  <div id="ag-stats"></div>

  <!-- Filter Toolbar -->
  <div class="inv-toolbar">
    <div class="inv-search-wrap">
      <span class="inv-search-icon">${_UI.search}</span>
      <input class="inv-search-inp" id="ag-search" placeholder="Name, CNIC, phone, code…"
             value="${esc(_agSearch)}" oninput="_agDoSearch(this.value)" autocomplete="off">
      <span class="inv-search-cmd">⌘K</span>
    </div>
    <div class="inv-status-pills">
      <button class="inv-spill${!_agStatus?' on':''}" onclick="_agSetStatus('')">All</button>
      <button class="inv-spill${_agStatus==='active'?' on':''}" onclick="_agSetStatus('active')">Active</button>
      <button class="inv-spill${_agStatus==='inactive'?' on':''}" onclick="_agSetStatus('inactive')">Inactive</button>
    </div>
    <button class="inv-fc" id="ag-fc-sort" onclick="_agSortDropdown(this)">
      ${_UI.sort}
      <span class="inv-fc-label">Sort</span>
      <span class="inv-fc-val">${_agSort==='sales'?'Top Sales':_agSort==='commission'?'Commission':'Name'}</span>
      ${_UI.chevD}
    </button>
    <div class="inv-view-toggle">
      <button class="inv-view-btn${_agView==='cards'?' on':''}" onclick="_agSetView('cards')" title="Card view">${_UI.grid}</button>
      <button class="inv-view-btn${_agView==='board'?' on':''}" onclick="_agSetView('board')" title="Leaderboard">${_UI.board}</button>
    </div>
  </div>

  <div id="ag-grid"></div>
</div>`;

  await _loadAgentList();
}

function _agSortDropdown(btn) {
  _invCloseDD();
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'inv-dd'; dd.id = 'inv-dd-open';
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.left = rect.left + 'px';
  const opts = [['name','Name A–Z'],['sales','Top Sales'],['commission','Commission']];
  dd.innerHTML = `<div class="inv-dd-hd">SORT BY</div>` +
    opts.map(([v,l]) => `<button class="inv-dd-item" onclick="_invCloseDD();_agSetSort('${v}')">${_agSort===v?'✓ ':''} ${l}</button>`).join('');
  document.body.appendChild(dd);
  _invDD = dd;
  _invArmOutsideClose(btn);
}

let _agSearchTimer = null;
function _agDoSearch(v) { _agSearch = v; clearTimeout(_agSearchTimer); _agSearchTimer = setTimeout(_loadAgentList, 300); }
function _agSetStatus(v) { _agStatus = v; _loadAgentList(); }
function _agSetSort(v)   { _agSort   = v; _loadAgentList(); }
function _agSetView(v) {
  _agView = v;
  localStorage.setItem('nxn_ag_view', v);
  document.querySelectorAll('.inv-view-btn').forEach(b => b.classList.remove('on'));
  const active = document.querySelector(`.inv-view-btn[onclick*="${v}"]`);
  if (active) active.classList.add('on');
  _renderAgentGrid(_agCache);
}

async function _loadAgentList() {
  const cid  = S?.cid;
  const grid = document.getElementById('ag-grid');
  if (!grid || !cid) return;
  grid.innerHTML = `<div class="empty"><div class="ei" style="font-size:28px">⏳</div><div class="et">Loading agents…</div></div>`;

  try {
    const { data, error } = await supabase.rpc('list_agents', {
      p_company_id: cid,
      p_search:     _agSearch || null,
      p_status:     _agStatus || null,
      p_sort:       _agSort
    });
    if (error) throw error;

    _agCache = Array.isArray(data) ? data : [];
    _renderAgentStats(_agCache);
    _renderAgentGrid(_agCache);
  } catch(e) {
    grid.innerHTML = `<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Failed to load agents</div><div class="es">${esc(e.message)}</div></div>`;
  }
}

function _renderAgentStats(agents) {
  const el = document.getElementById('ag-stats');
  if (!el) return;
  const active   = agents.filter(a => a.status === 'active').length;
  const totalComm = agents.reduce((s, a) => s + Number(a.total_commission_earned || 0), 0);
  const pendingComm = agents.reduce((s, a) => s + Number(a.total_commission_pending || 0), 0);
  el.className = 'stat-row module-agent';
  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-val">${agents.length}</div>
      <div class="stat-lbl">Total Agents</div>
    </div>
    <div class="stat-card">
      <div class="stat-val" style="color:var(--ok)">${active}</div>
      <div class="stat-lbl">Active</div>
    </div>
    <div class="stat-card">
      <div class="stat-val" style="color:var(--info);font-size:18px">${fM(totalComm)}</div>
      <div class="stat-lbl">Commission Earned</div>
    </div>
    <div class="stat-card">
      <div class="stat-val" style="color:var(--warn);font-size:18px">${fM(pendingComm)}</div>
      <div class="stat-lbl">Commission Pending</div>
    </div>`;

  const lbl = document.getElementById('ag-count-lbl');
  if (lbl) lbl.textContent = agents.length + (agents.length === 1 ? ' agent' : ' agents');
}

function _renderAgentGrid(agents) {
  if (_agView === 'board') { _renderLeaderboard(agents); return; }

  const grid = document.getElementById('ag-grid');
  if (!grid) return;
  const canEdit  = _canEditAgent();
  const showRank = _agSort === 'sales' || _agSort === 'commission';

  if (!agents.length) {
    grid.innerHTML = `<div class="inv-empty">
      <span class="inv-empty-ic">${_UI.user}</span>
      <p class="inv-empty-tx">No agents found</p>
      <p class="inv-empty-sub">${_agSearch||_agStatus ? 'Try clearing filters' : (canEdit ? 'Add your first sales agent to get started' : 'No agents added yet')}</p>
      ${(!_agSearch && !_agStatus && canEdit) ? `<button class="btn btn-g btn-sm" style="margin-top:12px" onclick="openAgentModal(null)">${_UI.plus} Add Agent</button>` : ''}
    </div>`;
    return;
  }

  const _rankMedal = [
    '<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#f5c842;font-size:11px;font-weight:800;color:#7c5e00">1</span>',
    '<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#94a3b8;font-size:11px;font-weight:800;color:#fff">2</span>',
    '<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#cd7c3f;font-size:11px;font-weight:800;color:#fff">3</span>'
  ];

  grid.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px">
    ${agents.map((a, idx) => {
      const pending = Number(a.total_commission_pending || 0);
      const earned  = Number(a.total_commission_earned  || 0);
      const ac      = _agColor(a);
      const medal   = showRank && idx < 3 ? _rankMedal[idx] : null;
      const rankBadge = showRank
        ? (medal
            ? `<span style="position:absolute;top:10px;right:10px;font-size:18px;line-height:1">${medal}</span>`
            : `<span style="position:absolute;top:12px;right:12px;font-size:10px;font-weight:700;color:var(--t3);background:var(--surface2);border:1px solid var(--line);border-radius:20px;padding:1px 7px">#${idx+1}</span>`)
        : '';

      return `
      <div onclick="openAgentDetail('${a.id}')"
        style="cursor:pointer;background:var(--surface);border:1px solid var(--line);
               border-radius:14px;overflow:hidden;position:relative;
               box-shadow:0 1px 4px rgba(0,0,0,.08);
               transition:transform .2s cubic-bezier(.4,0,.2,1),box-shadow .2s ease,border-color .2s ease"
        onmouseenter="this.style.transform='translateY(-3px)';this.style.boxShadow='0 10px 28px rgba(0,0,0,.16)';this.style.borderColor='${ac}99'"
        onmouseleave="this.style.transform='';this.style.boxShadow='0 1px 4px rgba(0,0,0,.08)';this.style.borderColor=''">

        ${rankBadge}
        <div style="height:3px;background:linear-gradient(90deg,${ac},${ac}88)"></div>

        <div style="padding:16px 16px 14px;display:flex;align-items:flex-start;gap:13px;border-bottom:1px solid var(--line)">
          ${_agAvatar(a, 46)}
          <div style="flex:1;min-width:0;padding-top:2px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:5px">
              <span style="font-size:14px;font-weight:600;color:var(--t1);line-height:1.3;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.full_name)}</span>
              ${_agStatusBadge(a.status)}
            </div>
            <div style="font-size:10px;color:var(--t4);font-family:'JetBrains Mono',monospace;margin-bottom:7px">${esc(a.agent_code)}</div>
            ${a.phone    ? `<div style="font-size:11px;color:var(--t2);margin-bottom:2px">${esc(a.phone)}</div>` : ''}
            ${a.email    ? `<div style="font-size:10px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.email)}</div>` : ''}
            ${a.territory? `<div style="font-size:10px;color:var(--t4);margin-top:2px">${esc(a.territory)}</div>` : ''}
          </div>
        </div>

        <div style="display:flex;align-items:stretch;background:${ac}0d;border-bottom:1px solid var(--line)">
          <div style="flex:0 0 80px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px 0;border-right:1px solid ${ac}28">
            <div style="font-size:26px;font-weight:600;color:var(--t1);font-family:'JetBrains Mono',monospace;line-height:1">${a.total_sales_count || 0}</div>
            <div style="font-size:9px;color:var(--t4);text-transform:uppercase;letter-spacing:.7px;margin-top:5px">sales</div>
          </div>
          <div style="flex:1;padding:12px 14px;display:flex;flex-direction:column;justify-content:center;gap:8px">
            <div style="display:flex;align-items:baseline;justify-content:space-between">
              <span style="font-size:9px;color:var(--t4);text-transform:uppercase;letter-spacing:.5px">Earned</span>
              <span style="font-size:13px;color:var(--ok);font-family:'JetBrains Mono',monospace">${fM(earned)}</span>
            </div>
            <div style="display:flex;align-items:baseline;justify-content:space-between">
              <span style="font-size:9px;color:var(--t4);text-transform:uppercase;letter-spacing:.5px">Pending</span>
              <span style="font-size:13px;font-family:'JetBrains Mono',monospace;color:${pending>0?'var(--warn)':'var(--t4)'}">${fM(pending)}</span>
            </div>
          </div>
        </div>

        <div style="padding:7px 16px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:10px;color:var(--t4)">${Number(a.commission_percent||0)}% commission</span>
          ${a.rating ? `<span style="font-size:10px;color:${ac}">★ ${Number(a.rating).toFixed(1)}</span>` : ''}
        </div>

      </div>`;
    }).join('')}
  </div>`;
}

// ── LEADERBOARD VIEW ─────────────────────────────────────────────────
function _renderLeaderboard(agents) {
  const grid = document.getElementById('ag-grid');
  if (!grid) return;
  const canEdit = _canEditAgent();

  if (!agents.length) {
    grid.innerHTML = `<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg></div><div class="et">No agents found</div><div class="es">${_agSearch||_agStatus?'Try clearing filters':''}</div></div>`;
    return;
  }

  // Sort by sales for leaderboard display
  const ranked  = [...agents].sort((a,b) => Number(b.total_sales_count||0) - Number(a.total_sales_count||0));
  const maxSales = Math.max(1, Number(ranked[0]?.total_sales_count || 0));
  const maxEarned = Math.max(1, ranked.reduce((m,a) => Math.max(m, Number(a.total_commission_earned||0)), 0));

  const rankCfg = [
    { medal:'<span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#f5c842;font-size:14px;font-weight:800;color:#7c5e00">1</span>', color:'#f5c842', bg:'rgba(245,200,66,.08)', border:'rgba(245,200,66,.3)',  label:'1st', size:56 },
    { medal:'<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#94a3b8;font-size:13px;font-weight:800;color:#fff">2</span>', color:'#94a3b8', bg:'rgba(148,163,184,.06)', border:'rgba(148,163,184,.25)', label:'2nd', size:48 },
    { medal:'<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#cd7c3f;font-size:13px;font-weight:800;color:#fff">3</span>', color:'#cd7c3f', bg:'rgba(205,124,63,.08)', border:'rgba(205,124,63,.3)',  label:'3rd', size:48 },
  ];

  // ── Podium (top 3) ──────────────────────────────────────────────
  const podium3 = ranked.slice(0, 3);
  // Reorder: 2nd | 1st | 3rd (classic podium)
  const podiumOrder = podium3.length >= 3
    ? [podium3[1], podium3[0], podium3[2]]
    : podium3.length === 2
    ? [podium3[1], podium3[0]]
    : [podium3[0]];
  const podiumCfgOrder = podium3.length >= 3
    ? [rankCfg[1], rankCfg[0], rankCfg[2]]
    : podium3.length === 2
    ? [rankCfg[1], rankCfg[0]]
    : [rankCfg[0]];

  const podiumHTML = podiumOrder.map((a, pi) => {
    const rc  = podiumCfgOrder[pi];
    const ac  = _agColor(a);
    const earned = Number(a.total_commission_earned || 0);
    const isFirst = rc.label === '1st';
    return `
    <div onclick="openAgentDetail('${a.id}')" style="
      flex:1;max-width:260px;background:var(--surface);border:1px solid ${rc.border};border-radius:16px;
      padding:20px 16px;text-align:center;cursor:pointer;
      background:linear-gradient(160deg,var(--surface),${rc.bg});
      box-shadow:0 4px 20px rgba(0,0,0,.12)${isFirst?`,0 0 40px ${rc.color}18`:''};
      transform:${isFirst?'scale(1.03)':'scale(1)'};
      transition:transform .2s,box-shadow .2s"
      onmouseenter="this.style.transform='${isFirst?'scale(1.06)':'translateY(-3px)'}';this.style.boxShadow='0 8px 30px rgba(0,0,0,.2)'"
      onmouseleave="this.style.transform='${isFirst?'scale(1.03)':'scale(1)'}';this.style.boxShadow='0 4px 20px rgba(0,0,0,.12)${isFirst?`,0 0 40px ${rc.color}18`:''}'"
    >
      <div style="margin-bottom:10px;display:flex;align-items:center;justify-content:center">${rc.medal}</div>
      <div style="margin:0 auto 10px;border:2px solid ${rc.color}66;border-radius:50%;display:inline-flex">${_agAvatar(a, rc.size)}</div>
      <div style="font-size:${isFirst?'15':'13'}px;font-weight:700;color:var(--t1);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.full_name)}</div>
      <div style="font-size:10px;font-family:'JetBrains Mono',monospace;color:var(--t3);margin-bottom:12px">${esc(a.agent_code)}</div>
      <div style="font-size:${isFirst?'32':'26'}px;font-weight:800;color:${rc.color};font-family:'JetBrains Mono',monospace;line-height:1">${a.total_sales_count||0}</div>
      <div style="font-size:9px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px">sales</div>
      <div style="font-size:11px;color:var(--ok);font-family:'JetBrains Mono',monospace">${fM(earned)}</div>
      <div style="font-size:9px;color:var(--t3);margin-top:1px">earned</div>
    </div>`;
  }).join('');

  // ── Ranked list (all agents) ─────────────────────────────────────
  const listHTML = ranked.map((a, idx) => {
    const ac      = _agColor(a);
    const sales   = Number(a.total_sales_count || 0);
    const earned  = Number(a.total_commission_earned || 0);
    const pct     = Math.round(sales / maxSales * 100);
    const commPct = Math.round(earned / maxEarned * 100);
    const medals  = [
      '<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#f5c842;font-size:11px;font-weight:800;color:#7c5e00">1</span>',
      '<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#94a3b8;font-size:11px;font-weight:800;color:#fff">2</span>',
      '<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#cd7c3f;font-size:11px;font-weight:800;color:#fff">3</span>'
    ];
    const rankDisp = idx < 3
      ? medals[idx]
      : `<span style="font-size:12px;font-weight:700;color:var(--t3);font-family:'JetBrains Mono',monospace;min-width:24px;text-align:center">#${idx+1}</span>`;

    return `
    <div onclick="openAgentDetail('${a.id}')" style="
      display:flex;align-items:center;gap:14px;padding:13px 16px;
      border-bottom:1px solid var(--line);cursor:pointer;transition:background .15s"
      onmouseenter="this.style.background='rgba(255,255,255,.02)'"
      onmouseleave="this.style.background=''">
      <div style="flex-shrink:0;width:28px;text-align:center">${rankDisp}</div>
      ${_agAvatar(a, 38)}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:13px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.full_name)}</span>
          ${_agStatusBadge(a.status)}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <div style="flex:1;height:5px;background:var(--surface2);border-radius:99px;overflow:hidden;max-width:180px">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,${ac},${ac}bb);border-radius:99px;transition:width .6s ease"></div>
          </div>
          <span style="font-size:10px;color:var(--t3);flex-shrink:0">${sales} sale${sales!==1?'s':''}</span>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;min-width:90px">
        <div style="font-size:13px;font-weight:700;color:var(--ok);font-family:'JetBrains Mono',monospace">${fM(earned)}</div>
        <div style="font-size:10px;color:var(--t3)">${Number(a.commission_percent||0)}% rate</div>
      </div>
      ${a.territory ? `<div style="font-size:11px;color:var(--t3);flex-shrink:0;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.territory)}</div>` : ''}
    </div>`;
  }).join('');

  grid.innerHTML = `
    <div style="display:flex;gap:14px;justify-content:center;align-items:flex-end;margin-bottom:24px;flex-wrap:wrap;padding:4px">
      ${podiumHTML}
    </div>
    <div style="background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px">
        <span style="font-size:13px;font-weight:700;color:var(--t1);display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>Full Rankings</span>
        <span style="font-size:11px;color:var(--t3);background:var(--surface2);padding:2px 8px;border-radius:20px">${ranked.length} agents</span>
      </div>
      ${listHTML}
    </div>`;
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
      supabase.from('agents').select('territory,monthly_target,quarterly_target,contract_doc_url,parent_agent_id').eq('id', _agId).single(),
      supabase.from('agent_commission_payments').select('*').eq('agent_id', _agId).eq('company_id', S.cid).order('payment_date', { ascending: false }),
      supabase.from('agents').select('id,full_name,agent_code,status,total_sales_count,commission_percent').eq('parent_agent_id', _agId).eq('company_id', S.cid)
    ]);

    if (rpcRes.error) throw rpcRes.error;
    if (!rpcRes.data?.success) { nav('agents'); return; }

    const ext      = extRes.data  || {};
    const commPays = commRes.data || [];
    const subAgents= subRes.data  || [];

    // Fetch parent agent name if linked
    let parentAgent = null;
    if (ext.parent_agent_id) {
      const { data: pa } = await supabase.from('agents').select('full_name,agent_code').eq('id', ext.parent_agent_id).single();
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

  // Commission payments table
  const commLedgerBody = commPays.length === 0
    ? `<div class="empty" style="padding:20px"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="22" height="16" x="1" y="4" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div><div class="et">No commission payments recorded yet</div></div>`
    : `<div class="tw"><table class="t"><thead><tr>
        <th>Date</th><th class="r">Amount</th><th>Method</th><th>Reference</th><th>Notes</th><th></th>
       </tr></thead><tbody>
       ${commPays.map(p => `<tr>
         <td style="font-size:12px">${fD(p.payment_date)}</td>
         <td class="r mono" style="font-weight:700;color:var(--ok)">PKR ${fM(p.amount)}</td>
         <td style="font-size:11px">${methodLbl(p.payment_method)}</td>
         <td style="font-family:monospace;font-size:11px">${esc(p.reference_no||'—')}</td>
         <td style="font-size:11px;color:var(--t3)">${esc(p.notes||'')}</td>
         <td>${canEdit ? `<button class="btn btn-r btn-xs" onclick="deleteCommPay('${p.id}')" style="display:inline-flex;align-items:center;justify-content:center"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>` : ''}</td>
       </tr>`).join('')}
       </tbody></table></div>
       <div style="padding:10px 16px;border-top:1px solid var(--line);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12px">
         <span>Total Paid: <strong style="color:var(--ok)">PKR ${fM(commPaidTotal)}</strong></span>
         <span>Still Pending: <strong style="color:var(--warn)">PKR ${fM(commPending)}</strong></span>
       </div>`;

  // Sub-agents section
  const subAgentsSection = subAgents.length > 0 ? `
    <div class="card">
      <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Sub-agents (${subAgents.length})</h3></div>
      <div class="tw"><table class="t"><thead><tr>
        <th>Name</th><th>Code</th><th>Sales</th><th>Comm %</th><th>Status</th><th></th>
      </tr></thead><tbody>
      ${subAgents.map(s => `<tr>
        <td style="font-weight:600">${esc(s.full_name)}</td>
        <td style="font-family:monospace;font-size:11px">${esc(s.agent_code||'')}</td>
        <td>${s.total_sales_count||0}</td>
        <td>${Number(s.commission_percent||0)}%</td>
        <td>${_agStatusBadge(s.status)}</td>
        <td><button class="btn btn-gh btn-xs" onclick="_agId='${s.id}';rAgentDetail()">View</button></td>
      </tr>`).join('')}
      </tbody></table></div>
    </div>` : '';

  pg.innerHTML = `<div class="ani">
    <!-- Form navigation bar -->
    <div id="ad-form-nav"></div>

    <!-- Back -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap" class="no-p">
      <button class="bk" onclick="nav('agents')">← Back</button>
    </div>

    <!-- Header card -->
    <div class="card mb14" style="padding:20px">
      <div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap">
        ${_agAvatar(a, 64)}
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
            <h2 style="font-size:20px;font-weight:800;color:var(--t1)">${esc(a.full_name)}</h2>
            ${_agStatusBadge(a.status)}
          </div>
          <div style="font-size:12px;color:var(--t3);font-family:'JetBrains Mono',monospace;margin-bottom:8px">${esc(a.agent_code)}</div>
          ${parentAgent ? `<div style="font-size:12px;color:var(--t3);margin-bottom:8px">Reports to: <b style="color:var(--text)">${esc(parentAgent.full_name)}</b></div>` : ''}
          <div style="display:flex;gap:7px;flex-wrap:wrap">
            ${a.phone ? `<a href="tel:${esc(a.phone)}" class="btn btn-gh btn-sm" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.52 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.44 1.18l3-.01a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.37a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>Call</a>` : ''}
            ${a.phone ? `<a href="https://wa.me/${(a.phone||'').replace(/\D/g,'')}" target="_blank" class="btn btn-gh btn-sm" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>WhatsApp</a>` : ''}
            ${a.email ? `<a href="mailto:${esc(a.email)}" class="btn btn-gh btn-sm" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>Email</a>` : ''}
            <button class="btn btn-print btn-sm" onclick="printAgentProfile()" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button>
          </div>
        </div>
      </div>

      <!-- KPI strip -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:0;margin-top:16px;padding-top:16px;border-top:1px solid var(--line)">
        <div style="padding:10px 12px;text-align:center;border-right:1px solid var(--line)">
          <div style="font-size:22px;font-weight:800;color:var(--t1)">${a.total_sales_count || 0}</div>
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;margin-top:3px">Total Sales</div>
        </div>
        <div style="padding:10px 12px;text-align:center;border-right:1px solid var(--line)">
          <div style="font-size:16px;font-weight:800;color:var(--t1)">${fMF(a.total_sales_amount)}</div>
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;margin-top:3px">Portfolio Value</div>
        </div>
        <div style="padding:10px 12px;text-align:center;border-right:1px solid var(--line)">
          <div style="font-size:16px;font-weight:800;color:var(--ok)">${fMF(commEarned)}</div>
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;margin-top:3px">Comm. Earned</div>
        </div>
        <div style="padding:10px 12px;text-align:center;border-right:1px solid var(--line)">
          <div style="font-size:16px;font-weight:800;color:var(--t2)">${fMF(commPaidTotal)}</div>
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;margin-top:3px">Comm. Paid</div>
        </div>
        <div style="padding:10px 12px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--warn)">${fMF(commPending)}</div>
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;margin-top:3px">Comm. Pending</div>
        </div>
      </div>

      <!-- Target progress bar -->
      ${targetPct !== null ? `
      <div style="margin-top:14px;padding:10px 14px;background:var(--hover);border-radius:8px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-bottom:6px">
          <span>Monthly Target Progress</span>
          <span style="font-weight:700;color:var(--text)">${targetPct}% · PKR ${fM(salesAmt)} / ${fM(monthlyTarget)}</span>
        </div>
        <div style="height:7px;background:var(--line);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${targetPct}%;background:${targetPct>=100?'var(--ok)':targetPct>=60?'#22c55e':targetPct>=30?'#f59e0b':'var(--err)'};-webkit-print-color-adjust:exact"></div>
        </div>
      </div>` : ''}
    </div>

    <!-- Agent Ledger tabs -->
    <div style="display:flex;border-bottom:2px solid var(--line);margin-bottom:14px">
      <button id="ag-tab-overview-btn" onclick="agSwitchTab('overview')" style="padding:8px 16px;background:none;border:none;border-bottom:2px solid var(--pri);color:var(--pri);font-weight:600;cursor:pointer;font-size:13px;margin-bottom:-2px;display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>Overview</button>
      <button id="ag-tab-ledger-btn"   onclick="agSwitchTab('ledger')"   style="padding:8px 16px;background:none;border:none;border-bottom:2px solid transparent;color:var(--t3);font-weight:600;cursor:pointer;font-size:13px;margin-bottom:-2px;display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>Ledger</button>
    </div>
    <div id="ag-tab-overview">
    <!-- Two-column layout -->
    <div class="cd">
      <div style="display:flex;flex-direction:column;gap:14px">

        <!-- Personal info -->
        <div class="card">
          <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Personal Info</h3></div>
          <div class="cb">
            ${row('Full Name',    esc(a.full_name))}
            ${row('Agent Code',  `<span style="font-family:'JetBrains Mono',monospace">${esc(a.agent_code)}</span>`)}
            ${row('Phone',       a.phone ? `<a href="tel:${esc(a.phone)}" style="color:var(--info)">${esc(a.phone)}</a>` : null)}
            ${row('Email',       a.email ? `<a href="mailto:${esc(a.email)}" style="color:var(--info)">${esc(a.email)}</a>` : null)}
            ${row('CNIC',        esc(a.cnic))}
            ${row('Address',     esc(a.address))}
            ${row('Join Date',   fD(a.join_date))}
            ${a.termination_date ? row('Termination', fD(a.termination_date)) : ''}
            ${row('Status',      _agStatusBadge(a.status))}
          </div>
        </div>

        <!-- Territory & Targets -->
        ${(ext.territory || ext.monthly_target || ext.quarterly_target || parentAgent) ? `
        <div class="card">
          <div class="ch"><h3>Territory &amp; Targets</h3></div>
          <div class="cb">
            ${row('Territory',         esc(ext.territory))}
            ${row('Reports To',        parentAgent ? `<b>${esc(parentAgent.full_name)}</b> <span style="font-family:monospace;font-size:11px;color:var(--t3)">${esc(parentAgent.agent_code||'')}</span>` : null)}
            ${row('Monthly Target',    ext.monthly_target ? `PKR ${fM(ext.monthly_target)}` : null)}
            ${row('Quarterly Target',  ext.quarterly_target ? `PKR ${fM(ext.quarterly_target)}` : null)}
          </div>
        </div>` : ''}

        <!-- Commission & Bank -->
        <div class="card">
          <div class="ch"><h3>Commission &amp; Bank</h3></div>
          <div class="cb">
            ${row('Commission Rate',  `<strong style="color:var(--ok)">${Number(a.commission_percent || 0)}%</strong>`)}
            ${row('Bank',            esc(a.bank_name))}
            ${row('Account No.',     a.bank_account_no ? `<span style="font-family:'JetBrains Mono',monospace">${esc(a.bank_account_no)}</span>` : null)}
            ${row('Account Title',   esc(a.bank_account_title))}
          </div>
        </div>

        ${a.notes ? `<div class="card">
          <div class="ch"><h3>Notes</h3></div>
          <div class="cb"><div style="font-size:13px;color:var(--t2);line-height:1.6">${esc(a.notes)}</div></div>
        </div>` : ''}

        <!-- Documents -->
        ${(a.cnic_front_url || a.cnic_back_url || ext.contract_doc_url) ? `<div class="card">
          <div class="ch"><h3>Documents</h3></div>
          <div class="cb" style="display:flex;flex-direction:column;gap:12px">
            ${(a.cnic_front_url || a.cnic_back_url) ? `<div style="display:flex;gap:10px;flex-wrap:wrap">
              ${a.cnic_front_url ? `<div style="flex:1;min-width:110px">
                <div style="font-size:11px;color:var(--t3);margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px">CNIC Front</div>
                <a href="${esc(a.cnic_front_url)}" target="_blank">
                  <img src="${esc(a.cnic_front_url)}" style="width:100%;border-radius:8px;border:1px solid var(--line)">
                </a>
              </div>` : ''}
              ${a.cnic_back_url ? `<div style="flex:1;min-width:110px">
                <div style="font-size:11px;color:var(--t3);margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px">CNIC Back</div>
                <a href="${esc(a.cnic_back_url)}" target="_blank">
                  <img src="${esc(a.cnic_back_url)}" style="width:100%;border-radius:8px;border:1px solid var(--line)">
                </a>
              </div>` : ''}
            </div>` : ''}
            ${ext.contract_doc_url ? `<div>
              <div style="font-size:11px;color:var(--t3);margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px">Agent Contract</div>
              <a href="${esc(ext.contract_doc_url)}" target="_blank" class="btn btn-gh btn-sm">View Contract Document</a>
            </div>` : ''}
          </div>
        </div>` : ''}

      </div>
      <div style="display:flex;flex-direction:column;gap:14px">

        <!-- Operations -->
        ${canEdit ? `<div class="card">
          <div class="ch"><h3>Operations</h3></div>
          <div style="display:flex;flex-direction:column">

            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--t1)">Edit Agent Profile</div>
                <div style="font-size:11px;color:var(--t3);margin-top:2px">Update contact info, commission rate, bank details</div>
              </div>
              <button class="btn btn-gh btn-sm" style="flex-shrink:0" onclick="openAgentModal('${a.id}')">✏ Edit</button>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--t1)">Pay Commission</div>
                <div style="font-size:11px;color:var(--t3);margin-top:2px">Record a commission disbursement · Pending: <strong style="color:var(--warn)">PKR ${fM(commPending)}</strong></div>
              </div>
              <button class="btn btn-g btn-sm" style="flex-shrink:0" onclick="openCommPayModal('${a.id}','${esc(a.full_name)}',${commPending})">Pay</button>
            </div>

            ${a.status === 'active' ? `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--t1)">Deactivate Agent</div>
                <div style="font-size:11px;color:var(--t3);margin-top:2px">Remove from active duty — sales history is preserved</div>
              </div>
              <button class="btn btn-r btn-sm" style="flex-shrink:0" onclick="deactivateAgent('${a.id}')">⏸ Deactivate</button>
            </div>` : `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--t1)">Reactivate Agent</div>
                <div style="font-size:11px;color:var(--t3);margin-top:2px">Restore this agent to active status</div>
              </div>
              <button class="btn btn-g btn-sm" style="flex-shrink:0" onclick="reactivateAgent('${a.id}')">▶ Reactivate</button>
            </div>`}

            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--err)">Delete Agent</div>
                <div style="font-size:11px;color:var(--t3);margin-top:2px">Permanently remove — only possible if no sales on record</div>
              </div>
              <button class="btn btn-r btn-sm" style="flex-shrink:0" onclick="deleteAgentConfirm('${a.id}')">Delete</button>
            </div>

          </div>
        </div>` : ''}

        <!-- Commission Payment Ledger -->
        <div class="card">
          <div class="ch">
            <div><h3>Commission Ledger</h3><p>${commPays.length} payment${commPays.length !== 1 ? 's' : ''} recorded</p></div>
          </div>
          ${commLedgerBody}
        </div>

        <!-- Sales history -->
        <div class="card">
          <div class="ch">
            <div><h3>Sales History</h3><p>${sales.length} sale${sales.length !== 1 ? 's' : ''}</p></div>
          </div>
          ${!sales.length
            ? `<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></div><div class="et">No sales yet</div><div class="es">Units sold by this agent will appear here</div></div>`
            : `<div class="tw"><table class="t"><thead><tr>
                <th>Unit</th><th>Project</th><th>Client</th><th>Date</th><th class="r">Price</th><th class="r">Commission</th>
               </tr></thead><tbody>
               ${sales.map(s => `<tr>
                 <td><strong>${esc(s.unit_no||s.unit_code||'—')}</strong></td>
                 <td style="font-size:12px;color:var(--t3)">${esc(s.project_name||'—')}</td>
                 <td>${esc(s.client_name||'—')}</td>
                 <td style="font-size:12px;color:var(--t3)">${fD(s.sale_date)}</td>
                 <td class="r">${fMF(s.net_amount)}</td>
                 <td class="r" style="color:var(--ok);font-weight:600">${fMF(s.commission_amount)}</td>
               </tr>`).join('')}
               </tbody></table></div>
               <div style="padding:10px 14px;border-top:1px solid var(--line);font-size:12px;color:var(--t3);display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
                 <span>Portfolio: <strong style="color:var(--t1)">${fMF(a.total_sales_amount)}</strong></span>
                 <span>Commission: <strong style="color:var(--ok)">${fMF(commEarned)}</strong></span>
               </div>`}
        </div>

        ${subAgentsSection}

      </div>
    </div>
    </div><!-- /ag-tab-overview -->
    <div id="ag-tab-ledger" data-agent-id="${a.id}" style="display:none">
      <div id="ag-ledger-body"></div>
    </div>
  </div>`;

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
          const { data } = await supabase.from('agents')
            .select('id, created_at')
            .eq('company_id', S.cid)
            .order('created_at', { ascending: true })
            .limit(2000);
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

function agSwitchTab(tab) {
  ['overview','ledger'].forEach(t => {
    document.getElementById('ag-tab-'+t).style.display = t === tab ? '' : 'none';
    const btn = document.getElementById('ag-tab-'+t+'-btn');
    if (btn) {
      btn.style.borderBottom = t === tab ? '2px solid var(--pri)' : '2px solid transparent';
      btn.style.color        = t === tab ? 'var(--pri)' : 'var(--t3)';
    }
  });
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
  el.innerHTML = `<div class="empty" style="padding:24px"><div class="es" style="color:var(--t3)">Loading…</div></div>`;

  const { data, error } = await supabase.rpc('get_agent_ledger', {
    p_agent_id: agentId, p_company_id: S.cid
  });
  if (error || !data?.success) {
    el.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Could not load ledger</div><div class="es">${esc(data?.error || error?.message || 'Error')}</div></div></div>`;
    return;
  }

  const rows = data.rows || [];

  if (!rows.length) {
    el.innerHTML = `<div class="card"><div class="ch"><h3>Commission Ledger</h3></div><div class="empty" style="padding:28px"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div><div class="et">No transactions yet</div><div class="es">Commission earned and payment records will appear here</div></div></div>`;
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

  el.innerHTML = `
    <div class="card">
      <div class="ch"><h3>Commission Ledger</h3><p>${rows.length} entr${rows.length !== 1 ? 'ies' : 'y'}</p></div>
      <div class="tw">
        <table class="t">
          <thead><tr>
            <th style="white-space:nowrap">Date</th>
            <th>Description</th>
            <th class="r" style="color:var(--ok);white-space:nowrap">Earned</th>
            <th class="r" style="color:var(--t1);white-space:nowrap">Paid</th>
            <th class="r" style="white-space:nowrap">Balance</th>
          </tr></thead>
          <tbody>
          ${enriched.map(r => `<tr>
            <td style="white-space:nowrap;font-size:12px;color:var(--t3)">${fD(r.row_date)}</td>
            <td style="font-size:12px;color:var(--t2)">${esc(r.description || '')}</td>
            <td class="r mono" style="color:var(--ok);font-weight:700">${r._earned > 0 ? fM(r._earned) : '<span style="color:var(--t4)">—</span>'}</td>
            <td class="r mono" style="color:var(--t1);font-weight:700">${r._paid   > 0 ? fM(r._paid)   : '<span style="color:var(--t4)">—</span>'}</td>
            <td class="r mono" style="font-weight:700;color:${r._balance > 0 ? 'var(--err)' : 'var(--ok)'}">
              ${fM(Math.abs(r._balance))}
            </td>
          </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <!-- Footer summary -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);border-top:2px solid var(--line)">
        <div style="padding:12px 16px;border-right:1px solid var(--line);text-align:center">
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Total Earned</div>
          <div style="font-size:15px;font-weight:800;color:var(--ok)">PKR ${fM(totalEarned)}</div>
        </div>
        <div style="padding:12px 16px;border-right:1px solid var(--line);text-align:center">
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Total Paid</div>
          <div style="font-size:15px;font-weight:800;color:var(--t1)">PKR ${fM(totalPaid)}</div>
        </div>
        <div style="padding:12px 16px;text-align:center">
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Pending Balance</div>
          <div style="font-size:15px;font-weight:800;color:${pending > 0 ? 'var(--err)' : 'var(--ok)'}">
            ${pending > 0 ? 'PKR ' + fM(pending) : 'Nil'}
          </div>
        </div>
      </div>
    </div>`;
  el.dataset.loaded = agentId;
}

// ── MODAL ────────────────────────────────────────────────────────────
async function openAgentModal(agentId) {
  if (!_canEditAgent()) { toast('You do not have permission to edit agents', 'warn'); return; }

  const isEdit = !!agentId;
  const m = document.getElementById('m-agent');
  if (!m) return;

  document.getElementById('agent-mtl').textContent = isEdit ? 'Edit Agent' : 'Add Agent';
  document.getElementById('af-agent-id').value = agentId || '';

  // Reset all fields
  const fields = ['af-name','af-email','af-cnic','af-address','af-notes',
                   'af-bank-name','af-bank-acct','af-bank-title','af-join-date',
                   'af-territory','af-monthly-target','af-quarterly-target'];
  fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const sv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
  sv('af-commission', '');
  sv('af-status', 'active');

  const phoneEl = document.getElementById('af-phone');
  if (phoneEl) phoneEl.value = '';
  document.querySelectorAll('#m-agent .af-err').forEach(el => el.textContent = '');
  document.querySelectorAll('#m-agent .inp-err').forEach(el => el.classList.remove('inp-err'));

  // Reset file inputs & previews
  const prevPhoto = document.getElementById('af-photo-preview');
  if (prevPhoto) prevPhoto.style.display = 'none';
  ['af-cnic-front-file','af-cnic-back-file','af-contract-file'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const contractLbl = document.getElementById('af-contract-lbl');
  if (contractLbl) contractLbl.textContent = 'Browse Contract (PDF / Image)';
  const contractPrev = document.getElementById('af-contract-prev');
  if (contractPrev) contractPrev.innerHTML = '';

  // Load parent agent dropdown.
  // Fetch ALL agents (not just active) so a currently-assigned inactive parent
  // doesn't get silently dropped on save. Inactive ones render greyed out.
  const parentSel = document.getElementById('af-parent-agent');
  if (parentSel) {
    try {
      const { data: allAgents } = await supabase
        .from('agents').select('id, full_name, status').eq('company_id', S.cid)
        .order('full_name');
      const candidates = (allAgents || []).filter(a => a.id !== agentId);
      parentSel.innerHTML = `<option value="">— None (Independent) —</option>` +
        candidates.map(a => {
          const inactive = a.status && a.status !== 'active';
          return `<option value="${a.id}"${inactive?' style="color:var(--text-faint)"':''}>${esc(a.full_name)}${inactive?' (inactive)':''}</option>`;
        }).join('');
    } catch(e) {
      console.error('[agents] parent list load failed:', e);
      parentSel.innerHTML = `<option value="">— Could not load agents (will retry on save) —</option>`;
    }
  }

  if (isEdit) {
    const a = _agCache.find(x => x.id === agentId);
    if (a) {
      sv('af-name',        a.full_name);
      sv('af-email',       a.email);
      sv('af-cnic',        a.cnic);
      sv('af-commission',  a.commission_percent);
      sv('af-status',      a.status || 'active');
      sv('af-address',     a.address);
      sv('af-notes',       a.notes);
      sv('af-bank-name',   a.bank_name);
      sv('af-bank-acct',   a.bank_account_no);
      sv('af-bank-title',  a.bank_account_title);
      sv('af-join-date',   a.join_date || '');
      if (a.profile_photo_url && prevPhoto) {
        prevPhoto.src = a.profile_photo_url;
        prevPhoto.style.display = 'block';
      }
    }
    // Fetch extended fields
    try {
      const { data: ext } = await supabase.from('agents')
        .select('territory,monthly_target,quarterly_target,contract_doc_url,parent_agent_id')
        .eq('id', agentId).single();
      if (ext) {
        sv('af-territory',        ext.territory);
        sv('af-monthly-target',   ext.monthly_target);
        sv('af-quarterly-target', ext.quarterly_target);
        if (parentSel && ext.parent_agent_id) parentSel.value = ext.parent_agent_id;
        if (ext.contract_doc_url) {
          if (contractLbl) contractLbl.textContent = '✓ Contract on file (browse to replace)';
          if (contractPrev) {
            const isPdf = ext.contract_doc_url.toLowerCase().includes('.pdf');
            contractPrev.innerHTML = `<div style="margin-top:8px;display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--hover);border-radius:8px;font-size:12px">
              <span>${isPdf ? 'PDF' : 'IMG'}</span>
              <a href="${esc(ext.contract_doc_url)}" target="_blank" style="color:var(--info);flex:1">View existing contract</a>
            </div>`;
          }
        }
      }
    } catch(e) {}
  } else {
    sv('af-join-date', new Date().toISOString().slice(0,10));
  }

  om('m-agent');

  setTimeout(() => {
    const phoneInp = document.getElementById('af-phone');
    if (!phoneInp) return;
    if (_agIti) { try { _agIti.destroy(); } catch(e) {} _agIti = null; }
    if (window.intlTelInput) {
      _agIti = window.intlTelInput(phoneInp, {
        initialCountry: 'pk',
        preferredCountries: ['pk','ae','sa','gb','us'],
        separateDialCode: true,
        utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@23.1.0/build/js/utils.js'
      });
      if (isEdit) {
        const a = _agCache.find(x => x.id === agentId);
        if (a?.phone) { try { _agIti.setNumber(a.phone); } catch(e) { phoneInp.value = a.phone; } }
      }
    } else if (isEdit) {
      const a = _agCache.find(x => x.id === agentId);
      if (a?.phone) phoneInp.value = a.phone;
    }
  }, 80);
}

function closeAgentModal() { cm('m-agent'); }

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
    if (inp) inp.classList.toggle('inp-err', !!msg);
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

  if (hasErr) return;

  const saveBtn = document.querySelector('#m-agent .btn-g');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const existingId = document.getElementById('af-agent-id')?.value?.trim() || '';
    const isEdit     = !!existingId;

    // Handle file uploads
    const photoFile    = document.getElementById('af-photo-file')?.files?.[0];
    const cnicFFile    = document.getElementById('af-cnic-front-file')?.files?.[0];
    const cnicBFile    = document.getElementById('af-cnic-back-file')?.files?.[0];

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
      const { data, error } = await supabase.rpc('create_agent', {
        p_company_id:         S.cid,
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
      await supabase.from('agents').update(extPatch).eq('id', finalId);
    }

    toast(isEdit ? 'Agent updated!' : `Agent added! Code: ${result.agent_code || ''}`, 'ok');
    cm('m-agent');
    await _loadAgentList();
    if (!isEdit && result.agent_id) { _agId = result.agent_id; nav('agentdetail'); }

  } catch(e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Agent'; }
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

// ── Pay Commission page ──────────────────────────────────────────────
async function rCommissions() {
  const pg = document.getElementById('pg-commissions');
  if (!pg) return;
  if (!S?.cid) { pg.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><div class="et">Not logged in</div></div></div>`; return; }

  pg.innerHTML = `<div class="ani"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div><div class="et">Loading…</div></div></div>`;

  try {
    const [agRes, payRes] = await Promise.all([
      supabase.from('agents').select('id,full_name,agent_code,total_commission_earned,status')
        .eq('company_id', S.cid).order('full_name'),
      supabase.from('agent_commission_payments').select('agent_id,amount')
        .eq('company_id', S.cid)
    ]);
    if (agRes.error) throw agRes.error;

    const agents = agRes.data || [];
    const pays   = payRes.data || [];

    // Sum paid per agent
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

    pg.innerHTML = `<div class="ani">
      <div class="ph">
        <div class="ph-l"><h2>Pay Commission</h2><p>Commission summary and disbursements</p></div>
      </div>

      <!-- Summary strip -->
      <div class="card mb14">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0">
          <div style="padding:14px 16px;text-align:center;border-right:1px solid var(--line)">
            <div style="font-size:18px;font-weight:800;color:var(--ok)">${fMF(totalEarned)}</div>
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;margin-top:3px">Total Earned</div>
          </div>
          <div style="padding:14px 16px;text-align:center;border-right:1px solid var(--line)">
            <div style="font-size:18px;font-weight:800;color:var(--t2)">${fMF(totalPaid)}</div>
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;margin-top:3px">Total Paid</div>
          </div>
          <div style="padding:14px 16px;text-align:center">
            <div style="font-size:18px;font-weight:800;color:var(--warn)">${fMF(totalPending)}</div>
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;margin-top:3px">Total Pending</div>
          </div>
        </div>
      </div>

      <!-- Agent table -->
      <div class="card">
        <div class="ch"><h3>Agents</h3><p>${rows.length} agent${rows.length !== 1 ? 's' : ''}</p></div>
        ${rows.length === 0
          ? `<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><div class="et">No agents found</div></div>`
          : `<div class="tw"><table class="t"><thead><tr>
              <th>Agent</th><th>Status</th><th class="r">Earned</th><th class="r">Paid</th><th class="r">Pending</th>${canEdit ? '<th></th>' : ''}
             </tr></thead><tbody>
             ${rows.map(r => `<tr>
               <td>
                 <div style="font-weight:600">${esc(r.full_name)}</div>
                 <div style="font-size:11px;font-family:monospace;color:var(--t3)">${esc(r.agent_code || '')}</div>
               </td>
               <td>${_agStatusBadge(r.status)}</td>
               <td class="r" style="color:var(--ok);font-weight:600">${fMF(r.earned)}</td>
               <td class="r" style="color:var(--t2)">${fMF(r.paid)}</td>
               <td class="r" style="font-weight:700;color:${r.pending > 0 ? 'var(--warn)' : 'var(--t3)'}">${fMF(r.pending)}</td>
               ${canEdit ? `<td><button class="btn btn-g btn-xs" onclick="openCommPayModal('${r.id}','${esc(r.full_name)}',${r.pending})">Pay</button></td>` : ''}
             </tr>`).join('')}
             </tbody></table></div>`}
      </div>
    </div>`;
  } catch(e) {
    pg.innerHTML = `<div class="ani"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Failed to load</div><div class="es">${esc(e.message)}</div></div></div>`;
  }
}

// ── Commission Payment Modal ─────────────────────────────────────────
function openCommPayModal(agentId, agentName, commPending) {
  if (!_canEditAgent()) { toast('Permission denied', 'warn'); return; }

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

  document.getElementById('cp-agent-id').value = agentId;
  document.getElementById('cp-agent-strip').innerHTML =
    `${esc(agentName)}&nbsp;&nbsp;<span style="font-weight:400;font-size:12px;color:var(--t3)">Pending commission: </span><span style="color:var(--warn)">PKR ${fM(commPending)}</span>`;
  document.getElementById('cp-amount').value = commPending > 0 ? Math.round(commPending) : '';
  document.getElementById('cp-date').value   = new Date().toISOString().slice(0, 10);
  document.getElementById('cp-method').value = 'bank_transfer';
  document.getElementById('cp-refno').value  = '';
  document.getElementById('cp-notes').value  = '';
  document.getElementById('cp-err').textContent     = '';
  document.getElementById('e-cp-amount').textContent = '';
  om('m-comm-pay');
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
    const { data: insertedRows, error } = await supabase.from('agent_commission_payments').insert({
      agent_id:       agentId,
      company_id:     S.cid,
      amount:         amount,
      payment_date:   date,
      payment_method: paymentMethod,
      reference_no:   refno || null,
      notes:          notes || null,
      created_by:     S.userId || null
    }).select();
    if (error) throw error;
    const inserted = insertedRows?.[0];

    toast('Commission payment recorded', 'ok');
    cm('m-comm-pay');

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
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Record Payment'; }
  }
}

async function deleteCommPay(id) {
  if (!confirm('Delete this commission payment record? This cannot be undone.')) return;
  const { error } = await supabase.from('agent_commission_payments').delete().eq('id', id).eq('company_id', S.cid);
  if (error) { toast('Error: ' + error.message, 'err'); return; }
  toast('Payment record deleted', 'ok');
  const activePg = document.querySelector('.pg.on')?.id;
  if (activePg === 'pg-commissions') await rCommissions();
  else await rAgentDetail();
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

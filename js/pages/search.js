// ══ QUICK SEARCH — Cascading Entity Hub ═════════════════════════════════════

// ── State ─────────────────────────────────────────────────────────────────────
let _srEntity     = null;
let _srFilter     = null;
let _srItems      = [];
let _srDetail     = null;
let _srCurrentDet = null;

const _srEntities = [
  { id:'unit',         ic:'', lb:'Unit'            },
  { id:'client',       ic:'', lb:'Client'           },
  { id:'agent',        ic:'', lb:'Agent'            },
  { id:'project',      ic:'', lb:'Project'          },
  { id:'payment',      ic:'', lb:'Payment'          },
  { id:'transfer',     ic:'', lb:'Transfer'         },
  { id:'cancellation', ic:'', lb:'Cancellation'     },
  { id:'installment',  ic:'', lb:'Due Installments' },
];

// ── Entity metadata: colors, icons, descriptions ──────────────────────────────
const _srEntityMeta = {
  unit:         { color:'#6366F1', bg:'rgba(99,102,241,0.10)', desc:'Inventory & availability',   svg:'<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>' },
  client:       { color:'#3B82F6', bg:'rgba(59,130,246,0.10)',  desc:'Buyers & owners',           svg:'<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },
  agent:        { color:'#10B981', bg:'rgba(16,185,129,0.10)',  desc:'Sales team',                svg:'<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
  project:      { color:'#8B5CF6', bg:'rgba(139,92,246,0.10)', desc:'Real estate projects',      svg:'<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>' },
  payment:      { color:'#16A34A', bg:'rgba(22,163,74,0.10)',   desc:'Received payments',         svg:'<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' },
  transfer:     { color:'#F59E0B', bg:'rgba(245,158,11,0.10)',  desc:'Ownership transfers',       svg:'<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m17 8 4 4-4 4"/><path d="M3 12h18"/><path d="m7 16-4-4 4-4"/></svg>' },
  cancellation: { color:'#EF4444', bg:'rgba(239,68,68,0.10)',   desc:'Cancelled bookings',        svg:'<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>' },
  installment:  { color:'#F97316', bg:'rgba(249,115,22,0.10)',  desc:'Pending dues',              svg:'<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/></svg>' },
};

// Empty array = no filter step, jump straight to list
const _srFilterConf = {
  unit: [
    { id:'available',   lb:'● Available',      clr:'#16a34a' },
    { id:'sold',        lb:'Installment Sale', clr:'#2563eb' },
    { id:'cash_sale',   lb:'Cash Sale',      clr:'#7c3aed' },
    { id:'reserved',    lb:'Reserved',       clr:'#b45309' },
    { id:'dead',        lb:'⬛ Dead / Blocked', clr:'#6b7280' },
    { id:'transferred', lb:'Transferred',    clr:'#7c3aed' },
    { id:'cancelled',   lb:'Cancelled',      clr:'#dc2626' },
  ],
  client: [
    { id:'all',         lb:'All Clients',       clr:'var(--brand)' },
    { id:'active',      lb:'✓ Active',           clr:'#16a34a'      },
    { id:'blacklisted', lb:'Blacklisted',     clr:'#dc2626'      },
    { id:'defaulter',   lb:'Defaulter',       clr:'#b45309'      },
  ],
  agent:        [],
  project:      [],
  payment: [
    { id:'all',         lb:'All',               clr:'var(--brand)' },
    { id:'cash',        lb:'Cash',            clr:'#16a34a'      },
    { id:'bank',        lb:'Bank',            clr:'#2563eb'      },
    { id:'adjustment',  lb:'Adjustment',      clr:'#b45309'      },
  ],
  transfer:     [],
  cancellation: [
    { id:'all',              lb:'All',           clr:'var(--brand)' },
    { id:'client_initiated', lb:'Client',     clr:'#2563eb'      },
    { id:'company_shortage', lb:'Shortage',   clr:'#dc2626'      },
  ],
  installment: [
    { id:'overdue',  lb:'Overdue',              clr:'#dc2626'      },
    { id:'upcoming', lb:'Upcoming (30 days)',   clr:'#b45309'      },
    { id:'all_due',  lb:'All Pending',             clr:'var(--brand)' },
  ],
};

// ── Page Render ───────────────────────────────────────────────────────────────
function rSearch() {
  document.getElementById('pg-search').innerHTML = `
  <style>
  .sr2 { max-width:900px; }
  /* Entity tiles */
  .sr2-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:6px; }
  @media(max-width:680px){ .sr2-grid{ grid-template-columns:repeat(2,1fr); } }
  .sr2-tile { display:flex; flex-direction:column; gap:10px; padding:14px 16px 16px; border-radius:12px;
    border:1.5px solid var(--x-border,rgba(255,255,255,0.08)); background:var(--x-surface,var(--surface));
    cursor:pointer; transition:border-color 130ms,background 130ms,transform 130ms,box-shadow 130ms; text-align:left; }
  .sr2-tile:hover { border-color:var(--x-border-2,rgba(255,255,255,0.16)); transform:translateY(-1px);
    box-shadow:0 6px 18px rgba(0,0,0,0.10); background:var(--x-surface-hover,var(--hover)); }
  .sr2-tile.on { border-color:var(--sr2c,#6366F1) !important; background:var(--sr2bg,rgba(99,102,241,0.10)) !important; }
  .sr2-tile-ic { width:38px; height:38px; border-radius:9px; display:flex; align-items:center; justify-content:center;
    background:var(--sr2bg,rgba(99,102,241,0.10)); color:var(--sr2c,#6366F1); flex-shrink:0; }
  .sr2-tile.on .sr2-tile-ic { background:var(--sr2c,#6366F1); color:#fff; }
  .sr2-tile-lb { font-size:13px; font-weight:700; color:var(--x-text,var(--t1)); line-height:1.2; }
  .sr2-tile-sub { font-size:11px; color:var(--x-text-3,var(--t3)); margin-top:2px; line-height:1.3; }
  .sr2-tile.on .sr2-tile-lb { color:var(--sr2c,#6366F1); }
  /* Filter chips */
  .sr2-fbar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:12px 0 2px;
    border-top:1px solid var(--x-border,rgba(255,255,255,0.07)); margin-top:6px; }
  .sr2-flbl { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
    color:var(--x-text-3,var(--t3)); white-space:nowrap; margin-right:2px; }
  .sr2-chip { display:inline-flex; align-items:center; gap:5px; height:28px; padding:0 12px; border-radius:14px;
    border:1px solid var(--x-border-2,rgba(255,255,255,0.12)); background:var(--x-surface,var(--surface));
    color:var(--x-text-2,var(--t2)); font-size:12px; font-weight:600; cursor:pointer; transition:all 120ms; white-space:nowrap; }
  .sr2-chip:hover { background:var(--x-surface-hover,var(--hover)); border-color:var(--x-border-3,rgba(255,255,255,0.22)); }
  .sr2-chip.on { color:#fff !important; border-color:transparent !important; background:var(--sr2c,#6366F1) !important; }
  .sr2-cdot { width:6px; height:6px; border-radius:50%; background:var(--sr2c,#6366F1); flex-shrink:0; }
  .sr2-chip.on .sr2-cdot { background:rgba(255,255,255,0.65); }
  /* List panel */
  .sr2-panel { background:var(--x-surface,var(--surface)); border:1px solid var(--x-border,rgba(255,255,255,0.07));
    border-radius:12px; overflow:hidden; margin-top:12px; }
  .sr2-panel-hd { display:flex; align-items:center; gap:10px; padding:11px 16px;
    border-bottom:1px solid var(--x-border,rgba(255,255,255,0.07)); background:var(--x-surface-2,var(--hover)); flex-wrap:wrap; }
  .sr2-panel-tt { font-size:13px; font-weight:700; color:var(--x-text,var(--t1)); }
  .sr2-panel-cnt { font-size:11px; font-weight:600; padding:2px 8px; border-radius:10px;
    background:var(--x-surface,var(--surface)); border:1px solid var(--x-border-2,rgba(255,255,255,0.12));
    color:var(--x-text-3,var(--t3)); }
  .sr2-qsrch { margin-left:auto; position:relative; }
  .sr2-qsrch-ic { position:absolute; left:9px; top:50%; transform:translateY(-50%);
    color:var(--x-text-3,var(--t3)); pointer-events:none; display:flex; }
  .sr2-qsrch input { height:30px; padding:0 10px 0 30px; border-radius:7px;
    border:1px solid var(--x-border-2,rgba(255,255,255,0.12)); background:var(--x-surface,var(--surface));
    color:var(--x-text,var(--t1)); font-family:inherit; font-size:12px; outline:none; width:190px;
    transition:border-color .12s,box-shadow .12s; }
  .sr2-qsrch input:focus { border-color:#6366F1; box-shadow:0 0 0 2px rgba(99,102,241,0.15); }
  .sr2-qsrch input::placeholder { color:var(--x-text-4,var(--t3)); opacity:.6; }
  /* Result rows */
  .sr2-list { max-height:520px; overflow-y:auto; }
  .sr2-row { display:flex; align-items:center; gap:12px; padding:10px 16px;
    border-bottom:1px solid var(--x-border,rgba(255,255,255,0.05)); cursor:pointer; transition:background 90ms; }
  .sr2-row:last-child { border-bottom:none; }
  .sr2-row:hover { background:var(--x-surface-hover,var(--hover)); }
  .sr2-av { width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center;
    font-size:12px; font-weight:700; flex-shrink:0; letter-spacing:-.3px;
    background:var(--sr2bg,rgba(99,102,241,0.10)); color:var(--sr2c,#6366F1); }
  .sr2-av.cd { font-family:monospace; font-size:10px; border-radius:6px; letter-spacing:0; }
  .sr2-row-body { flex:1; min-width:0; }
  .sr2-row-tt { font-size:13px; font-weight:600; color:var(--x-text,var(--t1));
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sr2-row-sub { font-size:11px; color:var(--x-text-3,var(--t3)); margin-top:2px;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sr2-row-r { display:flex; align-items:center; gap:7px; flex-shrink:0; }
  .sr2-chev { color:var(--x-text-4,var(--t3)); opacity:.35; transition:opacity .1s; }
  .sr2-row:hover .sr2-chev { opacity:1; }
  /* KPI grid */
  .sr2-kpi-g { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:8px; }
  .sr2-kpi { padding:10px 12px; background:var(--x-surface-2,var(--hover));
    border:1px solid var(--x-border,rgba(255,255,255,0.07)); border-radius:8px; }
  .sr2-kpi-l { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.05em;
    color:var(--x-text-3,var(--t3)); margin-bottom:3px; }
  .sr2-kpi-v { font-size:15px; font-weight:700; color:var(--x-text,var(--t1)); line-height:1.2; }
  .sr2-kpi-s { font-size:11px; color:var(--x-text-3,var(--t3)); margin-top:2px; }
  /* Loading / empty states */
  .sr2-state { padding:52px 24px; text-align:center; }
  .sr2-state-tt { font-size:14px; font-weight:600; color:var(--x-text-2,var(--t2)); margin:0 0 4px; }
  .sr2-state-sub { font-size:13px; color:var(--x-text-3,var(--t3)); margin:0; }
  @keyframes sr2sp { to{transform:rotate(360deg);} }
  .sr2-spin { width:22px; height:22px; border:2.5px solid rgba(99,102,241,0.15); border-top-color:#6366F1;
    border-radius:50%; animation:sr2sp .65s linear infinite; margin:0 auto 14px; }
  .sr2-state-ic { width:46px; height:46px; border-radius:12px; background:var(--x-surface-2,var(--hover));
    display:flex; align-items:center; justify-content:center; margin:0 auto 12px; color:var(--x-text-3,var(--t3)); }
  /* Light mode */
  [data-theme="light"] .sr2-tile { background:#fff; border-color:#E5E7EB; }
  [data-theme="light"] .sr2-tile:hover { background:#F9FAFB; border-color:#D1D5DB; }
  [data-theme="light"] .sr2-panel { background:#fff; border-color:#E5E7EB; }
  [data-theme="light"] .sr2-panel-hd { background:#F9FAFB; border-bottom-color:#E5E7EB; }
  [data-theme="light"] .sr2-row:hover { background:#F8FAFC; }
  [data-theme="light"] .sr2-row { border-bottom-color:#F3F4F6; }
  [data-theme="light"] .sr2-qsrch input { background:#fff; border-color:#E5E7EB; color:#1F2937; }
  [data-theme="light"] .sr2-chip { background:#fff; border-color:#E5E7EB; color:#374151; }
  [data-theme="light"] .sr2-chip:hover { background:#F9FAFB; border-color:#D1D5DB; }
  [data-theme="light"] .sr2-kpi { background:#F9FAFB; border-color:#E5E7EB; }
  [data-theme="light"] .sr2-panel-cnt { background:#fff; border-color:#E5E7EB; }
  [data-theme="light"] .sr2-fbar { border-top-color:#E5E7EB; }
  </style>
  <div class="ani sr2">

    <!-- Page header -->
    <div class="ph" style="margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid var(--x-border,rgba(255,255,255,0.07))">
      <div class="ph-l">
        <h2 style="font-size:22px;font-weight:800;color:var(--x-text,var(--t1));margin:0 0 4px;letter-spacing:-.3px">Quick Search</h2>
        <p style="font-size:13px;color:var(--x-text-3,var(--t3));margin:0">
          Find units, clients, agents, payments and more
          <kbd style="display:inline-flex;align-items:center;height:18px;padding:0 6px;margin-left:5px;border-radius:4px;font-size:10px;font-weight:700;font-family:monospace;background:var(--x-surface-2,rgba(255,255,255,0.06));border:1px solid var(--x-border-2,rgba(255,255,255,0.12));color:var(--x-text-3,var(--t3));vertical-align:middle">⌘K</kbd>
        </p>
      </div>
    </div>

    <!-- Entity tile grid -->
    <div class="sr2-grid" id="sr2-ent-grid">
      ${_srEntities.map(e => {
        const m = _srEntityMeta[e.id] || { color:'#6366F1', bg:'rgba(99,102,241,0.10)', desc:'', svg:'' };
        return `<button id="sr2-ent-${e.id}" onclick="_srSetEntity('${e.id}')"
          class="sr2-tile" style="--sr2c:${m.color};--sr2bg:${m.bg}">
          <div class="sr2-tile-ic">${m.svg}</div>
          <div>
            <div class="sr2-tile-lb">${e.lb}</div>
            <div class="sr2-tile-sub">${m.desc}</div>
          </div>
        </button>`;
      }).join('')}
    </div>

    <!-- Filter chips -->
    <div id="sr-filter-bar" style="display:none">
      <div class="sr2-fbar">
        <span class="sr2-flbl">Filter by</span>
        <div id="sr-filter-chips" style="display:contents"></div>
      </div>
    </div>

    <!-- Results panel -->
    <div id="sr-list-pane" style="display:none">
      <div class="sr2-panel">
        <div class="sr2-panel-hd">
          <span class="sr2-panel-tt" id="sr-list-title">Results</span>
          <span class="sr2-panel-cnt" id="sr-list-count">0</span>
          <div class="sr2-qsrch">
            <span class="sr2-qsrch-ic"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
            <input id="sr-list-search" type="text" autocomplete="off" placeholder="Filter results…" oninput="_srQuickFilter(this.value)">
          </div>
        </div>
        <div class="sr2-list" id="sr-list"></div>
      </div>
    </div>

    <!-- Detail pane -->
    <div id="sr-detail-pane" style="display:none"></div>
  </div>`;

  document.removeEventListener('keydown', _srGlobalKey);
  document.addEventListener('keydown', _srGlobalKey);

  if (_srEntity) {
    _srHighlightEntity(_srEntity);
    const filters = _srFilterConf[_srEntity] || [];
    if (filters.length) {
      _srShowFilterBar(filters);
      if (_srFilter) {
        _srHighlightFilter(_srFilter);
        if (_srItems.length) _srShowList();
      }
    } else if (_srItems.length) {
      _srShowList();
    }
  }
}

// ── Entity Selection ──────────────────────────────────────────────────────────
function _srSetEntity(id) {
  _srEntity = id;
  _srFilter = null;
  _srItems  = [];
  _srHighlightEntity(id);
  document.getElementById('sr-list-pane').style.display   = 'none';
  document.getElementById('sr-detail-pane').style.display  = 'none';
  const filters = _srFilterConf[id] || [];
  if (filters.length) {
    _srShowFilterBar(filters);
  } else {
    document.getElementById('sr-filter-bar').style.display = 'none';
    _srLoadAndShowList(id, 'all');
  }
}

function _srHighlightEntity(id) {
  document.querySelectorAll('.sr2-tile').forEach(btn => {
    btn.classList.toggle('on', btn.id === 'sr2-ent-' + id);
  });
}

// ── Filter Selection ──────────────────────────────────────────────────────────
function _srShowFilterBar(filters) {
  const bar   = document.getElementById('sr-filter-bar');
  const chips = document.getElementById('sr-filter-chips');
  if (!bar || !chips) return;
  chips.innerHTML = filters.map(f =>
    `<button id="sr-fil-${f.id}" onclick="_srSetFilter('${f.id}')" class="sr2-chip"
      style="--sr2c:${f.clr||'var(--brand)'}">
      <span class="sr2-cdot"></span>${esc(f.lb)}
    </button>`
  ).join('');
  bar.style.display = '';
}

function _srSetFilter(filterId) {
  _srFilter = filterId;
  _srHighlightFilter(filterId);
  document.getElementById('sr-detail-pane').style.display = 'none';
  _srLoadAndShowList(_srEntity, filterId);
}

function _srHighlightFilter(filterId) {
  document.querySelectorAll('.sr2-chip').forEach(btn => {
    btn.classList.toggle('on', btn.id === 'sr-fil-' + filterId);
  });
}

// ── List Load & Render ────────────────────────────────────────────────────────
async function _srLoadAndShowList(entity, filter) {
  const listPane = document.getElementById('sr-list-pane');
  const listEl   = document.getElementById('sr-list');
  const titleEl  = document.getElementById('sr-list-title');
  if (!listPane || !listEl) return;
  listPane.style.display = '';
  listEl.innerHTML = `<div class="sr2-state"><div class="sr2-spin"></div><p class="sr2-state-tt">Loading…</p></div>`;
  const searchInput = document.getElementById('sr-list-search');
  if (searchInput) searchInput.value = '';

  // Build title
  const entDef = _srEntities.find(e => e.id === entity);
  const filDef = (_srFilterConf[entity] || []).find(f => f.id === filter);
  if (titleEl) titleEl.textContent = [entDef?.lb, filDef && filDef.id !== 'all' ? filDef.lb.replace(/^[^\w]*/, '') : null].filter(Boolean).join(' · ');

  try {
    _srItems = await _srFetchItems(entity, filter);
    _srShowList();
  } catch(err) {
    console.error('[_srLoadAndShowList]', err);
    listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--err)">${esc(err.message)}</div>`;
  }
}

function _srShowList() {
  document.getElementById('sr-list-pane').style.display = '';
  _srRenderList(_srItems, '');
}

function _srQuickFilter(q) {
  _srRenderList(_srItems, q.trim().toLowerCase());
}

function _srRenderList(items, q) {
  const countEl = document.getElementById('sr-list-count');
  const listEl  = document.getElementById('sr-list');
  if (!listEl) return;

  const vis = q
    ? items.filter(it =>
        (it.title || '').toLowerCase().includes(q) ||
        (it.sub   || '').toLowerCase().includes(q) ||
        (it.extra || '').toLowerCase().includes(q))
    : items;

  if (countEl) countEl.textContent = vis.length + (q && vis.length < items.length ? ' of ' + items.length : '');

  if (!vis.length) {
    listEl.innerHTML = `<div class="sr2-state">
      <div class="sr2-state-ic"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
      <p class="sr2-state-tt">${q ? 'No matches for "' + esc(q) + '"' : 'Nothing here'}</p>
      <p class="sr2-state-sub">${q ? 'Try a different keyword' : 'No items match this filter'}</p>
    </div>`;
    return;
  }

  const m   = _srEntityMeta[_srEntity] || { color:'#6366F1', bg:'rgba(99,102,241,0.10)' };
  const isCode = ['unit','payment','transfer','cancellation','installment'].includes(_srEntity);

  listEl.innerHTML = vis.map(item => {
    const idx = items.indexOf(item);
    const av  = _srAvatar(item);
    return `<div onclick="_srPickItem(${idx})" class="sr2-row" style="--sr2c:${m.color};--sr2bg:${m.bg}">
      <div class="sr2-av${isCode?' cd':''}">${esc(av)}</div>
      <div class="sr2-row-body">
        <div class="sr2-row-tt">${esc(item.title)}</div>
        ${(item.sub||item.extra) ? `<div class="sr2-row-sub">${esc(item.sub||item.extra||'')}</div>` : ''}
      </div>
      <div class="sr2-row-r">
        ${item.badge ? `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:${item.badgeColor}1a;color:${item.badgeColor};white-space:nowrap">${esc(item.badge)}</span>` : ''}
        <svg class="sr2-chev" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`;
  }).join('');
}

function _srAvatar(item) {
  const t = item.title || '';
  switch (_srEntity) {
    case 'unit': {
      const m = t.match(/^([A-Za-z]+)[\s\-]*(\d+)/);
      return m ? (m[1].slice(0,1) + m[2].slice(0,2)).toUpperCase() : t.replace(/[^A-Za-z0-9]/g,'').slice(0,3).toUpperCase() || '?';
    }
    case 'client':
    case 'agent': {
      const parts = t.trim().split(/\s+/).filter(Boolean);
      return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : (parts[0]||'?').slice(0,2).toUpperCase();
    }
    case 'project':      return t.slice(0,2).toUpperCase() || 'PR';
    case 'payment':      return 'PKR';
    case 'transfer':     return 'TXN';
    case 'cancellation': return 'CXL';
    case 'installment': {
      const n = item._raw?.installment_number;
      return n != null ? '#' + String(n).padStart(2,'0') : 'DUE';
    }
    default: return '?';
  }
}

// ── Item Fetchers ─────────────────────────────────────────────────────────────
async function _srFetchItems(entity, filter) {
  switch(entity) {
    case 'unit':         return _srItemsUnit(filter);
    case 'client':       return _srItemsClient(filter);
    case 'agent':        return _srItemsAgent();
    case 'project':      return _srItemsProject();
    case 'payment':      return _srItemsPayment(filter);
    case 'transfer':     return _srItemsTransfer();
    case 'cancellation': return _srItemsCancellation(filter);
    case 'installment':  return _srItemsInstallment(filter);
    default:             return [];
  }
}

async function _srItemsUnit(filter) {
  const units = window._unitsCache || [];
  const projs = window._projectsCache || [];

  const toItem = (u, badgeOverride, extraOverride) => {
    const prj = projs.find(p => p.id === u.projectId);
    return {
      id: u.id, _u: u, _prj: prj,
      title: u.unitNo,
      sub:   [prj ? (prj.projectName || prj.name) : null, u.floorLabel, u.type].filter(Boolean).join(' · '),
      badge: badgeOverride || (u.isAvailable ? 'Available' : (u.status || 'Sold')),
      badgeColor: u.isAvailable ? '#16a34a' : (u.statusColor || 'var(--brand)'),
      extra: extraOverride !== undefined ? extraOverride : (u.customerName || ''),
    };
  };

  if (filter === 'transferred') {
    const { data } = await supabase.rpc('list_unit_transfers_search', { p_company_id: S.cid, p_limit: 2000 });
    const seen = new Set();
    const tMap = {};
    (data || []).forEach(t => { if (!tMap[t.unit_id]) tMap[t.unit_id] = t; seen.add(t.unit_id); });
    return units.filter(u => seen.has(u.id)).map(u => {
      const t = tMap[u.id];
      return { ...toItem(u, 'Transferred', [u.customerName, t ? fD(t.transfer_date) : null].filter(Boolean).join(' · ')), badgeColor: '#7c3aed' };
    }).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  }

  if (filter === 'cancelled') {
    const { data } = await supabase.rpc('list_unit_cancellations_search', { p_company_id: S.cid, p_type: null, p_limit: 2000 });
    const cMap = {};
    (data || []).forEach(c => { if (!cMap[c.unit_id]) cMap[c.unit_id] = c; });
    return units.filter(u => cMap[u.id]).map(u => {
      const c = cMap[u.id];
      return { ...toItem(u, 'Cancelled', [c.cancellation_voucher_no, fD(c.cancellation_date)].filter(Boolean).join(' · ')), badgeColor: '#dc2626' };
    }).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  }

  let filtered;
  switch(filter) {
    case 'available': filtered = units.filter(u => u.isAvailable); break;
    case 'sold':      filtered = units.filter(u => !u.isAvailable && !['Dead','Blocked','CashSale','Reserved'].includes(u.status)); break;
    case 'cash_sale': filtered = units.filter(u => u.status === 'CashSale'); break;
    case 'reserved':  filtered = units.filter(u => u.status === 'Reserved'); break;
    case 'dead':      filtered = units.filter(u => u.status === 'Dead' || u.status === 'Blocked'); break;
    default:          filtered = units;
  }
  return filtered.map(u => toItem(u)).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
}

async function _srItemsClient(filter) {
  const { data } = await supabase.rpc('list_clients_for_search', { p_company_id: S.cid, p_filter: filter || null });
  return (data || []).map(c => ({
    id: c.id, _raw: c,
    title: c.full_name || '—',
    sub:   [c.phone_primary, c.cnic ? 'CNIC: ' + c.cnic : null].filter(Boolean).join(' · '),
    badge: c.is_blacklisted ? 'Blacklisted' : c.is_defaulter ? 'Defaulter' : 'Active',
    badgeColor: c.is_blacklisted ? '#dc2626' : c.is_defaulter ? '#b45309' : '#16a34a',
    extra: c.has_cancellation_history ? 'Has cancellation history' : '',
  }));
}

async function _srItemsAgent() {
  const { data } = await supabase.rpc('list_agents_for_search', { p_company_id: S.cid });
  return (data || []).map(a => ({
    id: a.id, _raw: a,
    title: a.full_name || '—',
    sub:   [a.agent_code ? 'Code: ' + a.agent_code : null, a.phone].filter(Boolean).join(' · '),
    badge: a.status === 'active' ? 'Active' : (a.status || '—'),
    badgeColor: a.status === 'active' ? '#16a34a' : 'var(--t3)',
    extra: a.commission_percent ? a.commission_percent + '% commission' : '',
  }));
}

function _srItemsProject() {
  return (window._projectsCache || []).map(p => ({
    id: p.id, _raw: p,
    title: p.projectName || p.name || '—',
    sub:   [p.location, p.city].filter(Boolean).join(', '),
    badge: p.status || 'Active',
    badgeColor: '#16a34a',
    extra: '',
  }));
}

async function _srItemsPayment(filter) {
  const { data } = await supabase.rpc('list_payments_for_search', { p_company_id: S.cid, p_filter: filter || null });
  return (data || []).map(p => ({
    id: p.id, _raw: p,
    title: p.payment_code || p.reference_no || '—',
    sub:   [fD(p.payment_date), (p.payment_method || '').replace(/_/g,' ')].filter(Boolean).join(' · '),
    badge: 'PKR ' + fM(p.amount || 0),
    badgeColor: '#16a34a',
    extra: p.bank_name || p.notes || '',
  }));
}

async function _srItemsTransfer() {
  const { data } = await supabase.rpc('list_unit_transfers_search', { p_company_id: S.cid, p_limit: 150 });
  const units = window._unitsCache || [];
  return (data || []).map(t => {
    const u = units.find(x => x.id === t.unit_id);
    return {
      id: t.id, _raw: t,
      title: t.transfer_voucher_no || '—',
      sub:   [fD(t.transfer_date), u ? 'Unit: ' + u.unitNo : null].filter(Boolean).join(' · '),
      badge: 'PKR ' + fM(t.transfer_fee || 0),
      badgeColor: '#7c3aed', extra: '',
    };
  });
}

async function _srItemsCancellation(filter) {
  const cType = filter === 'client_initiated' ? 'client_initiated' : filter === 'company_shortage' ? 'company_shortage' : null;
  const { data } = await supabase.rpc('list_unit_cancellations_search', { p_company_id: S.cid, p_type: cType, p_limit: 150 });
  const units = window._unitsCache || [];
  return (data || []).map(c => {
    const u = units.find(x => x.id === c.unit_id);
    return {
      id: c.id, _raw: c,
      title: c.cancellation_voucher_no || '—',
      sub:   [fD(c.cancellation_date), u ? 'Unit: ' + u.unitNo : null,
              c.cancellation_type === 'client_initiated' ? 'Client' : 'Shortage'].filter(Boolean).join(' · '),
      badge: 'Refund: PKR ' + fM(c.refund_amount || 0),
      badgeColor: '#dc2626', extra: '',
    };
  });
}

async function _srItemsInstallment(filter) {
  const today = td();
  const { data } = await supabase.rpc('list_installments_for_search', { p_company_id: S.cid, p_filter: filter || null });
  const saleIds = [...new Set((data || []).map(i => i.sale_id).filter(Boolean))];
  let saleMap = {};
  if (saleIds.length) {
    const { data: sales } = await supabase.rpc('get_sales_unit_map', { p_company_id: S.cid, p_sale_ids: saleIds });
    (sales || []).forEach(s => { saleMap[s.id] = s.unit_id; });
  }
  const units = window._unitsCache || [];
  return (data || []).map(i => {
    const u    = units.find(x => x.id === saleMap[i.sale_id]);
    const isOvd = i.due_date && i.due_date < today;
    const days = isOvd ? Math.floor((Date.now() - new Date(i.due_date + 'T00:00:00')) / 86400000) : 0;
    return {
      id: i.id, _raw: i, _unit: u,
      title: (u ? u.unitNo + ' — ' : '') + 'Inst #' + String(i.installment_number).padStart(2, '0'),
      sub:   'Due: ' + fD(i.due_date) + (isOvd ? ' · ' + days + ' days overdue' : ''),
      badge: 'PKR ' + fM(i.outstanding || i.amount_due || 0),
      badgeColor: isOvd ? (days > 60 ? '#dc2626' : '#b45309') : 'var(--brand)',
      extra: u?.customerName || '',
    };
  });
}

// ── Pick Item ─────────────────────────────────────────────────────────────────
async function _srPickItem(idx) {
  const item = _srItems[idx];
  if (!item) return;
  document.getElementById('sr-list-pane').style.display   = 'none';
  document.getElementById('sr-detail-pane').style.display  = '';
  const detEl = document.getElementById('sr-detail-pane');
  detEl.innerHTML = `<div class="sr2-state" style="padding:60px 24px"><div class="sr2-spin"></div><p class="sr2-state-tt">Loading…</p></div>`;
  try {
    if (_srEntity === 'unit') { await _srPickUnit(item.id); return; }
    let html = '';
    if      (_srEntity === 'client')       html = await _srDetailClient(item);
    else if (_srEntity === 'agent')        html = await _srDetailAgent(item);
    else if (_srEntity === 'project')      html = await _srDetailProject(item);
    else if (_srEntity === 'payment')      html = await _srDetailPayment(item);
    else if (_srEntity === 'transfer')     html = await _srDetailTransfer(item);
    else if (_srEntity === 'cancellation') html = await _srDetailCancellation(item);
    else if (_srEntity === 'installment')  html = _srDetailInstallment(item);
    detEl.innerHTML = `<div class="ani">${html}</div>`;
  } catch(err) {
    console.error('[_srPickItem]', err);
    detEl.innerHTML = `<div style="padding:40px;text-align:center"><div style="color:var(--err);font-size:14px;margin-bottom:14px">${esc(err.message)}</div><button class="btn btn-gh" onclick="_srBack()">← Back</button></div>`;
  }
}

function _srBack() {
  document.getElementById('sr-detail-pane').style.display = 'none';
  document.getElementById('sr-list-pane').style.display   = '';
  const qf = document.getElementById('sr-list-search')?.value || '';
  _srRenderList(_srItems, qf.trim().toLowerCase());
}

function _srGlobalKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); nav('search'); }
}

// ── Unit Detail Flow ──────────────────────────────────────────────────────────
async function _srPickUnit(unitId) {
  const detEl = document.getElementById('sr-detail-pane');
  detEl.style.display = '';
  detEl.innerHTML = `<div class="sr2-state" style="padding:60px 24px"><div class="sr2-spin"></div><p class="sr2-state-tt">Loading unit…</p></div>`;
  try {
    const d = await _srLoadData(unitId);
    _srDetail = d;
    _srRenderDetail(d);
  } catch(err) {
    console.error('[_srPickUnit]', err);
    detEl.innerHTML = `<div style="padding:40px;text-align:center"><div style="color:var(--err);font-size:14px;margin-bottom:14px">${esc(err.message)}</div><button class="btn btn-gh" onclick="_srBack()">← Back</button></div>`;
  }
}

// ── Shared Helpers ────────────────────────────────────────────────────────────
function _srCard(ic, title, body) {
  return `<div class="card mb14"><div class="ch"><h3>${ic} ${title}</h3></div><div class="cb">${body}</div></div>`;
}
function _srRow(l, v) {
  return (v != null && v !== '' && v !== false)
    ? `<div class="ir"><span class="ir-l">${l}</span><span class="ir-r">${v}</span></div>` : '';
}
function _srKpi(label, value, sub) {
  return `<div class="sr2-kpi">
    <div class="sr2-kpi-l">${label}</div>
    <div class="sr2-kpi-v">${value}</div>
    ${sub ? `<div class="sr2-kpi-s">${sub}</div>` : ''}
  </div>`;
}
function _srStatusBadge(status, large) {
  const sz  = large ? 'font-size:12px;padding:4px 12px' : 'font-size:10px;padding:2px 9px';
  const map = {
    available:  ['#16a34a','rgba(34,197,94,.12)','● Available'],
    on_time:    ['#16a34a','rgba(34,197,94,.12)','On Time'],
    overdue:    ['#b45309','rgba(245,158,11,.12)','Overdue'],
    defaulter:  ['#dc2626','rgba(239,68,68,.12)','Defaulter'],
    fully_paid: ['#1d4ed8','rgba(59,130,246,.12)','Fully Paid'],
  };
  const [color, bg, label] = map[status] || ['var(--t3)','var(--hover)',status];
  return `<span style="${sz};font-weight:700;border-radius:20px;background:${bg};color:${color};white-space:nowrap">${label}</span>`;
}
function _srClientBadge(type) {
  const map = {
    first:    ['#16a34a','rgba(34,197,94,.1)','First Client'],
    current:  ['#1d4ed8','rgba(59,130,246,.1)','Transfer Buyer'],
    previous: ['#b45309','rgba(245,158,11,.1)','Transferred Out'],
  };
  const [color, bg, label] = map[type] || ['var(--t3)','var(--hover)',type];
  return `<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;background:${bg};color:${color}">${label}</span>`;
}
function _srMethBadge(m) {
  m = (m || '').toLowerCase();
  if (m === 'cash') return `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:20px;background:rgba(34,197,94,.12);color:#16a34a">Cash</span>`;
  if (['bank_transfer','bank','cheque','online'].includes(m)) return `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:20px;background:rgba(59,130,246,.12);color:#1d4ed8">Bank</span>`;
  if (m === 'adjustment') return `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:20px;background:rgba(245,158,11,.12);color:#b45309">Adj</span>`;
  return `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:20px;background:var(--hover);color:var(--t2)">${esc(m)}</span>`;
}

// ── Client Detail ─────────────────────────────────────────────────────────────
async function _srDetailClient(item) {
  const { data: c } = await supabase.rpc('get_client_by_id', { p_id: item.id, p_company_id: S.cid });
  if (!c) throw new Error('Client not found');
  const { data: sales } = await supabase.rpc('list_sales_by_client_all', { p_client_id: c.id, p_company_id: S.cid });
  _srCurrentDet = { type: 'client', data: c };
  const units = window._unitsCache || [];
  const projs = window._projectsCache || [];
  const flags = [
    c.is_blacklisted ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(220,38,38,.12);color:#dc2626">Blacklisted</span>' : '',
    c.is_defaulter   ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(180,83,9,.12);color:#b45309">Defaulter</span>' : '',
    c.has_cancellation_history ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(107,114,128,.12);color:var(--t3)">Has Cancellation</span>' : '',
  ].filter(Boolean).join(' ');

  const salesHtml = (sales || []).length
    ? (sales || []).map(s => {
        const u = units.find(x => x.id === s.unit_id);
        const p = u ? projs.find(x => x.id === u.projectId) : null;
        return `<div class="ir">
          <span class="ir-l"><span style="font-weight:700;font-family:monospace">${u ? esc(u.unitNo) : '—'}</span>
            ${p ? `<span style="font-size:10px;color:var(--t3);margin-left:4px">${esc(p.projectName||p.name||'')}</span>` : ''}</span>
          <span class="ir-r" style="display:flex;align-items:center;gap:6px">
            <span style="font-size:11px;color:var(--t3)">${fD(s.sale_date)}</span>
            <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:20px;
              background:${s.is_active?'rgba(34,197,94,.12)':'var(--hover)'};color:${s.is_active?'#16a34a':'var(--t3)'}">${s.is_active?'Active':'Closed'}</span>
          </span></div>`;
      }).join('')
    : `<div class="empty" style="padding:12px"><div class="et">No sales recorded</div></div>`;

  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" class="no-p">
      <button class="bk" onclick="_srBack()">← Back</button>
      <button class="btn btn-print btn-sm" onclick="_srPrintCurrentClient()">Print Profile</button>
    </div>
    <div class="card mb14" style="background:linear-gradient(135deg,var(--surface) 0%,var(--hover) 100%)">
      <div class="cb" style="padding:14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
          <h2 style="font-size:20px;font-weight:800;margin:0">${esc(c.full_name||'—')}</h2>
          ${flags}
        </div>
        <div class="sr2-kpi-g" style="margin-top:10px">
          ${_srKpi('Phone',    c.phone_primary||'—', '')}
          ${_srKpi('CNIC',     c.cnic||'—', '')}
          ${_srKpi('Type',     c.overseas_local==='overseas'?'Overseas':c.overseas_local==='local'?'Local':'—', '')}
          ${_srKpi('Sales',    String((sales||[]).length), '')}
        </div>
      </div>
    </div>
    <div class="ud">
      <div style="display:flex;flex-direction:column;gap:13px">
        ${_srCard('','Personal Info',`
          ${_srRow('Full Name',   `<span style="font-weight:700">${esc(c.full_name||'—')}</span>`)}
          ${_srRow('CNIC',        c.cnic ? `<span style="font-family:monospace">${esc(c.cnic)}</span>` : null)}
          ${_srRow('Phone',       c.phone_primary ? `<a href="tel:${esc(c.phone_primary)}" style="color:var(--info)">${esc(c.phone_primary)}</a>` : null)}
          ${_srRow('Alt Phone',   c.phone_secondary||null)}
          ${_srRow('Email',       c.email||null)}
          ${_srRow('Father Name', c.father_name||null)}
          ${_srRow('Occupation',  c.occupation||null)}
          ${_srRow('Type',        c.overseas_local==='overseas'?'Overseas':c.overseas_local==='local'?'Local':null)}
          ${_srRow('Address',     c.address ? esc(c.address)+(c.city?', '+esc(c.city):'') : null)}
        `)}
        ${c.next_of_kin_name ? _srCard('','Next of Kin',`
          ${_srRow('Name',     esc(c.next_of_kin_name))}
          ${_srRow('Relation', c.next_of_kin_relation||null)}
          ${_srRow('Phone',    c.next_of_kin_phone||null)}
        `) : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:13px">
        ${_srCard('','Units & Sales', salesHtml)}
        ${(c.is_blacklisted||c.is_defaulter||c.has_cancellation_history) ? _srCard('','Status Flags',`
          ${_srRow('Blacklisted',      c.is_blacklisted?'<span style="color:#dc2626;font-weight:700">Yes</span>':'No')}
          ${_srRow('Defaulter',        c.is_defaulter?'<span style="color:#b45309;font-weight:700">Yes</span>':'No')}
          ${_srRow('Has Cancellation', c.has_cancellation_history?'Yes':'No')}
          ${_srRow('Blacklist Reason', c.blacklist_reason||null)}
          ${_srRow('Defaulter Since',  c.defaulter_since?fD(c.defaulter_since):null)}
        `) : ''}
      </div>
    </div>`;
}

// ── Agent Detail ──────────────────────────────────────────────────────────────
async function _srDetailAgent(item) {
  const [{ data: a }, { data: sales }] = await Promise.all([
    supabase.rpc('get_agent_full', { p_id: item.id, p_company_id: S.cid }),
    supabase.rpc('list_sales_by_agent', { p_agent_id: item.id, p_company_id: S.cid }),
  ]);
  if (!a) throw new Error('Agent not found');
  _srCurrentDet = { type: 'agent', data: a };
  const units  = window._unitsCache || [];
  const projs  = window._projectsCache || [];
  const active = (sales||[]).filter(s => s.is_active);
  const totalE = (sales||[]).reduce((s,x) => s+Number(x.agent_commission_amount||0), 0);
  const totalP = (sales||[]).reduce((s,x) => s+Number(x.agent_commission_paid||0), 0);
  const totalPend = Math.max(0, totalE - totalP);

  const salesHtml = (sales||[]).length
    ? (sales||[]).map(s => {
        const u = units.find(x => x.id === s.unit_id);
        const p = u ? projs.find(x => x.id === u.projectId) : null;
        const comm = Number(s.agent_commission_amount||0);
        const paid = Number(s.agent_commission_paid||0);
        return `<div class="ir">
          <span class="ir-l">
            <span style="font-weight:700;font-family:monospace">${u?esc(u.unitNo):'—'}</span>
            ${p?`<span style="font-size:10px;color:var(--t3);margin-left:4px">${esc(p.projectName||p.name||'')}</span>`:''}
            ${s.is_active?'':' <span style="font-size:10px;color:var(--t3)">(closed)</span>'}
          </span>
          <span class="ir-r" style="font-size:11px">
            ${fD(s.sale_date)} &nbsp;
            <span style="color:${paid<comm?'#b45309':'var(--ok)'}">Comm: ${fM(comm)}${paid<comm?' ('+fM(comm-paid)+' due)':''}</span>
          </span>
        </div>`;
      }).join('')
    : `<div class="empty" style="padding:12px"><div class="et">No sales</div></div>`;

  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" class="no-p">
      <button class="bk" onclick="_srBack()">← Back</button>
    </div>
    <div class="card mb14" style="background:linear-gradient(135deg,var(--surface) 0%,var(--hover) 100%)">
      <div class="cb" style="padding:14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
          <h2 style="font-size:20px;font-weight:800;margin:0">${esc(a.full_name||'—')}</h2>
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;
            background:${a.status==='active'?'rgba(34,197,94,.12)':'var(--hover)'};
            color:${a.status==='active'?'#16a34a':'var(--t3)'}">${a.status||'—'}</span>
        </div>
        <div class="sr2-kpi-g">
          ${_srKpi('Rate',          (a.commission_percent||0)+'%', '')}
          ${_srKpi('Total Sales',   String((sales||[]).length), 'all time')}
          ${_srKpi('Total Earned',  fM(totalE), '')}
          ${_srKpi('Pending',       fM(totalPend), totalPend>0?'unpaid':'clear')}
        </div>
      </div>
    </div>
    <div class="ud">
      <div style="display:flex;flex-direction:column;gap:13px">
        ${_srCard('','Agent Info',`
          ${_srRow('Full Name',   `<span style="font-weight:700">${esc(a.full_name||'—')}</span>`)}
          ${_srRow('Agent Code',  a.agent_code?`<span style="font-family:monospace">${esc(a.agent_code)}</span>`:null)}
          ${_srRow('Phone',       a.phone?`<a href="tel:${esc(a.phone)}" style="color:var(--info)">${esc(a.phone)}</a>`:null)}
          ${_srRow('Email',       a.email||null)}
          ${_srRow('Status',      a.status||null)}
          ${_srRow('Commission',  a.commission_percent?a.commission_percent+'%':null)}
          ${_srRow('CNIC',        a.cnic||null)}
          ${_srRow('Join Date',   a.joined_date?fD(a.joined_date):null)}
          ${_srRow('Address',     a.address||null)}
        `)}
        ${_srCard('','Commission Summary',`
          ${_srRow('Total Sales',  String((sales||[]).length))}
          ${_srRow('Active Sales', String(active.length))}
          ${_srRow('Total Earned', `<span style="font-weight:700">${fMF(totalE)}</span>`)}
          ${_srRow('Total Paid',   `<span style="color:var(--ok)">${fMF(totalP)}</span>`)}
          ${_srRow('Pending',      totalPend>0?`<span style="color:var(--warn);font-weight:700">${fMF(totalPend)}</span>`:'<span style="color:var(--ok)">Clear</span>')}
        `)}
      </div>
      <div>${_srCard('','All Sales',salesHtml)}</div>
    </div>`;
}

// ── Project Detail ────────────────────────────────────────────────────────────
async function _srDetailProject(item) {
  const prj = (window._projectsCache||[]).find(p => p.id === item.id);
  if (!prj) throw new Error('Project not found');
  _srCurrentDet = { type: 'project', data: prj };
  const units     = (window._unitsCache||[]).filter(u => u.projectId === item.id);
  const available = units.filter(u => u.isAvailable);
  const sold      = units.filter(u => !u.isAvailable && u.status !== 'Dead' && u.status !== 'Blocked');
  const blocked   = units.filter(u => u.status === 'Dead' || u.status === 'Blocked');
  const pct       = units.length > 0 ? Math.round(sold.length / units.length * 100) : 0;
  const types     = [...new Set(units.map(u => u.type).filter(Boolean))];

  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" class="no-p">
      <button class="bk" onclick="_srBack()">← Back</button>
    </div>
    <div class="card mb14" style="background:linear-gradient(135deg,var(--surface) 0%,var(--hover) 100%)">
      <div class="cb" style="padding:14px">
        <h2 style="font-size:20px;font-weight:800;margin:0 0 10px">${esc(prj.projectName||prj.name||'—')}</h2>
        <div class="sr2-kpi-g">
          ${_srKpi('Total Units',  String(units.length), '')}
          ${_srKpi('Available',    String(available.length), '')}
          ${_srKpi('Sold',         String(sold.length), pct+'%')}
          ${_srKpi('Blocked/Dead', String(blocked.length), '')}
        </div>
        ${units.length ? `<div style="margin-top:12px"><div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--brand);border-radius:3px;transition:width .4s"></div>
        </div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t3);margin-top:3px">
          <span>${pct}% sold</span><span>${100-pct}% available</span>
        </div></div>` : ''}
      </div>
    </div>
    <div class="ud">
      <div>
        ${_srCard('','Project Info',`
          ${_srRow('Name',       esc(prj.projectName||prj.name||'—'))}
          ${_srRow('Location',   prj.location||null)}
          ${_srRow('City',       prj.city||null)}
          ${_srRow('Status',     prj.status||null)}
          ${_srRow('Start Date', prj.startDate?fD(prj.startDate):null)}
          ${_srRow('Notes',      prj.description||null)}
        `)}
      </div>
      <div>
        ${_srCard('','Inventory by Type',
          types.map(t => {
            const tu = units.filter(u=>u.type===t);
            return _srRow(esc(t), `${tu.filter(u=>!u.isAvailable).length} / ${tu.length} sold`);
          }).join('') || `<div class="empty" style="padding:10px"><div class="et">No type data</div></div>`
        )}
      </div>
    </div>`;
}

// ── Payment Detail ────────────────────────────────────────────────────────────
async function _srDetailPayment(item) {
  const { data: p } = await supabase.rpc('get_payment_full', { p_id: item.id, p_company_id: S.cid });
  if (!p) throw new Error('Payment not found');
  _srCurrentDet = { type: 'payment', data: p };
  let saleInfo = null, unitInfo = null, clientInfo = null;
  if (p.sale_id) {
    const { data: s } = await supabase.rpc('get_sale_for_lookup', { p_sale_id: p.sale_id, p_company_id: S.cid });
    if (s) {
      saleInfo   = s;
      unitInfo   = (window._unitsCache||[]).find(u => u.id === s.unit_id);
      clientInfo = (typeof gclient === 'function' ? gclient(s.client_id) : null) || null;
      if (!clientInfo && s.client_id) {
        const { data: cl } = await supabase.rpc('get_client_lite', { p_id: s.client_id, p_company_id: S.cid });
        clientInfo = cl;
      }
    }
  }
  const cName  = clientInfo ? (clientInfo.fullName||clientInfo.full_name||null) : null;
  const cPhone = clientInfo ? (clientInfo.phonePrimary||clientInfo.phone_primary||null) : null;

  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" class="no-p">
      <button class="bk" onclick="_srBack()">← Back</button>
    </div>
    <div class="card mb14" style="background:linear-gradient(135deg,var(--surface) 0%,var(--hover) 100%)">
      <div class="cb" style="padding:14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <h2 style="font-size:20px;font-weight:800;margin:0">Payment</h2>
          ${p.payment_code?`<span style="font-family:monospace;font-size:12px;color:var(--t3)">${esc(p.payment_code)}</span>`:''}
        </div>
        <div class="sr2-kpi-g">
          ${_srKpi('Amount', fMF(p.amount||0), '')}
          ${_srKpi('Date',   fD(p.payment_date), '')}
          ${_srKpi('Method', (p.payment_method||'—').replace(/_/g,' '), '')}
          ${_srKpi('Status', p.status||'—', '')}
        </div>
      </div>
    </div>
    <div class="ud">
      <div>${_srCard('','Payment Details',`
        ${_srRow('Payment Code',    p.payment_code||null)}
        ${_srRow('Reference No',    p.reference_no||null)}
        ${_srRow('Amount',          `<span style="font-weight:700;color:var(--ok)">${fMF(p.amount||0)}</span>`)}
        ${_srRow('Date',            fD(p.payment_date))}
        ${_srRow('Method',          (p.payment_method||'—').replace(/_/g,' '))}
        ${_srRow('Bank',            p.bank_name||null)}
        ${_srRow('Status',          p.status||null)}
        ${_srRow('Category',        p.payment_category||null)}
        ${_srRow('Notes',           p.notes||null)}
        ${_srRow('Adjustment Note', p.adjustment_note||null)}
      `)}</div>
      <div>${_srCard('','Linked Records',`
        ${saleInfo  ? _srRow('Sale No', esc(saleInfo.sale_number||'—')) : ''}
        ${unitInfo  ? _srRow('Unit',    `<span style="font-weight:700;font-family:monospace">${esc(unitInfo.unitNo)}</span>`) : ''}
        ${cName     ? _srRow('Client',  esc(cName)) : ''}
        ${cPhone    ? _srRow('Phone',   esc(cPhone)) : ''}
        ${!saleInfo&&!unitInfo?`<div class="empty" style="padding:12px"><div class="et">No linked records</div></div>`:''}
      `)}</div>
    </div>`;
}

// ── Transfer Detail ───────────────────────────────────────────────────────────
async function _srDetailTransfer(item) {
  const { data: t } = await supabase.rpc('get_unit_transfer_full', { p_id: item.id, p_company_id: S.cid });
  if (!t) throw new Error('Transfer not found');
  _srCurrentDet = { type: 'transfer', data: t };
  const unitInfo = (window._unitsCache||[]).find(u => u.id === t.unit_id);
  const resolveC = async (id) => {
    if (!id) return null;
    const c = typeof gclient === 'function' ? gclient(id) : null;
    if (c) return c;
    const { data } = await supabase.rpc('get_client_lite', { p_id: id, p_company_id: S.cid });
    return data;
  };
  const [oldC, newC] = await Promise.all([resolveC(t.old_client_id), resolveC(t.new_client_id)]);
  const cN = (c) => c ? (c.fullName||c.full_name||'—') : '—';
  const cP = (c) => c ? (c.phonePrimary||c.phone_primary||null) : null;

  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" class="no-p">
      <button class="bk" onclick="_srBack()">← Back</button>
    </div>
    <div class="card mb14" style="background:linear-gradient(135deg,var(--surface) 0%,var(--hover) 100%)">
      <div class="cb" style="padding:14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
          <h2 style="font-size:20px;font-weight:800;margin:0">Transfer</h2>
          <span style="font-family:monospace;font-size:13px;font-weight:700;color:var(--brand)">${esc(t.transfer_voucher_no||'—')}</span>
        </div>
        <div class="sr2-kpi-g">
          ${_srKpi('Unit',     unitInfo?unitInfo.unitNo:'—', '')}
          ${_srKpi('Date',     fD(t.transfer_date), '')}
          ${_srKpi('Fee',      fM(t.transfer_fee||0), '')}
          ${_srKpi('New Price',t.new_net_amount?fM(t.new_net_amount):'—', '')}
        </div>
      </div>
    </div>
    <div class="ud">
      <div style="display:flex;flex-direction:column;gap:13px">
        ${_srCard('','Transfer Info',`
          ${_srRow('Voucher No',    `<span style="font-family:monospace;font-weight:700">${esc(t.transfer_voucher_no||'—')}</span>`)}
          ${_srRow('Date',          fD(t.transfer_date))}
          ${_srRow('Unit',          unitInfo?`<span style="font-weight:700;font-family:monospace">${esc(unitInfo.unitNo)}</span>`:null)}
          ${_srRow('Transfer Fee',  t.transfer_fee>0?fMF(t.transfer_fee):null)}
          ${_srRow('Doc Charges',   t.documentation_charges>0?fMF(t.documentation_charges):null)}
          ${_srRow('Other Charges', t.other_charges>0?fMF(t.other_charges):null)}
          ${_srRow('New Net Price', t.new_net_amount>0?fMF(t.new_net_amount):null)}
          ${_srRow('Notes',         t.notes||null)}
        `)}
      </div>
      <div style="display:flex;flex-direction:column;gap:13px">
        ${_srCard('','From (Seller)',`
          ${_srRow('Name',  esc(cN(oldC)))}
          ${_srRow('CNIC',  oldC?.cnic?`<span style="font-family:monospace">${esc(oldC.cnic)}</span>`:null)}
          ${_srRow('Phone', cP(oldC)||null)}
        `)}
        ${_srCard('','To (Buyer)',`
          ${_srRow('Name',  esc(cN(newC)))}
          ${_srRow('CNIC',  newC?.cnic?`<span style="font-family:monospace">${esc(newC.cnic)}</span>`:null)}
          ${_srRow('Phone', cP(newC)||null)}
        `)}
      </div>
    </div>`;
}

// ── Cancellation Detail ───────────────────────────────────────────────────────
async function _srDetailCancellation(item) {
  const { data: c } = await supabase.rpc('get_unit_cancellation_full', { p_id: item.id, p_company_id: S.cid });
  if (!c) throw new Error('Cancellation not found');
  _srCurrentDet = { type: 'cancellation', data: c };
  const unitInfo = (window._unitsCache||[]).find(u => u.id === c.unit_id);
  let clientInfo = typeof gclient === 'function' ? gclient(c.client_id) : null;
  if (!clientInfo && c.client_id) {
    const { data: cl } = await supabase.rpc('get_client_lite', { p_id: c.client_id, p_company_id: S.cid });
    clientInfo = cl;
  }
  const cName  = clientInfo ? (clientInfo.fullName||clientInfo.full_name||null) : null;
  const cPhone = clientInfo ? (clientInfo.phonePrimary||clientInfo.phone_primary||null) : null;
  const typeLabel = c.cancellation_type === 'client_initiated' ? 'Client Initiated' : 'Company (Shortage)';

  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" class="no-p">
      <button class="bk" onclick="_srBack()">← Back</button>
      <button class="btn btn-print btn-sm" onclick="printCancellationVoucher('${esc(c.id)}','${esc(c.cancellation_voucher_no||'')}')">Print Voucher</button>
    </div>
    <div class="card mb14" style="background:linear-gradient(135deg,var(--surface) 0%,var(--hover) 100%)">
      <div class="cb" style="padding:14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
          <h2 style="font-size:20px;font-weight:800;margin:0">Cancellation</h2>
          <span style="font-family:monospace;font-size:13px;font-weight:700;color:#dc2626">${esc(c.cancellation_voucher_no||'—')}</span>
        </div>
        <div class="sr2-kpi-g">
          ${_srKpi('Unit',       unitInfo?unitInfo.unitNo:'—', '')}
          ${_srKpi('Date',       fD(c.cancellation_date), '')}
          ${_srKpi('Total Paid', fM(c.total_amount_paid||0), '')}
          ${_srKpi('Refund',     fM(c.refund_amount||0), '')}
        </div>
      </div>
    </div>
    <div class="ud">
      <div style="display:flex;flex-direction:column;gap:13px">
        ${_srCard('','Cancellation Info',`
          ${_srRow('Voucher No',    `<span style="font-family:monospace;font-weight:700">${esc(c.cancellation_voucher_no||'—')}</span>`)}
          ${_srRow('Date',          fD(c.cancellation_date))}
          ${_srRow('Type',          typeLabel)}
          ${_srRow('Unit',          unitInfo?`<span style="font-weight:700;font-family:monospace">${esc(unitInfo.unitNo)}</span>`:null)}
          ${_srRow('Reason',        c.cancellation_reason||null)}
          ${_srRow('Total Paid',    c.total_amount_paid>0?fMF(c.total_amount_paid):null)}
          ${_srRow('Deductions',    c.deduction_amount>0?`<span style="color:var(--err)">− ${fMF(c.deduction_amount)}</span>`:null)}
          ${_srRow('Refund',        c.refund_amount>0?`<span style="color:var(--ok);font-weight:700">${fMF(c.refund_amount)}</span>`:'<span style="color:var(--t3)">No Refund</span>')}
          ${_srRow('Refund Method', c.refund_method||null)}
        `)}
      </div>
      <div style="display:flex;flex-direction:column;gap:13px">
        ${_srCard('','Client',`
          ${_srRow('Name',  cName?esc(cName):null)}
          ${_srRow('CNIC',  clientInfo?.cnic?`<span style="font-family:monospace">${esc(clientInfo.cnic)}</span>`:null)}
          ${_srRow('Phone', cPhone||null)}
          ${!cName?`<div class="empty" style="padding:10px"><div class="et">No client linked</div></div>`:''}
        `)}
        ${_srCard('','Commission',`
          ${_srRow('Action',       c.agent_commission_action||null)}
          ${_srRow('Clawback Amt', c.agent_clawback_amount>0?fMF(c.agent_clawback_amount):null)}
          ${_srRow('Notes',        c.agent_commission_notes||null)}
          ${!c.agent_commission_action?`<div class="empty" style="padding:10px"><div class="et">No action recorded</div></div>`:''}
        `)}
      </div>
    </div>`;
}

// ── Installment Detail ────────────────────────────────────────────────────────
function _srDetailInstallment(item) {
  const i = item._raw;
  const u = item._unit;
  const isOvd = i.due_date && i.due_date < td();
  const days  = isOvd ? Math.floor((Date.now() - new Date(i.due_date+'T00:00:00'))/86400000) : 0;
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" class="no-p">
      <button class="bk" onclick="_srBack()">← Back</button>
      ${u?`<button class="btn btn-gr btn-sm" onclick="nav('addpayment','${esc(u.id)}')">Add Payment</button>`:''}
      ${u?`<button class="btn btn-gh btn-sm" onclick="_srPickUnit('${esc(u.id)}')">Full Unit Detail</button>`:''}
    </div>
    ${_srCard('','Overdue Installment',`
      ${_srRow('Unit',         u?`<span style="font-weight:700;font-family:monospace">${esc(u.unitNo)}</span>`:null)}
      ${_srRow('Installment #',`<span style="font-family:monospace;font-weight:700">#${String(i.installment_number).padStart(2,'0')}</span>`)}
      ${_srRow('Due Date',     `<span style="color:var(--err);font-weight:700">${fD(i.due_date)}</span>`)}
      ${isOvd?_srRow('Days Overdue',`<span style="color:var(--err);font-weight:700">${days} days</span>`):''}
      ${_srRow('Amount Due',   fMF(i.amount_due||0))}
      ${_srRow('Outstanding',  `<span style="font-weight:700;color:${isOvd?'var(--err)':'var(--t1)'}">${fMF(i.outstanding||i.amount_due||0)}</span>`)}
      ${_srRow('Status',       i.status||null)}
      ${_srRow('Notes',        i.notes||null)}
    `)}`;
}

// ── Unit Data Loader ──────────────────────────────────────────────────────────
async function _srLoadData(unitId) {
  const u   = gunit(unitId);
  if (!u) throw new Error('Unit not found in cache');
  const prj = gproject(u.projectId);
  const [pymRaw, saleRow, ohRaw] = await Promise.all([
    supabase.rpc('get_unit_payment_summary', { p_unit_id: unitId, p_company_id: S.cid }).then(r => r.data),
    supabase.rpc('get_active_sale_for_unit_full', { p_unit_id: unitId, p_company_id: S.cid }).then(r => r.data),
    supabase.rpc('get_unit_ownership_history', { p_unit_id: unitId, p_company_id: S.cid }).then(r => r.data),
  ]);
  const pymData = pymRaw, ownerHist = ohRaw;
  const saleId  = pymData?.success ? pymData.sale?.sale_id : (saleRow?.id || null);
  let payments = [], client = null, agent = null;
  if (saleId) {
    const [pmtsRaw, clientRaw, agentRaw] = await Promise.all([
      supabase.rpc('list_payments_by_sale_full', { p_sale_id: saleId, p_company_id: S.cid }).then(r => r.data || []),
      saleRow?.client_id
        ? (gclient(saleRow.client_id) ? Promise.resolve(gclient(saleRow.client_id))
          : supabase.rpc('get_client_detail_for_search', { p_id: saleRow.client_id, p_company_id: S.cid }).then(r => r.data))
        : Promise.resolve(null),
      saleRow?.agent_id
        ? supabase.rpc('get_agent_detail_for_search', { p_id: saleRow.agent_id, p_company_id: S.cid }).then(r => r.data)
        : Promise.resolve(null),
    ]);
    payments = pmtsRaw; client = clientRaw; agent = agentRaw;
  }
  return { u, prj, pymData, saleRow, payments, ownerHist, client, agent };
}

// ── Status Computation ────────────────────────────────────────────────────────
function _srCalcStatus(pymData, payments) {
  if (!pymData?.success) return 'available';
  const net   = Number(pymData.sale?.net_amount || 0);
  const paid  = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  if (net <= 0) return 'available';
  if (paid >= net) return 'fully_paid';
  const today = td();
  const insts = Array.isArray(pymData.installments) ? pymData.installments : [];
  const dp    = pymData.down_payment || null;
  let overdueCount = 0, maxDays = 0;
  const chk = (dueDate, outstanding) => {
    if (Number(outstanding||0) <= 0 || !dueDate || dueDate >= today) return;
    overdueCount++;
    const days = Math.floor((Date.now() - new Date(dueDate+'T00:00:00')) / 86400000);
    if (days > maxDays) maxDays = days;
  };
  if (dp) chk(dp.due_date, dp.outstanding);
  insts.forEach(i => chk(i.due_date, i.outstanding));
  if (overdueCount >= 3 || maxDays > 60) return 'defaulter';
  if (overdueCount >= 1) return 'overdue';
  return 'on_time';
}

// ── Unit Master Detail Renderer ───────────────────────────────────────────────
function _srRenderDetail(d) {
  const { u, prj, pymData, saleRow, payments, ownerHist, client, agent } = d;
  const el = document.getElementById('sr-detail-pane');
  if (!el) return;
  const hasSale    = pymData?.success === true;
  const s          = hasSale ? pymData.sale : null;
  const insts      = hasSale ? (pymData.installments || []) : [];
  const dp         = hasSale ? (pymData.down_payment || null) : null;
  const netAmt     = hasSale ? Number(s.net_amount || 0) : 0;
  const totalPaid  = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const outstanding = Math.max(0, netAmt - totalPaid);
  const paidPct    = netAmt > 0 ? Math.round(totalPaid / netAmt * 100) : 0;
  const status     = _srCalcStatus(pymData, payments);
  const today      = td();
  const cashPaid   = payments.filter(p=>(p.payment_method||'').toLowerCase()==='cash').reduce((s,p)=>s+Number(p.amount||0),0);
  const bankPaid   = payments.filter(p=>['bank_transfer','bank','cheque','online'].includes((p.payment_method||'').toLowerCase())).reduce((s,p)=>s+Number(p.amount||0),0);
  const adjPaid    = payments.filter(p=>(p.payment_method||'').toLowerCase()==='adjustment').reduce((s,p)=>s+Number(p.amount||0),0);
  const hist       = ownerHist?.success ? (ownerHist.history || []) : [];
  const hasTransfer = hist.length > 1;
  const histCurrent  = hist.find(h => h.is_active) || null;
  const histPrevious = hist.filter(h => !h.is_active);
  const clientType   = (hasTransfer && histCurrent?.is_transfer) ? 'current' : 'first';
  const overdueInsts = insts.filter(i => Number(i.outstanding||0)>0 && i.due_date && i.due_date < today);
  const paidInsts    = insts.filter(i => i.status === 'paid');
  const nextDue      = insts.filter(i => Number(i.outstanding||0)>0 && i.due_date >= today).sort((a,b)=>(a.due_date||'').localeCompare(b.due_date||''))[0] || null;

  const card = (ic, ti, badge, body) =>
    `<div class="card mb14"><div class="ch"><div style="display:flex;align-items:center;gap:8px"><h3>${ic} ${ti}</h3></div>${badge?`<div>${badge}</div>`:''}</div><div class="cb">${body}</div></div>`;
  const row  = (l, v) => v ? `<div class="ir"><span class="ir-l">${l}</span><span class="ir-r">${v}</span></div>` : '';

  el.innerHTML = `<div class="ani">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" class="no-p">
      <button class="bk" onclick="_srBack()">← Back</button>
      <button class="btn btn-print btn-sm" onclick="printSearchDetail()">Print Report</button>
      ${hasSale?`<button class="btn btn-gr btn-sm" onclick="nav('addpayment','${esc(u.id)}')">Add Payment</button>`:''}
      <button class="btn btn-gh btn-sm" onclick="openUD('${esc(u.id)}')">Full Detail</button>
    </div>
    <div class="card mb14" style="background:linear-gradient(135deg,var(--surface) 0%,var(--hover) 100%)">
      <div class="cb" style="padding:14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <h2 style="font-size:22px;font-weight:800;font-family:monospace;margin:0">${esc(u.unitNo)}</h2>
          ${typeof uStatusBadge==='function'?uStatusBadge(u.status,u.statusColor):''}
          ${_srStatusBadge(status,false)}
          ${hasTransfer?`<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;background:rgba(139,92,246,.12);color:#7c3aed">Transferred</span>`:''}
        </div>
        <div style="font-size:12px;color:var(--t2);margin-bottom:14px">
          ${esc(prj?.projectName||prj?.name||'—')}${u.floorLabel?' · '+esc(u.floorLabel):''}${u.type?' · '+esc(u.type):''}${u.area?' · '+u.area+' '+(u.areaUnit||'sqft'):''}
        </div>
        <div class="sr2-kpi-g">
          ${_srKpi('Sale Price',  hasSale?fMF(netAmt):'—', '')}
          ${_srKpi('Total Paid', hasSale?fMF(totalPaid):'—', paidPct?paidPct+'%':'')}
          ${_srKpi('Outstanding',hasSale?fMF(outstanding):'—', outstanding>0?(100-paidPct)+'%':'')}
          ${_srKpi('Status',     _srStatusBadge(status,false), '')}
        </div>
        ${hasSale&&netAmt>0?`<div style="margin-top:12px"><div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${paidPct}%;background:${outstanding<=0?'#16a34a':outstanding/netAmt>.5?'#ef4444':'#f59e0b'};border-radius:3px;transition:width .4s"></div>
        </div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t3);margin-top:3px"><span>${paidPct}% paid</span><span>${100-paidPct}% remaining</span></div></div>`:''}
      </div>
    </div>
    <div class="ud">
      <div style="display:flex;flex-direction:column;gap:13px">
        ${card('','Unit Info','',`
          ${row('Unit No',   `<span style="font-family:monospace;font-weight:700">${esc(u.unitNo)}</span>`)}
          ${row('Unit Code', u.unitCode?`<span style="font-family:monospace;color:var(--t3)">${esc(u.unitCode)}</span>`:null)}
          ${row('Project',   esc(prj?.projectName||prj?.name||'—'))}
          ${row('Floor',     u.floorLabel?esc(u.floorLabel):(u.floorNo!=null?'Floor '+u.floorNo:null))}
          ${row('Block',     u.block?esc(u.block):null)}
          ${row('Type',      u.type?esc(u.type):null)}
          ${row('Area',      u.area?u.area+' '+(u.areaUnit||'sqft'):null)}
          ${row('Bedrooms',  u.bedrooms!=null?u.bedrooms:null)}
          ${row('Facing',    u.facing?esc(u.facing):null)}
          ${row('Base Price',u.basePrice>0?fMF(u.basePrice):null)}
          ${u.notes?row('Notes',`<span style="font-size:12px">${esc(u.notes)}</span>`):''}
        `)}
        ${hasSale?card('','Sale & Pricing','',`
          ${row('Sale Number',  `<span style="font-family:monospace;font-weight:700;color:var(--brand)">${esc(s.sale_number||'—')}</span>`)}
          ${row('Sale Date',    fD(s.sale_date))}
          ${row('Payment Plan', s.payment_plan_type==='cash'?'Full Cash':s.installment_count>0?`Installment — ${s.installment_count} months`:'Installment')}
          ${row('Price / sqft', s.price_per_sqft?fMF(s.price_per_sqft):null)}
          ${row('Area',         s.area_sqft?fM(s.area_sqft)+' '+(s.area_unit||'sqft'):null)}
          ${row('Net Price',    `<span style="font-weight:700;color:var(--brand)">${fMF(netAmt)}</span>`)}
          ${row('Down Payment', s.down_payment>0?fMF(s.down_payment):null)}
          ${row('WHT',          Number(saleRow?.wht_amount||0)>0?fMF(saleRow.wht_amount):null)}
          ${row('CVT',          Number(saleRow?.cvt_amount||0)>0?fMF(saleRow.cvt_amount):null)}
          ${saleRow?.co_buyer_name?row('Co-Buyer',esc(saleRow.co_buyer_name)):''}
          ${saleRow?.nominee_name?row('Nominee',esc(saleRow.nominee_name)+(saleRow.nominee_relation?' ('+saleRow.nominee_relation+')':'')):''}
        `):card('','Sale & Pricing','',`<div class="empty" style="padding:16px"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><div class="et">No active sale</div><div class="es">Unit is available</div></div>`)}
        ${agent?card('','Sales Agent','',`
          ${row('Agent Name',    esc(agent.full_name||'—'))}
          ${row('Agent Code',    agent.agent_code?`<span style="font-family:monospace">${esc(agent.agent_code)}</span>`:null)}
          ${row('Phone',         agent.phone?`<a href="tel:${esc(agent.phone)}" style="color:var(--info)">${esc(agent.phone)}</a>`:null)}
          ${row('Commission',    agent.commission_percent?agent.commission_percent+'%':null)}
          ${row('Comm This Sale',hasSale&&agent.commission_percent?`<span style="font-weight:700">${fMF(netAmt*Number(agent.commission_percent)/100)}</span>`:null)}
          ${row('Paid',          agent.total_commission_paid>0?`<span style="color:var(--ok)">${fMF(agent.total_commission_paid)}</span>`:null)}
          ${row('Pending',       agent.total_commission_pending>0?`<span style="color:var(--warn)">${fMF(agent.total_commission_pending)}</span>`:null)}
        `):''}
      </div>
      <div style="display:flex;flex-direction:column;gap:13px">
        ${_srClientSection(d,hist,histCurrent,histPrevious,hasTransfer,clientType,card,row)}
        ${hasSale?card('','Payment Summary',_srStatusBadge(status),`
          <div class="sr2-kpi-g" style="margin-bottom:12px">
            ${_srKpi('Cash',fMF(cashPaid),'')} ${_srKpi('Bank',fMF(bankPaid),'')} ${_srKpi('Adjustment',fMF(adjPaid),'')}
          </div>
          ${row('Total Paid',  `<span style="color:var(--ok);font-weight:700">${fMF(totalPaid)} (${paidPct}%)</span>`)}
          ${row('Outstanding', `<span style="color:${outstanding>0?'var(--err)':'var(--ok)'};font-weight:700">${outstanding>0?fMF(outstanding)+' ('+(100-paidPct)+'%)':'Fully Paid'}</span>`)}
          <div style="margin:10px 0 8px;border-top:1px solid var(--line);padding-top:10px">
            ${row('Installments',`${insts.length} total`)}
            ${row('Paid',`<span style="color:var(--ok)">${paidInsts.length}</span>`)}
            ${overdueInsts.length?row('Overdue',`<span style="color:var(--err);font-weight:700">${overdueInsts.length}</span>`):''}
            ${nextDue?row('Next Due',`<span style="${nextDue.due_date<today?'color:var(--err);font-weight:700':''}">${fD(nextDue.due_date)} — ${fMF(nextDue.outstanding)}</span>`):''}
          </div>
        `):''}
        ${_srScheduleSection(hasSale,insts,dp,today,card)}
        ${_srPayHistSection(payments,card)}
        ${_srTransferSection(hist,hasTransfer,card)}
      </div>
    </div>
  </div>`;
}

function _srClientSection(d, hist, histCurrent, histPrevious, hasTransfer, clientType, card, row) {
  const { client } = d;
  if (!client && !histCurrent) return card('','Client Information','',`<div class="empty" style="padding:16px"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><div class="et">No client linked</div></div>`);
  if (!hasTransfer) {
    const c = client || {};
    return card('','Client Information',_srClientBadge('first'),`
      ${row('Name',       c.full_name?`<span style="font-weight:700">${esc(c.full_name)}</span>`:'—')}
      ${row('CNIC',       c.cnic?`<span style="font-family:monospace">${esc(c.cnic)}</span>`:null)}
      ${row('Phone',      c.phone_primary?`<a href="tel:${esc(c.phone_primary)}" style="color:var(--info)">${esc(c.phone_primary)}</a>`:null)}
      ${row('Alt Phone',  c.phone_secondary?esc(c.phone_secondary):null)}
      ${row('Email',      c.email?esc(c.email):null)}
      ${row('Address',    c.address?esc(c.address)+(c.city?', '+esc(c.city):''):null)}
      ${row('Father',     c.father_name?esc(c.father_name):null)}
      ${row('Occupation', c.occupation?esc(c.occupation):null)}
      ${row('Category',   c.overseas_local==='overseas'?'Overseas':c.overseas_local==='local'?'Local':null)}
      ${c.next_of_kin_name?row('Next of Kin',esc(c.next_of_kin_name)+(c.next_of_kin_relation?' ('+esc(c.next_of_kin_relation)+')':'')+(c.next_of_kin_phone?' · '+esc(c.next_of_kin_phone):'')):''}
    `);
  }
  const rows = [
    histCurrent?`<div style="padding:12px;border:1px solid rgba(59,130,246,.3);border-radius:var(--r);background:rgba(59,130,246,.03);margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Current Owner</span>${_srClientBadge('current')}
      </div>
      <div style="font-size:14px;font-weight:700;margin-bottom:4px">${esc(histCurrent.client_name||'—')}</div>
      ${histCurrent.client_cnic?`<div style="font-size:11px;color:var(--t3);font-family:monospace">CNIC: ${esc(histCurrent.client_cnic)}</div>`:''}
      ${histCurrent.client_phone?`<div style="font-size:11px;color:var(--t3)">${esc(histCurrent.client_phone)}</div>`:''}
      ${histCurrent.transfer_date?`<div style="font-size:11px;color:var(--t3);margin-top:6px;padding-top:6px;border-top:1px dashed var(--line)">Transferred in: ${fD(histCurrent.transfer_date)}${histCurrent.transfer_voucher_no?' · <span style="font-family:monospace">'+esc(histCurrent.transfer_voucher_no)+'</span>':''}</div>`:''}
    </div>`:'',
    ...histPrevious.map(h=>`<div style="padding:12px;border:1px solid rgba(245,158,11,.3);border-radius:var(--r);background:rgba(245,158,11,.03);margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Previous Owner</span>${_srClientBadge('previous')}
      </div>
      <div style="font-size:14px;font-weight:700;margin-bottom:4px">${esc(h.client_name||'—')}</div>
      ${h.client_cnic?`<div style="font-size:11px;color:var(--t3);font-family:monospace">CNIC: ${esc(h.client_cnic)}</div>`:''}
      ${h.client_phone?`<div style="font-size:11px;color:var(--t3)">${esc(h.client_phone)}</div>`:''}
      ${h.sale_date?`<div style="font-size:11px;color:var(--t3);margin-top:6px;padding-top:6px;border-top:1px dashed var(--line)">Original sale: ${fD(h.sale_date)}${h.transfer_date?' · Out: '+fD(h.transfer_date):''}</div>`:''}
    </div>`)
  ].join('');
  return card('','Client History','',rows);
}

function _srScheduleSection(hasSale, insts, dp, today, card) {
  if (!hasSale || (!insts.length && !dp)) return '';
  const allRows = [];
  if (dp) allRows.push({ ...dp, installment_number: 0 });
  insts.forEach(i => allRows.push(i));
  const trs = allRows.map(r => {
    const num    = r.installment_number===0?'DP':String(r.installment_number).padStart(2,'0');
    const isPaid = r.status==='paid'||Number(r.outstanding||0)<=0;
    const isOvd  = !isPaid&&r.due_date&&r.due_date<today;
    const st     = isPaid?`<span style="color:#16a34a;font-weight:700">Paid</span>`:isOvd?`<span style="color:#dc2626;font-weight:700">Overdue</span>`:`<span style="color:var(--t3)">Pending</span>`;
    return `<tr><td style="font-family:monospace;font-weight:700;color:${isOvd?'#dc2626':'var(--t2)'}">${num}</td><td style="${isOvd?'color:#dc2626;font-weight:700':''}">${r.due_date?fD(r.due_date):'—'}</td><td style="text-align:right;font-family:monospace">${fM(r.amount_due||0)}</td><td>${st}</td><td style="color:var(--t3);font-size:11px">${r.paid_at?fD(r.paid_at.split('T')[0]):'—'}</td></tr>`;
  }).join('');
  return card('','Installment Schedule','',`<div class="tw" style="max-height:320px;overflow-y:auto"><table class="t"><thead><tr><th>#</th><th>Due Date</th><th style="text-align:right">Amount</th><th>Status</th><th>Paid Date</th></tr></thead><tbody>${trs}</tbody></table></div>`);
}

function _srPayHistSection(payments, card) {
  if (!payments.length) return card('','Payment History','',`<div class="empty" style="padding:14px"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div class="et">No payments recorded</div></div>`);
  const trs = payments.map((p,i)=>`<tr><td style="color:var(--t3);font-size:11px">${i+1}</td><td>${fD(p.payment_date)}</td><td>${_srMethBadge(p.payment_method)}</td><td style="text-align:right;font-family:monospace;font-weight:700;color:var(--ok)">+${fM(p.amount)}</td><td style="font-size:11px;color:var(--t3)">${p.reference_no||p.bank_name||'—'}</td><td style="font-size:11px;color:var(--t2);max-width:120px">${p.notes||p.adjustment_note||'—'}</td></tr>`).join('');
  return card('',`Payment History <span style="font-size:12px;font-weight:400;color:var(--t3)">(${payments.length})</span>`,'',`<div class="tw" style="max-height:280px;overflow-y:auto"><table class="t"><thead><tr><th>#</th><th>Date</th><th>Method</th><th style="text-align:right">Amount</th><th>Reference</th><th>Notes</th></tr></thead><tbody>${trs}</tbody></table></div>`);
}

function _srTransferSection(hist, hasTransfer, card) {
  if (!hasTransfer) return '';
  const transfers = hist.filter(h => h.transfer_id);
  if (!transfers.length) return '';
  const rows = transfers.map((h,i)=>`<div style="padding:12px;border:1px solid var(--line);border-radius:var(--r);margin-bottom:10px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:12px;font-weight:700;color:var(--brand)">Transfer #${i+1}</span>
      ${h.transfer_voucher_no?`<span style="font-size:11px;font-family:monospace;color:var(--t2)">${esc(h.transfer_voucher_no)}</span>`:''}
    </div>
    <div class="ir"><span class="ir-l">Date</span><span class="ir-r">${fD(h.transfer_date)}</span></div>
    <div class="ir"><span class="ir-l">From</span><span class="ir-r">${esc(h.client_name||'—')}</span></div>
    ${h.transferred_to?`<div class="ir"><span class="ir-l">To</span><span class="ir-r">${esc(h.transferred_to)}</span></div>`:''}
    ${h.net_amount?`<div class="ir"><span class="ir-l">Sale Price</span><span class="ir-r">${fMF(h.net_amount)}</span></div>`:''}
  </div>`).join('');
  return card('','Transfer History','',rows);
}

// ── Print Functions ───────────────────────────────────────────────────────────
function _srPrintCurrentClient() {
  if (_srCurrentDet?.type === 'client') _srPrintClient(_srCurrentDet.data);
}

function _srPrintClient(c) {
  if (!c) { toast('No client data','warn'); return; }
  const today = td();
  const w = _pw('Client Profile — '+(c.full_name||''), _pCSS('A4'), 'A4');
  if (!w) return;
  const H  = _lh('CLIENT PROFILE');
  const pr = (l,v) => v?`<div class="row"><span class="lbl">${l}</span><span class="val">${v}</span></div>`:'';
  let h = H+`<div class="body"><div class="doc-title" style="margin-bottom:8px">Client Profile</div>
    <div style="font-size:10px;color:#555;margin-bottom:14px">Printed: ${fD(today)}</div>
    <div class="sec-title">Personal Information</div>
    ${pr('Full Name',c.full_name)}${pr('CNIC',c.cnic)}${pr('Phone',c.phone_primary)}
    ${pr('Alt Phone',c.phone_secondary)}${pr('Email',c.email)}${pr('Father Name',c.father_name)}
    ${pr('Occupation',c.occupation)}${pr('Category',c.overseas_local)}
    ${pr('Address',(c.address||'')+(c.city?', '+c.city:''))}
    ${c.next_of_kin_name?`<div class="sec-title">Next of Kin</div>${pr('Name',c.next_of_kin_name)}${pr('Relation',c.next_of_kin_relation)}${pr('Phone',c.next_of_kin_phone)}`:''}
    <div class="sig-row" style="margin-top:24px">
      <div class="sig-box"><div class="sig-lbl">Prepared By</div><div class="sig-name">${esc(S?.name||'—')}</div></div>
      <div class="sig-box"><div class="sig-lbl">Authorized</div><div class="sig-name">&nbsp;</div></div>
    </div>
    <div class="footer-bar">Nexunova RMS &nbsp;|&nbsp; ${fD(today)} &nbsp;|&nbsp; Client: ${esc(c.full_name||'—')}</div>
  </div>`;
  w.document.write(h); _pclose(w);
}

function printSearchDetail() {
  const d = _srDetail;
  if (!d) { toast('No unit detail loaded to print','warn'); return; }
  const { u, prj, pymData, saleRow, payments, ownerHist, client, agent } = d;
  const hasSale    = pymData?.success === true;
  const s          = hasSale ? pymData.sale : null;
  const insts      = hasSale ? (pymData.installments||[]) : [];
  const dp         = hasSale ? (pymData.down_payment||null) : null;
  const netAmt     = hasSale ? Number(s.net_amount||0) : 0;
  const totalPaid  = payments.reduce((sm,p)=>sm+Number(p.amount||0),0);
  const outstanding = Math.max(0,netAmt-totalPaid);
  const paidPct    = netAmt>0?Math.round(totalPaid/netAmt*100):0;
  const status     = _srCalcStatus(pymData,payments);
  const today      = td();
  const hist       = ownerHist?.success?(ownerHist.history||[]):[];
  const hasTransfer = hist.length>1;
  const cashPaid = payments.filter(p=>(p.payment_method||'').toLowerCase()==='cash').reduce((s,p)=>s+Number(p.amount||0),0);
  const bankPaid = payments.filter(p=>['bank_transfer','bank','cheque','online'].includes((p.payment_method||'').toLowerCase())).reduce((s,p)=>s+Number(p.amount||0),0);
  const adjPaid  = payments.filter(p=>(p.payment_method||'').toLowerCase()==='adjustment').reduce((s,p)=>s+Number(p.amount||0),0);
  const stMap    = {available:'Available',on_time:'On Time',overdue:'Overdue',defaulter:'DEFAULTER',fully_paid:'Fully Paid'};
  const stLabel  = stMap[status]||status;
  const w = _pw('Unit Detail — '+u.unitNo, _pCSS('A4'),'A4');
  if (!w) return;
  const H  = _lh('UNIT MASTER DETAIL REPORT');
  const pr  = (l,v)=>v?`<div class="row"><span class="lbl">${l}</span><span class="val">${v}</span></div>`:'';
  const sec = (t)=>`<div class="sec-title">${t}</div>`;
  const tbl = (head,rows)=>`<table><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  let h = H+`<div class="body">`;
  h+=`<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
    <div><div class="doc-title" style="margin:0 0 4px">Unit Detail Report</div>
    <div style="font-size:10px;color:#555">Unit: <b>${esc(u.unitNo)}</b> &nbsp;|&nbsp; Project: ${esc(prj?.projectName||prj?.name||'—')}</div></div>
    <div style="text-align:right"><div style="font-size:9px;color:#888">Report Date</div>
    <div style="font-size:12px;font-weight:700">${fD(today)}</div>
    <div style="font-size:9px;margin-top:4px;padding:2px 8px;border:1px solid #333;border-radius:3px;font-weight:700">${stLabel.toUpperCase()}</div></div>
  </div>`;
  h+=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid #ccc;border-radius:4px;overflow:hidden;margin-bottom:14px">
    ${[['Sale Price',fMF(netAmt)],['Total Paid',fMF(totalPaid)+' ('+paidPct+'%)'],['Outstanding',fMF(outstanding)],['Status',stLabel]]
      .map(([l,v])=>`<div style="padding:10px 12px;border-right:1px solid #ccc"><div style="font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:3px">${l}</div><div style="font-size:11px;font-weight:700">${v}</div></div>`).join('')}
  </div>`;
  h+=sec('Unit Information');
  h+=`<div class="info-grid">${[['Unit No',u.unitNo],['Project',prj?.projectName||prj?.name||'—'],['Floor',u.floorLabel||'—'],['Type',u.type||'—'],['Area',(u.area||'—')+' '+(u.areaUnit||'')],['Block',u.block||'—'],['Base Price',fMF(u.basePrice)],['Unit Code',u.unitCode||'—'],['Facing',u.facing||'—']].map(([l,v])=>`<div class="ig-item"><div class="ig-lbl">${l}</div><div class="ig-val">${esc(String(v||'—'))}</div></div>`).join('')}</div>`;
  if (hasSale) {
    h+=sec('Sale & Pricing');
    h+=pr('Sale Number',s.sale_number); h+=pr('Sale Date',fD(s.sale_date));
    h+=pr('Payment Plan',s.payment_plan_type==='cash'?'Full Cash':`Installment — ${s.installment_count} months`);
    h+=pr('Net Sale Price','<b>'+fMF(netAmt)+'</b>'); h+=pr('Down Payment',fMF(s.down_payment));
    if(Number(s.discount||0)>0) h+=pr('Discount',fMF(s.discount));
    if(saleRow?.wht_amount>0) h+=pr('WHT',fMF(saleRow.wht_amount));
    if(saleRow?.cvt_amount>0) h+=pr('CVT',fMF(saleRow.cvt_amount));
  }
  h+=sec('Client Information');
  if (client) {
    h+=`<div class="info-grid-2">${[['Name',client.full_name||'—'],['CNIC',client.cnic||'—'],['Phone',client.phone_primary||'—'],['Email',client.email||'—'],['Address',(client.address||'—')+(client.city?', '+client.city:'')],['Father Name',client.father_name||'—']].map(([l,v])=>`<div class="ig-item"><div class="ig-lbl">${l}</div><div class="ig-val">${esc(String(v||'—'))}</div></div>`).join('')}</div>`;
  } else if (hist[0]) {
    h+=pr('Name',hist[0].client_name); h+=pr('CNIC',hist[0].client_cnic); h+=pr('Phone',hist[0].client_phone);
  }
  if (agent) { h+=sec('Sales Agent'); h+=pr('Agent',agent.full_name); h+=pr('Code',agent.agent_code); h+=pr('Phone',agent.phone); h+=pr('Commission',agent.commission_percent+'%'); if(hasSale) h+=pr('Comm This Sale',fMF(netAmt*Number(agent.commission_percent)/100)); }
  h+=sec('Payment Summary');
  h+=pr('Sale Price',fMF(netAmt)); h+=pr('Cash',fMF(cashPaid)); h+=pr('Bank',fMF(bankPaid)); h+=pr('Adjustment',fMF(adjPaid));
  h+=pr('Total Paid','<b>'+fMF(totalPaid)+' ('+paidPct+'%)</b>'); h+=pr('Outstanding',outstanding>0?fMF(outstanding)+' ('+(100-paidPct)+'%)':'Fully Paid'); h+=pr('Status',stLabel.toUpperCase());
  if (hasSale && (insts.length||dp)) {
    h+=sec('Installment Schedule');
    const ar=[]; if(dp) ar.push({...dp,installment_number:0}); insts.forEach(i=>ar.push(i));
    h+=tbl(['#','Due Date','Amount (PKR)','Status','Paid Date'],ar.map(r=>{const num=r.installment_number===0?'DP':String(r.installment_number).padStart(2,'0');const isPaid=r.status==='paid'||Number(r.outstanding||0)<=0;const isOvd=!isPaid&&r.due_date&&r.due_date<today;return `<tr><td>${num}</td><td>${r.due_date?fD(r.due_date):'—'}</td><td style="text-align:right">${fM(r.amount_due||0)}</td><td>${isPaid?'Paid':isOvd?'Overdue':'Pending'}</td><td>${r.paid_at?fD(r.paid_at.split('T')[0]):'—'}</td></tr>`;}));
  }
  if (payments.length) {
    h+=sec('Payment History');
    h+=tbl(['#','Date','Method','Amount (PKR)','Reference','Notes'],payments.map((p,i)=>`<tr><td>${i+1}</td><td>${fD(p.payment_date)}</td><td>${(p.payment_method||'').replace('_',' ')}</td><td style="text-align:right">${fM(p.amount)}</td><td>${p.reference_no||p.bank_name||'—'}</td><td>${p.notes||p.adjustment_note||'—'}</td></tr>`));
  }
  if (hasTransfer) { h+=sec('Transfer History'); hist.forEach((hh,i)=>{h+=pr(`Owner #${i+1}`,esc(hh.client_name||'—'));if(hh.sale_date)h+=pr('  Booked',fD(hh.sale_date));if(hh.transfer_date)h+=pr('  Transferred',fD(hh.transfer_date)+(hh.transfer_voucher_no?' · '+hh.transfer_voucher_no:''));}); }
  h+=`<div class="sig-row" style="margin-top:24px"><div class="sig-box"><div class="sig-lbl">Prepared By</div><div class="sig-name">${esc(S?.name||'—')}</div></div><div class="sig-box"><div class="sig-lbl">Authorized Signatory</div><div class="sig-name">&nbsp;</div></div></div>
  <div class="footer-bar">Nexunova RMS &nbsp;|&nbsp; ${fD(today)} &nbsp;|&nbsp; Unit: ${esc(u.unitNo)} &nbsp;|&nbsp; Printed by: ${esc(S?.name||'—')}</div></div>`;
  w.document.write(h); _pclose(w);
}

// ══ LEDGERS HUB ══════════════════════════════════════════════

// Cached set of unit IDs that have at least one active sale (for unit ledger search)
let _soldUnitIds = null;

// Ledger hub — unified search + grouped list (redesigned 2026-06-16).
// One search box queries ALL account dimensions at once (or one, when a list row
// narrows the scope); registers open directly. nx- kit, fully theme-aware.
// group: 'account' (needs an entity → searchable) | 'register' (opens directly).
// PDC / Cancelled / Transferred removed — reachable from sidebar + Transfer & Cancel.
const _LHUB = [
  { type:'client',   group:'account',  icon:'users',      tone:'',        name:'Client Ledger',           desc:'Payment history & balance per client' },
  { type:'unit',     group:'account',  icon:'home',       tone:'info',    name:'Unit Ledger',             desc:'Sale & payment history per unit' },
  { type:'agent',    group:'account',  icon:'id-card',    tone:'',        name:'Agent Ledger',            desc:'Commission & sales history per agent' },
  { type:'project',  group:'account',  icon:'building-2', tone:'info',    name:'Project Ledger',          desc:'Collection ledger per project' },
  { type:'officer',  group:'register', icon:'shield',     tone:'success', name:'Recovery Officer Ledger', desc:'Collection performance by officer', navId:'officerledger' },
  { type:'receiving',group:'register', icon:'hand-coins', tone:'success', name:'Receiving Ledger',        desc:'All receipts and inflows log',      navId:'receivingledger' },
];

// Active search scope: 'all' or one account type (set by tapping a list row).
let _ldgFilter = 'all';
const _LDG_TYPE_LABEL = { client:'Client', unit:'Unit', agent:'Agent', project:'Project' };

function _ldgUniPlaceholder() {
  return {
    all:     'Search any client, unit, agent or project…',
    client:  'Search clients by name, code or phone…',
    unit:    'Search units by number or project…',
    agent:   'Search agents by name or code…',
    project: 'Search projects by name…',
  }[_ldgFilter] || 'Search…';
}

// Scoped CSS (re-injected per render with the page innerHTML, so it never
// accumulates). Pure semantic --fk tokens → dark/light aware automatically.
function _ldgHubCss() {
  return `<style>
    #pg-ledgers .ldg-search-wrap{position:relative}
    #pg-ledgers .ldg-search-ic{position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--fk-text-muted);display:flex;pointer-events:none}
    #pg-ledgers .ldg-search-inp{width:100%;padding:14px 16px 14px 46px;font-size:var(--fk-fs-title);font-weight:var(--fk-fw-medium);background:var(--fk-bg-subtle);border:1.5px solid var(--fk-border);border-radius:var(--fk-radius-control);color:var(--fk-text);outline:none;transition:border-color .15s,box-shadow .15s}
    #pg-ledgers .ldg-search-inp::placeholder{color:var(--fk-text-muted);font-weight:var(--fk-fw-regular)}
    #pg-ledgers .ldg-search-inp:focus{border-color:var(--fk-primary);box-shadow:0 0 0 3px var(--fk-primary-tint)}
    #pg-ledgers .ldg-results{margin-top:var(--fk-sp-3);max-height:340px;overflow-y:auto;border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);background:var(--fk-bg-card)}
    #pg-ledgers .ldg-res-row{display:flex;align-items:center;gap:11px;padding:11px 14px;cursor:pointer;border-bottom:1px solid var(--fk-border);transition:background .14s}
    #pg-ledgers .ldg-res-row:last-child{border-bottom:0}
    #pg-ledgers .ldg-res-row:hover{background:var(--fk-subtle-hover)}
    #pg-ledgers .ldg-res-main{flex:1;min-width:0}
    #pg-ledgers .ldg-res-lbl{font-size:var(--fk-fs-body);font-weight:var(--fk-fw-semibold);color:var(--fk-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #pg-ledgers .ldg-res-sub{font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin-top:1px}
    #pg-ledgers .ldg-res-tag{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:var(--fk-fw-bold);color:var(--fk-primary);background:var(--fk-primary-surface);padding:3px 8px;border-radius:999px;flex-shrink:0}
    #pg-ledgers .ldg-res-msg{padding:16px;text-align:center;font-size:var(--fk-fs-label);color:var(--fk-text-muted)}
    #pg-ledgers .ldg-sec-lbl{font-size:var(--fk-fs-label);text-transform:uppercase;letter-spacing:var(--fk-tracking-label);font-weight:var(--fk-fw-bold);color:var(--fk-text-muted);margin:var(--fk-sp-6) 0 var(--fk-sp-2)}
    #pg-ledgers .ldg-list{display:flex;flex-direction:column;gap:var(--fk-sp-2)}
    #pg-ledgers .ldg-row{display:flex;align-items:center;gap:12px;padding:13px 15px;background:var(--fk-bg-card);border:1px solid var(--fk-border);border-left:3px solid transparent;border-radius:var(--fk-radius-control);cursor:pointer;transition:border-color .15s,background .15s,transform .12s}
    #pg-ledgers .ldg-row:hover{border-color:var(--fk-primary);background:var(--fk-subtle-hover);transform:translateY(-1px)}
    #pg-ledgers .ldg-row.is-active{border-left-color:var(--fk-primary);background:var(--fk-primary-surface)}
    #pg-ledgers .ldg-row-txt{flex:1;min-width:0}
    #pg-ledgers .ldg-row-name{font-size:var(--fk-fs-body);font-weight:var(--fk-fw-semibold);color:var(--fk-text)}
    #pg-ledgers .ldg-row-desc{font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin-top:1px}
    #pg-ledgers .ldg-row-chev{color:var(--fk-text-muted);display:flex;flex-shrink:0}
  </style>`;
}

// The agent list lives in agents.js as `_agCache`, but agents.js is LAZY-loaded —
// open Ledgers without ever visiting Agents (every recovery / finance user, since
// their sidebar has no Agents entry) and the bare identifier throws ReferenceError,
// killing the whole page render. Read it defensively; keep our own copy otherwise.
function _ldgAgents() {
  try { if (typeof _agCache !== 'undefined' && Array.isArray(_agCache) && _agCache.length) return _agCache; }
  catch (e) {}
  return window._ldgAgentCache || [];
}
function _ldgSetAgents(rows) {
  window._ldgAgentCache = rows;
  try { if (typeof _agCache !== 'undefined') _agCache = rows; } catch (e) {}
}

function rLedgers() {
  const pg = document.getElementById('pg-ledgers');
  if (!pg) return;
  _ldgFilter = 'all';

  if (!_ldgAgents().length) {
    supabase.rpc('list_agents', { p_company_id: S?.cid, p_sort: 'name' })
      .then(({ data }) => { if (Array.isArray(data)) _ldgSetAgents(data); })
      .catch(() => {});
  }
  // Warm the sold-unit cache so the first unified search resolves instantly.
  if (_soldUnitIds === null) {
    _soldUnitIds = [];
    supabase.rpc('list_sold_unit_ids', { p_company_id: S?.cid })
      .then(({ data }) => { _soldUnitIds = data || []; })
      .catch(() => {});
  }

  const account  = _LHUB.filter(c => c.group === 'account').map(_ldgRow).join('');
  const register = _LHUB.filter(c => c.group === 'register').map(_ldgRow).join('');

  const hero = NX.card(
    '<div class="ldg-search-wrap">' +
      '<span class="ldg-search-ic">' + NX.icon('search', 18) + '</span>' +
      '<input id="ldg-uni-q" class="ldg-search-inp" autocomplete="off" placeholder="' + _ldgUniPlaceholder() + '" oninput="_ldgRunSearch(this.value)">' +
    '</div>' +
    '<div id="ldg-uni-results" class="ldg-results" style="display:none"></div>',
    { class:'ldg-hero' });

  pg.innerHTML =
    '<div class="ani">' +
      NX.pageHeader('Ledgers', '', { icon:'wallet', sub:'Search any account, or open a register' }) +
      _ldgHubCss() +
      hero +
      '<div class="ldg-sec-lbl">Account ledgers</div>' +
      '<div class="ldg-list">' + account + '</div>' +
      '<div class="ldg-sec-lbl">Registers</div>' +
      '<div class="ldg-list">' + register + '</div>' +
    '</div>';
}

function _ldgRow(c) {
  const onclick = c.group === 'register' ? `nav('${c.navId}')` : `_ldgPick('${c.type}')`;
  const data    = c.group === 'account' ? ` data-ltype="${c.type}"` : '';
  return '<div class="ldg-row"' + data + ' onclick="' + onclick + '">' +
    NX.ichip(c.icon, c.tone, {}) +
    '<div class="ldg-row-txt"><div class="ldg-row-name">' + esc(c.name) + '</div>' +
      '<div class="ldg-row-desc">' + esc(c.desc) + '</div></div>' +
    '<span class="ldg-row-chev">' + NX.icon('chevron-right', 16) + '</span>' +
  '</div>';
}

// Tapping an account row narrows the unified search to that dimension (tap again → all).
function _ldgPick(type) {
  _ldgFilter = (_ldgFilter === type) ? 'all' : type;
  document.querySelectorAll('#pg-ledgers .ldg-row[data-ltype]').forEach(function (r) {
    r.classList.toggle('is-active', r.getAttribute('data-ltype') === _ldgFilter);
  });
  const inp = document.getElementById('ldg-uni-q');
  if (inp) { inp.placeholder = _ldgUniPlaceholder(); inp.focus(); _ldgRunSearch(inp.value); }
}

// Gather matches for one dimension → [{type,id,label,sub}]
function _ldgGather(type, term) {
  if (type === 'client') {
    return gclients()
      .filter(c => !term || (c.fullName||'').toLowerCase().includes(term) || (c.clientCode||'').toLowerCase().includes(term) || (c.phonePrimary||'').includes(term))
      .map(c => ({ type, id:c.id, label:c.fullName||'Unnamed', sub:c.clientCode||'' }));
  }
  if (type === 'unit') {
    const projs = gprojects();
    return gunits().filter(u => (_soldUnitIds || []).includes(u.id))
      .filter(u => {
        if (!term) return true;
        const pn = (projs.find(p => p.id === u.projectId)?.projectName || projs.find(p => p.id === u.projectId)?.name || '').toLowerCase();
        return (u.unitNo||'').toLowerCase().includes(term) || pn.includes(term);
      })
      .map(u => {
        const prj = projs.find(p => p.id === u.projectId);
        return { type, id:u.id, label:u.unitNo||u.id, sub:prj?.projectName||prj?.name||'' };
      });
  }
  if (type === 'agent') {
    return _ldgAgents()
      .filter(a => !term || (a.full_name||'').toLowerCase().includes(term) || (a.agent_code||'').toLowerCase().includes(term))
      .map(a => ({ type, id:a.id, label:a.full_name||'Unnamed', sub:a.agent_code||'' }));
  }
  if (type === 'project') {
    return gprojects()
      .filter(p => !term || (p.projectName||p.name||'').toLowerCase().includes(term))
      .map(p => ({ type, id:p.id, label:p.projectName||p.name||'Unnamed', sub:'' }));
  }
  return [];
}

// Unified search — queries every active dimension and drops mixed, tagged results.
function _ldgRunSearch(q) {
  const resEl = document.getElementById('ldg-uni-results');
  if (!resEl) return;
  const term  = (q || '').toLowerCase().trim();
  const types = _ldgFilter === 'all' ? ['client','unit','agent','project'] : [_ldgFilter];

  // Empty query → keep the panel quiet (don't dump the whole book).
  if (!term) { resEl.style.display = 'none'; resEl.innerHTML = ''; return; }

  // Lazily load the sold-unit cache if a unit search needs it.
  if (types.includes('unit') && _soldUnitIds === null) {
    _soldUnitIds = [];
    supabase.rpc('list_sold_unit_ids', { p_company_id: S?.cid })
      .then(({ data }) => { _soldUnitIds = data || []; _ldgRunSearch(document.getElementById('ldg-uni-q')?.value || ''); });
    resEl.innerHTML = '<div class="ldg-res-msg">Loading…</div>';
    resEl.style.display = '';
    return;
  }

  // Fairly capped per dimension, then overall.
  let items = [];
  types.forEach(t => { items = items.concat(_ldgGather(t, term).slice(0, 12)); });
  items = items.slice(0, 30);

  if (!items.length) {
    resEl.innerHTML = '<div class="ldg-res-msg">No matches for “' + esc(q) + '”</div>';
  } else {
    resEl.innerHTML = items.map(function (it) {
      return '<div class="ldg-res-row" onclick="_lhubOpen(\'' + it.type + '\',\'' + it.id + '\')">' +
        '<div class="ldg-res-main"><div class="ldg-res-lbl">' + esc(it.label) + '</div>' +
          (it.sub ? '<div class="ldg-res-sub">' + esc(it.sub) + '</div>' : '') + '</div>' +
        '<span class="ldg-res-tag">' + esc(_LDG_TYPE_LABEL[it.type] || it.type) + '</span>' +
      '</div>';
    }).join('');
  }
  resEl.style.display = '';
}

function _lhubOpen(type, id) {
  if (type === 'client') {
    const c = gclients().find(x => x.id === id);
    window._ldgCtx = { id, name: c?.fullName || '—', sub: c?.clientCode || '' };
    nav('ledger-client');
  } else if (type === 'unit') {
    const u = gunits().find(x => x.id === id);
    const p = gprojects().find(x => x.id === u?.projectId);
    window._ldgCtx = { id, name: u?.unitNo || '—', sub: p?.projectName || p?.name || '' };
    nav('ledger-unit');
  } else if (type === 'agent') {
    const a = _ldgAgents().find(x => x.id === id);
    window._ldgCtx = { id, name: a?.full_name || '—', sub: a?.agent_code || '' };
    nav('ledger-agent');
  } else if (type === 'project') {
    const p = gprojects().find(x => x.id === id);
    window._ldgCtx = { id, name: p?.projectName || p?.name || '—', sub: '' };
    nav('ledger-project');
  }
}

// ══ Crystal Report shared helpers ════════════════════════════

function _ldgFiscalYear() {
  const now = new Date();
  const y   = now.getFullYear();
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  const dd  = String(now.getDate()).padStart(2, '0');
  return { from: `${y}-01-01`, to: `${y}-${mm}-${dd}` };
}

// "01-Jan-2026"
function _ldgFmtDate(s) {
  if (!s) return '';
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return String(s);
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + M[d.getMonth()] + '-' + d.getFullYear();
}

// "Jan-26"
function _ldgMonthLabel(s) {
  if (!s) return '???';
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return '???';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return M[d.getMonth()] + '-' + String(d.getFullYear()).slice(2);
}

// {text, color} for a balance amount
function _ldgBalStr(n) {
  const v = +n || 0;
  if (v === 0) return { text: '0 Dr', color: '#6B7280' };
  if (v > 0)   return { text: fMF(v) + ' Dr', color: '#dc2626' };
  return             { text: fMF(Math.abs(v)) + ' Cr', color: '#16a34a' };
}

// No-op — print is handled via _ldgPrint() popup window, not window.print()
function _ldgInjectPrintCss() {}

// Open report in a clean new window and print it — no app UI, no conflicts
function _ldgPrint() {
  const pg = document.querySelector('.pg.on');
  const el = (pg || document).querySelector('.ldg-rpt-wrap');
  if (!el) { alert('No report loaded — click Run Report first.'); return; }

  const co = (S?.coName || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);

  const _ldgHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${co} — Ledger Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family:"Times New Roman",Georgia,serif; background:#fff; color:#1a1a1a; margin:0; padding:10px 16px; font-size:9pt; line-height:1.35; }
  .no-print, .ldg-page-footer { display:none !important; }
  /* Crystal ledger doc */
  .ldg-crystal { border:1px solid #333; border-radius:0 !important; background:#fff; box-shadow:none !important; }
  .ldg-crystal.lc-head { border-bottom:0; }
  .lc-title { text-align:center; padding:10px 14px 8px; }
  .lc-co  { font-size:15pt; font-weight:700; }
  .lc-doc { font-size:11pt; font-weight:700; letter-spacing:1.2px; text-decoration:underline; margin-top:2px; }
  .lc-info { border-top:1px solid #333; border-bottom:1px solid #333; padding:7px 14px; display:grid; grid-template-columns:1fr 1fr; gap:2px 22px; font-size:9pt; }
  .lc-info .ir b { display:inline-block; min-width:84px; font-weight:700; }
  .lc-tw { overflow:visible !important; }
  table.lc-tbl { border-collapse:collapse; width:100% !important; min-width:0 !important; table-layout:fixed; font-variant-numeric:tabular-nums; }
  .lc-tbl th, .lc-tbl td { border:1px solid #333; padding:3px 6px; font-size:8.5pt; vertical-align:middle; word-break:break-word; overflow-wrap:break-word; }
  .lc-tbl thead th { background:#fff; color:#1a1a1a; font-weight:700; text-align:left; border-bottom:2.5px double #333; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .lc-tbl th.num, .lc-tbl td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .lc-tbl tr.lc-mhdr td { background:#dcdcdc; font-weight:700; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .lc-tbl tr.lc-mtot td { background:#E8E8E8; font-weight:700; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .lc-tbl tr.lc-gtot td { background:#cfcfcf; font-weight:700; border-top:3px double #333; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .lc-tbl tr.lc-ob td { font-style:italic; }
  .lc-dr { color:#b91c1c; font-weight:600; } .lc-cr { color:#15803d; font-weight:600; } .lc-zero { color:#6b7280; }
  .lc-tbl thead th:nth-child(1){width:8%} .lc-tbl thead th:nth-child(2){width:9%} .lc-tbl thead th:nth-child(3){width:38%}
  .lc-tbl thead th:nth-child(4){width:10%} .lc-tbl thead th:nth-child(5){width:11%} .lc-tbl thead th:nth-child(6){width:11%} .lc-tbl thead th:nth-child(7){width:13%}
  .lc-summary { border:1px solid #333; border-radius:4px; padding:8px 12px; max-width:320px; margin:12px 14px 8px; }
  .lc-summary h4 { font-size:9pt; font-weight:700; text-decoration:underline; text-align:center; margin:0 0 6px; }
  .lc-sum-row { display:flex; justify-content:space-between; gap:12px; padding:2px 0; border-bottom:1px dotted #aaa; font-size:9pt; }
  .lc-sum-row .l { font-weight:700; } .lc-sum-row .v { font-weight:700; text-decoration:underline; }
  @page { size:A4 landscape; margin:1cm 1.4cm; }
  @media print {
    body { padding:0; }
    thead { display:table-header-group; }
    .lc-mhdr { page-break-after:avoid; }
    .lc-gtot { page-break-before:avoid; }
    .lc-tbl th, .lc-mhdr td, .lc-mtot td, .lc-gtot td { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
</style>
</head>
<body>
${el.innerHTML}
</body>
</html>`;

  _printHTML(_ldgHtml, co + ' — Ledger Report');
}

// Navigation bar strip (hidden on print)
function _ldgNavBar(title) {
  const co = esc(S?.coName || '');
  return '<div class="no-print nx-card nx-card--compact" style="display:flex;align-items:center;justify-content:space-between;gap:var(--fk-sp-3);margin-bottom:var(--fk-sp-3)">' +
    NX.button('Back', { variant:'ghost', size:'sm', icon:'arrow-left', onclick:'navBack()' }) +
    '<span style="font-size:var(--fk-fs-body);font-weight:var(--fk-fw-semibold);color:var(--fk-text);text-align:center;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + co + (co ? ' — ' : '') + esc(title) + '</span>' +
    NX.button('Print', { variant:'secondary', size:'sm', icon:'printer', onclick:'_ldgPrint()' }) +
  '</div>';
}

// Legacy alias kept so old code doesn't break
function _ldgHdr(ledgerName) { return _ldgNavBar(ledgerName); }

// Date filter bar (hidden on print)
function _ldgFilterRow(prefix, onRunFn, extraHtml, dfl) {
  const fy   = _ldgFiscalYear();
  const from = (dfl && dfl.from) || fy.from;
  const to   = (dfl && dfl.to)   || fy.to;
  return '<div class="no-print nx-card" style="margin-bottom:var(--fk-sp-3)">' +
    '<div style="display:flex;flex-wrap:wrap;gap:var(--fk-sp-3);align-items:flex-end">' +
      '<div class="nx-field" style="margin-bottom:0"><label class="nx-label">From date</label>' +
        '<input id="' + prefix + '-from" class="nx-input" type="date" value="' + from + '" min="2000-01-01" max="2099-12-31" style="width:160px"></div>' +
      '<div class="nx-field" style="margin-bottom:0"><label class="nx-label">To date</label>' +
        '<input id="' + prefix + '-to" class="nx-input" type="date" value="' + to + '" min="2000-01-01" max="2099-12-31" style="width:160px"></div>' +
      (extraHtml || '') +
      NX.button('Run report', { variant:'primary', icon:'arrow-right', onclick: onRunFn + '()' }) +
    '</div>' +
  '</div>';
}

function _ldgValidateDates(fromVal, toVal, bodyEl) {
  if (!fromVal || !toVal) {
    if (bodyEl) bodyEl.innerHTML = _ldgErr('Please select both From and To dates.');
    return false;
  }
  if (fromVal > toVal) {
    if (bodyEl) bodyEl.innerHTML = _ldgErr('From date cannot be after To date.');
    return false;
  }
  return true;
}

function _ldgEmpty() {
  return NX.card(NX.empty({ icon:'file-text', message:'Select a date range and click “Run report” — the ledger will appear here.' }));
}

function _ldgLoading() {
  return NX.card(NX.empty({ icon:'clock', message:'Generating report…' }));
}

function _ldgErr(msg) {
  return NX.card(NX.banner(String(msg), 'danger'));
}

// Ledger type label from the active page id (shared header is type-agnostic).
function _ldgTypeLabel() {
  const id = ((document.querySelector('.pg.on') || {}).id) || '';
  const M = {'pg-ledger-client':'Client','pg-ledger-unit':'Unit','pg-ledger-agent':'Agent',
             'pg-ledger-project':'Project','pg-officerledger':'Officer','pg-receivingledger':'Receiving'};
  return M[id] || 'General';
}

// ── Crystal accounting header (shared, all dimensions) ──────────────────────
// params: { entityName, entityCode, project, fromDate, toDate, ledgerType? }
// Reuses the shared Crystal tokens (helpers.js _injectCrystalStyle / .ldg-crystal).
function _ldgCrystalHdr(params) {
  if (typeof _injectCrystalStyle === 'function') _injectCrystalStyle();
  const co   = esc(S?.coName || '—');
  const fd   = _ldgFmtDate(params.fromDate);
  const td2  = _ldgFmtDate(params.toDate);
  const name = esc(params.entityName || '—');
  const code = esc(params.entityCode || '—');
  const proj = esc(params.project    || '—');
  const lt   = esc(params.ledgerType || _ldgTypeLabel());
  const gen  = _ldgFmtDate(new Date().toISOString().slice(0, 10));
  return `
  <div class="ldg-crystal lc-head">
    <div class="lc-title">
      <div class="lc-co">${co}</div>
      <div class="lc-doc">${lt.toUpperCase()} LEDGER</div>
    </div>
    <div class="lc-info">
      <div class="ir"><b>Ledger</b>${lt}</div>
      <div class="ir"><b>Entity</b>${name}</div>
      <div class="ir"><b>Head Code</b>${code}</div>
      <div class="ir"><b>Project</b>${proj}</div>
      <div class="ir"><b>Period</b>${fd || '—'} to ${td2 || '—'}</div>
      <div class="ir"><b>Generated</b>${gen}</div>
    </div>
  </div>`;
}

// Print button shown inside rendered report (hidden on actual print)
function _ldgPrintBtn() {
  return '<div class="no-print" style="display:flex;justify-content:flex-end;margin-bottom:var(--fk-sp-3)">' +
    NX.button('Print report', { variant:'primary', icon:'printer', onclick:'_ldgPrint()' }) +
  '</div>';
}

// ── SAIF-style Crystal Report table ─────────────────────────
// rows:  array of row objects (mixed field names handled)
// ob:    opening balance (number)
// fromDate: 'YYYY-MM-DD'
// opts:  { debitLabel, creditLabel }
function _ldgCrystalTable(rows, ob, fromDate, opts) {
  const o   = opts || {};
  const dLbl = o.debitLabel  || 'Debit';
  const cLbl = o.creditLabel || 'Credit';

  // Normalize each row to a consistent shape
  const norm = (rows || []).map(r => {
    const dateStr = r.entry_date || r.row_date || r.payment_date || '';
    const isPdc   = ['pdc','cheque'].includes((r.method || '').toLowerCase());
    return {
      voucher_no:  r.voucher_no  || r.voucher_code || '',
      entry_date:  dateStr,
      description: r.description || r.particulars  || '',
      chq_no:      r.chq_no || (isPdc ? (r.reference_no || '') : ''),
      debit:  +(r.debit  || r.earned || 0),
      credit: +(r.credit || r.paid   || r.amount || 0),
    };
  });

  // Sort ascending by date
  norm.sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0));

  // Build month groups preserving order
  const monthOrder = [];
  const monthMap   = {};

  const obMk = (fromDate || '').slice(0, 7);
  if (obMk && !monthMap[obMk]) { monthMap[obMk] = []; monthOrder.push(obMk); }

  norm.forEach(r => {
    const mk = r.entry_date.slice(0, 7);
    if (!mk) return;
    if (!monthMap[mk]) { monthMap[mk] = []; monthOrder.push(mk); }
    monthMap[mk].push(r);
  });

  let runBal = +ob || 0;
  let totalD = 0, totalC = 0;
  let tbody  = '';
  const bcls = (v) => (v > 0 ? 'lc-dr' : v < 0 ? 'lc-cr' : 'lc-zero');

  monthOrder.forEach((mk, mIdx) => {
    const mRows  = monthMap[mk];
    const mLabel = _ldgMonthLabel(mk + '-01');
    let mD = 0, mC = 0;

    tbody += `<tr class="lc-mhdr"><td colspan="7">${mLabel}</td></tr>`;

    // Opening balance row (first month only)
    if (mIdx === 0) {
      const b = _ldgBalStr(runBal);
      tbody += `<tr class="lc-ob">
        <td>OP-0</td>
        <td class="num" style="text-align:left">${_ldgFmtDate(fromDate)}</td>
        <td>**** Opening Balance ****</td>
        <td></td><td class="num"></td><td class="num"></td>
        <td class="num"><span class="${bcls(runBal)}">${b.text}</span></td>
      </tr>`;
    }

    // Transaction rows
    mRows.forEach(r => {
      const dr = r.debit, cr = r.credit;
      runBal += dr - cr;
      mD += dr; mC += cr;
      totalD += dr; totalC += cr;
      const b = _ldgBalStr(runBal);
      tbody += `<tr>
        <td>${esc(r.voucher_no)}</td>
        <td class="num" style="text-align:left">${_ldgFmtDate(r.entry_date)}</td>
        <td>${esc(r.description || '—')}</td>
        <td>${esc(r.chq_no)}</td>
        <td class="num">${dr ? `<span class="lc-dr">${fMF(dr)}</span>` : ''}</td>
        <td class="num">${cr ? `<span class="lc-cr">${fMF(cr)}</span>` : ''}</td>
        <td class="num"><span class="${bcls(runBal)}">${b.text}</span></td>
      </tr>`;
    });

    // Monthly total
    tbody += `<tr class="lc-mtot">
      <td colspan="4" class="num">Monthly Total :</td>
      <td class="num"><span class="lc-dr">${fMF(mD)}</span></td>
      <td class="num"><span class="lc-cr">${fMF(mC)}</span></td>
      <td></td>
    </tr>`;
  });

  // Grand total
  const closing = (+ob || 0) + totalD - totalC;
  const fb = _ldgBalStr(closing);
  tbody += `<tr class="lc-gtot">
    <td colspan="4" class="num">Grand Total :</td>
    <td class="num"><span class="lc-dr">${fMF(totalD)}</span></td>
    <td class="num"><span class="lc-cr">${fMF(totalC)}</span></td>
    <td class="num"><span class="${bcls(closing)}">${fb.text}</span></td>
  </tr>`;

  // ── Outstanding Balance Summary box (Saif-style; underlined values) ──
  const isClient = _ldgTypeLabel() === 'Client';
  const sL = isClient
    ? { a: 'Total Billed (Dr)', b: 'Amount Received (Cr)', c: 'Remaining Balance' }
    : { a: 'Total ' + dLbl + ' (Dr)', b: 'Total ' + cLbl + ' (Cr)', c: 'Closing Balance' };
  const obStr = _ldgBalStr(+ob || 0);
  const summary = `
  <div class="lc-summary">
    <h4>Outstanding Balance Summary</h4>
    <div class="lc-sum-row"><span class="l">Opening Balance</span><span class="v">${obStr.text}</span></div>
    <div class="lc-sum-row"><span class="l">${sL.a}</span><span class="v">${fMF(totalD)}</span></div>
    <div class="lc-sum-row"><span class="l">${sL.b}</span><span class="v">${fMF(totalC)}</span></div>
    <div class="lc-sum-row"><span class="l">${sL.c}</span><span class="v">${fb.text}</span></div>
  </div>`;

  return `
  <div class="ldg-crystal lc-body">
    <div class="lc-tw">
      <table class="lc-tbl">
        <thead><tr>
          <th style="width:78px">V/No</th>
          <th style="width:96px">Date</th>
          <th>Description</th>
          <th style="width:96px">Cheque/Ref</th>
          <th class="num" style="width:120px">${esc(dLbl)}</th>
          <th class="num" style="width:120px">${esc(cLbl)}</th>
          <th class="num" style="width:130px">Balance</th>
        </tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
    ${summary}
  </div>`;
}

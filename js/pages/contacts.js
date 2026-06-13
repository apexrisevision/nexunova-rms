// ══ FOLLOW-UP & RECOVERY — v3.0 (full rebuild 2026-05-31) ══════════════════
// Tabs: Dashboard | Work Queue | Contact Log | Reports | Escalation
//
// CRITICAL ARCHITECTURE NOTE (vs v2.0):
//   v2.0 split rendering into two passes — _fcBuild set pg.innerHTML to the
//   shell with an EMPTY <div id="cl-content">, then _fcRender called a tab
//   renderer that set cl-content.innerHTML separately. Empirically that
//   second write didn't stick in production: cl-content stayed at 0 chars
//   even though the renderer function executed and the same renderer worked
//   when called manually from the console. Likely a CSS animation /
//   compositor race against repeated innerHTML mutations on a freshly
//   inserted node. Rather than chase the race, v3.0 sidesteps it entirely.
//
//   v3.0: ONE innerHTML pass per render. Tab content is composed into the
//   shell template as a string, so pg-contacts goes from old content →
//   new content in a single browser layout step. Tab switch = full
//   _fcBuild rebuild (not a partial cl-content write). No stale element
//   refs, no animation-vs-write race.
//
// Public API preserved for callers in modals-log-call.js, ui.js nav, etc.:
//   rCons, loadContactLogsCache, _fcSetTab, _fcBuild,
//   _unitEscalation, _computeNewFlag, _chIcon, _resBadge, _stBadge, _dStat
// Removed (no external callers; verified via grep): _fcRender, _fcDash,
//   _fcQueue, _renderCLLog, _renderCLReports, _fcEscalation as separate
//   exports. _rCLTable kept (Contact Log filters call it directly).
// ═══════════════════════════════════════════════════════════════════════════

// ─── State ────────────────────────────────────────────────────────────────
let _clCache          = null;
let _clTab            = 'dashboard';
let _clRptTab         = 'daily';
let _clSelectedUnit   = null;
let _clQueueFilter    = 'all';   // Work Queue filter pill: all/critical/overdue/today/never
let _clDrawerUnitId   = null;
let _clf              = { ch:'All', res:'All', fu:'All', ag:'All', flag:'All', q:'', fr:'', to:'' };
let _clBrokenPromises = [];
let _clEscalations    = [];
let _clLegalCases     = [];

// ─── SVG Icon Helper (Lucide subset) ──────────────────────────────────────
const _FC_ICONS = {
  'phone-call':       '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-3.64-3.07 19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 2.96 2.27l3.12.44a2 2 0 0 1 1.69 1.69l.44 3.12a2 2 0 0 1-.45 2.11L6.5 10.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45l3.12.44a2 2 0 0 1 1.69 1.69l.44 3.12Z"/>',
  'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  'zap':              '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  'list':             '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  'bar-chart-3':      '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  'alert-triangle':   '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'refresh-cw':       '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'plus':             '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'chevron-right':    '<path d="m9 18 6-6-6-6"/>',
  'check':            '<polyline points="20 6 9 17 4 12"/>',
  'x':                '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'phone':            '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.77 13.5 19.79 19.79 0 0 1 1.72 4.91a2 2 0 0 1 1.77-2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 17.92z"/>',
  'external-link':    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/>',
  'clock':            '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'handshake':        '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-1"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
  'flag':             '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  'inbox':            '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'trending-up':      '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'arrow-right':      '<line x1="5" x2="19" y1="12" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  'search':           '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'printer':          '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
  'mail':             '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  'message-circle':   '<path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/>',
  'message-square':   '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'home':             '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  'users':            '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
};
function _fci(name, size=14) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${_FC_ICONS[name]||''}</svg>`;
}

// WARMTH BRIDGE — the Inbox runs on followup.css (its own `fc-*` system, used
// nowhere else). Per "RESTYLE ≠ REBUILD", the chrome (header/tabs/KPIs) is
// rebuilt on the nx-kit; the dense tab CONTENT (lanes/sections/tables) stays on
// followup.css but is re-pointed to the kit palette by remapping its local CSS
// variables to --fk-* on #pg-contacts. Presentational only, page-scoped.
function _fcWarmCSS() {
  if (document.getElementById('_fc_warm_css')) return;
  const s = document.createElement('style'); s.id = '_fc_warm_css';
  s.textContent = `
    #pg-contacts{
      --primary:var(--fk-primary); --border:var(--fk-border); --border-strong:var(--fk-border);
      --border-focus:var(--fk-primary); --text:var(--fk-text); --text-muted:var(--fk-text-muted);
      --text-soft:var(--fk-text-muted); --text-faint:var(--fk-text-muted);
      --bg-card:var(--fk-bg-card); --bg-card-hover:var(--fk-bg-subtle); --bg-page:var(--fk-bg-page);
      --bg-chip:var(--fk-bg-subtle); --bg-row-hover:var(--fk-bg-subtle);
      --bg-primary-soft:var(--fk-primary-tint);
      --bg-success-soft:var(--fk-success-surface,rgba(22,163,74,.08));
      --bg-danger-soft:var(--fk-danger-surface,rgba(220,38,38,.08));
      --success:var(--fk-success); --danger:var(--fk-danger); --warning:var(--fk-warning);
      --shadow-sm:var(--fk-shadow); font-family:var(--fk-font);
    }
    #pg-contacts .fc-kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
    @media(max-width:900px){#pg-contacts .fc-kpi-grid{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:520px){#pg-contacts .fc-kpi-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(s);
}

function _fcRenderTabs(TABS) {
  const el = document.getElementById('fc-tabs');
  if (!el) return;
  el.innerHTML = NX.tabs({
    tabs: TABS.map(t => ({ k:t.id, label:t.label, icon:t.icon, count: t.badge > 0 ? t.badge : undefined })),
    active: _clTab, onSelect: "_fcSetTab('%k')"
  });
}

// ─── Cache Loader (called at login + manual refresh) ──────────────────────
async function loadContactLogsCache(companyId) {
  try {
    const cid = companyId || S?.cid;
    if (!cid) return;
    const { data, error } = await supabase.rpc('get_contact_logs_cache', { p_company_id: cid });
    if (!error) {
      _clCache = data || [];
      window._contactLogsCache = _clCache;
    }
  } catch(e) { console.warn('[loadContactLogsCache]', e); }
}

async function _loadBrokenPromises() {
  try {
    if (!S?.cid) { _clBrokenPromises = []; return; }
    const projIds = (S.assignedProjectIds && S.assignedProjectIds.length) ? S.assignedProjectIds : null;
    const { data } = await supabase.rpc('list_broken_promises', {
      p_company_id: S.cid, p_project_ids: projIds
    });
    _clBrokenPromises = Array.isArray(data) ? data : [];
  } catch(e) { _clBrokenPromises = []; }
}

async function _loadEscalationData() {
  try {
    if (!S?.cid) { _clEscalations = []; _clLegalCases = []; return; }
    const { data } = await supabase.rpc('get_escalations_legal_combined', { p_company_id: S.cid });
    _clEscalations = data?.escalations  || [];
    _clLegalCases  = data?.legal_cases  || [];
  } catch(e) { _clEscalations = []; _clLegalCases = []; }
}

// ─── Entry Point (called by nav('contacts')) ──────────────────────────────
async function rCons() {
  const pg = document.getElementById('pg-contacts');
  if (!pg) return;
  pg.innerHTML = `<div style="padding:60px 20px;text-align:center;color:var(--t3);font-size:13px">Loading Follow-up &amp; Recovery…</div>`;
  try {
    await Promise.all([
      loadContactLogsCache(S?.cid),
      _loadBrokenPromises(),
      _loadEscalationData()
    ]);
    _fcBuild(pg);
  } catch(e) {
    pg.innerHTML = `<div class="card" style="margin:20px;padding:20px;color:#ef4444;border-left:3px solid #ef4444">Error loading: ${esc(e?.message||String(e))}</div>`;
  }
}

// ─── Single-Pass Page Builder ─────────────────────────────────────────────
// Sets pg-contacts innerHTML to header + tabs + tab content IN ONE GO.
// Called on initial load AND on every tab switch.
function _fcBuild(pg) {
  if (!pg) pg = document.getElementById('pg-contacts');
  if (!pg) return;

  const t   = td();
  const all = _clCache || [];

  // ── Compute tab badges ──
  const fuOverdue  = all.filter(c => c.next_followup_date && c.next_followup_date < t).length;
  const fuToday    = all.filter(c => c.next_followup_date === t).length;
  const queueCount = fuOverdue + fuToday;
  const byUnit     = {};
  all.forEach(c => { if (c.unit_id) (byUnit[c.unit_id] = byUnit[c.unit_id] || []).push(c); });
  const redCount   = Object.values(byUnit).filter(logs => _unitEscalation(logs).flag === 'Red').length;

  const TABS = [
    { id:'dashboard',  label:'Dashboard',   icon:'layout-dashboard' },
    { id:'queue',      label:'Work Queue',  icon:'zap',             badge: queueCount  },
    { id:'log',        label:'Contact Log', icon:'list' },
    { id:'reports',    label:'Reports',     icon:'bar-chart-3' },
    { id:'escalation', label:'Escalation',  icon:'alert-triangle',  badge: redCount },
  ];

  // ── Render tab content as a string (sync) ──
  let body = '';
  try {
    body = _renderTabHtml();
  } catch(e) {
    console.error('[_fcBuild tab render]', e);
    body = `<div class="card" style="padding:20px;color:#ef4444;border-left:3px solid #ef4444">
      <div style="font-weight:700;margin-bottom:6px">Tab render error</div>
      <div style="font-size:12px;color:var(--t2)">${esc(e?.message||String(e))}</div>
    </div>`;
  }

  // ── ONE-SHOT innerHTML — warm kit header + segmented tabs + content ──
  _fcWarmCSS();
  pg.innerHTML = '<div class="module-recovery" style="opacity:1">' +
    NX.pageHeader('Follow-up & Recovery',
      NX.button('Refresh', { variant:'secondary', icon:'refresh-cw', onclick:'rCons()' }) +
      NX.button('Log contact', { variant:'primary', icon:'plus', onclick:'openConModal(null)' }),
      { icon:'phone', sub:'Communication tracking and recovery analytics' }) +
    '<div id="fc-tabs" style="margin-bottom:4px"></div>' +
    `<div class="fc-content" id="cl-content" role="tabpanel" style="opacity:1;padding-top:20px">${body}</div>` +
  '</div>';

  _fcRenderTabs(TABS);
  _fcEnsureDrawer();

  // Post-render hook for the Contact Log tab: populate cl-sum + cl-tbl
  // (inline <script> tags inside innerHTML don't execute, so we call here).
  if (_clTab === 'log') setTimeout(_rCLTable, 0);
}

function _fcSetTab(tab) {
  _clTab = tab;
  _fcBuild();
}

// ─── Tab Dispatcher ───────────────────────────────────────────────────────
function _renderTabHtml() {
  switch (_clTab) {
    case 'dashboard':  return _tabDashboardHtml();
    case 'queue':      return _tabQueueHtml();
    case 'log':        return _tabLogHtml();
    case 'reports':    return _tabReportsHtml();
    case 'escalation': return _tabEscalationHtml();
    default:           return _tabDashboardHtml();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1 — DASHBOARD (v3.1 — uses followup.css design system, single accent,
// no multi-colour stat cards, fixed Due-Today text overlap)
// ═══════════════════════════════════════════════════════════════════════════
function _tabDashboardHtml() {
  const t   = td();
  const all = _clCache || [];
  const byUnit = {};
  all.forEach(c => { if (c.unit_id) (byUnit[c.unit_id] = byUnit[c.unit_id] || []).push(c); });

  const fuOverdue = all.filter(c => c.next_followup_date && c.next_followup_date < t);
  const fuToday   = all.filter(c => c.next_followup_date === t);
  const promises  = all.filter(c => c.promise_to_pay);
  const promiseAmt= promises.reduce((s,c) => s + Number(c.promise_amount||0), 0);

  const flags = { Red:[], Orange:[], Yellow:[] };
  Object.entries(byUnit).forEach(([uid, logs]) => {
    const f = _unitEscalation(logs).flag;
    if (f) flags[f].push(uid);
  });
  const totalFlags = flags.Red.length + flags.Orange.length + flags.Yellow.length;

  const soldUnits      = gunits().filter(u => u.status !== 'Available' && u.status !== 'Dead' && actualPending(u) > 0);
  const neverContacted = soldUnits.filter(u => !byUnit[u.id]);

  // ── 4 hero KPIs (single accent + critical red only) ──
  const kpiHtml = `<div class="fc-kpi-grid">
    ${_fcKpi('clock',           'blue',    'Due Today',       String(fuToday.length),   fuToday.length ? `${fuToday.length} scheduled` : 'All caught up')}
    ${_fcKpi('alert-triangle',  fuOverdue.length ? 'red' : 'slate', 'Overdue', String(fuOverdue.length), fuOverdue.length ? 'Past deadline' : 'No backlog')}
    ${_fcKpi('handshake',       'emerald', 'Active Promises', String(promises.length),  promises.length ? `PKR ${fM(promiseAmt)}` : 'None pending')}
    ${_fcKpi('flag',            totalFlags ? 'red' : 'slate', 'Escalation Flags', String(totalFlags), totalFlags ? `${flags.Red.length} red · ${flags.Orange.length} orange · ${flags.Yellow.length} yellow` : 'All units in good standing')}
  </div>`;

  // ── Action lanes: Due Today / Overdue / Never Contacted ──
  const dueTodayLane = _fcLane({
    title: 'Due Today',
    count: fuToday.length,
    onViewAll: fuToday.length ? `_fcSetTab('queue')` : null,
    emptyTitle: 'No follow-ups due today',
    emptySuccess: true,
    items: fuToday.slice(0, 5).map(c => {
      const u = gunit(c.unit_id);
      const ch = c.next_followup_channel || c.channel || 'Call';
      const pending = u ? actualPending(u) : 0;
      return _fcLaneRowHtml({
        uid: c.unit_id,
        name: u?.customerName || c.client_name || '—',
        unitNo: u?.unitNo,
        meta: pending ? `${ch} · PKR ${fM(pending)}` : ch,
      });
    }).join(''),
    overflow: fuToday.length > 5 ? `+${fuToday.length - 5} more in Work Queue` : null,
  });

  const overdueSorted = [...fuOverdue].sort((a,b) => (a.next_followup_date||'').localeCompare(b.next_followup_date||''));
  const overdueLane = _fcLane({
    title: 'Overdue',
    count: fuOverdue.length,
    countTone: fuOverdue.length ? 'red' : null,
    onViewAll: fuOverdue.length ? `_fcSetTab('queue')` : null,
    emptyTitle: 'No overdue follow-ups',
    emptySuccess: true,
    items: overdueSorted.slice(0, 5).map(c => {
      const u = gunit(c.unit_id);
      const d = Math.floor((new Date(t) - new Date(c.next_followup_date)) / 86400000);
      return _fcLaneRowHtml({
        uid: c.unit_id,
        name: u?.customerName || c.client_name || '—',
        unitNo: u?.unitNo,
        meta: `${d}d late · ${c.next_followup_channel || c.channel || 'Call'}`,
        metaTone: 'red',
      });
    }).join(''),
    overflow: fuOverdue.length > 5 ? `+${fuOverdue.length - 5} more in Work Queue` : null,
  });

  const neverLane = _fcLane({
    title: 'Never Contacted',
    count: neverContacted.length,
    onViewAll: neverContacted.length ? `_fcSetTab('queue')` : null,
    emptyTitle: 'Every sold unit has been contacted',
    emptySuccess: true,
    items: neverContacted.slice(0, 5).map(u => _fcLaneRowHtml({
      uid: u.id,
      name: u.customerName || '—',
      unitNo: u.unitNo,
      meta: `PKR ${fM(actualPending(u))} pending`,
    })).join(''),
    overflow: neverContacted.length > 5 ? `+${neverContacted.length - 5} more sold units` : null,
  });

  const lanesHtml = `<div class="fc-lanes">
    ${dueTodayLane}
    ${overdueLane}
    ${neverLane}
  </div>`;

  // ── Escalation summary (compact section, only shown if any flag exists) ──
  const escSummaryHtml = totalFlags ? `
    <div class="fc-section">
      <div class="fc-section-header">
        <div class="fc-section-header-left">
          <div class="fc-section-title">Escalation Summary</div>
          <div class="fc-section-sub">Units flagged by no-response or broken-promise heuristics</div>
        </div>
        <div class="fc-section-right">
          <button class="fc-btn ghost" onclick="_fcSetTab('escalation')">View register ${_fci('arrow-right', 12)}</button>
        </div>
      </div>
      <div style="display:flex;gap:24px;padding:14px 16px;flex-wrap:wrap">
        ${flags.Red.length    ? _fcEscChip('Red',    flags.Red.length,    '5+ no-response')          : ''}
        ${flags.Orange.length ? _fcEscChip('Orange', flags.Orange.length, '2+ broken promises')      : ''}
        ${flags.Yellow.length ? _fcEscChip('Yellow', flags.Yellow.length, '3+ no-response')          : ''}
      </div>
    </div>` : '';

  return kpiHtml + lanesHtml + escSummaryHtml;
}

// ── Reusable building blocks for the SaaS-grade dashboard ────────────────
function _fcKpi(iconName, tone, label, value, sub) {
  const toneMap = { blue:'', red:'danger', emerald:'success', slate:'' };
  return NX.kpi({ icon:iconName, tone:toneMap[tone] || '', label, value, delta:sub });
}

function _fcLane({ title, count, countTone, onViewAll, emptyTitle, emptySuccess, items, overflow }) {
  const countStyle = countTone === 'red' ? 'background:rgba(220,38,38,.10);color:#DC2626' : '';
  return `<div class="fc-lane">
    <div class="fc-lane-header">
      <div class="fc-lane-title-wrap">
        <span class="fc-lane-title">${title}</span>
        <span class="fc-lane-count"${countStyle?` style="${countStyle}"`:''}>${count}</span>
      </div>
      ${onViewAll ? `<button class="fc-lane-link" onclick="${onViewAll}">View all</button>` : ''}
    </div>
    <div class="fc-lane-body">
      ${!items
        ? `<div class="fc-lane-empty"><div class="fc-lane-empty-icon${emptySuccess?' success':''}">${_fci(emptySuccess?'check':'inbox', 14)}</div><div class="fc-lane-empty-title">${emptyTitle}</div></div>`
        : items}
    </div>
    ${overflow ? `<div class="fc-lane-footer" onclick="_fcSetTab('queue')">${overflow}</div>` : ''}
  </div>`;
}

function _fcLaneRowHtml({ uid, name, unitNo, meta, metaTone }) {
  const metaStyle = metaTone === 'red' ? 'color:#DC2626' : '';
  return `<div class="fc-lane-row" onclick="openUD('${esc(uid||'')}')">
    <div class="fc-lane-info">
      <div class="fc-lane-name">${esc(name)}</div>
      <div class="fc-lane-meta"${metaStyle?` style="${metaStyle}"`:''}>${unitNo?`<span class="fc-unit">${esc(unitNo)}</span> · `:''}${esc(meta)}</div>
    </div>
    <button class="fc-lane-action" onclick="event.stopPropagation();openConModal('${esc(uid||'')}')">Log</button>
  </div>`;
}

function _fcEscChip(flag, count, reason) {
  const tones = {
    Red:    { color:'#DC2626', bg:'rgba(220,38,38,.08)', border:'rgba(220,38,38,.18)' },
    Orange: { color:'#EA580C', bg:'rgba(234,88,12,.08)', border:'rgba(234,88,12,.18)' },
    Yellow: { color:'#D97706', bg:'rgba(217,119,6,.08)', border:'rgba(217,119,6,.18)' },
  };
  const t = tones[flag] || tones.Yellow;
  return `<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:${t.bg};border:1px solid ${t.border};border-radius:8px">
    <div style="width:8px;height:8px;border-radius:50%;background:${t.color};flex-shrink:0"></div>
    <div>
      <div style="font-size:13px;font-weight:600;color:var(--text);font-variant-numeric:tabular-nums">${count} <span style="font-weight:500;color:${t.color}">${flag}</span></div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:1px">${reason}</div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2 — WORK QUEUE (v3.1 SaaS — uses .fc-queue-card / .fc-qi / .fc-pills)
// ═══════════════════════════════════════════════════════════════════════════
function _tabQueueHtml() {
  const t   = td();
  const all = _clCache || [];

  const byUnit = {};
  all.forEach(c => { if (c.unit_id) (byUnit[c.unit_id] = byUnit[c.unit_id] || []).push(c); });

  const soldUnits = gunits().filter(u => u.status !== 'Available' && u.status !== 'Dead' && actualPending(u) > 0);

  // Build a single ranked list, tagged with type so filter pills can slice
  // it without re-computation.
  const items = [];
  soldUnits.forEach(u => {
    const logs = byUnit[u.id] || [];
    if (!logs.length) {
      items.push({ u, logs, type:'never', label:'Never contacted', sortKey: actualPending(u), refLog:null });
      return;
    }
    const flag     = _unitEscalation(logs).flag;
    const fuLogs   = logs.filter(c => c.next_followup_date);
    const overdueL = fuLogs.find(c => c.next_followup_date < t);
    const todayL   = fuLogs.find(c => c.next_followup_date === t);
    if (flag === 'Red' && overdueL) {
      const d = Math.floor((new Date(t)-new Date(overdueL.next_followup_date))/86400000);
      items.push({ u, logs, type:'critical', label:`Red flag · ${d}d overdue`, sortKey: -d, refLog: overdueL });
    } else if (overdueL) {
      const d = Math.floor((new Date(t)-new Date(overdueL.next_followup_date))/86400000);
      items.push({ u, logs, type:'overdue', label:`${d}d overdue`, sortKey: -d, refLog: overdueL });
    } else if (todayL) {
      items.push({ u, logs, type:'today', label:'Due today', sortKey: actualPending(u), refLog: todayL });
    }
  });

  // Critical > Overdue > Today > Never. Within bucket, sortKey desc.
  const typeOrder = { critical:0, overdue:1, today:2, never:3 };
  items.sort((a,b) => (typeOrder[a.type]-typeOrder[b.type]) || (b.sortKey - a.sortKey));

  const counts = {
    all:      items.length,
    critical: items.filter(i => i.type === 'critical').length,
    overdue:  items.filter(i => i.type === 'overdue').length,
    today:    items.filter(i => i.type === 'today').length,
    never:    items.filter(i => i.type === 'never').length,
  };

  const filter   = _clQueueFilter || 'all';
  const filtered = filter === 'all' ? items : items.filter(i => i.type === filter);

  const renderQI = (it, idx) => {
    const { u, type, label, logs, refLog } = it;
    const lastLog = logs.length ? [...logs].sort((a,b) => (b.contact_date||'').localeCompare(a.contact_date||''))[0] : null;
    const rankCls = type === 'critical' ? 'top' : 'normal';
    const channelStr = refLog?.next_followup_channel || refLog?.channel || (lastLog?.channel) || 'Call';
    const lastStr = lastLog ? `Last: ${fD(lastLog.contact_date)} · ${esc(lastLog.channel||'Call')}` : 'No contact on record';
    return `<div class="fc-qi" onclick="openUD('${esc(u.id||'')}')">
      <div class="fc-qi-rank ${rankCls}">${idx+1}</div>
      <div class="fc-qi-body">
        <div class="fc-qi-row1">
          <span class="fc-unit">${esc(u.unitNo||'?')}</span>
          <span class="fc-qi-name">${esc((u.customerName||'?').substring(0,28))}</span>
          <span class="fc-status ${type}">${esc(label)}</span>
        </div>
        <div class="fc-qi-meta">
          <span class="fc-amount" style="display:inline">PKR ${fM(actualPending(u))}</span>
          &nbsp;·&nbsp; ${esc(lastStr)}
          ${refLog ? ` &nbsp;·&nbsp; Next: ${esc(channelStr)}` : ''}
        </div>
      </div>
      <div class="fc-qi-actions">
        <button class="fc-btn ghost" onclick="event.stopPropagation();openUD('${esc(u.id||'')}')">View</button>
        <button class="fc-btn primary" onclick="event.stopPropagation();openConModal('${esc(u.id||'')}')">Log</button>
      </div>
    </div>`;
  };

  const headerHtml = `<div class="fc-queue-header">
    <div>
      <div class="fc-queue-title">${items.length} action item${items.length!==1?'s':''}${filter!=='all'?` · filter: ${filter}`:''}</div>
      <div class="fc-queue-meta">${new Date().toLocaleDateString('en-PK',{weekday:'long',day:'numeric',month:'long'})}</div>
    </div>
    <div class="fc-queue-controls">
      ${_clBrokenPromises.length ? `<span class="fc-status broken">${_clBrokenPromises.length} promise${_clBrokenPromises.length>1?'s':''} due</span>` : ''}
      <button class="fc-icon-btn-sm" onclick="rCons()" title="Refresh">${_fci('refresh-cw',14)}</button>
    </div>
  </div>`;

  const pillsHtml = `<div class="fc-pills">
    ${_qPill('all',      'All',       counts.all)}
    ${counts.critical ? _qPill('critical', 'Critical', counts.critical, 'critical') : ''}
    ${counts.overdue  ? _qPill('overdue',  'Overdue',  counts.overdue,  'overdue')  : ''}
    ${counts.today    ? _qPill('today',    'Today',    counts.today,    'today')    : ''}
    ${counts.never    ? _qPill('never',    'Never contacted', counts.never, 'never') : ''}
  </div>`;

  const queueHtml = filtered.length
    ? `<div class="fc-queue-card">${filtered.map(renderQI).join('')}</div>`
    : `<div class="fc-queue-card"><div class="fc-empty">
        <div class="fc-empty-icon success">${_fci('check',20)}</div>
        <div class="fc-empty-title">Queue is clear</div>
        <div class="fc-empty-sub">${filter==='all'?'No pending follow-ups. Check back tomorrow.':'No items match this filter.'}</div>
      </div></div>`;

  const brokenHtml = _clBrokenPromises.length ? `
    <div class="fc-section" style="margin-top:16px">
      <div class="fc-section-header">
        <div class="fc-section-header-left">
          <div class="fc-section-title">Overdue Payment Promises</div>
          <div class="fc-section-sub">Promises past their due date that haven't been kept</div>
        </div>
      </div>
      <div class="fc-tbl-wrap">
        <table class="fc-table">
          <thead><tr>
            <th>Unit</th><th>Client</th><th>Due</th><th class="r">Amount</th><th>Notes</th><th class="r">Action</th>
          </tr></thead>
          <tbody>${_clBrokenPromises.map(p => {
            const u = p.sale_id ? (window._unitsCache||[]).find(uu => uu.saleId === p.sale_id) : null;
            return `<tr ${u?`onclick="openUD('${u.id}')"`:''}${u?' style="cursor:pointer"':''}>
              <td><span class="fc-unit">${esc(u?.unitNo||'—')}</span></td>
              <td>${esc(u?.customerName||'—')}</td>
              <td class="muted">${fD(p.promise_date)}</td>
              <td class="r"><span class="fc-amount"><sup class="fc-pkr">PKR</sup>${fM(Number(p.promised_amount||0))}</span></td>
              <td class="muted">${esc(p.notes||'—')}</td>
              <td class="r">${u?`<button class="fc-btn primary" onclick="event.stopPropagation();openConModal('${u.id}')">Log</button>`:'—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>` : '';

  return headerHtml + pillsHtml + queueHtml + brokenHtml;
}

function _qPill(filterId, label, count, statusCls) {
  const active = (_clQueueFilter || 'all') === filterId;
  return `<button class="fc-pill${active?' active':''}" onclick="_clQueueFilter='${filterId}';_fcBuild()">
    ${esc(label)}
    <span class="fc-pill-count">${count}</span>
  </button>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3 — CONTACT LOG (v3.1 SaaS — .fc-filter-bar + .fc-table + .fc-badge)
// ═══════════════════════════════════════════════════════════════════════════
function _tabLogHtml() {
  const users = window._appUsersCache || [];
  const chOpts  = ['All','Call','WhatsApp','Meeting','Email','SMS','Visit'];
  const resOpts = [['All','All Responses'],['NoResponse','No Response'],['Interested','Interested'],['WillPay','Will Pay'],['NotInterested','Not Interested'],['Dispute','Dispute'],['CallBack','Call Back']];
  const fuOpts  = [['All','All Follow-ups'],['overdue','Overdue'],['today','Due Today'],['upcoming','Upcoming'],['none','None Set']];
  const flagOpts= [['All','All Flags'],['Red','Red'],['Orange','Orange'],['Yellow','Yellow'],['none','No Flag']];

  return `
    <div class="fc-filter-bar">
      <div class="fc-fg">
        <label class="fc-flabel">From</label>
        <input class="fc-fi" type="date" value="${_clf.fr||''}" onchange="_clf.fr=this.value;_rCLTable()">
      </div>
      <div class="fc-fg">
        <label class="fc-flabel">To</label>
        <input class="fc-fi" type="date" value="${_clf.to||''}" onchange="_clf.to=this.value;_rCLTable()">
      </div>
      <div class="fc-fg">
        <label class="fc-flabel">Channel</label>
        <select class="fc-select" style="width:auto" onchange="_clf.ch=this.value;_rCLTable()">
          ${chOpts.map(v => `<option value="${v}"${_clf.ch===v?' selected':''}>${v}${v==='All'?' Channels':''}</option>`).join('')}
        </select>
      </div>
      <div class="fc-fg">
        <label class="fc-flabel">Response</label>
        <select class="fc-select" style="width:auto" onchange="_clf.res=this.value;_rCLTable()">
          ${resOpts.map(([v,lbl]) => `<option value="${v}"${_clf.res===v?' selected':''}>${lbl}</option>`).join('')}
        </select>
      </div>
      <div class="fc-fg">
        <label class="fc-flabel">Follow-up</label>
        <select class="fc-select" style="width:auto" onchange="_clf.fu=this.value;_rCLTable()">
          ${fuOpts.map(([v,lbl]) => `<option value="${v}"${_clf.fu===v?' selected':''}>${lbl}</option>`).join('')}
        </select>
      </div>
      <div class="fc-fg">
        <label class="fc-flabel">Agent</label>
        <select class="fc-select" style="width:auto" onchange="_clf.ag=this.value;_rCLTable()">
          <option value="All"${_clf.ag==='All'?' selected':''}>All Agents</option>
          ${users.map(u => `<option value="${u.id}"${_clf.ag===u.id?' selected':''}>${esc(u.name||u.fullName||u.id)}</option>`).join('')}
        </select>
      </div>
      <div class="fc-fg">
        <label class="fc-flabel">Flag</label>
        <select class="fc-select" style="width:auto" onchange="_clf.flag=this.value;_rCLTable()">
          ${flagOpts.map(([v,lbl]) => `<option value="${v}"${_clf.flag===v?' selected':''}>${lbl}</option>`).join('')}
        </select>
      </div>
      <div class="fc-search-wrap">
        <label class="fc-flabel">Search</label>
        <div style="position:relative">
          <span class="fc-search-icon" style="top:calc(50% + 2px)">${_fci('search', 14)}</span>
          <input class="fc-search-input" placeholder="Unit / client / remarks…" value="${esc(_clf.q||'')}" oninput="_clf.q=this.value;clearTimeout(window._clfTimer);window._clfTimer=setTimeout(_rCLTable,220)">
        </div>
      </div>
      <div class="fc-fg" style="justify-content:flex-end">
        <label class="fc-flabel">&nbsp;</label>
        <button class="fc-btn ghost" onclick="_clf={ch:'All',res:'All',fu:'All',ag:'All',flag:'All',q:'',fr:'',to:''};_fcBuild()">Reset</button>
      </div>
    </div>
    <div id="cl-sum"></div>
    <div id="cl-tbl"></div>
  `;
}

// Sub-render — updates cl-sum and cl-tbl inside the already-rendered tab
function _rCLTable() {
  const t = td();
  let rows = [...(_clCache || [])];

  if (_clf.fr) rows = rows.filter(c => c.contact_date && c.contact_date >= _clf.fr);
  if (_clf.to) rows = rows.filter(c => c.contact_date && c.contact_date <= _clf.to);
  if (_clf.ch  !== 'All') rows = rows.filter(c => c.channel === _clf.ch);
  if (_clf.res !== 'All') rows = rows.filter(c => c.response_received === _clf.res);
  if      (_clf.fu === 'overdue')  rows = rows.filter(c => c.next_followup_date && c.next_followup_date < t);
  else if (_clf.fu === 'today')    rows = rows.filter(c => c.next_followup_date === t);
  else if (_clf.fu === 'upcoming') rows = rows.filter(c => c.next_followup_date && c.next_followup_date > t);
  else if (_clf.fu === 'none')     rows = rows.filter(c => !c.next_followup_date);
  if (_clf.ag !== 'All') rows = rows.filter(c => c.agent_id === _clf.ag || c.created_by === _clf.ag);
  if (_clf.flag === 'none') rows = rows.filter(c => !c.escalation_flag);
  else if (_clf.flag !== 'All') rows = rows.filter(c => c.escalation_flag === _clf.flag);
  if (_clf.q) {
    const q = _clf.q.toLowerCase();
    rows = rows.filter(c => {
      const u = gunit(c.unit_id);
      return (u?.unitNo||'').toLowerCase().includes(q)
          || (c.client_name||'').toLowerCase().includes(q)
          || (c.remarks||'').toLowerCase().includes(q);
    });
  }

  const all       = _clCache || [];
  const overdueCt = all.filter(c => c.next_followup_date && c.next_followup_date < t).length;
  const todayCt   = all.filter(c => c.next_followup_date === t).length;
  const promiseCt = all.filter(c => c.promise_to_pay).length;

  const sum = document.getElementById('cl-sum');
  if (sum) sum.innerHTML = `<div class="fc-sum-strip">
    <span class="fc-sum-val">${rows.length} shown</span>
    ${overdueCt ? `<span class="fc-sum-sep">·</span><span style="color:var(--danger);font-weight:500">${overdueCt} overdue</span>` : ''}
    ${todayCt   ? `<span class="fc-sum-sep">·</span><span style="color:var(--primary);font-weight:500">${todayCt} today</span>` : ''}
    ${promiseCt ? `<span class="fc-sum-sep">·</span><span style="color:var(--success);font-weight:500">${promiseCt} promise${promiseCt>1?'s':''}</span>` : ''}
  </div>`;

  const tbl = document.getElementById('cl-tbl');
  if (!tbl) return;
  if (!rows.length) {
    tbl.innerHTML = `<div class="fc-section"><div class="fc-empty">
      <div class="fc-empty-icon">${_fci('inbox', 20)}</div>
      <div class="fc-empty-title">No contact logs match filters</div>
      <div class="fc-empty-sub">Try widening the date range or clearing some filters.</div>
    </div></div>`;
    return;
  }

  // Channel + response → fc-badge classes
  const chCls  = ch => 'fc-badge ' + ({Call:'call',WhatsApp:'whatsapp',Visit:'visit',Email:'email',SMS:'sms',Meeting:'meeting'}[ch] || '');
  const resCls = r  => 'fc-badge ' + ({NoResponse:'noresponse',Interested:'interested',WillPay:'willpay',NotInterested:'notinterested',Dispute:'dispute',CallBack:'callback'}[r] || 'unreachable');
  const resLbl = r  => ({NoResponse:'No Response',Interested:'Interested',WillPay:'Will Pay',NotInterested:'Not Interested',Dispute:'Dispute',CallBack:'Call Back'}[r] || (r || '—'));

  tbl.innerHTML = `<div class="fc-section"><div class="fc-tbl-wrap">
    <table class="fc-table">
      <thead><tr>
        <th>Date</th><th>Unit</th><th>Client</th><th>Channel</th><th>Response</th>
        <th>Remarks</th><th>Promise</th><th>Next Follow-up</th><th>Agent</th><th class="c">Flag</th>
      </tr></thead>
      <tbody>${rows.map(c => {
        const u     = gunit(c.unit_id);
        const fuOv  = c.next_followup_date && c.next_followup_date < t;
        const fuTod = c.next_followup_date === t;
        return `<tr onclick="openUD('${c.unit_id||''}')" style="cursor:pointer">
          <td class="muted" style="white-space:nowrap">${fD(c.contact_date)}${c.contact_time?` · ${c.contact_time.slice(0,5)}`:''}</td>
          <td><span class="fc-unit">${esc(u?.unitNo||'?')}</span></td>
          <td style="max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.client_name||u?.customerName||'—')}</td>
          <td><span class="${chCls(c.channel)}">${esc(c.channel||'—')}</span></td>
          <td><span class="${resCls(c.response_received)}">${esc(resLbl(c.response_received))}</span></td>
          <td class="muted" style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(c.remarks||'')}">${esc(c.remarks||'—')}</td>
          <td>${c.promise_to_pay
            ? `<span class="fc-badge promised">${c.promise_amount?fM(c.promise_amount):'Promised'}${c.promise_date?` · ${fD(c.promise_date)}`:''}</span>`
            : '<span class="muted">—</span>'}</td>
          <td style="white-space:nowrap;${fuOv?'color:var(--danger)':fuTod?'color:var(--primary)':'color:var(--text-muted)'}">${c.next_followup_date?fD(c.next_followup_date):'—'}</td>
          <td class="muted" style="white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis">${esc(gunm(c.agent_id||c.created_by)||'—')}</td>
          <td class="c">${c.escalation_flag?`<span class="fc-flag-dot ${c.escalation_flag.toLowerCase()}"></span>`:''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div></div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 4 — REPORTS
// ═══════════════════════════════════════════════════════════════════════════
const _rptTabs = [
  { id:'daily',     label:'Daily Activity' },
  { id:'promise',   label:'Promise Tracking' },
  { id:'perf',      label:'Agent Performance' },
  { id:'channel',   label:'Channel Analysis' },
  { id:'difficult', label:'Difficult Clients' },
  { id:'perclient', label:'Per-Client History' },
];

function _tabReportsHtml() {
  const body = (() => {
    switch (_clRptTab) {
      case 'daily':     return _rptDailyHtml();
      case 'promise':   return _rptPromiseHtml();
      case 'perf':      return _rptPerfHtml();
      case 'channel':   return _rptChannelHtml();
      case 'difficult': return _rptDifficultHtml();
      case 'perclient': return _rptPerClientHtml();
      default:          return _rptDailyHtml();
    }
  })();
  return `
    <div class="fc-sub-tabs">
      ${_rptTabs.map(tab => {
        const on = _clRptTab === tab.id;
        return `<button class="fc-sub-tab${on?' active':''}" onclick="_setRptTab('${tab.id}')">${tab.label}</button>`;
      }).join('')}
    </div>
    <div id="cl-rpt-body">${body}</div>
  `;
}

function _setRptTab(tab) {
  _clRptTab = tab;
  _fcBuild();
}

// ── Report: Daily Activity ────────────────────────────────────────────────
function _rptDailyHtml() {
  const today   = td();
  const selDate = (window._rptDailyDate || today);
  const dayLogs = (_clCache||[]).filter(c => c.contact_date === selDate);

  const chCls  = ch => 'fc-badge ' + ({Call:'call',WhatsApp:'whatsapp',Visit:'visit',Email:'email',SMS:'sms',Meeting:'meeting'}[ch] || '');
  const resCls = r  => 'fc-badge ' + ({NoResponse:'noresponse',Interested:'interested',WillPay:'willpay',NotInterested:'notinterested',Dispute:'dispute',CallBack:'callback'}[r] || 'unreachable');
  const resLbl = r  => ({NoResponse:'No Response',Interested:'Interested',WillPay:'Will Pay',NotInterested:'Not Interested',Dispute:'Dispute',CallBack:'Call Back'}[r] || (r || '—'));

  const inner = (() => {
    if (!dayLogs.length) {
      return `<div class="fc-section"><div class="fc-empty">
        <div class="fc-empty-icon">${_fci('inbox', 20)}</div>
        <div class="fc-empty-title">No activity on ${fD(selDate)}</div>
        <div class="fc-empty-sub">Pick another date to view its activity report.</div>
      </div></div>`;
    }
    const byAgent = {};
    dayLogs.forEach(c => { const ag = c.agent_id || c.created_by || 'unknown'; (byAgent[ag] = byAgent[ag] || []).push(c); });
    return `<div class="fc-section">
      <div class="fc-section-header">
        <div class="fc-section-header-left">
          <div class="fc-section-title">Recovery Agent Daily Activity Report</div>
          <div class="fc-section-sub">${fD(selDate)} · ${dayLogs.length} contacts · ${Object.keys(byAgent).length} agents</div>
        </div>
      </div>
      ${Object.entries(byAgent).map(([agId, logs]) => {
        const agName   = gunm(agId);
        const promises = logs.filter(c => c.promise_to_pay);
        return `<div style="padding:14px 16px;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div class="fc-snap-avatar" style="width:32px;height:32px;font-size:13px">${ini(agName)}</div>
            <div>
              <div style="font-size:14px;font-weight:500;color:var(--text)">${esc(agName)}</div>
              <div style="font-size:12px;color:var(--text-muted)">${logs.length} contacts · ${promises.length} promise${promises.length!==1?'s':''}</div>
            </div>
          </div>
          <div class="fc-tbl-wrap">
            <table class="fc-table">
              <thead><tr>
                <th>Time</th><th>Unit</th><th>Client</th><th>Channel</th><th>Response</th>
                <th>Remarks</th><th>Promise</th><th>Follow-up</th>
              </tr></thead>
              <tbody>${logs.sort((a,b) => (a.contact_time||'').localeCompare(b.contact_time||'')).map(c => {
                const u = gunit(c.unit_id);
                return `<tr>
                  <td class="muted">${c.contact_time?c.contact_time.slice(0,5):'—'}</td>
                  <td><span class="fc-unit">${esc(u?.unitNo||'?')}</span></td>
                  <td>${esc(c.client_name||u?.customerName||'—')}</td>
                  <td><span class="${chCls(c.channel)}">${esc(c.channel||'—')}</span></td>
                  <td><span class="${resCls(c.response_received)}">${esc(resLbl(c.response_received))}</span></td>
                  <td class="muted" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.remarks||'—')}</td>
                  <td>${c.promise_to_pay?`<span class="fc-badge promised">${c.promise_amount?fM(c.promise_amount):'Yes'}</span>`:'<span class="muted">—</span>'}</td>
                  <td class="muted">${c.next_followup_date?fD(c.next_followup_date):'—'}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  })();

  return `
    <div class="fc-rpt-controls">
      <div class="fc-fg">
        <label class="fc-flabel">Activity Date</label>
        <input class="fc-fi" type="date" value="${selDate}" onchange="window._rptDailyDate=this.value;_fcBuild()">
      </div>
      <div class="fc-rpt-controls-right">
        <button class="fc-btn ghost" onclick="window.print()">${_fci('printer',12)} Print</button>
      </div>
    </div>
    ${inner}
  `;
}

// ── Report: Promise Tracking ──────────────────────────────────────────────
function _rptPromiseHtml() {
  const t   = td();
  const all = _clCache || [];
  const byUnit = {};
  all.filter(c => c.promise_to_pay && c.unit_id).forEach(c => {
    (byUnit[c.unit_id] = byUnit[c.unit_id] || []).push(c);
  });

  const rows = Object.entries(byUnit).map(([uid, promises]) => {
    const u      = gunit(uid);
    const latest = [...promises].sort((a,b) => (b.contact_date||'').localeCompare(a.contact_date||''))[0];
    const allFor = all.filter(c => c.unit_id === uid).sort((a,b) => (a.contact_date||'').localeCompare(b.contact_date||''));
    const broken = allFor.filter(c =>
      c.contact_date && latest.contact_date && c.contact_date > latest.contact_date &&
      (c.response_received === 'NoResponse' || c.response_received === 'Dispute')
    );
    let status = 'Pending', scol = '#f59e0b';
    if (broken.length)                                          { status = 'Broken'; scol = '#ef4444'; }
    else if (latest.promise_date && latest.promise_date < t)    { status = 'Due';    scol = '#f97316'; }
    return { uid, u, latest, promises, status, scol };
  });

  const totAmt    = rows.reduce((s,r) => s + Number(r.latest.promise_amount||0), 0);
  const brokenAmt = rows.filter(r => r.status==='Broken').reduce((s,r) => s + Number(r.latest.promise_amount||0), 0);

  const statusBadge = s => {
    const cls = s === 'Broken' ? 'noresponse' : s === 'Due' ? 'dispute' : s === 'Pending' ? 'callback' : 'unreachable';
    return `<span class="fc-badge ${cls}">${s}</span>`;
  };

  return `
    <div class="fc-kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      ${_fcKpi('handshake',      'blue',    'Total Promises', String(rows.length),                                           'Promise commitments')}
      ${_fcKpi('clock',          'slate',   'Pending',        String(rows.filter(r=>r.status==='Pending').length),           'Not yet due')}
      ${_fcKpi('alert-triangle', rows.filter(r=>r.status==='Due').length ? 'red' : 'slate', 'Due', String(rows.filter(r=>r.status==='Due').length), 'Past promise date')}
      ${_fcKpi('alert-triangle', rows.filter(r=>r.status==='Broken').length ? 'red' : 'slate', 'Broken', String(rows.filter(r=>r.status==='Broken').length), 'Promise + no follow-through')}
      ${_fcKpi('trending-up',    'emerald', 'Total Amt',      `<sup class="fc-pkr">PKR</sup>${fM(totAmt)}`,                  'Across all promises')}
      ${_fcKpi('alert-triangle', brokenAmt ? 'red' : 'slate', 'Broken Amt', `<sup class="fc-pkr">PKR</sup>${fM(brokenAmt)}`, 'At risk of write-off')}
    </div>
    <div class="fc-section">
      <div class="fc-section-header">
        <div class="fc-section-header-left">
          <div class="fc-section-title">Promise Tracking</div>
          <div class="fc-section-sub">All commitments by promise date and status</div>
        </div>
        <div class="fc-section-right">
          <button class="fc-btn ghost" onclick="window.print()">${_fci('printer',12)} Print</button>
        </div>
      </div>
      ${!rows.length
        ? `<div class="fc-empty"><div class="fc-empty-icon">${_fci('handshake',20)}</div><div class="fc-empty-title">No promises recorded</div><div class="fc-empty-sub">Promises appear here when logged during a contact.</div></div>`
        : `<div class="fc-tbl-wrap"><table class="fc-table">
          <thead><tr>
            <th>Unit</th><th>Client</th><th>Promise Date</th><th class="r">Amount</th>
            <th>Agent</th><th class="c">#</th><th>Status</th><th>Last Contact</th><th class="r">Action</th>
          </tr></thead>
          <tbody>${rows.map(r => `<tr style="cursor:pointer" onclick="openUD('${r.uid}')">
            <td><span class="fc-unit">${esc(r.u?.unitNo||'?')}</span></td>
            <td>${esc(r.u?.customerName||r.latest.client_name||'—')}</td>
            <td class="muted">${r.latest.promise_date?fD(r.latest.promise_date):'—'}</td>
            <td class="r"><span class="fc-amount"><sup class="fc-pkr">PKR</sup>${r.latest.promise_amount?fM(r.latest.promise_amount):'—'}</span></td>
            <td class="muted">${esc(gunm(r.latest.agent_id||r.latest.created_by)||'—')}</td>
            <td class="c">${r.promises.length}</td>
            <td>${statusBadge(r.status)}</td>
            <td class="muted">${fD(r.latest.contact_date)}</td>
            <td class="r"><button class="fc-btn primary" onclick="event.stopPropagation();openConModal('${r.uid}')">Follow Up</button></td>
          </tr>`).join('')}</tbody>
        </table></div>`}
    </div>`;
}

// ── Report: Agent Performance ─────────────────────────────────────────────
function _rptPerfHtml() {
  const all    = _clCache || [];
  const in30   = new Date(); in30.setDate(in30.getDate() - 30);
  const from30 = in30.toISOString().slice(0,10);
  const recent = all.filter(c => c.contact_date && c.contact_date >= from30);

  if (!recent.length) {
    return `<div class="fc-section"><div class="fc-empty">
      <div class="fc-empty-icon">${_fci('trending-up',20)}</div>
      <div class="fc-empty-title">No activity in last 30 days</div>
      <div class="fc-empty-sub">Once agents log contacts, performance metrics will appear here.</div>
    </div></div>`;
  }

  const stats = {};
  recent.forEach(c => {
    const ag = c.agent_id || c.created_by || 'unknown';
    if (!stats[ag]) stats[ag] = { total:0, nr:0, interested:0, willPay:0, promises:0, promiseAmt:0, fuSet:0 };
    const s = stats[ag];
    s.total++;
    if (c.response_received === 'NoResponse') s.nr++;
    if (c.response_received === 'Interested') s.interested++;
    if (c.response_received === 'WillPay')    s.willPay++;
    if (c.promise_to_pay) { s.promises++; s.promiseAmt += Number(c.promise_amount||0); }
    if (c.next_followup_date) s.fuSet++;
  });

  const sorted = Object.entries(stats).sort((a,b) => b[1].total - a[1].total);

  return `
    <div class="fc-section">
      <div class="fc-section-header">
        <div class="fc-section-header-left">
          <div class="fc-section-title">Agent Performance</div>
          <div class="fc-section-sub">Last 30 days · ${sorted.length} agent${sorted.length!==1?'s':''}</div>
        </div>
        <div class="fc-section-right">
          <button class="fc-btn ghost" onclick="window.print()">${_fci('printer',12)} Print</button>
        </div>
      </div>
      <div class="fc-tbl-wrap"><table class="fc-table">
        <thead><tr>
          <th>Agent</th><th class="c">Total</th><th class="c">No Response</th><th class="c">Interested</th>
          <th class="c">Will Pay</th><th class="c">Promises</th><th class="r">Promise Amt</th>
          <th class="c">Response Rate</th><th class="c">FU Set</th>
        </tr></thead>
        <tbody>${sorted.map(([agId, s]) => {
          const rr = s.total ? Math.round((s.total - s.nr) / s.total * 100) : 0;
          return `<tr>
            <td>${esc(gunm(agId))}</td>
            <td class="c">${s.total}</td>
            <td class="c" style="color:${s.nr?'var(--danger)':'var(--text-muted)'}">${s.nr}</td>
            <td class="c" style="color:${s.interested?'var(--success)':'var(--text-muted)'}">${s.interested}</td>
            <td class="c" style="color:${s.willPay?'var(--success)':'var(--text-muted)'}">${s.willPay}</td>
            <td class="c">${s.promises}</td>
            <td class="r"><span class="fc-amount">${s.promiseAmt?'<sup class="fc-pkr">PKR</sup>'+fM(s.promiseAmt):'—'}</span></td>
            <td class="c" style="color:${rr>=50?'var(--success)':'var(--danger)'};font-weight:500">${rr}%</td>
            <td class="c muted">${s.fuSet}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
}

// ── Report: Channel Analysis ──────────────────────────────────────────────
function _rptChannelHtml() {
  const all = _clCache || [];
  const chs = {};
  all.forEach(c => {
    const ch = c.channel || 'Unknown';
    if (!chs[ch]) chs[ch] = { total:0, nr:0, interested:0, willPay:0, promises:0 };
    chs[ch].total++;
    if (c.response_received === 'NoResponse') chs[ch].nr++;
    if (c.response_received === 'Interested') chs[ch].interested++;
    if (c.response_received === 'WillPay')    chs[ch].willPay++;
    if (c.promise_to_pay)                     chs[ch].promises++;
  });

  const sorted = Object.entries(chs).sort((a,b) => b[1].total - a[1].total);
  const total  = all.length;

  const chCls = ch => 'fc-badge ' + ({Call:'call',WhatsApp:'whatsapp',Visit:'visit',Email:'email',SMS:'sms',Meeting:'meeting'}[ch] || '');

  return `
    <div class="fc-section">
      <div class="fc-section-header">
        <div class="fc-section-header-left">
          <div class="fc-section-title">Channel Analysis</div>
          <div class="fc-section-sub">Volume and response quality by communication channel</div>
        </div>
        <div class="fc-section-right">
          <button class="fc-btn ghost" onclick="window.print()">${_fci('printer',12)} Print</button>
        </div>
      </div>
      ${!sorted.length
        ? `<div class="fc-empty"><div class="fc-empty-icon">${_fci('bar-chart-3',20)}</div><div class="fc-empty-title">No channel data yet</div><div class="fc-empty-sub">Log some contacts to see channel-level metrics.</div></div>`
        : `<div class="fc-tbl-wrap"><table class="fc-table">
          <thead><tr>
            <th>Channel</th><th class="c">Total</th><th class="c">% of all</th><th class="c">No Response</th>
            <th class="c">Interested</th><th class="c">Will Pay</th><th class="c">Promises</th><th class="c">Response Rate</th>
          </tr></thead>
          <tbody>${sorted.map(([ch, s]) => {
            const rr = s.total ? Math.round((s.total - s.nr) / s.total * 100) : 0;
            return `<tr>
              <td><span class="${chCls(ch)}">${esc(ch)}</span></td>
              <td class="c">${s.total}</td>
              <td class="c muted">${total?Math.round(s.total/total*100):0}%</td>
              <td class="c" style="color:${s.nr?'var(--danger)':'var(--text-muted)'}">${s.nr}</td>
              <td class="c" style="color:${s.interested?'var(--success)':'var(--text-muted)'}">${s.interested}</td>
              <td class="c" style="color:${s.willPay?'var(--success)':'var(--text-muted)'}">${s.willPay}</td>
              <td class="c">${s.promises}</td>
              <td class="c" style="color:${rr>=50?'var(--success)':'var(--danger)'};font-weight:500">${rr}%</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
    </div>`;
}

// ── Report: Difficult Clients ─────────────────────────────────────────────
function _rptDifficultHtml() {
  const all    = _clCache || [];
  const byUnit = {};
  all.forEach(c => { if (c.unit_id) (byUnit[c.unit_id] = byUnit[c.unit_id] || []).push(c); });

  const rows = Object.entries(byUnit)
    .map(([uid, logs]) => {
      const nr     = logs.filter(c => c.response_received === 'NoResponse').length;
      const esc_s  = _unitEscalation(logs);
      const sorted = [...logs].sort((a,b) => (b.contact_date||'').localeCompare(a.contact_date||''));
      return { uid, u:gunit(uid), logs, nr, last:sorted[0], esc_s };
    })
    .filter(r => r.nr >= 5)
    .sort((a,b) => b.nr - a.nr);

  const resCls = r  => 'fc-badge ' + ({NoResponse:'noresponse',Interested:'interested',WillPay:'willpay',NotInterested:'notinterested',Dispute:'dispute',CallBack:'callback'}[r] || 'unreachable');
  const resLbl = r  => ({NoResponse:'No Response',Interested:'Interested',WillPay:'Will Pay',NotInterested:'Not Interested',Dispute:'Dispute',CallBack:'Call Back'}[r] || (r || '—'));

  return `<div class="fc-section">
    <div class="fc-section-header">
      <div class="fc-section-header-left">
        <div class="fc-section-title">Difficult / Non-Responsive Clients</div>
        <div class="fc-section-sub">${rows.length} unit${rows.length!==1?'s':''} with 5+ no-responses on record</div>
      </div>
      <div class="fc-section-right">
        <button class="fc-btn ghost" onclick="window.print()">${_fci('printer',12)} Print</button>
      </div>
    </div>
    ${!rows.length
      ? `<div class="fc-empty"><div class="fc-empty-icon success">${_fci('check',20)}</div><div class="fc-empty-title">No difficult clients</div><div class="fc-empty-sub">No unit has accumulated 5+ no-responses.</div></div>`
      : `<div class="fc-tbl-wrap"><table class="fc-table">
        <thead><tr>
          <th>Unit</th><th>Client</th><th class="c">Total</th><th class="c">No Response</th>
          <th>Last Contact</th><th>Last Response</th><th class="c">Flag</th><th class="r">Pending</th><th class="r">Actions</th>
        </tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><span class="fc-unit" onclick="openUD('${r.uid}')" style="cursor:pointer">${esc(r.u?.unitNo||'?')}</span></td>
          <td>${esc(r.u?.customerName||r.last?.client_name||'—')}</td>
          <td class="c">${r.logs.length}</td>
          <td class="c" style="color:var(--danger)">${r.nr}</td>
          <td class="muted">${fD(r.last?.contact_date)}</td>
          <td><span class="${resCls(r.last?.response_received)}">${esc(resLbl(r.last?.response_received))}</span></td>
          <td class="c">${r.esc_s.flag?`<span class="fc-flag-dot ${r.esc_s.flag.toLowerCase()}"></span>`:'<span class="muted">—</span>'}</td>
          <td class="r"><span class="fc-amount"><sup class="fc-pkr">PKR</sup>${fM(actualPending(r.u||{}))}</span></td>
          <td class="r" style="white-space:nowrap">
            <button class="fc-btn primary" onclick="openConModal('${r.uid}')">Log</button>
            <button class="fc-btn ghost" onclick="_clSelectedUnit='${r.uid}';_clRptTab='perclient';_fcBuild()" style="margin-left:4px">History</button>
          </td>
        </tr>`).join('')}</tbody>
      </table></div>`}
  </div>`;
}

// ── Report: Per-Client History ────────────────────────────────────────────
function _rptPerClientHtml() {
  const units = gunits().filter(u => u.status !== 'Available' && u.status !== 'Dead');

  const chCls  = ch => 'fc-badge ' + ({Call:'call',WhatsApp:'whatsapp',Visit:'visit',Email:'email',SMS:'sms',Meeting:'meeting'}[ch] || '');
  const resCls = r  => 'fc-badge ' + ({NoResponse:'noresponse',Interested:'interested',WillPay:'willpay',NotInterested:'notinterested',Dispute:'dispute',CallBack:'callback'}[r] || 'unreachable');
  const resLbl = r  => ({NoResponse:'No Response',Interested:'Interested',WillPay:'Will Pay',NotInterested:'Not Interested',Dispute:'Dispute',CallBack:'Call Back'}[r] || (r || '—'));

  const detail = (() => {
    if (!_clSelectedUnit) return '';
    const u    = gunit(_clSelectedUnit);
    const logs = (_clCache||[]).filter(c => c.unit_id === _clSelectedUnit)
                                .sort((a,b) => (b.contact_date||'').localeCompare(a.contact_date||''));
    if (!logs.length) {
      return `<div class="fc-section"><div class="fc-empty">
        <div class="fc-empty-icon">${_fci('inbox',20)}</div>
        <div class="fc-empty-title">No contact history for this unit</div>
      </div></div>`;
    }
    const noResp   = logs.filter(c => c.response_received === 'NoResponse').length;
    const promises = logs.filter(c => c.promise_to_pay);
    const esc_s    = _unitEscalation(logs);

    return `<div class="fc-section">
      <div class="fc-section-header">
        <div class="fc-section-header-left">
          <div class="fc-section-title">${esc(u?.unitNo||'?')} — Contact History</div>
          <div class="fc-section-sub">Client: ${esc(u?.customerName||logs[0]?.client_name||'—')} · Project: ${esc(gproject(u?.projectId)?.name||'—')}</div>
        </div>
        ${esc_s.flag?`<div class="fc-section-right"><span class="fc-status ${esc_s.flag==='Red'?'critical':esc_s.flag==='Orange'?'overdue':'today'}">
          <span class="fc-flag-dot ${esc_s.flag.toLowerCase()}" style="margin-right:6px"></span>${esc_s.flag} · ${esc(esc_s.reason)}
        </span></div>`:''}
      </div>
      <div class="fc-kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));padding:14px 16px;margin:0;border-bottom:1px solid var(--border)">
        ${_fcKpi('inbox',          'blue',    'Total Contacts', String(logs.length),                                  'On record')}
        ${_fcKpi('alert-triangle', noResp ? 'red' : 'slate', 'No Response', String(noResp),                          'Unanswered attempts')}
        ${_fcKpi('handshake',      'emerald', 'Promises',       String(promises.length),                              'Commitments')}
        ${_fcKpi('alert-triangle', actualPending(u||{}) ? 'red' : 'slate', 'Pending', `<sup class="fc-pkr">PKR</sup>${fM(actualPending(u||{}))}`, 'Current balance')}
        ${_fcKpi('clock',          'slate',   'Last Contact',   fD(logs[0]?.contact_date),                            'Most recent activity')}
      </div>
      <div class="fc-tbl-wrap"><table class="fc-table">
        <thead><tr>
          <th>Date</th><th>Time</th><th>Channel</th><th>Dir</th><th>Response</th>
          <th>Remarks</th><th>Promise</th><th>Next FU</th><th>Agent</th>
        </tr></thead>
        <tbody>${logs.map(c => `<tr>
          <td class="muted">${fD(c.contact_date)}</td>
          <td class="muted">${c.contact_time?c.contact_time.slice(0,5):'—'}</td>
          <td><span class="${chCls(c.channel)}">${esc(c.channel||'—')}</span></td>
          <td class="muted">${c.direction==='Inbound'?'↙ In':'↗ Out'}</td>
          <td><span class="${resCls(c.response_received)}">${esc(resLbl(c.response_received))}</span></td>
          <td class="muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.remarks||'')}">${esc(c.remarks||'—')}</td>
          <td>${c.promise_to_pay?`<span class="fc-badge promised">${c.promise_amount?fM(c.promise_amount):'Yes'}${c.promise_date?` · ${fD(c.promise_date)}`:''}</span>`:'<span class="muted">—</span>'}</td>
          <td class="muted">${c.next_followup_date?fD(c.next_followup_date):'—'}</td>
          <td class="muted">${esc(gunm(c.agent_id||c.created_by||''))}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  })();

  return `
    <div class="fc-rpt-controls">
      <div class="fc-fg" style="flex:1;max-width:360px">
        <label class="fc-flabel">Select Unit / Client</label>
        <select class="fc-select" style="width:100%" onchange="_clSelectedUnit=this.value;_fcBuild()">
          <option value="">-- Select a unit --</option>
          ${units.map(u => `<option value="${u.id}" ${_clSelectedUnit===u.id?'selected':''}>${esc(u.unitNo)}${u.customerName?' — '+esc(u.customerName):''}</option>`).join('')}
        </select>
      </div>
      ${_clSelectedUnit?`<div class="fc-rpt-controls-right"><button class="fc-btn ghost" onclick="window.print()">${_fci('printer',12)} Print</button></div>`:''}
    </div>
    ${detail}
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 5 — ESCALATION & LEGAL (v3.1 SaaS — .fc-esc-kpi-grid + .fc-section + .fc-table)
// ═══════════════════════════════════════════════════════════════════════════
function _tabEscalationHtml() {
  const all    = _clCache || [];
  const byUnit = {};
  all.forEach(c => { if (c.unit_id) (byUnit[c.unit_id] = byUnit[c.unit_id] || []).push(c); });

  const flags = { Red:[], Orange:[], Yellow:[] };
  Object.entries(byUnit).forEach(([uid, logs]) => {
    const esc_s = _unitEscalation(logs);
    if (esc_s.flag) flags[esc_s.flag].push({ uid, u:gunit(uid), logs, esc_s });
  });

  const resCls = r  => 'fc-badge ' + ({NoResponse:'noresponse',Interested:'interested',WillPay:'willpay',NotInterested:'notinterested',Dispute:'dispute',CallBack:'callback'}[r] || 'unreachable');
  const resLbl = r  => ({NoResponse:'No Response',Interested:'Interested',WillPay:'Will Pay',NotInterested:'Not Interested',Dispute:'Dispute',CallBack:'Call Back'}[r] || (r || '—'));

  const renderFlag = (flag, items) => {
    if (!items.length) return '';
    const titles = {
      Red:    'Red — 5+ Consecutive No Responses',
      Orange: 'Orange — 2+ Broken Promises',
      Yellow: 'Yellow — 3+ Consecutive No Responses',
    };
    const subs = {
      Red:    'Escalate to manager — recovery process is stuck',
      Orange: 'Client has broken a promise — verify intent',
      Yellow: 'Watch — pattern of non-response forming',
    };
    return `<div class="fc-section">
      <div class="fc-section-header">
        <div class="fc-section-header-left">
          <div class="fc-section-title"><span class="fc-flag-dot ${flag.toLowerCase()}" style="margin-right:8px;vertical-align:middle"></span>${titles[flag]}</div>
          <div class="fc-section-sub">${subs[flag]}</div>
        </div>
        <div class="fc-section-right">
          <span class="fc-lane-count">${items.length} unit${items.length>1?'s':''}</span>
        </div>
      </div>
      <div class="fc-tbl-wrap"><table class="fc-table">
        <thead><tr>
          <th>Unit</th><th>Client</th><th>Reason</th><th class="c">Contacts</th>
          <th>Last Contact</th><th>Last Response</th><th class="r">Pending</th><th class="r">Actions</th>
        </tr></thead>
        <tbody>${items.map(({ uid, u, logs, esc_s }) => {
          const last = [...logs].sort((a,b) => (b.contact_date||'').localeCompare(a.contact_date||''))[0];
          return `<tr>
            <td><span class="fc-unit" onclick="openUD('${uid}')" style="cursor:pointer">${esc(u?.unitNo||'?')}</span></td>
            <td>${esc(u?.customerName||last?.client_name||'—')}</td>
            <td class="muted">${esc(esc_s.reason)}</td>
            <td class="c">${logs.length}</td>
            <td class="muted">${fD(last?.contact_date)}</td>
            <td><span class="${resCls(last?.response_received)}">${esc(resLbl(last?.response_received))}</span></td>
            <td class="r"><span class="fc-amount"><sup class="fc-pkr">PKR</sup>${fM(actualPending(u||{}))}</span></td>
            <td class="r" style="white-space:nowrap">
              <button class="fc-btn primary" onclick="openConModal('${uid}')">Log</button>
              <button class="fc-btn ghost" onclick="openUD('${uid}')" style="margin-left:4px">View</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
  };

  const openEsc  = _clEscalations.filter(e => e.status !== 'closed' && e.status !== 'resolved').length;
  const openLeg  = _clLegalCases.filter(l => l.status !== 'closed').length;
  const totalFlags = flags.Red.length + flags.Orange.length + flags.Yellow.length;

  const kpiHtml = `<div class="fc-esc-kpi-grid">
    ${_fcKpi('flag', flags.Red.length    ? 'red'    : 'slate', 'Red Flags',        String(flags.Red.length),    '5+ no-response')}
    ${_fcKpi('flag', flags.Orange.length ? 'red'    : 'slate', 'Orange Flags',     String(flags.Orange.length), 'Broken promises')}
    ${_fcKpi('flag', flags.Yellow.length ? 'amber'  : 'slate', 'Yellow Flags',     String(flags.Yellow.length), '3+ no-response')}
    ${_fcKpi('alert-triangle', openEsc ? 'blue' : 'slate', 'Open Escalations', String(openEsc), `${_clEscalations.length} total on record`)}
    ${_fcKpi('alert-triangle', openLeg ? 'red'  : 'slate', 'Active Legal',     String(openLeg), `${_clLegalCases.length} cases total`)}
  </div>`;

  const flagsBody = totalFlags
    ? `${renderFlag('Red', flags.Red)}${renderFlag('Orange', flags.Orange)}${renderFlag('Yellow', flags.Yellow)}`
    : `<div class="fc-section"><div class="fc-empty">
        <div class="fc-empty-icon success">${_fci('check', 20)}</div>
        <div class="fc-empty-title">No escalation flags</div>
        <div class="fc-empty-sub">All units are in good standing — no patterns of non-response or broken promises detected.</div>
      </div></div>`;

  const escRecordsHtml = `<div class="fc-section">
    <div class="fc-section-header">
      <div class="fc-section-header-left">
        <div class="fc-section-title">Escalation Records</div>
        <div class="fc-section-sub">Manual escalations logged to manager level</div>
      </div>
      <div class="fc-section-right">
        <span class="fc-lane-count">${_clEscalations.length} total</span>
      </div>
    </div>
    ${!_clEscalations.length
      ? `<div class="fc-empty"><div class="fc-empty-icon">${_fci('inbox',20)}</div><div class="fc-empty-title">No escalation records</div><div class="fc-empty-sub">Escalations created via the action buttons above will appear here.</div></div>`
      : `<div class="fc-tbl-wrap"><table class="fc-table">
        <thead><tr><th>Date</th><th>Level</th><th>Reason</th><th>Status</th><th>Escalated To</th></tr></thead>
        <tbody>${_clEscalations.map(e => {
          const statusCls = e.status === 'open' || e.status === 'pending' ? 'noresponse' : e.status === 'resolved' ? 'promised' : 'unreachable';
          const lvl = e.from_level && e.to_level ? `L${e.from_level}→L${e.to_level}` : '—';
          return `<tr>
            <td class="muted">${fD((e.created_at||'').slice(0,10))}</td>
            <td>${esc(lvl)}</td>
            <td class="muted" style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.reason||'—')}</td>
            <td><span class="fc-badge ${statusCls}">${esc(e.status||'open')}</span></td>
            <td class="muted">${esc(gunm(e.escalated_to)||'—')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`}
  </div>`;

  const stageBadge = stage => {
    const cls = ({pre_legal:'unreachable',notice_sent:'dispute',filed:'noresponse',hearing:'noresponse',judgment:'noresponse',appeal:'dispute',settled:'promised',closed:'unreachable'})[stage] || 'unreachable';
    return `<span class="fc-badge ${cls}">${esc(stage||'—')}</span>`;
  };

  const legalHtml = `<div class="fc-section">
    <div class="fc-section-header">
      <div class="fc-section-header-left">
        <div class="fc-section-title">Legal Cases</div>
        <div class="fc-section-sub">Cases that have entered formal legal process</div>
      </div>
      <div class="fc-section-right">
        <span class="fc-lane-count">${_clLegalCases.length} total</span>
      </div>
    </div>
    ${!_clLegalCases.length
      ? `<div class="fc-empty"><div class="fc-empty-icon">${_fci('inbox',20)}</div><div class="fc-empty-title">No legal cases on record</div><div class="fc-empty-sub">Cases created in the Legal module will appear here.</div></div>`
      : `<div class="fc-tbl-wrap"><table class="fc-table">
        <thead><tr>
          <th>Filed</th><th>Unit</th><th>Client</th><th>Case No.</th>
          <th>Stage</th><th>Next Hearing</th><th>Lawyer</th><th class="r">Claim Amt</th>
        </tr></thead>
        <tbody>${_clLegalCases.map(lc => {
          const u   = gunit(lc.unit_id);
          const now = td();
          const nxt = lc.next_hearing_date;
          const nxtStyle = nxt && nxt < now ? 'color:var(--danger);font-weight:500' : nxt === now ? 'color:var(--primary);font-weight:500' : 'color:var(--text-muted)';
          return `<tr style="cursor:pointer" onclick="openUD('${lc.unit_id||''}')">
            <td class="muted">${fD((lc.filed_date||lc.created_at||'').slice(0,10))}</td>
            <td><span class="fc-unit">${esc(u?.unitNo||'—')}</span></td>
            <td style="max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u?.customerName||'—')}</td>
            <td class="muted">${esc(lc.case_number||'—')}</td>
            <td>${stageBadge(lc.stage)}</td>
            <td style="${nxtStyle}">${nxt?fD(nxt):'—'}</td>
            <td class="muted">${esc(lc.lawyer_name||'—')}</td>
            <td class="r"><span class="fc-amount">${lc.claim_amount?`<sup class="fc-pkr">PKR</sup>${fM(Number(lc.claim_amount))}`:'—'}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`}
  </div>`;

  return kpiHtml + flagsBody + escRecordsHtml + legalHtml;
}

// ═══════════════════════════════════════════════════════════════════════════
// DRAWER (one-time injection into <body>; opens with unit detail snapshot)
// ═══════════════════════════════════════════════════════════════════════════
function _fcEnsureDrawer() {
  if (document.getElementById('fc-drawer')) return;
  const overlay = document.createElement('div');
  overlay.id = 'fc-drawer-overlay';
  overlay.className = 'fc-drawer-overlay';
  overlay.onclick = _fcCloseDrawer;
  const drawer = document.createElement('div');
  drawer.id = 'fc-drawer';
  drawer.className = 'fc-drawer';
  drawer.innerHTML = '<div id="fc-drawer-inner" style="height:100%;display:flex;flex-direction:column"></div>';
  document.body.appendChild(overlay);
  document.body.appendChild(drawer);
}

function _fcOpenDrawer(uid) {
  const o = document.getElementById('fc-drawer-overlay');
  const d = document.getElementById('fc-drawer');
  if (o) o.classList.add('open');
  if (d) d.classList.add('open');
}

function _fcCloseDrawer() {
  const o = document.getElementById('fc-drawer-overlay');
  const d = document.getElementById('fc-drawer');
  if (o) o.classList.remove('open');
  if (d) d.classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED HELPERS (used by this file + modals-log-call.js)
// ═══════════════════════════════════════════════════════════════════════════

function _unitEscalation(logs) {
  if (!logs.length) return { flag:null, reason:'', count:0 };
  const sorted = [...logs].sort((a,b) =>
    ((a.contact_date||'') + (a.created_at||'')).localeCompare((b.contact_date||'') + (b.created_at||''))
  );

  let consNR = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].response_received === 'NoResponse') consNR++;
    else break;
  }

  let broken = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i-1].promise_to_pay &&
       (sorted[i].response_received === 'NoResponse' || sorted[i].response_received === 'Dispute')) {
      broken++;
    }
  }

  if (consNR >= 5) return { flag:'Red',    reason:`${consNR} consecutive no-responses`,         count:consNR };
  if (broken >= 2) return { flag:'Orange', reason:`${broken} broken promise${broken>1?'s':''}`, count:broken };
  if (consNR >= 3) return { flag:'Yellow', reason:`${consNR} consecutive no-responses`,         count:consNR };
  return { flag:null, reason:'', count:0 };
}

function _computeNewFlag(existingLogs, newContact) {
  return _unitEscalation([...existingLogs, newContact]).flag;
}

function _chIcon(ch) {
  const _svg = (p, s=11) => `<svg width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">${p}</svg>`;
  return { Call:_svg(_FC_ICONS.phone), WhatsApp:_svg(_FC_ICONS.phone), Meeting:_svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'), Email:_svg('<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>'), SMS:_svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'), Visit:_svg('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>') }[ch] || _svg('<rect width="14" height="17" x="5" y="3.5" rx="1"/>');
}

function _resBadge(r) {
  const m = {
    NoResponse:    ['rgba(239,68,68,.12)',    '#ef4444',     'No Response'],
    Interested:    ['rgba(16,185,129,.12)',   '#10b981',     'Interested'],
    WillPay:       ['rgba(16,185,129,.15)',   '#059669',     'Will Pay'],
    NotInterested: ['rgba(107,114,128,.12)', 'var(--t3)',    'Not Interested'],
    Dispute:       ['rgba(245,158,11,.12)',   '#d97706',     'Dispute'],
    CallBack:      ['rgba(99,102,241,.12)',   'var(--brand)','Call Back'],
  };
  const [bg, col, lbl] = m[r] || ['var(--hover)', 'var(--t3)', r || '—'];
  return `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;white-space:nowrap;background:${bg};color:${col}">${lbl}</span>`;
}

function _stBadge(s) {
  const col = { Active:'#10b981', Pending:'#f59e0b', Escalated:'#ef4444', Resolved:'var(--t3)', Closed:'var(--t3)' }[s] || 'var(--t3)';
  return `<span style="font-size:10px;font-weight:700;color:${col}">${s||'Active'}</span>`;
}

function _dStat(label, val, color) {
  return `<div class="card" style="padding:14px 16px;text-align:center">
    <div style="font-size:22px;font-weight:800;color:${color||'var(--brand)'}">${val}</div>
    <div style="font-size:11px;color:var(--t3);margin-top:2px">${label}</div>
  </div>`;
}

function _emptyDot(tone) {
  const col = tone === 'green' ? '#22c55e' : '#D1D5DB';
  return `<svg width="32" height="32" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
}

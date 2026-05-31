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
};
function _fci(name, size=14) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${_FC_ICONS[name]||''}</svg>`;
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

  // ── ONE-SHOT innerHTML — header + tabs + content together ──
  pg.innerHTML = `<div class="module-recovery" style="opacity:1">
    <header class="fc-header">
      <div class="fc-header-left">
        <div class="fc-breadcrumb">Home ${_fci('chevron-right',11)} Follow-up</div>
        <div class="fc-title-row">
          <span class="fc-title-icon">${_fci('phone-call',16)}</span>
          <span class="fc-title">Follow-up &amp; Recovery</span>
        </div>
        <div class="fc-sub">Communication tracking and recovery analytics</div>
      </div>
      <div class="fc-header-right">
        <button class="fc-icon-btn" onclick="rCons()" title="Refresh">
          ${_fci('refresh-cw',16)}
        </button>
        <button class="fc-btn-primary" onclick="openConModal(null)">
          ${_fci('plus',14)} Log Contact
        </button>
      </div>
    </header>
    <nav class="fc-tabs" role="tablist">
      ${TABS.map(tab => {
        const on = _clTab === tab.id;
        return `<button class="fc-tab${on?' active':''}" role="tab" aria-selected="${on}"
          onclick="_fcSetTab('${tab.id}')">
          ${_fci(tab.icon,14)} ${tab.label}
          ${tab.badge > 0 ? `<span class="fc-tab-badge">${tab.badge}</span>` : ''}
        </button>`;
      }).join('')}
    </nav>
    <div class="fc-content" id="cl-content" role="tabpanel" style="opacity:1;padding-top:20px">
      ${body}
    </div>
  </div>`;

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
  return `<div class="fc-kpi">
    <div class="fc-kpi-icon ${tone}">${_fci(iconName, 16)}</div>
    <div class="fc-kpi-body">
      <div class="fc-kpi-label">${label}</div>
      <div class="fc-kpi-value">${value}</div>
      <div class="fc-kpi-sub">${sub}</div>
    </div>
  </div>`;
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
// TAB 2 — WORK QUEUE (sync, uses pre-loaded _clBrokenPromises)
// ═══════════════════════════════════════════════════════════════════════════
function _tabQueueHtml() {
  const t   = td();
  const all = _clCache || [];

  const byUnit = {};
  all.forEach(c => { if (c.unit_id) (byUnit[c.unit_id] = byUnit[c.unit_id] || []).push(c); });

  const p1 = [], p2 = [], p3 = [], p4 = [];
  const soldUnits = gunits().filter(u => u.status !== 'Available' && u.status !== 'Dead' && actualPending(u) > 0);

  soldUnits.forEach(u => {
    const logs = byUnit[u.id] || [];
    if (!logs.length) { p4.push({ u, type:'new', reason:'Never contacted' }); return; }

    const flag     = _unitEscalation(logs).flag;
    const fuLogs   = logs.filter(c => c.next_followup_date);
    const overdueL = fuLogs.find(c => c.next_followup_date < t);
    const todayL   = fuLogs.find(c => c.next_followup_date === t);

    if (flag === 'Red' && overdueL) {
      const d = Math.floor((new Date(t)-new Date(overdueL.next_followup_date))/86400000);
      p1.push({ u, logs, flag, overdueL, type:'critical', reason:`Red flag + ${d}d overdue` });
    } else if (overdueL) {
      const d = Math.floor((new Date(t)-new Date(overdueL.next_followup_date))/86400000);
      p2.push({ u, logs, overdueL, type:'overdue', reason:`${d}d overdue` });
    } else if (todayL) {
      p3.push({ u, logs, todayL, type:'today', reason:'Due today' });
    }
  });

  p2.sort((a,b) => (a.overdueL.next_followup_date||'').localeCompare(b.overdueL.next_followup_date||''));
  p3.sort((a,b) => actualPending(b.u) - actualPending(a.u));
  p4.sort((a,b) => actualPending(b.u) - actualPending(a.u));

  const total = p1.length + p2.length + p3.length + p4.length;

  const renderQRow = (item, idx) => {
    const { u, type, reason, overdueL, todayL, logs } = item;
    const lastLog = logs ? [...logs].sort((a,b) => (b.contact_date||'').localeCompare(a.contact_date||''))[0] : null;
    const col = { critical:'#ef4444', overdue:'#f97316', today:'#f59e0b', new:'#6366f1' }[type] || 'var(--t2)';
    const refLog = overdueL || todayL;
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);${type==='critical'?'background:rgba(239,68,68,.03)':''}">
      <div style="width:26px;height:26px;border-radius:50%;background:${col};color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;flex-shrink:0">${idx+1}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:700;font-size:13px">${esc(u.unitNo||'')}</span>
          <span style="color:var(--t3)">·</span>
          <span style="font-size:12px">${esc((u.customerName||'?').substring(0,20))}</span>
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:rgba(239,68,68,.08);color:${col}">${reason}</span>
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:3px">
          <span style="font-size:11px;color:var(--t3)">PKR ${fM(actualPending(u))}</span>
          ${lastLog ? `<span style="font-size:11px;color:var(--t3)">Last: ${fD(lastLog.contact_date)} · ${_chIcon(lastLog.channel)}</span>` : ''}
          ${refLog  ? `<span style="font-size:11px;color:${col}">${_chIcon(refLog.next_followup_channel||'Call')} ${esc(refLog.next_followup_channel||'Call')}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-gh btn-xs" onclick="openUD('${u.id}')">View</button>
        <button class="btn btn-d btn-xs" onclick="openConModal('${u.id}')">Log</button>
      </div>
    </div>`;
  };

  const sections = [
    { items:p1, title:'Critical — Red-Flagged + Overdue', col:'#ef4444', offset:0 },
    { items:p2, title:'High — Overdue Follow-ups',        col:'#f97316', offset:p1.length },
    { items:p3, title:'Today\'s Follow-ups',              col:'#f59e0b', offset:p1.length+p2.length },
    { items:p4, title:'Never Contacted',                  col:'#6366f1', offset:p1.length+p2.length+p3.length },
  ].filter(s => s.items.length);

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div>
        <div style="font-size:13px;font-weight:700">${total} action item${total!==1?'s':''} in your queue</div>
        <div style="font-size:11px;color:var(--t3);margin-top:2px">${new Date().toLocaleDateString('en-PK',{weekday:'long',day:'numeric',month:'long'})}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${_clBrokenPromises.length ? `<div style="font-size:11px;font-weight:700;padding:5px 11px;border-radius:var(--rm);background:rgba(245,158,11,.1);color:#f59e0b;border:1px solid rgba(245,158,11,.2)">${_clBrokenPromises.length} promise${_clBrokenPromises.length>1?'s':''} due</div>` : ''}
        <button class="btn btn-gh btn-sm" onclick="rCons()">↺ Refresh</button>
      </div>
    </div>

    ${!total && !_clBrokenPromises.length
      ? `<div class="card"><div class="empty"><div class="ei">${_emptyDot('green')}</div><div class="et">Queue is clear!</div><div class="es">No pending follow-ups. Check back tomorrow.</div></div></div>`
      : ''}

    ${sections.map(({ items, title, col, offset }) => `
      <div class="card" style="margin-bottom:12px;border-left:3px solid ${col}">
        <div style="padding:10px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:12px;font-weight:700;color:${col}">${title}</div>
          <div style="font-size:11px;color:var(--t3)">${items.length} unit${items.length>1?'s':''}</div>
        </div>
        ${items.map((item, i) => renderQRow(item, offset + i)).join('')}
      </div>
    `).join('')}

    ${_clBrokenPromises.length ? `
    <div class="card" style="border-left:3px solid #f59e0b">
      <div style="padding:10px 16px;border-bottom:1px solid var(--line)">
        <div style="font-size:12px;font-weight:700;color:#f59e0b">Overdue Payment Promises</div>
      </div>
      <div class="tw"><table class="t">
        <thead><tr><th>Unit</th><th>Client</th><th>Due</th><th>Amount</th><th>Notes</th><th>Action</th></tr></thead>
        <tbody>${_clBrokenPromises.map(p => {
          const u = p.sale_id ? (window._unitsCache||[]).find(u => u.saleId === p.sale_id) : null;
          return `<tr class="cr">
            <td style="font-weight:700" ${u?`onclick="openUD('${u.id}')"`:''}>${esc(u?.unitNo||'—')}</td>
            <td>${esc(u?.customerName||'—')}</td>
            <td style="color:#f59e0b;font-weight:700">${fD(p.promise_date)}</td>
            <td style="font-weight:700">${fM(Number(p.promised_amount||0))}</td>
            <td style="font-size:11px;color:var(--t3)">${esc(p.notes||'—')}</td>
            <td>${u?`<button class="btn btn-d btn-xs" onclick="openConModal('${u.id}')">Log</button>`:'—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>` : ''}
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3 — CONTACT LOG (sync; _rCLTable does filter updates against sub-divs)
// ═══════════════════════════════════════════════════════════════════════════
function _tabLogHtml() {
  const users = window._appUsersCache || [];
  return `
    <div class="fbar" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <div class="fg"><label class="fl" style="font-size:10px">From</label>
        <input class="inp-light" type="date" value="${_clf.fr||''}" style="padding:6px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_clf.fr=this.value;_rCLTable()">
      </div>
      <div class="fg"><label class="fl" style="font-size:10px">To</label>
        <input class="inp-light" type="date" value="${_clf.to||''}" style="padding:6px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_clf.to=this.value;_rCLTable()">
      </div>
      <div class="fg"><label class="fl" style="font-size:10px">Channel</label>
        <select class="inp-light" style="padding:6px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_clf.ch=this.value;_rCLTable()">
          ${['All','Call','WhatsApp','Meeting','Email','SMS','Visit'].map(v => `<option value="${v}"${_clf.ch===v?' selected':''}>${v}${v==='All'?' Channels':''}</option>`).join('')}
        </select>
      </div>
      <div class="fg"><label class="fl" style="font-size:10px">Response</label>
        <select class="inp-light" style="padding:6px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_clf.res=this.value;_rCLTable()">
          ${[['All','All Responses'],['NoResponse','No Response'],['Interested','Interested'],['WillPay','Will Pay'],['NotInterested','Not Interested'],['Dispute','Dispute'],['CallBack','Call Back']].map(([v,lbl]) => `<option value="${v}"${_clf.res===v?' selected':''}>${lbl}</option>`).join('')}
        </select>
      </div>
      <div class="fg"><label class="fl" style="font-size:10px">Follow-up</label>
        <select class="inp-light" style="padding:6px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_clf.fu=this.value;_rCLTable()">
          ${[['All','All'],['overdue','Overdue'],['today','Due Today'],['upcoming','Upcoming'],['none','None Set']].map(([v,lbl]) => `<option value="${v}"${_clf.fu===v?' selected':''}>${lbl}</option>`).join('')}
        </select>
      </div>
      <div class="fg"><label class="fl" style="font-size:10px">Agent</label>
        <select class="inp-light" style="padding:6px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_clf.ag=this.value;_rCLTable()">
          <option value="All"${_clf.ag==='All'?' selected':''}>All Agents</option>
          ${users.map(u => `<option value="${u.id}"${_clf.ag===u.id?' selected':''}>${esc(u.name||u.fullName||u.id)}</option>`).join('')}
        </select>
      </div>
      <div class="fg"><label class="fl" style="font-size:10px">Flag</label>
        <select class="inp-light" style="padding:6px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_clf.flag=this.value;_rCLTable()">
          ${[['All','All'],['Red','Red'],['Orange','Orange'],['Yellow','Yellow'],['none','No Flag']].map(([v,lbl]) => `<option value="${v}"${_clf.flag===v?' selected':''}>${lbl}</option>`).join('')}
        </select>
      </div>
      <div class="fg" style="flex:1;min-width:160px"><label class="fl" style="font-size:10px">Search</label>
        <input class="inp-light" style="padding:6px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px;width:100%;box-sizing:border-box" placeholder="Unit / client / remarks…" value="${esc(_clf.q||'')}" oninput="_clf.q=this.value;clearTimeout(window._clfTimer);window._clfTimer=setTimeout(_rCLTable,220)">
      </div>
      <div class="fg" style="display:flex;align-items:flex-end">
        <button class="btn btn-gh btn-sm" onclick="_clf={ch:'All',res:'All',fu:'All',ag:'All',flag:'All',q:'',fr:'',to:''};_fcBuild()">Reset</button>
      </div>
    </div>
    <div id="cl-sum" style="margin-bottom:10px"></div>
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
  if (sum) sum.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;padding:9px 16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);font-size:12px">
    <span style="font-weight:700">${rows.length} shown</span>
    ${overdueCt  ? `<span style="color:var(--t3)">·</span><span style="color:#ef4444;font-weight:700">${overdueCt} overdue</span>` : ''}
    ${todayCt    ? `<span style="color:var(--t3)">·</span><span style="color:#f59e0b;font-weight:700">${todayCt} today</span>` : ''}
    ${promiseCt  ? `<span style="color:var(--t3)">·</span><span style="color:#10b981;font-weight:700">${promiseCt} promise${promiseCt>1?'s':''}</span>` : ''}
  </div>`;

  const tbl = document.getElementById('cl-tbl');
  if (!tbl) return;
  if (!rows.length) {
    tbl.innerHTML = `<div class="card"><div class="empty"><div class="ei">${_emptyDot('grey')}</div><div class="et">No contact logs match filters</div></div></div>`;
    return;
  }

  tbl.innerHTML = `<div class="card"><div class="tw"><table class="t">
    <thead><tr><th>Date</th><th>Unit</th><th>Client</th><th>Channel</th><th>Response</th><th>Remarks</th><th>Promise</th><th>Next Follow-up</th><th>Agent</th><th>Flag</th></tr></thead>
    <tbody>${rows.map(c => {
      const u     = gunit(c.unit_id);
      const fuOv  = c.next_followup_date && c.next_followup_date < t;
      const fuTod = c.next_followup_date === t;
      const fcol  = {Red:'#ef4444',Orange:'#f97316',Yellow:'#f59e0b'}[c.escalation_flag] || '';
      return `<tr class="cr" onclick="openUD('${c.unit_id||''}')">
        <td style="font-size:11px;white-space:nowrap">${fD(c.contact_date)}${c.contact_time?`<br><span style="color:var(--t3)">${c.contact_time.slice(0,5)}</span>`:''}</td>
        <td style="font-weight:700">${esc(u?.unitNo||'?')}</td>
        <td style="max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.client_name||u?.customerName||'—')}</td>
        <td style="white-space:nowrap">${_chIcon(c.channel)} ${esc(c.channel||'—')}</td>
        <td>${_resBadge(c.response_received)}</td>
        <td style="font-size:11px;color:var(--t3);max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(c.remarks||'')}">${esc(c.remarks||'—')}</td>
        <td style="font-size:11px">${c.promise_to_pay?`<span style="color:#10b981;font-weight:700">&#10003;</span>${c.promise_amount?' '+fM(c.promise_amount):''}${c.promise_date?`<br><span style="color:var(--t3);font-size:10px">${fD(c.promise_date)}</span>`:''}` : '—'}</td>
        <td style="color:${fuOv?'#ef4444':fuTod?'#f59e0b':'var(--t3)'};font-weight:${fuOv||fuTod?700:400};font-size:11px">${c.next_followup_date?fD(c.next_followup_date)+(fuOv?' !':(fuTod?' •':'')):'—'}</td>
        <td style="font-size:11px;color:var(--t3)">${esc(gunm(c.agent_id||c.created_by)||'—')}</td>
        <td style="color:${fcol};font-weight:700;font-size:12px">${c.escalation_flag||''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div></div>`;
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
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      ${_rptTabs.map(tab => {
        const on = _clRptTab === tab.id;
        return `<button onclick="_setRptTab('${tab.id}')"
          style="padding:6px 14px;border:1.5px solid ${on?'var(--brand)':'var(--line)'};background:${on?'var(--brand)':'transparent'};color:${on?'#fff':'var(--t2)'};border-radius:var(--rm);font-size:12px;font-weight:600;cursor:pointer">${tab.label}</button>`;
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

  const inner = (() => {
    if (!dayLogs.length) {
      return `<div class="card"><div class="empty"><div class="ei">${_emptyDot('grey')}</div><div class="et">No activity on ${fD(selDate)}</div></div></div>`;
    }
    const byAgent = {};
    dayLogs.forEach(c => { const ag = c.agent_id || c.created_by || 'unknown'; (byAgent[ag] = byAgent[ag] || []).push(c); });
    return `<div class="card">
      <div style="text-align:center;padding:16px 20px 12px;border-bottom:2px solid var(--line)">
        <div style="font-size:15px;font-weight:800">Recovery Agent Daily Activity Report</div>
        <div style="font-size:12px;color:var(--t3);margin-top:4px">${fD(selDate)} &nbsp;|&nbsp; ${dayLogs.length} contacts &nbsp;|&nbsp; ${Object.keys(byAgent).length} agents</div>
      </div>
      ${Object.entries(byAgent).map(([agId, logs]) => {
        const agName   = gunm(agId);
        const promises = logs.filter(c => c.promise_to_pay);
        return `<div style="padding:14px 16px 4px;border-bottom:1px solid var(--line)">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 12px;background:var(--hover);border-radius:var(--r)">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0">${ini(agName)}</div>
            <div>
              <div style="font-weight:700;font-size:13px">${esc(agName)}</div>
              <div style="font-size:11px;color:var(--t3)">${logs.length} contacts · ${promises.length} promise${promises.length!==1?'s':''}</div>
            </div>
          </div>
          <div class="tw"><table class="t" style="font-size:11px">
            <thead><tr><th>Time</th><th>Unit</th><th>Client</th><th>Channel</th><th>Response</th><th>Remarks</th><th>Promise</th><th>Follow-up</th></tr></thead>
            <tbody>${logs.sort((a,b) => (a.contact_time||'').localeCompare(b.contact_time||'')).map(c => {
              const u = gunit(c.unit_id);
              return `<tr>
                <td>${c.contact_time?c.contact_time.slice(0,5):'—'}</td>
                <td style="font-weight:700">${esc(u?.unitNo||'?')}</td>
                <td>${esc(c.client_name||u?.customerName||'—')}</td>
                <td>${_chIcon(c.channel)} ${esc(c.channel||'—')}</td>
                <td>${_resBadge(c.response_received)}</td>
                <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.remarks||'—')}</td>
                <td>${c.promise_to_pay?`&#10003;${c.promise_amount?' '+fM(c.promise_amount):''}`:''}</td>
                <td>${c.next_followup_date?fD(c.next_followup_date):'—'}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
        </div>`;
      }).join('')}
    </div>`;
  })();

  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <div class="fg"><label class="fl" style="font-size:10px">Activity Date</label>
        <input class="inp-light" type="date" value="${selDate}" style="padding:6px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px"
          onchange="window._rptDailyDate=this.value;_fcBuild()">
      </div>
      <div style="margin-top:16px"><button class="btn btn-print btn-sm" onclick="window.print()">Print</button></div>
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

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">
      ${_dStat('Total Promises', rows.length,                                     'var(--brand)')}
      ${_dStat('Pending',        rows.filter(r=>r.status==='Pending').length,     '#f59e0b')}
      ${_dStat('Due',            rows.filter(r=>r.status==='Due').length,         '#f97316')}
      ${_dStat('Broken',         rows.filter(r=>r.status==='Broken').length,      '#ef4444')}
      ${_dStat('Total Amt',      fM(totAmt),                                      '#10b981')}
      ${_dStat('Broken Amt',     fM(brokenAmt),                                   '#ef4444')}
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line)">
        <h3 style="font-size:13px;font-weight:700;margin:0">Promise Tracking</h3>
        <button class="btn btn-print btn-sm" onclick="window.print()">Print</button>
      </div>
      ${!rows.length ? `<div class="empty"><div class="ei">${_emptyDot('grey')}</div><div class="et">No promises recorded</div></div>` :
        `<div class="tw"><table class="t">
          <thead><tr><th>Unit</th><th>Client</th><th>Promise Date</th><th>Amount</th><th>Agent</th><th>#</th><th>Status</th><th>Last Contact</th><th>Action</th></tr></thead>
          <tbody>${rows.map(r => `<tr class="cr">
            <td style="font-weight:700" onclick="openUD('${r.uid}')">${esc(r.u?.unitNo||'?')}</td>
            <td>${esc(r.u?.customerName||r.latest.client_name||'—')}</td>
            <td>${r.latest.promise_date?fD(r.latest.promise_date):'—'}</td>
            <td style="font-weight:700">${r.latest.promise_amount?fM(r.latest.promise_amount):'—'}</td>
            <td style="font-size:11px;color:var(--t3)">${esc(gunm(r.latest.agent_id||r.latest.created_by)||'—')}</td>
            <td style="text-align:center">${r.promises.length}</td>
            <td><span style="font-size:11px;font-weight:700;color:${r.scol}">${r.status}</span></td>
            <td style="font-size:11px;color:var(--t3)">${fD(r.latest.contact_date)}</td>
            <td><button class="btn btn-d btn-xs" onclick="openConModal('${r.uid}')">Follow Up</button></td>
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
    return `<div class="card"><div class="empty"><div class="ei">${_emptyDot('grey')}</div><div class="et">No activity in last 30 days</div></div></div>`;
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
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--t2)">Last 30 days — ${sorted.length} agent${sorted.length!==1?'s':''}</div>
      <button class="btn btn-print btn-sm" onclick="window.print()">Print</button>
    </div>
    <div class="card">
      <div class="tw"><table class="t">
        <thead><tr><th>Agent</th><th>Total</th><th>No Response</th><th>Interested</th><th>Will Pay</th><th>Promises</th><th>Promise Amt</th><th>Response Rate</th><th>FU Set</th></tr></thead>
        <tbody>${sorted.map(([agId, s]) => {
          const rr = s.total ? Math.round((s.total - s.nr) / s.total * 100) : 0;
          return `<tr>
            <td style="font-weight:700">${esc(gunm(agId))}</td>
            <td style="text-align:center;font-weight:700">${s.total}</td>
            <td style="text-align:center;color:#ef4444">${s.nr}</td>
            <td style="text-align:center;color:#10b981">${s.interested}</td>
            <td style="text-align:center;color:#10b981">${s.willPay}</td>
            <td style="text-align:center;font-weight:700">${s.promises}</td>
            <td>${s.promiseAmt?fM(s.promiseAmt):'—'}</td>
            <td style="text-align:center"><span style="font-weight:700;color:${rr>=50?'#10b981':'#ef4444'}">${rr}%</span></td>
            <td style="text-align:center">${s.fuSet}</td>
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

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px">
      ${sorted.map(([ch, s]) => _dStat(`${_chIcon(ch)} ${ch}`, s.total, 'var(--brand)')).join('')}
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line)">
        <h3 style="font-size:13px;font-weight:700;margin:0">Channel Analysis</h3>
        <button class="btn btn-print btn-sm" onclick="window.print()">Print</button>
      </div>
      ${!sorted.length ? `<div class="empty"><div class="ei">${_emptyDot('grey')}</div><div class="et">No data yet</div></div>` :
        `<div class="tw"><table class="t">
          <thead><tr><th>Channel</th><th>Total</th><th>%</th><th>No Response</th><th>Interested</th><th>Will Pay</th><th>Promises</th><th>Response Rate</th></tr></thead>
          <tbody>${sorted.map(([ch, s]) => {
            const rr = s.total ? Math.round((s.total - s.nr) / s.total * 100) : 0;
            return `<tr>
              <td style="font-weight:700">${_chIcon(ch)} ${esc(ch)}</td>
              <td style="text-align:center;font-weight:700">${s.total}</td>
              <td style="text-align:center">${total?Math.round(s.total/total*100):0}%</td>
              <td style="text-align:center;color:#ef4444">${s.nr}</td>
              <td style="text-align:center;color:#10b981">${s.interested}</td>
              <td style="text-align:center;color:#10b981">${s.willPay}</td>
              <td style="text-align:center;font-weight:700">${s.promises}</td>
              <td style="text-align:center"><span style="font-weight:700;color:${rr>=50?'#10b981':'#ef4444'}">${rr}%</span></td>
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

  return `<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line)">
      <h3 style="font-size:13px;font-weight:700;margin:0">Difficult / Non-Responsive <span style="font-size:11px;font-weight:400;color:var(--t3)">${rows.length} with 5+ no-responses</span></h3>
      <button class="btn btn-print btn-sm" onclick="window.print()">Print</button>
    </div>
    ${!rows.length ? `<div class="empty"><div class="ei">${_emptyDot('green')}</div><div class="et">No difficult clients</div></div>` :
      `<div class="tw"><table class="t">
        <thead><tr><th>Unit</th><th>Client</th><th>Total</th><th>No Response</th><th>Last Contact</th><th>Last Response</th><th>Flag</th><th>Pending</th><th>Actions</th></tr></thead>
        <tbody>${rows.map(r => {
          const fcol = {Red:'#ef4444',Orange:'#f97316',Yellow:'#f59e0b'}[r.esc_s.flag] || 'var(--t3)';
          return `<tr class="cr">
            <td style="font-weight:700" onclick="openUD('${r.uid}')">${esc(r.u?.unitNo||'?')}</td>
            <td>${esc(r.u?.customerName||r.last?.client_name||'—')}</td>
            <td style="text-align:center;font-weight:700">${r.logs.length}</td>
            <td style="text-align:center;color:#ef4444;font-weight:700">${r.nr}</td>
            <td>${fD(r.last?.contact_date)}</td>
            <td>${_resBadge(r.last?.response_received)}</td>
            <td style="color:${fcol};font-weight:700">${r.esc_s.flag||'—'}</td>
            <td style="font-weight:700">${fM(actualPending(r.u||{}))}</td>
            <td style="display:flex;gap:4px">
              <button class="btn btn-d btn-xs" onclick="openConModal('${r.uid}')">Log</button>
              <button class="btn btn-gh btn-xs" onclick="_clSelectedUnit='${r.uid}';_clRptTab='perclient';_fcBuild()">History</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`}
  </div>`;
}

// ── Report: Per-Client History ────────────────────────────────────────────
function _rptPerClientHtml() {
  const units = gunits().filter(u => u.status !== 'Available' && u.status !== 'Dead');

  const detail = (() => {
    if (!_clSelectedUnit) return '';
    const u    = gunit(_clSelectedUnit);
    const logs = (_clCache||[]).filter(c => c.unit_id === _clSelectedUnit)
                                .sort((a,b) => (b.contact_date||'').localeCompare(a.contact_date||''));
    if (!logs.length) {
      return `<div class="card"><div class="empty"><div class="ei">${_emptyDot('grey')}</div><div class="et">No contact history for this unit</div></div></div>`;
    }
    const noResp   = logs.filter(c => c.response_received === 'NoResponse').length;
    const promises = logs.filter(c => c.promise_to_pay);
    const esc_s    = _unitEscalation(logs);
    const flagCol  = {Red:'#ef4444',Orange:'#f97316',Yellow:'#f59e0b'}[esc_s.flag] || '';

    return `<div class="card">
      <div style="padding:16px 20px;border-bottom:2px solid var(--line)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          <div>
            <div style="font-size:15px;font-weight:800">${esc(u?.unitNo||'?')} — Contact History</div>
            <div style="font-size:12px;color:var(--t3);margin-top:3px">Client: ${esc(u?.customerName||logs[0]?.client_name||'—')} · Project: ${esc(gproject(u?.projectId)?.name||'—')}</div>
          </div>
          ${esc_s.flag?`<div style="padding:5px 14px;border-radius:20px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);font-size:12px;font-weight:700;color:${flagCol}">${esc_s.flag} — ${esc(esc_s.reason)}</div>`:''}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px">
          ${_dStat('Total Contacts', logs.length,                'var(--brand)')}
          ${_dStat('No Response',    noResp,                     '#ef4444')}
          ${_dStat('Promises',       promises.length,            '#10b981')}
          ${_dStat('Pending',        fM(actualPending(u||{})),   '#f97316')}
          ${_dStat('Last Contact',   fD(logs[0]?.contact_date),  'var(--t2)')}
        </div>
      </div>
      <div class="tw"><table class="t" style="font-size:11px">
        <thead><tr><th>Date</th><th>Time</th><th>Channel</th><th>Dir</th><th>Response</th><th>Remarks</th><th>Promise</th><th>Next FU</th><th>Agent</th><th>Status</th></tr></thead>
        <tbody>${logs.map(c => `<tr>
          <td style="white-space:nowrap;font-weight:600">${fD(c.contact_date)}</td>
          <td>${c.contact_time?c.contact_time.slice(0,5):'—'}</td>
          <td>${_chIcon(c.channel)} ${esc(c.channel||'—')}</td>
          <td style="font-size:10px;color:var(--t3)">${c.direction==='Inbound'?'↙ In':'↗ Out'}</td>
          <td>${_resBadge(c.response_received)}</td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.remarks||'')}">${esc(c.remarks||'—')}</td>
          <td>${c.promise_to_pay?`&#10003;${c.promise_amount?' '+fM(c.promise_amount):''}${c.promise_date?`<br>${fD(c.promise_date)}`:''}`:''}</td>
          <td>${c.next_followup_date?`${fD(c.next_followup_date)}${c.next_followup_channel?`<br>${_chIcon(c.next_followup_channel)} ${esc(c.next_followup_channel)}`:''}`:'—'}</td>
          <td style="white-space:nowrap">${esc(gunm(c.agent_id||c.created_by||''))}</td>
          <td>${_stBadge(c.status_tag)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  })();

  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <div class="fg"><label class="fl" style="font-size:10px">Select Unit / Client</label>
        <select class="inp-light" style="padding:6px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px;min-width:260px"
          onchange="_clSelectedUnit=this.value;_fcBuild()">
          <option value="">-- Select a unit --</option>
          ${units.map(u => `<option value="${u.id}" ${_clSelectedUnit===u.id?'selected':''}>${esc(u.unitNo)}${u.customerName?' — '+esc(u.customerName):''}</option>`).join('')}
        </select>
      </div>
      ${_clSelectedUnit?`<div style="margin-top:16px"><button class="btn btn-print btn-sm" onclick="window.print()">Print</button></div>`:''}
    </div>
    ${detail}
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 5 — ESCALATION & LEGAL (sync; uses pre-loaded _clEscalations/_clLegalCases)
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

  const renderFlag = (flag, items) => {
    if (!items.length) return '';
    const colors = { Red:'#ef4444', Orange:'#f97316', Yellow:'#f59e0b' };
    const titles = {
      Red:    'Red — 5+ Consecutive No Responses (Escalate to Manager)',
      Orange: 'Orange — 2+ Broken Promises',
      Yellow: 'Yellow — 3+ Consecutive No Responses',
    };
    const col = colors[flag];
    return `<div class="card" style="margin-bottom:12px;border-left:3px solid ${col}">
      <div style="padding:10px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">
        <h3 style="font-size:13px;font-weight:700;margin:0;color:${col}">${titles[flag]}</h3>
        <div style="font-size:11px;color:var(--t3)">${items.length} unit${items.length>1?'s':''}</div>
      </div>
      <div class="tw"><table class="t">
        <thead><tr><th>Unit</th><th>Client</th><th>Reason</th><th>Contacts</th><th>Last Contact</th><th>Last Response</th><th>Pending</th><th>Actions</th></tr></thead>
        <tbody>${items.map(({ uid, u, logs, esc_s }) => {
          const last = [...logs].sort((a,b) => (b.contact_date||'').localeCompare(a.contact_date||''))[0];
          return `<tr class="cr">
            <td style="font-weight:700" onclick="openUD('${uid}')">${esc(u?.unitNo||'?')}</td>
            <td>${esc(u?.customerName||last?.client_name||'—')}</td>
            <td style="font-size:11px;color:${col};font-weight:600">${esc(esc_s.reason)}</td>
            <td style="text-align:center">${logs.length}</td>
            <td>${fD(last?.contact_date)}</td>
            <td>${_resBadge(last?.response_received)}</td>
            <td style="font-weight:700">${fM(actualPending(u||{}))}</td>
            <td style="display:flex;gap:4px">
              <button class="btn btn-d btn-xs" onclick="openConModal('${uid}')">Log</button>
              <button class="btn btn-gh btn-xs" onclick="openUD('${uid}')">View</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
  };

  const openEsc = _clEscalations.filter(e => e.status !== 'closed' && e.status !== 'resolved').length;
  const openLeg = _clLegalCases.filter(l => l.status !== 'closed').length;

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px">
      ${_dStat('Red Flags',        flags.Red.length,    '#ef4444')}
      ${_dStat('Orange Flags',     flags.Orange.length, '#f97316')}
      ${_dStat('Yellow Flags',     flags.Yellow.length, '#f59e0b')}
      ${_dStat('Open Escalations', openEsc,             '#6366f1')}
      ${_dStat('Active Legal',     openLeg,             '#ef4444')}
    </div>

    ${renderFlag('Red',    flags.Red)}
    ${renderFlag('Orange', flags.Orange)}
    ${renderFlag('Yellow', flags.Yellow)}
    ${!flags.Red.length && !flags.Orange.length && !flags.Yellow.length
      ? `<div class="card" style="margin-bottom:12px"><div class="empty"><div class="ei">${_emptyDot('green')}</div><div class="et">No escalation flags — all units in good standing</div></div></div>`
      : ''}

    <div class="card" style="margin-bottom:12px">
      <div style="padding:10px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">
        <h3 style="font-size:13px;font-weight:700;margin:0">Escalation Records</h3>
        <div style="font-size:11px;color:var(--t3)">${_clEscalations.length} total</div>
      </div>
      ${!_clEscalations.length
        ? `<div class="empty"><div class="ei">${_emptyDot('grey')}</div><div class="et">No escalation records</div></div>`
        : `<div class="tw"><table class="t" style="font-size:12px">
          <thead><tr><th>Date</th><th>Level</th><th>Reason</th><th>Status</th><th>Escalated To</th></tr></thead>
          <tbody>${_clEscalations.map(e => {
            const sc = {open:'#ef4444',pending:'#f59e0b',resolved:'#10b981',closed:'var(--t3)'}[e.status]||'var(--t3)';
            const lvl = e.from_level && e.to_level ? `L${e.from_level}→L${e.to_level}` : '—';
            return `<tr class="cr">
              <td style="font-size:11px;white-space:nowrap">${fD((e.created_at||'').slice(0,10))}</td>
              <td style="font-size:11px;font-weight:700">${esc(lvl)}</td>
              <td style="font-size:11px;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.reason||'—')}</td>
              <td><span style="font-size:10px;font-weight:700;color:${sc}">${esc(e.status||'open')}</span></td>
              <td style="font-size:11px;color:var(--t3)">${esc(gunm(e.escalated_to)||'—')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
    </div>

    <div class="card">
      <div style="padding:10px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">
        <h3 style="font-size:13px;font-weight:700;margin:0;color:#ef4444">Legal Cases</h3>
        <div style="font-size:11px;color:var(--t3)">${_clLegalCases.length} total</div>
      </div>
      ${!_clLegalCases.length
        ? `<div class="empty"><div class="ei">${_emptyDot('grey')}</div><div class="et">No legal cases on record</div></div>`
        : `<div class="tw"><table class="t" style="font-size:12px">
          <thead><tr><th>Filed</th><th>Unit</th><th>Client</th><th>Case No.</th><th>Stage</th><th>Next Hearing</th><th>Lawyer</th><th>Claim Amt</th></tr></thead>
          <tbody>${_clLegalCases.map(lc => {
            const u   = gunit(lc.unit_id);
            const now = td();
            const nxt = lc.next_hearing_date;
            const nc  = nxt && nxt < now ? '#ef4444' : nxt === now ? '#f59e0b' : 'var(--t2)';
            const stageCols = {
              pre_legal:'var(--t3)', notice_sent:'#f59e0b', filed:'#f97316',
              hearing:'#ef4444', judgment:'#ef4444', appeal:'#f97316',
              settled:'#10b981', closed:'var(--t3)'
            };
            const sc = stageCols[lc.stage] || 'var(--t3)';
            return `<tr class="cr" onclick="openUD('${lc.unit_id||''}')">
              <td style="font-size:11px;white-space:nowrap">${fD((lc.filed_date||lc.created_at||'').slice(0,10))}</td>
              <td style="font-weight:700">${esc(u?.unitNo||'—')}</td>
              <td style="max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u?.customerName||'—')}</td>
              <td style="font-size:11px">${esc(lc.case_number||'—')}</td>
              <td><span style="font-size:10px;font-weight:700;color:${sc}">${esc(lc.stage||'—')}</span></td>
              <td style="color:${nc};font-weight:${nxt&&nxt<=now?700:400};font-size:11px">${nxt?fD(nxt):'—'}</td>
              <td style="font-size:11px;color:var(--t3)">${esc(lc.lawyer_name||'—')}</td>
              <td style="font-weight:700">${lc.claim_amount?fM(Number(lc.claim_amount)):'—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
    </div>
  `;
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

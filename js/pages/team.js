// ══ TEAM PERFORMANCE (Admin-only) ═════════════════════════════════════════════
// One row per active recovery user — activity, collections, neglected accounts,
// over an arbitrary period (Today / This week / This month / Custom) and project.
// Clickable rows open a slide-over drawer with the full per-officer breakdown.
//
// Data: get_team_performance(p_company_id, p_project_id, p_from, p_to) — the
// period-aware RPC (extends the old _lite with field_visits, escalations, dual
// keep-rate, and the get_recovery_position OLD/CURRENT/DEAD collections split).
// Keep-rate: FAIR (kept ÷ matured) is the headline; STRICT (kept ÷ made) shown
// as a secondary. Collections attribution = project-assignment (see RPC comment;
// created_by-precise is a future upgrade once receipts are stamped).
//
// QA NOTE (merge review): Team Performance is NOT a duplicate of Users & Roles.
// Users & Roles manages accounts/roles/access; this is a recovery-operations
// scoreboard (recovered, keep-rate, calls, visits, escalations, neglect) per
// officer. Keep both.
// ═════════════════════════════════════════════════════════════════════════════
'use strict';

let _teamRows = [];
let _teamFilt = { period: 'month', from: '', to: '', project: '' };

function _teamTodayISO() { return new Date().toISOString().slice(0, 10); }

// Selected period → {from,to}. Day/week/month are all just date ranges; the RPC
// is period-agnostic so the UI owns the calendar arithmetic.
function _teamRange() {
  const p = _teamFilt.period, t = _teamTodayISO();
  if (p === 'today') return { from: t, to: t };
  if (p === 'week')  { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return { from: d.toISOString().slice(0, 10), to: t }; }
  if (p === 'custom') return { from: _teamFilt.from || t, to: _teamFilt.to || t };
  const d = new Date(); d.setDate(1); return { from: d.toISOString().slice(0, 10), to: t };  // month
}

async function rTeam() {
  const el = document.getElementById('pg-team');
  if (!el) return;

  // Role guard — Admin / Owner only
  if (!S || (S.role !== 'owner' && S.role !== 'admin')) {
    if (typeof nav === 'function') nav('dashboard');
    return;
  }

  el.innerHTML = '<div class="ani">' +
    NX.pageHeader('Team Performance', '', { icon: 'users', sub: 'Per-officer recovery — recovered, promise keep-rate, calls, visits & escalations' }) +
    '<div id="team-filt" class="nx" style="display:flex;flex-wrap:wrap;align-items:center;gap:var(--fk-sp-3);margin-bottom:var(--fk-sp-4)"></div>' +
    '<div id="team-body"></div></div>';

  _teamRenderFilters();
  await _teamLoad();
}

function _teamRenderFilters() {
  const bar = document.getElementById('team-filt');
  if (!bar) return;
  const tabs = NX.tabs({
    active: _teamFilt.period,
    onSelect: "_teamSetPeriod('%k')",
    tabs: [
      { k: 'today', label: 'Today' },
      { k: 'week',  label: 'This week' },
      { k: 'month', label: 'This month' },
      { k: 'custom', label: 'Custom' }
    ]
  });

  const projs = (typeof gprojects === 'function' ? gprojects() : []).slice()
    .sort((a, b) => String(a.name || a.project_name || '').localeCompare(String(b.name || b.project_name || '')));
  const projSel = '<select class="nx-select" style="width:auto" onchange="_teamSetProject(this.value)">' +
    '<option value="">All projects</option>' +
    projs.map(p => `<option value="${esc(p.id)}"${p.id === _teamFilt.project ? ' selected' : ''}>${esc(p.name || p.project_name || 'Project')}</option>`).join('') +
    '</select>';

  let custom = '';
  if (_teamFilt.period === 'custom') {
    const r = _teamRange();
    custom = `<span class="nx-kpi-label">From</span>` +
      `<input type="date" class="nx-input" style="width:auto" value="${esc(r.from)}" onchange="_teamSetCustom('from',this.value)">` +
      `<span class="nx-kpi-label">To</span>` +
      `<input type="date" class="nx-input" style="width:auto" value="${esc(r.to)}" onchange="_teamSetCustom('to',this.value)">`;
  }

  bar.innerHTML = tabs + projSel + custom;
}

function _teamSetPeriod(k) { _teamFilt.period = k; _teamRenderFilters(); if (k !== 'custom') _teamLoad(); }
function _teamSetProject(v) { _teamFilt.project = v || ''; _teamLoad(); }
function _teamSetCustom(key, val) { _teamFilt[key] = val; _teamRenderFilters(); if (_teamFilt.from && _teamFilt.to) _teamLoad(); }

async function _teamLoad() {
  const body = document.getElementById('team-body');
  if (!body) return;
  body.innerHTML = NX.card(NX.empty({ icon: 'users', message: 'Loading team performance…' }));

  const r = _teamRange();
  try {
    const { data, error } = await supabase.rpc('get_team_performance', {
      p_company_id: S.cid,
      p_project_id: _teamFilt.project || null,
      p_from: r.from,
      p_to: r.to
    });
    if (error) throw error;
    _teamRows = Array.isArray(data) ? data : [];
    _teamRender(_teamRows);
  } catch (e) {
    body.innerHTML = NX.card(NX.banner('Could not load team performance: ' + (e.message || e), 'danger'));
  }
}

// PKR money — reuse the app-wide Western-grouping formatter; never invent one.
function _teamMoney(v) {
  return (window.DX && DX.money) ? DX.money(v) : 'PKR ' + (typeof fM === 'function' ? fM(Number(v) || 0) : (Number(v) || 0).toLocaleString('en-US'));
}
function _teamPct(v) { return (v == null || v === '') ? '—' : (Number(v).toFixed(1).replace(/\.0$/, '') + '%'); }

function _teamRender(rows) {
  const body = document.getElementById('team-body');
  if (!body) return;

  // RENDER-GATE: the RPC returns every active recovery officer, so an empty list
  // means the company has no recovery users at all (the FG reality today). Show a
  // warm, helpful next-step — never a dead table.
  if (!rows.length) {
    body.innerHTML = NX.card(NX.empty({
      icon: 'user-plus',
      tone: '',
      message: 'No recovery activity yet — assign a recovery user (Users & Roles → role “Recovery”) and they’ll appear here with their calls, promises, visits and collections.'
    }));
    return;
  }

  const muted = (t) => `<span style="color:var(--fk-text-muted)">${t}</span>`;
  const recTip  = 'Recovered = Σ receipts on the officer’s assigned projects in the period (gross). ' +
    'from Arrears / from Current = the FIFO split of what those receipts cleared (old vs current dues). ' +
    'Attribution is by assigned project — a shared project credits each assigned officer.';
  const keepTip = 'Keep-rate (fair) = promises kept ÷ promises matured (whose date has passed). ' +
    'Strict = kept ÷ all promises made in the period (a not-yet-due promise counts against it).';

  const trs = rows.map(r => {
    const nm       = r.full_name || '—';
    const initial  = (String(nm).trim()[0] || '?').toUpperCase();

    const recovered = Number(r.recovered) || 0;
    const rOld = Number(r.recovered_old) || 0, rCur = Number(r.recovered_current) || 0;
    const split = recovered > 0
      ? `<div class="nx-kpi-label" style="text-transform:none;margin-top:2px">${_teamMoney(rOld)} arrears · ${_teamMoney(rCur)} current</div>`
      : '';
    const recCell = recovered > 0
      ? `<div style="color:var(--fk-text)">${_teamMoney(recovered)}</div>${split}`
      : muted('—');

    const made = Number(r.promises_made) || 0;
    const fair = r.keep_rate_matured, strict = r.keep_rate_made;
    const keepCell = made === 0
      ? muted('—')
      : `<div style="color:var(--fk-text)">${_teamPct(fair)}</div>` +
        `<div class="nx-kpi-label" style="text-transform:none;margin-top:2px">${_teamPct(strict)} strict · ${made} made</div>`;

    const calls  = Number(r.calls) || 0;
    const visits = Number(r.visits) || 0;
    const escs   = Number(r.escalations) || 0;

    const un     = Number(r.untouched_overdue) || 0;
    const unCell = un > 0 ? NX.badge(String(un), 'danger') : muted('0');

    const userCell =
      '<span style="display:inline-flex;align-items:center;gap:10px">' +
        '<span class="nx-avatar" style="background:var(--fk-primary-chip);color:var(--fk-primary)">' + esc(initial) + '</span>' +
        '<span style="font-weight:var(--fk-fw-semibold);color:var(--fk-text)">' + esc(nm) + '</span>' +
      '</span>';

    return `<tr style="cursor:pointer" onclick="_teamDrawer('${esc(String(r.user_id))}')">
      <td>${userCell}</td>
      <td class="num">${recCell}</td>
      <td class="num">${keepCell}</td>
      <td class="num">${calls || muted('0')}</td>
      <td class="num">${visits || muted('0')}</td>
      <td class="num">${escs ? NX.badge(String(escs), 'warning') : muted('0')}</td>
      <td class="num">${unCell}</td>
    </tr>`;
  }).join('');

  body.innerHTML = NX.card(
    `<table class="nx-table nx-table--flush">
      <thead><tr>
        <th>Officer</th>
        <th class="num">Recovered${NX.infoTip(recTip)}</th>
        <th class="num">Keep-rate${NX.infoTip(keepTip)}</th>
        <th class="num">Calls</th>
        <th class="num">Visits</th>
        <th class="num">Escalations</th>
        <th class="num">Untouched</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table>`, { flush: true });
}

/* ── Detail drawer: full per-officer breakdown ──────────────────────────────── */
function _teamDrawer(userId) {
  const r = (_teamRows || []).find(x => String(x.user_id) === String(userId));
  if (!r) return;

  const projects  = Array.isArray(r.projects) ? r.projects : [];
  const outstanding = Number(r.outstanding) || 0;
  const overdue     = Number(r.overdue) || 0;
  const recovered   = Number(r.recovered) || 0;
  const rOld = Number(r.recovered_old) || 0, rCur = Number(r.recovered_current) || 0, rDead = Number(r.recovered_dead) || 0;
  const pa          = Number(r.pending_approvals) || 0;
  const calls       = Number(r.calls) || 0;
  const visits      = Number(r.visits) || 0;
  const escs        = Number(r.escalations) || 0;
  const made        = Number(r.promises_made) || 0;
  const kept        = Number(r.promises_kept) || 0;
  const matured     = Number(r.promises_matured) || 0;
  const un          = Number(r.untouched_overdue) || 0;
  const rr          = _teamRange();
  const periodLbl   = rr.from === rr.to ? rr.from : (rr.from + ' → ' + rr.to);

  const lbl = (t) => `<div style="font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin:18px 0 10px">${esc(t)}</div>`;

  // Portfolio (as-of today)
  const portfolio = `<div class="dx-dstats">
    <div class="dx-dstat"><div class="dx-dstat-l">Total Outstanding</div><div class="dx-dstat-v">${_teamMoney(outstanding)}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Overdue</div><div class="dx-dstat-v" style="${overdue > 0 ? 'color:#b91c1c' : ''}">${_teamMoney(overdue)}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Pending Approvals</div><div class="dx-dstat-v">${pa}</div></div>
  </div>`;

  // Collections recovered (period) — gross + FIFO split
  const collections = lbl('Recovered — ' + periodLbl) + `<div class="dx-dstats">
    <div class="dx-dstat"><div class="dx-dstat-l">Recovered (gross)</div><div class="dx-dstat-v">${_teamMoney(recovered)}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">from Arrears (old)</div><div class="dx-dstat-v">${_teamMoney(rOld)}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">from Current dues</div><div class="dx-dstat-v">${_teamMoney(rCur)}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">of which Dead (&gt;90d)</div><div class="dx-dstat-v">${_teamMoney(rDead)}</div></div>
  </div>`;

  // Activity (period)
  const activity = lbl('Activity — ' + periodLbl) + `<div class="dx-dstats">
    <div class="dx-dstat"><div class="dx-dstat-l">Calls Logged</div><div class="dx-dstat-v">${calls}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Field Visits</div><div class="dx-dstat-v">${visits}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Escalations Opened</div><div class="dx-dstat-v">${escs}</div></div>
  </div>`;

  // Promise quality — dual keep-rate
  const fair   = r.keep_rate_matured, strict = r.keep_rate_made;
  const quality = lbl('Promise quality') + `<div class="dx-dstats">
    <div class="dx-dstat"><div class="dx-dstat-l">Made</div><div class="dx-dstat-v">${made}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Kept</div><div class="dx-dstat-v">${kept}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Keep-rate (fair)</div><div class="dx-dstat-v">${_teamPct(fair)}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Keep-rate (strict)</div><div class="dx-dstat-v">${_teamPct(strict)}</div></div>
  </div>`
    + `<div style="font-size:11.5px;color:var(--text-muted);margin-top:8px">Fair = kept ÷ ${matured} matured · Strict = kept ÷ ${made} made</div>`;

  // Neglect
  const neglect = lbl('Neglected accounts')
    + (un > 0
      ? `<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid rgba(220,38,38,.30);border-radius:10px;background:rgba(220,38,38,.06)">
           ${DX.statusChip(String(un), 'danger')}
           <span style="font-size:12.5px;color:var(--text-primary)">overdue account${un === 1 ? '' : 's'} with no contact in the last 14 days</span>
         </div>`
      : `<div style="font-size:12.5px;color:var(--text-muted);padding:6px 0">All overdue accounts have been contacted in the last 14 days.</div>`);

  // Projects
  const projBlock = lbl('Assigned projects')
    + (projects.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${projects.map(p => `<span class="dx-status neutral">${esc(p)}</span>`).join('')}</div>`
      : `<div style="font-size:12.5px;color:var(--text-muted);padding:6px 0">No projects assigned.</div>`);

  // Monthly target — placeholder filled async by _teamLoadTarget after the drawer mounts.
  const targetSection = lbl("This Month's Target")
    + `<div id="team-target-block"><div style="font-size:12.5px;color:var(--text-muted)">Loading target…</div></div>`;

  const footer = `<button class="btn btn-g btn-sm" onclick="document.querySelector('.dx-drawer-x').click()">Close</button>`;

  DX.drawer({
    eyebrow: 'Recovery Officer',
    title: r.full_name || '—',
    subtitle: projects.length ? projects.join(', ') : 'No projects assigned',
    body: portfolio + collections + targetSection + activity + quality + neglect + projBlock,
    footer
  });

  // Fire-and-forget: fetch + render the target block into the now-mounted drawer.
  _teamLoadTarget(String(r.user_id));
}

/* ── Monthly target (admin set/edit; everyone reads) ─────────────────────────── */
// Reuses _teamMoney (PKR Western formatter), .dx-dstats/.dx-dstat, .btn variants,
// toast(msg,kind), and the same admin check as rTeam (S.role owner/admin).
// Compared against the row's `recovered` for the selected period.
let _teamTargetCache = {};

function _teamIsAdmin() {
  return !!(typeof S !== 'undefined' && S && (S.role === 'owner' || S.role === 'admin'));
}

function _teamPeriod() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

async function _teamLoadTarget(userId) {
  const box = document.getElementById('team-target-block');
  if (!box) return;
  const { year, month } = _teamPeriod();
  let target = null;
  try {
    const { data, error } = await supabase.rpc('get_officer_target', { p_data: { p_user_id: userId, year, month } });
    if (error) throw error;
    if (data && data.success) target = data.target || null;
  } catch (e) {
    // On read failure, fall through and render the no-target view (recovered only).
  }
  _teamTargetRender(userId, target);
}

function _teamTargetRender(userId, target) {
  const box = document.getElementById('team-target-block');
  if (!box) return;
  const r = (_teamRows || []).find(x => String(x.user_id) === String(userId));
  if (!r) return;

  const collected = Number(r.recovered) || 0;     // recovered for the selected period
  const tAmt      = target ? (Number(target.target_amount) || 0) : 0;
  const notes     = (target && target.notes) ? String(target.notes) : '';
  _teamTargetCache[String(userId)] = { amount: tAmt, notes };

  let html;
  if (tAmt > 0) {
    const pct = Math.round((collected / tAmt) * 100);   // tAmt>0 guards divide-by-zero
    html = `<div class="dx-dstats">
        <div class="dx-dstat"><div class="dx-dstat-l">Target</div><div class="dx-dstat-v">${_teamMoney(tAmt)}</div></div>
        <div class="dx-dstat"><div class="dx-dstat-l">Recovered (period)</div><div class="dx-dstat-v">${_teamMoney(collected)}</div></div>
        <div class="dx-dstat"><div class="dx-dstat-l">Achieved</div><div class="dx-dstat-v">${pct}%</div></div>
      </div>`
      + (notes ? `<div style="font-size:12.5px;color:var(--text-muted);margin-top:8px">${esc(notes)}</div>` : '');
  } else {
    html = `<div style="font-size:12.5px;color:var(--text-muted);padding:2px 0 8px">No monthly target set</div>`
      + `<div class="dx-dstats"><div class="dx-dstat"><div class="dx-dstat-l">Recovered (period)</div><div class="dx-dstat-v">${_teamMoney(collected)}</div></div></div>`;
  }

  if (_teamIsAdmin()) {
    html += `<div style="margin-top:10px"><button class="btn btn-gh btn-sm" onclick="_teamTargetEdit('${esc(String(userId))}')">${tAmt > 0 ? 'Edit target' : 'Set target'}</button></div>`;
  }
  box.innerHTML = html;
}

function _teamTargetEdit(userId) {
  if (!_teamIsAdmin()) return;
  const box = document.getElementById('team-target-block');
  if (!box) return;
  const cur = _teamTargetCache[String(userId)] || { amount: 0, notes: '' };
  box.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;max-width:340px">
      <label style="font-size:11px;color:var(--text-muted);font-weight:600">Target amount (PKR)
        <input id="team-tgt-amt" class="inp" type="number" min="0" step="1" inputmode="numeric" value="${cur.amount || ''}" style="width:100%;margin-top:4px">
      </label>
      <label style="font-size:11px;color:var(--text-muted);font-weight:600">Notes (optional)
        <input id="team-tgt-notes" class="inp" type="text" maxlength="200" value="${esc(cur.notes || '')}" style="width:100%;margin-top:4px">
      </label>
      <div id="team-tgt-err" style="font-size:12px;color:#b91c1c;display:none"></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-p btn-sm" onclick="_teamTargetSave('${esc(String(userId))}')">Save</button>
        <button class="btn btn-g btn-sm" onclick="_teamLoadTarget('${esc(String(userId))}')">Cancel</button>
      </div>
    </div>`;
}

async function _teamTargetSave(userId) {
  if (!_teamIsAdmin()) return;
  const box     = document.getElementById('team-target-block');
  const amtEl   = document.getElementById('team-tgt-amt');
  const notesEl = document.getElementById('team-tgt-notes');
  const errEl   = document.getElementById('team-tgt-err');
  const saveBtn = box ? box.querySelector('.btn-p') : null;

  const raw     = parseInt(amtEl && amtEl.value, 10);
  const target_amount = isNaN(raw) ? 0 : Math.max(0, raw);   // plain rupees, integer
  const notes   = ((notesEl && notesEl.value) || '').trim();
  const { year, month } = _teamPeriod();

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  try {
    const { data, error } = await supabase.rpc('set_officer_target_v2', {
      p_data: { p_user_id: userId, year, month, target_amount, notes }
    });
    if (error) throw error;
    if (!data || !data.success) throw new Error((data && (data.message || data.error)) || 'Could not save target');
    if (typeof toast === 'function') toast('Monthly target saved', 'ok');
    await _teamLoadTarget(userId);   // re-fetch + re-render read-only block
  } catch (e) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    if (errEl) { errEl.style.display = ''; errEl.textContent = e.message || 'Could not save target'; }
    if (typeof toast === 'function') toast(e.message || 'Could not save target', 'err');
  }
}

// ══ TEAM PERFORMANCE (Admin-only) ═════════════════════════════════════════════
// One row per active recovery user — activity, collections, neglected accounts.
// Clickable rows open a DX slide-over drawer with the full per-officer breakdown.
// Data: get_team_performance_lite(p_company_id) — UNCHANGED. Built on the shared DX
// table + DX.drawer layer (helpers.js / components.css), not a bespoke table system.
// ═════════════════════════════════════════════════════════════════════════════
'use strict';

let _teamRows = [];

async function rTeam() {
  const el = document.getElementById('pg-team');
  if (!el) return;

  // Role guard — Admin / Owner only
  if (!S || (S.role !== 'owner' && S.role !== 'admin')) {
    if (typeof nav === 'function') nav('dashboard');
    return;
  }

  el.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l"><h2>Team Performance</h2><p>Per-officer activity, collections, and neglected accounts</p></div>
    </div>
    <div id="team-body"></div>
  </div>`;

  await _teamLoad();
}

async function _teamLoad() {
  const body = document.getElementById('team-body');
  if (!body) return;
  body.innerHTML = `<div class="card"><div class="empty" style="padding:32px"><div class="es" style="color:var(--t3)">Loading team performance…</div></div></div>`;

  try {
    const { data, error } = await supabase.rpc('get_team_performance_lite', { p_company_id: S.cid });
    if (error) throw error;
    _teamRows = Array.isArray(data) ? data : [];
    _teamRender(_teamRows);
  } catch (e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="et">Could not load team performance</div><div class="es">${esc(e.message)}</div></div></div>`;
  }
}

// PKR money — reuse the app-wide en-IN (lakh/crore) formatter; never invent one.
function _teamMoney(v) {
  return (window.DX && DX.money) ? DX.money(v) : 'PKR ' + (typeof fM === 'function' ? fM(Number(v) || 0) : (Number(v) || 0).toLocaleString('en-IN'));
}

function _teamRender(rows) {
  const body = document.getElementById('team-body');
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `<div class="dx-wrap">` + DX.empty({
      icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      title: 'No recovery users',
      sub: 'No active recovery users found for this company.'
    }) + `</div>`;
    return;
  }

  const trs = rows.map(r => {
    const nm       = r.full_name || '—';
    const mono     = (String(nm).trim()[0] || '?').toUpperCase();
    const projects = Array.isArray(r.projects) ? r.projects : [];
    const projCell = projects.length
      ? esc(projects.join(', '))
      : '<span style="color:var(--text-muted)">—</span>';

    const calls    = Number(r.calls_this_month) || 0;
    const made     = Number(r.promises_made) || 0;
    const kept     = Number(r.promises_kept) || 0;
    const broken   = Number(r.promises_broken) || 0;
    const promCell = made === 0
      ? '<span style="color:var(--text-muted)">—</span>'
      : `<span title="kept / broken">${kept} / ${broken}</span>`;

    const collected = Number(r.collected_this_month) || 0;

    const un        = Number(r.untouched_overdue) || 0;
    const unCell    = un > 0 ? DX.statusChip(String(un), 'danger') : '<span style="color:var(--text-muted)">0</span>';

    const pa        = Number(r.pending_approvals) || 0;
    const paCell    = pa > 0 ? DX.statusChip(String(pa), 'warn') : '<span style="color:var(--text-muted)">0</span>';

    return `<tr class="clickable" data-search="${esc((nm + ' ' + projects.join(' ')).toLowerCase())}" onclick="_teamDrawer('${esc(String(r.user_id))}')">
      <td data-v="${esc(String(nm).toLowerCase())}">
        <span class="dx-cell"><span class="dx-mono">${esc(mono)}</span>
          <span class="dx-cell-main"><span class="dx-cell-t" style="font-weight:600">${esc(nm)}</span></span>
        </span>
      </td>
      <td class="muted" style="max-width:260px;white-space:normal" data-v="${esc(projects.join(', ').toLowerCase())}">${projCell}</td>
      <td class="num" data-v="${calls}">${calls}</td>
      <td class="num" data-v="${made}">${promCell}</td>
      <td class="num" data-v="${collected}">${_teamMoney(collected)}</td>
      <td class="num" data-v="${un}">${unCell}</td>
      <td class="num" data-v="${pa}">${paCell}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `<div class="dx-wrap" id="team-wrap"><div class="dx-scroll"><table class="dx-table" id="team-table">
    <thead><tr>
      <th data-sort="text">Officer</th>
      <th data-sort="text">Projects</th>
      <th class="num" data-sort="num">Calls</th>
      <th class="num" data-sort="num">Promises</th>
      <th class="num" data-sort="num">Collected</th>
      <th class="num" data-sort="num">Untouched</th>
      <th class="num" data-sort="num">Approvals</th>
    </tr></thead>
    <tbody>${trs}</tbody>
  </table></div></div>`;

  if (window.DX) {
    DX.density(document.getElementById('team-wrap'));
    DX.enhance(document.getElementById('team-table'), {});
  }
}

/* ── Detail drawer: full per-officer breakdown ──────────────────────────────── */
function _teamDrawer(userId) {
  const r = (_teamRows || []).find(x => String(x.user_id) === String(userId));
  if (!r) return;

  const projects  = Array.isArray(r.projects) ? r.projects : [];
  const outstanding = Number(r.outstanding) || 0;
  const overdue     = Number(r.overdue) || 0;
  const collected   = Number(r.collected_this_month) || 0;
  const pa          = Number(r.pending_approvals) || 0;
  const calls       = Number(r.calls_this_month) || 0;
  const made        = Number(r.promises_made) || 0;
  const kept        = Number(r.promises_kept) || 0;
  const broken      = Number(r.promises_broken) || 0;
  const un          = Number(r.untouched_overdue) || 0;
  const resolved    = kept + broken;
  const keptRate    = resolved > 0 ? Math.round((kept / resolved) * 100) + '%' : '—';

  const lbl = (t) => `<div style="font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin:18px 0 10px">${esc(t)}</div>`;

  // Portfolio
  const portfolio = `<div class="dx-dstats">
    <div class="dx-dstat"><div class="dx-dstat-l">Total Outstanding</div><div class="dx-dstat-v">${_teamMoney(outstanding)}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Overdue</div><div class="dx-dstat-v" style="${overdue > 0 ? 'color:#b91c1c' : ''}">${_teamMoney(overdue)}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Collected (this month)</div><div class="dx-dstat-v">${_teamMoney(collected)}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Pending Approvals</div><div class="dx-dstat-v">${pa}</div></div>
  </div>`;

  // Activity
  const activity = lbl('Activity — this month') + `<div class="dx-dstats">
    <div class="dx-dstat"><div class="dx-dstat-l">Calls Logged</div><div class="dx-dstat-v">${calls}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Promises Made</div><div class="dx-dstat-v">${made}</div></div>
  </div>`;

  // Promise quality (past-due)
  const quality = lbl('Promise quality — past-due') + `<div class="dx-dstats">
    <div class="dx-dstat"><div class="dx-dstat-l">Kept</div><div class="dx-dstat-v">${kept}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Broken</div><div class="dx-dstat-v" style="${broken > 0 ? 'color:#b91c1c' : ''}">${broken}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Kept Rate</div><div class="dx-dstat-v">${keptRate}</div></div>
  </div>`;

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
    body: portfolio + targetSection + activity + quality + neglect + projBlock,
    footer
  });

  // Fire-and-forget: fetch + render the target block into the now-mounted drawer.
  _teamLoadTarget(String(r.user_id));
}

/* ── Monthly target (admin set/edit; everyone reads) ─────────────────────────── */
// Reuses _teamMoney (PKR en-IN formatter), .dx-dstats/.dx-dstat, .btn variants,
// toast(msg,kind), and the same admin check as rTeam (S.role owner/admin).
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
    // On read failure, fall through and render the no-target view (collected only).
  }
  _teamTargetRender(userId, target);
}

function _teamTargetRender(userId, target) {
  const box = document.getElementById('team-target-block');
  if (!box) return;
  const r = (_teamRows || []).find(x => String(x.user_id) === String(userId));
  if (!r) return;

  const collected = Number(r.collected_this_month) || 0;
  const tAmt      = target ? (Number(target.target_amount) || 0) : 0;
  const notes     = (target && target.notes) ? String(target.notes) : '';
  _teamTargetCache[String(userId)] = { amount: tAmt, notes };

  let html;
  if (tAmt > 0) {
    const pct = Math.round((collected / tAmt) * 100);   // tAmt>0 guards divide-by-zero
    html = `<div class="dx-dstats">
        <div class="dx-dstat"><div class="dx-dstat-l">Target</div><div class="dx-dstat-v">${_teamMoney(tAmt)}</div></div>
        <div class="dx-dstat"><div class="dx-dstat-l">Collected</div><div class="dx-dstat-v">${_teamMoney(collected)}</div></div>
        <div class="dx-dstat"><div class="dx-dstat-l">Achieved</div><div class="dx-dstat-v">${pct}%</div></div>
      </div>`
      + (notes ? `<div style="font-size:12.5px;color:var(--text-muted);margin-top:8px">${esc(notes)}</div>` : '');
  } else {
    html = `<div style="font-size:12.5px;color:var(--text-muted);padding:2px 0 8px">No monthly target set</div>`
      + `<div class="dx-dstats"><div class="dx-dstat"><div class="dx-dstat-l">Collected this month</div><div class="dx-dstat-v">${_teamMoney(collected)}</div></div></div>`;
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

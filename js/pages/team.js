// ══ TEAM PERFORMANCE LITE (Admin-only) ════════════════════════════════════════
// One row per active recovery user. 6 columns, no charts/trends/links.
// RPC: get_team_performance_lite(p_company_id)
// ═════════════════════════════════════════════════════════════════════════════
'use strict';

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
      <div class="ph-l"><h2>Team Performance</h2><p>Recovery team — outstanding, overdue, collections and pending approvals</p></div>
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
    const rows = Array.isArray(data) ? data : [];
    _teamRender(rows);
  } catch (e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="et">Could not load team performance</div><div class="es">${esc(e.message)}</div></div></div>`;
  }
}

function _teamRender(rows) {
  const body = document.getElementById('team-body');
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `<div class="card"><div class="empty" style="padding:40px">
      <div class="et">No recovery users</div><div class="es">No active recovery users found for this company.</div>
    </div></div>`;
    return;
  }

  const money = (v) => (typeof fM === 'function' ? 'PKR ' + fM(Number(v) || 0) : 'PKR ' + (Number(v) || 0).toLocaleString());

  const tr = rows.map(r => {
    const projects = Array.isArray(r.projects) ? r.projects : [];
    const projCell = projects.length
      ? esc(projects.join(', '))
      : '<span style="color:var(--t3)">—</span>';
    const pending = Number(r.pending_approvals) || 0;
    return `<tr>
      <td style="font-size:13px;font-weight:600;color:var(--text)">${esc(r.full_name || '—')}</td>
      <td style="font-size:12px;color:var(--t2);max-width:280px">${projCell}</td>
      <td class="r mono" style="font-size:12px">${money(r.outstanding)}</td>
      <td class="r mono" style="font-size:12px;color:${(Number(r.overdue)||0) > 0 ? 'var(--err)' : 'var(--t2)'}">${money(r.overdue)}</td>
      <td class="r mono" style="font-size:12px">${money(r.collected_this_month)}</td>
      <td class="r mono" style="font-size:12px">${pending > 0 ? `<b>${pending}</b>` : '0'}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `<div class="card" style="padding:0;overflow:hidden">
    <div class="tw"><table class="t">
      <thead><tr>
        <th>Recovery User</th>
        <th>Assigned Projects</th>
        <th class="r">Total Outstanding</th>
        <th class="r">Overdue Amount</th>
        <th class="r">Collected This Month</th>
        <th class="r">Pending Approvals</th>
      </tr></thead>
      <tbody>${tr}</tbody>
    </table></div>
  </div>`;
}

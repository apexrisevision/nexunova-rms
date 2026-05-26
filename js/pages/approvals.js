// ══ APPROVALS QUEUE (Admin maker-checker) ════════════════════════════════════
// RPCs: get_pending_approvals, get_approval_history, approve_request, reject_request
// Admin/Owner only. Two tabs: Pending | History.
// ═════════════════════════════════════════════════════════════════════════════

let _apTab      = 'pending';
let _apPending  = [];
let _apHistory  = [];
let _apDecision = null;   // { id, action:'approve'|'reject', title, type }

const _AP_TYPE = {
  discount:       ['#6366f1', 'Discount'],
  price_revision: ['#8b5cf6', 'Price Revision'],
  cancellation:   ['#ef4444', 'Cancellation'],
  transfer:       ['#f59e0b', 'Transfer'],
  refund:         ['#0ea5e9', 'Refund'],
  dnd:            ['#64748b', 'DND'],
  blacklist:      ['#dc2626', 'Blacklist'],
};

function _apTypeBadge(t) {
  const [c, l] = _AP_TYPE[t] || ['#94a3b8', t || '—'];
  return `<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;background:${c}1a;color:${c};border:1px solid ${c}40;text-transform:uppercase;letter-spacing:.4px">${esc(l)}</span>`;
}

function _apRelTime(ts) {
  if (!ts) return '—';
  try {
    const diff = Date.now() - new Date(ts).getTime();
    if (isNaN(diff)) return '—';
    const m = Math.floor(diff/60000), h = Math.floor(diff/3600000), d = Math.floor(diff/86400000);
    if (diff < 60000) return 'just now';
    if (m < 60) return m + 'm ago';
    if (h < 24) return h + 'h ago';
    if (d < 30) return d + 'd ago';
    return fD(String(ts).slice(0,10));
  } catch { return '—'; }
}

function _apEntityRef(r) {
  if (!r.entity_table) return '—';
  const short = r.entity_id ? String(r.entity_id).slice(0, 8) : '';
  return `<span style="font-family:monospace;font-size:11px;color:var(--t3)">${esc(r.entity_table)}${short ? ' · ' + short : ''}</span>`;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
async function rApprovals() {
  const el = document.getElementById('pg-approvals');
  if (!el) return;

  // Role guard — Admin / Owner only
  if (!S || (S.role !== 'owner' && S.role !== 'admin')) {
    if (typeof nav === 'function') nav('dashboard');
    return;
  }

  el.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l"><h2>Approvals</h2><p>Maker-checker requests — review, then approve or reject with a comment</p></div>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--line)">
      <button id="ap-tab-pending" class="ap-tab" onclick="_apSetTab('pending')"
        style="background:none;border:none;border-bottom:2px solid transparent;padding:9px 14px;font-size:13px;font-weight:600;color:var(--t3);cursor:pointer;font-family:inherit">Pending</button>
      <button id="ap-tab-history" class="ap-tab" onclick="_apSetTab('history')"
        style="background:none;border:none;border-bottom:2px solid transparent;padding:9px 14px;font-size:13px;font-weight:600;color:var(--t3);cursor:pointer;font-family:inherit">History</button>
    </div>
    <div id="ap-body"></div>
  </div>`;

  _apEnsureModal();
  _apSetTab(_apTab);
}

function _apSetTab(t) {
  _apTab = t;
  ['pending','history'].forEach(k => {
    const b = document.getElementById('ap-tab-' + k);
    if (!b) return;
    const on = k === t;
    b.style.color        = on ? 'var(--brand)' : 'var(--t3)';
    b.style.borderBottom = on ? '2px solid var(--brand)' : '2px solid transparent';
  });
  if (t === 'pending') _apLoadPending(); else _apLoadHistory();
}

// ─── PENDING ─────────────────────────────────────────────────────────────────
async function _apLoadPending() {
  const body = document.getElementById('ap-body');
  if (!body) return;
  body.innerHTML = `<div class="empty" style="padding:32px"><div class="es" style="color:var(--t3)">Loading pending requests…</div></div>`;
  try {
    const { data, error } = await supabase.rpc('get_pending_approvals', { p_filters: {} });
    if (error) throw error;
    if (!data || !data.success) throw new Error(data?.error || 'Failed to load');
    _apPending = Array.isArray(data.rows) ? data.rows : [];
    _apRenderPending();
  } catch (e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="et">Could not load pending requests</div><div class="es">${esc(e.message)}</div></div></div>`;
  }
}

function _apRenderPending() {
  const body = document.getElementById('ap-body');
  if (!body) return;

  if (!_apPending.length) {
    body.innerHTML = `<div class="card"><div class="empty" style="padding:40px">
      <div class="ei"><svg width="34" height="34" fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
      <div class="et">No pending approvals</div><div class="es">All caught up — nothing awaiting your decision.</div>
    </div></div>`;
    return;
  }

  const rows = _apPending.map(r => `
    <tr>
      <td>${_apTypeBadge(r.request_type)}</td>
      <td>
        <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(r.title || '—')}</div>
        ${r.description ? `<div style="font-size:11px;color:var(--t3);margin-top:2px;max-width:340px">${esc(r.description)}</div>` : ''}
        <div style="margin-top:3px">${_apEntityRef(r)}</div>
      </td>
      <td class="r mono" style="font-size:12px">${r.amount != null ? 'PKR ' + fM(r.amount) : '—'}</td>
      <td style="font-size:12px">${esc(r.requested_by_name || '—')}</td>
      <td style="font-size:11px;color:var(--t3);white-space:nowrap">${_apRelTime(r.requested_at)}</td>
      <td style="white-space:nowrap;text-align:right">
        <button class="btn btn-g btn-xs" onclick="_apOpenDecision('${r.id}','approve')">Approve</button>
        <button class="btn btn-gh btn-xs" style="color:var(--err);border-color:var(--err)" onclick="_apOpenDecision('${r.id}','reject')">Reject</button>
      </td>
    </tr>`).join('');

  body.innerHTML = `<div class="card" style="padding:0;overflow:hidden">
    <div class="tw"><table class="t">
      <thead><tr>
        <th>Type</th><th>Request</th><th class="r">Amount</th><th>Requested By</th><th>Submitted</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────
async function _apLoadHistory() {
  const body = document.getElementById('ap-body');
  if (!body) return;
  body.innerHTML = `<div class="empty" style="padding:32px"><div class="es" style="color:var(--t3)">Loading history…</div></div>`;
  try {
    const { data, error } = await supabase.rpc('get_approval_history', { p_filters: { limit: 200 } });
    if (error) throw error;
    if (!data || !data.success) throw new Error(data?.error || 'Failed to load');
    _apHistory = Array.isArray(data.rows) ? data.rows : [];
    _apRenderHistory();
  } catch (e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="et">Could not load history</div><div class="es">${esc(e.message)}</div></div></div>`;
  }
}

function _apStatusBadge(s) {
  const map = { approved: ['#22c55e','Approved'], rejected: ['#ef4444','Rejected'], pending: ['#f59e0b','Pending'], cancelled: ['#94a3b8','Cancelled'] };
  const [c, l] = map[s] || ['#94a3b8', s || '—'];
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${c}22;color:${c}">${esc(l)}</span>`;
}

function _apRenderHistory() {
  const body = document.getElementById('ap-body');
  if (!body) return;

  const decided = _apHistory.filter(r => r.status !== 'pending');
  if (!decided.length) {
    body.innerHTML = `<div class="card"><div class="empty" style="padding:40px"><div class="et">No decided requests yet</div><div class="es">Approved and rejected requests will appear here.</div></div></div>`;
    return;
  }

  const rows = decided.map(r => `
    <tr>
      <td>${_apTypeBadge(r.request_type)}</td>
      <td><div style="font-size:13px;font-weight:600;color:var(--text)">${esc(r.title || '—')}</div></td>
      <td>${_apStatusBadge(r.status)}</td>
      <td style="font-size:12px">${esc(r.decided_by_name || '—')}</td>
      <td style="font-size:11px;color:var(--t3);white-space:nowrap">${r.decided_at ? fD(String(r.decided_at).slice(0,10)) : '—'}</td>
      <td style="font-size:11px;color:var(--t2);max-width:280px">${r.decision_comment ? esc(r.decision_comment) : '<span style="color:var(--t3)">—</span>'}</td>
    </tr>`).join('');

  body.innerHTML = `<div class="card" style="padding:0;overflow:hidden">
    <div class="tw"><table class="t">
      <thead><tr>
        <th>Type</th><th>Request</th><th>Decision</th><th>Decided By</th><th>Date</th><th>Decision Comment</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

// ─── DECISION MODAL ──────────────────────────────────────────────────────────
function _apEnsureModal() {
  if (document.getElementById('m-approval-decision')) return;
  const div = document.createElement('div');
  div.id = 'm-approval-decision';
  div.className = 'mov';
  div.innerHTML = `
    <div class="md" style="max-width:520px">
      <div class="mh">
        <div><h3 id="ap-dec-title">Decision</h3><p id="ap-dec-sub">—</p></div>
        <button class="mx" onclick="cm('m-approval-decision')">✕</button>
      </div>
      <div class="mb">
        <div id="ap-dec-thread" style="margin-bottom:12px"></div>
        <div class="fr">
          <label class="fl" id="ap-dec-lbl">Comment *</label>
          <textarea id="ap-dec-comment" class="inp-light" rows="3"
            placeholder="Required — explain your decision" oninput="_apClearErr()"></textarea>
          <div id="ap-dec-err" style="font-size:11px;color:var(--err);margin-top:4px"></div>
        </div>
      </div>
      <div class="mf">
        <button class="btn btn-gh" onclick="cm('m-approval-decision')">Cancel</button>
        <button id="ap-dec-btn" class="btn btn-g" onclick="_apSubmitDecision()" style="flex:1">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(div);
}

function _apClearErr() {
  const e = document.getElementById('ap-dec-err');
  if (e) e.textContent = '';
  document.getElementById('ap-dec-comment')?.classList.remove('inp-err');
}

async function _apOpenDecision(id, action) {
  const r = _apPending.find(x => x.id === id);
  if (!r) return;
  _apDecision = { id, action, title: r.title || '', type: r.request_type };

  _apEnsureModal();
  const isApprove = action === 'approve';
  document.getElementById('ap-dec-title').textContent = isApprove ? 'Approve Request' : 'Reject Request';
  document.getElementById('ap-dec-sub').innerHTML = `${_apTypeBadge(r.request_type)} &nbsp; ${esc(r.title || '')}`;
  document.getElementById('ap-dec-lbl').textContent = isApprove ? 'Approval comment *' : 'Rejection reason *';
  document.getElementById('ap-dec-comment').value = '';
  _apClearErr();
  const btn = document.getElementById('ap-dec-btn');
  btn.textContent = isApprove ? 'Approve' : 'Reject';
  btn.className = 'btn btn-g';
  if (!isApprove) { btn.style.background = 'var(--err)'; btn.style.borderColor = 'var(--err)'; btn.style.color = '#fff'; }
  else            { btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = ''; }

  // Maker's justification thread (loaded so the checker reads it before deciding)
  const thread = document.getElementById('ap-dec-thread');
  thread.innerHTML = `<div style="font-size:11px;color:var(--t3)">Loading request detail…</div>`;
  om('m-approval-decision');
  try {
    const { data } = await supabase.rpc('get_approval_history', { p_filters: { request_id: id } });
    const comments = (data && Array.isArray(data.comments)) ? data.comments : [];
    const req      = data && data.request ? data.request : r;
    const lines = comments.map(c => `
      <div style="padding:7px 0;border-bottom:1px solid var(--line)">
        <div style="font-size:11px;color:var(--t3)"><b style="color:var(--t2)">${esc(c.author_name || '—')}</b> · ${esc(c.action || 'comment')} · ${_apRelTime(c.created_at)}</div>
        <div style="font-size:12px;color:var(--text);margin-top:2px">${esc(c.comment || '')}</div>
      </div>`).join('');
    thread.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 14px">
        <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Request Detail</div>
        ${req.description ? `<div style="font-size:12px;color:var(--t2);margin-bottom:6px">${esc(req.description)}</div>` : ''}
        ${req.amount != null ? `<div style="font-size:12px;color:var(--t2);margin-bottom:6px">Amount: <b>PKR ${fM(req.amount)}</b></div>` : ''}
        <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:8px 0 2px">Maker Justification</div>
        ${lines || '<div style="font-size:12px;color:var(--t3)">No comment on file.</div>'}
      </div>`;
  } catch (e) {
    thread.innerHTML = `<div style="font-size:11px;color:var(--err)">Could not load detail: ${esc(e.message)}</div>`;
  }
}

async function _apSubmitDecision() {
  if (!_apDecision) return;
  const comment = (document.getElementById('ap-dec-comment')?.value || '').trim();
  if (!comment) {
    const e = document.getElementById('ap-dec-err');
    if (e) e.textContent = 'A comment is required.';
    document.getElementById('ap-dec-comment')?.classList.add('inp-err');
    document.getElementById('ap-dec-comment')?.focus();
    return;
  }

  const btn = document.getElementById('ap-dec-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const rpc = _apDecision.action === 'approve' ? 'approve_request' : 'reject_request';
    const { data, error } = await supabase.rpc(rpc, { p_request_id: _apDecision.id, p_comment: comment });
    if (error) throw error;
    if (!data || !data.success) throw new Error(data?.message || data?.error || 'Decision failed');

    cm('m-approval-decision');
    toast(_apDecision.action === 'approve' ? 'Request approved & applied' : 'Request rejected', 'ok');

    // Remove from the pending list + refresh sidebar badge
    _apPending = _apPending.filter(x => x.id !== _apDecision.id);
    _apDecision = null;
    _apRenderPending();
    if (typeof refreshApprovalsBadge === 'function') refreshApprovalsBadge();
  } catch (e) {
    const er = document.getElementById('ap-dec-err');
    if (er) er.textContent = e.message || 'Decision failed';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = _apDecision ? (_apDecision.action === 'approve' ? 'Approve' : 'Reject') : 'Confirm'; }
  }
}

// ─── Sidebar pending badge ───────────────────────────────────────────────────
// Sets window._approvalsPending then re-renders the sidebar (admin only).
async function refreshApprovalsBadge() {
  if (!S || (S.role !== 'owner' && S.role !== 'admin')) return;
  try {
    const { data } = await supabase.rpc('get_pending_approvals', { p_filters: {} });
    window._approvalsPending = (data && Array.isArray(data.rows)) ? data.rows.length : 0;
  } catch { window._approvalsPending = 0; }
  if (typeof buildSB === 'function') buildSB();
}

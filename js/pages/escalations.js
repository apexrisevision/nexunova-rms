// ── Escalation Register ───────────────────────────────────────────────────────

let _escData = null;

const ESC_LEVELS = { 1:'L1 – Officer', 2:'L2 – Manager', 3:'L3 – Director', 4:'L4 – CEO/Legal' };

async function rEscalations() {
  const el = document.getElementById('pg-escalations');
  if (!el) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  el.innerHTML = `
  <div class="ph">
    <div><h2>Escalation Register</h2><p>Cases escalated to higher management for resolution</p></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-g btn-sm" onclick="_escLoad()">↺ Refresh</button>
      ${isA ? `<button class="btn btn-p btn-sm" onclick="_escOpenModal()">+ New Escalation</button>` : ''}
    </div>
  </div>
  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <button class="btn btn-gh btn-xs esc-ftab on" onclick="_escFilter('open',this)">Open</button>
    <button class="btn btn-gh btn-xs esc-ftab"    onclick="_escFilter('resolved',this)">Resolved</button>
    <button class="btn btn-gh btn-xs esc-ftab"    onclick="_escFilter('all',this)">All</button>
  </div>
  <div id="esc-body"><div class="card"><div class="cb"><div class="empty"><div class="ei">⏳</div><div class="et">Loading…</div></div></div></div></div>

  <!-- Modal -->
  <div id="esc-modal" class="mo" style="display:none" onclick="if(event.target===this)_escCloseModal()">
    <div class="mo-box" style="max-width:500px">
      <div class="mo-hd"><span id="esc-modal-title">New Escalation</span><button class="mo-cl" onclick="_escCloseModal()">✕</button></div>
      <div class="mo-bd">
        <div class="fg"><label class="fl">Client *</label>
          <select id="esc-client_id" class="fi"><option value="">— Select client —</option></select></div>
        <div class="fg"><label class="fl">Escalated From Level *</label>
          <select id="esc-from_level" class="fi">
            <option value="1">L1 – Officer</option><option value="2">L2 – Manager</option>
            <option value="3">L3 – Director</option>
          </select>
        </div>
        <div class="fg"><label class="fl">Escalated To Level *</label>
          <select id="esc-to_level" class="fi">
            <option value="2">L2 – Manager</option><option value="3">L3 – Director</option>
            <option value="4">L4 – CEO/Legal</option>
          </select>
        </div>
        <div class="fg"><label class="fl">Reason *</label>
          <textarea id="esc-reason" class="fi" rows="3" placeholder="Why was this case escalated?"></textarea></div>
        <div id="esc-modal-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="_escCloseModal()">Cancel</button>
        <button class="btn btn-p btn-sm" id="esc-save-btn" onclick="_escSave()">Escalate</button>
      </div>
    </div>
  </div>

  <!-- Resolve Modal -->
  <div id="esc-resolve-modal" class="mo" style="display:none" onclick="if(event.target===this)document.getElementById('esc-resolve-modal').style.display='none'">
    <div class="mo-box" style="max-width:420px">
      <div class="mo-hd"><span>Resolve Escalation</span><button class="mo-cl" onclick="document.getElementById('esc-resolve-modal').style.display='none'">✕</button></div>
      <div class="mo-bd">
        <div class="fg"><label class="fl">Resolution Note *</label>
          <textarea id="esc-resolution_note" class="fi" rows="3" placeholder="How was this resolved?"></textarea></div>
        <div id="esc-resolve-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="document.getElementById('esc-resolve-modal').style.display='none'">Cancel</button>
        <button class="btn btn-p btn-sm" id="esc-resolve-btn" onclick="_escResolveConfirm()">Mark Resolved</button>
      </div>
    </div>
  </div>`;

  await _escLoad();
  _escPopulateClients();
}

let _escCurFilter = 'open';
function _escFilter(f, el) {
  _escCurFilter = f;
  document.querySelectorAll('.esc-ftab').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  _escRender();
}

async function _escLoad() {
  const { data } = await supabase
    .from('escalations')
    .select(`*, clients(client_name, client_code)`)
    .eq('company_id', S.cid)
    .order('created_at', { ascending: false });
  _escData = data || [];
  _escRender();
}

function _escRender() {
  const el = document.getElementById('esc-body');
  if (!el) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  let rows = _escData;
  if (_escCurFilter === 'open')     rows = rows.filter(r => r.status === 'open');
  if (_escCurFilter === 'resolved') rows = rows.filter(r => r.status === 'resolved');

  if (!rows.length) {
    el.innerHTML = `<div class="card"><div class="cb"><div class="empty"><div class="ei">🚨</div><div class="et">No escalations in this filter</div></div></div></div>`;
    return;
  }

  const trs = rows.map(r => {
    const statusBadge = r.status === 'resolved'
      ? `<span class="badge ok">Resolved</span>`
      : `<span class="badge err">Open</span>`;
    return `<tr>
      <td>
        <div style="font-weight:700;font-size:13px">${esc(r.clients?.client_name || '—')}</div>
        <div style="font-size:11px;color:var(--t3)">${esc(r.clients?.client_code || '')}</div>
      </td>
      <td style="font-size:12px;color:var(--t3)">${esc(ESC_LEVELS[r.from_level] || r.from_level)}</td>
      <td style="font-size:12px;font-weight:700">${esc(ESC_LEVELS[r.to_level] || r.to_level)}</td>
      <td style="font-size:12px;max-width:200px">${esc(r.reason)}</td>
      <td>${statusBadge}</td>
      <td style="font-size:11px;color:var(--t3)">${r.created_at ? fD(r.created_at.split('T')[0]) : '—'}</td>
      ${isA ? `<td style="text-align:right">
        ${r.status === 'open' ? `<button class="btn btn-p btn-xs" onclick="_escOpenResolve('${r.id}')">Resolve</button>` : ''}
      </td>` : '<td></td>'}
    </tr>`;
  }).join('');

  el.innerHTML = `<div class="card"><div class="cb"><div class="tw"><table class="t">
    <thead><tr><th>Client</th><th>From</th><th>To</th><th>Reason</th><th>Status</th><th>Date</th>${isA ? '<th></th>' : ''}</tr></thead>
    <tbody>${trs}</tbody>
  </table></div></div></div>`;
}

async function _escPopulateClients() {
  const { data } = await supabase.from('clients').select('id, client_name, client_code').eq('company_id', S.cid).order('client_name');
  const sel = document.getElementById('esc-client_id');
  if (!sel || !data) return;
  data.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.client_name} (${c.client_code || '—'})`;
    sel.appendChild(o);
  });
}

function _escOpenModal() {
  document.getElementById('esc-modal-err').textContent = '';
  document.getElementById('esc-modal').style.display = 'flex';
}
function _escCloseModal() { document.getElementById('esc-modal').style.display = 'none'; }

async function _escSave() {
  const clientId  = document.getElementById('esc-client_id').value;
  const fromLevel = document.getElementById('esc-from_level').value;
  const toLevel   = document.getElementById('esc-to_level').value;
  const reason    = document.getElementById('esc-reason').value.trim();
  const errEl     = document.getElementById('esc-modal-err');
  if (!clientId || !reason) { errEl.textContent = 'Client and reason are required.'; return; }

  const btn = document.getElementById('esc-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const { error } = await supabase.from('escalations').insert({
    company_id: S.cid,
    client_id: clientId,
    from_level: Number(fromLevel),
    to_level: Number(toLevel),
    reason,
    status: 'open',
    escalated_by: S.uid || null,
  });

  btn.disabled = false; btn.textContent = 'Escalate';
  if (error) { errEl.textContent = error.message; return; }
  _escCloseModal();
  await _escLoad();
  if (typeof toast === 'function') toast('Escalation created', 'ok');
}

let _escResolveId = null;
function _escOpenResolve(id) {
  _escResolveId = id;
  document.getElementById('esc-resolution_note').value = '';
  document.getElementById('esc-resolve-err').textContent = '';
  document.getElementById('esc-resolve-modal').style.display = 'flex';
}
async function _escResolveConfirm() {
  const note = document.getElementById('esc-resolution_note').value.trim();
  const errEl = document.getElementById('esc-resolve-err');
  if (!note) { errEl.textContent = 'Resolution note required.'; return; }

  const btn = document.getElementById('esc-resolve-btn');
  btn.disabled = true;

  const { error } = await supabase.from('escalations').update({
    status: 'resolved',
    resolution_note: note,
    resolved_at: new Date().toISOString(),
  }).eq('id', _escResolveId);

  btn.disabled = false;
  if (error) { errEl.textContent = error.message; return; }
  document.getElementById('esc-resolve-modal').style.display = 'none';
  await _escLoad();
  if (typeof toast === 'function') toast('Escalation resolved', 'ok');
}

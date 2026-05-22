// ── Blacklisted Clients ───────────────────────────────────────────────────────

let _blData = null;

async function rBlacklist() {
  const el = document.getElementById('pg-blacklist');
  if (!el) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  el.innerHTML = `
  <div class="ph">
    <div><h2>Blacklist Register</h2><p>Clients flagged for non-payment, fraud or breach of contract</p></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-g btn-sm" onclick="_blLoad()">↺ Refresh</button>
      ${isA ? `<button class="btn btn-r btn-sm" onclick="_blOpenModal()">+ Add to Blacklist</button>` : ''}
    </div>
  </div>
  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <button class="btn btn-gh btn-xs bl-ftab on" onclick="_blSetFilter('active',this)">Active</button>
    <button class="btn btn-gh btn-xs bl-ftab"    onclick="_blSetFilter('all',this)">All</button>
    <button class="btn btn-gh btn-xs bl-ftab"    onclick="_blSetFilter('removed',this)">Removed</button>
  </div>
  <div id="bl-body"><div class="card"><div class="cb"><div class="empty"><div class="ei">⏳</div><div class="et">Loading…</div></div></div></div></div>

  <!-- Modal: Add to Blacklist -->
  <div id="bl-modal" class="mo" style="display:none" onclick="if(event.target===this)_blCloseModal()">
    <div class="mo-box" style="max-width:480px">
      <div class="mo-hd"><span>Add to Blacklist</span><button class="mo-cl" onclick="_blCloseModal()">✕</button></div>
      <div class="mo-bd">
        <div class="fg"><label class="fl">Client *</label>
          <select id="bl-client_id" class="fi"><option value="">— Select client —</option></select></div>
        <div class="fg"><label class="fl">Reason *</label>
          <textarea id="bl-reason" class="fi" rows="3" placeholder="Reason for blacklisting…"></textarea></div>
        <div class="fg"><label class="fl">Blacklist Date *</label>
          <input type="date" id="bl-blacklist_date" class="fi"></div>
        <div class="fg"><label class="fl">Approved By</label>
          <input id="bl-approved_by" class="fi" placeholder="Name of approver"></div>
        <div id="bl-modal-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="_blCloseModal()">Cancel</button>
        <button class="btn btn-r btn-sm" id="bl-save-btn" onclick="_blSave()">Blacklist</button>
      </div>
    </div>
  </div>

  <!-- Modal: Remove from Blacklist -->
  <div id="bl-remove-modal" class="mo" style="display:none" onclick="if(event.target===this)document.getElementById('bl-remove-modal').style.display='none'">
    <div class="mo-box" style="max-width:400px">
      <div class="mo-hd"><span>Remove from Blacklist</span><button class="mo-cl" onclick="document.getElementById('bl-remove-modal').style.display='none'">✕</button></div>
      <div class="mo-bd">
        <div class="fg"><label class="fl">Reason for Removal *</label>
          <textarea id="bl-removal_reason" class="fi" rows="3"></textarea></div>
        <div id="bl-remove-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="document.getElementById('bl-remove-modal').style.display='none'">Cancel</button>
        <button class="btn btn-p btn-sm" id="bl-remove-btn" onclick="_blRemoveConfirm()">Confirm Remove</button>
      </div>
    </div>
  </div>`;

  await _blLoad();
  _blPopulateClients();
}

let _blFilter = 'active';
function _blSetFilter(f, el) {
  _blFilter = f;
  document.querySelectorAll('.bl-ftab').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  _blRender();
}

async function _blLoad() {
  const { data } = await supabase
    .from('blacklisted_clients')
    .select(`*, clients(client_name, client_code, phone)`)
    .eq('company_id', S.cid)
    .order('blacklist_date', { ascending: false });
  _blData = data || [];
  _blRender();
}

function _blRender() {
  const el = document.getElementById('bl-body');
  if (!el) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  let rows = _blData;
  if (_blFilter === 'active')  rows = rows.filter(r => r.is_active !== false);
  if (_blFilter === 'removed') rows = rows.filter(r => r.is_active === false);

  if (!rows.length) {
    el.innerHTML = `<div class="card"><div class="cb"><div class="empty"><div class="ei">🛡️</div><div class="et">No records found</div></div></div></div>`;
    return;
  }

  const trs = rows.map(r => {
    const client = r.clients;
    return `<tr>
      <td>
        <div style="font-weight:700;font-size:13px">${esc(client?.client_name || '—')}</div>
        <div style="font-size:11px;color:var(--t3)">${esc(client?.client_code || '')} ${client?.phone ? '· ' + esc(client.phone) : ''}</div>
      </td>
      <td style="font-size:12px;max-width:220px">${esc(r.reason)}</td>
      <td style="font-size:12px">${fD(r.blacklist_date)}</td>
      <td style="font-size:12px;color:var(--t3)">${esc(r.approved_by || '—')}</td>
      <td><span class="badge ${r.is_active !== false ? 'err' : 'g'}">${r.is_active !== false ? 'Blacklisted' : 'Removed'}</span></td>
      ${isA ? `<td style="text-align:right">
        ${r.is_active !== false ? `<button class="btn btn-p btn-xs" onclick="_blOpenRemove('${r.id}')">Remove</button>` : ''}
      </td>` : '<td></td>'}
    </tr>`;
  }).join('');

  el.innerHTML = `<div class="card"><div class="cb"><div class="tw"><table class="t">
    <thead><tr><th>Client</th><th>Reason</th><th>Date</th><th>Approved By</th><th>Status</th>${isA ? '<th></th>' : ''}</tr></thead>
    <tbody>${trs}</tbody>
  </table></div></div></div>`;
}

async function _blPopulateClients() {
  const { data } = await supabase
    .from('clients')
    .select('id, client_name, client_code')
    .eq('company_id', S.cid)
    .order('client_name');
  const sel = document.getElementById('bl-client_id');
  if (!sel || !data) return;
  data.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.client_name} (${c.client_code || '—'})`;
    sel.appendChild(o);
  });
}

function _blOpenModal() {
  document.getElementById('bl-blacklist_date').value = td();
  document.getElementById('bl-modal-err').textContent = '';
  document.getElementById('bl-modal').style.display = 'flex';
}
function _blCloseModal() { document.getElementById('bl-modal').style.display = 'none'; }

async function _blSave() {
  const clientId = document.getElementById('bl-client_id').value;
  const reason   = document.getElementById('bl-reason').value.trim();
  const date     = document.getElementById('bl-blacklist_date').value;
  const errEl    = document.getElementById('bl-modal-err');
  if (!clientId || !reason || !date) { errEl.textContent = 'Client, reason and date are required.'; return; }

  const btn = document.getElementById('bl-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const { error } = await supabase.from('blacklisted_clients').insert({
    company_id: S.cid,
    client_id: clientId,
    reason,
    blacklist_date: date,
    approved_by: document.getElementById('bl-approved_by').value.trim() || null,
    is_active: true,
  });

  btn.disabled = false; btn.textContent = 'Blacklist';
  if (error) { errEl.textContent = error.message; return; }
  _blCloseModal();
  await _blLoad();
  if (typeof toast === 'function') toast('Client blacklisted', 'ok');
}

let _blRemoveId = null;
function _blOpenRemove(id) {
  _blRemoveId = id;
  document.getElementById('bl-removal_reason').value = '';
  document.getElementById('bl-remove-err').textContent = '';
  document.getElementById('bl-remove-modal').style.display = 'flex';
}
async function _blRemoveConfirm() {
  const reason = document.getElementById('bl-removal_reason').value.trim();
  const errEl  = document.getElementById('bl-remove-err');
  if (!reason) { errEl.textContent = 'Removal reason is required.'; return; }

  const btn = document.getElementById('bl-remove-btn');
  btn.disabled = true;

  const { error } = await supabase.from('blacklisted_clients').update({
    is_active: false,
    removal_reason: reason,
    removed_date: td(),
    removed_by: S.name || S.email || 'System',
  }).eq('id', _blRemoveId);

  btn.disabled = false;
  if (error) { errEl.textContent = error.message; return; }
  document.getElementById('bl-remove-modal').style.display = 'none';
  await _blLoad();
  if (typeof toast === 'function') toast('Removed from blacklist', 'ok');
}

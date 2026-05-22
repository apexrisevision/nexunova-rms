// ── Legal Cases Register ──────────────────────────────────────────────────────

let _lcData = null;

const LC_STAGES = ['Notice', 'Filing', 'Hearing', 'Judgment', 'Appeal', 'Settlement', 'Closed'];

async function rLegalCases() {
  const el = document.getElementById('pg-legalcases');
  if (!el) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  el.innerHTML = `
  <div class="ph">
    <div><h2>Legal Cases</h2><p>Track litigation, notices, and legal proceedings against defaulting clients</p></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-g btn-sm" onclick="_lcLoad()">↺ Refresh</button>
      ${isA ? `<button class="btn btn-p btn-sm" onclick="_lcOpenModal()">+ New Case</button>` : ''}
    </div>
  </div>
  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <button class="btn btn-gh btn-xs lc-ftab on" onclick="_lcSetFilter('active',this)">Active</button>
    <button class="btn btn-gh btn-xs lc-ftab"    onclick="_lcSetFilter('all',this)">All</button>
    <button class="btn btn-gh btn-xs lc-ftab"    onclick="_lcSetFilter('closed',this)">Closed</button>
  </div>
  <div id="lc-kpi" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px"></div>
  <div id="lc-body"><div class="card"><div class="cb"><div class="empty"><div class="ei">⏳</div><div class="et">Loading…</div></div></div></div></div>

  <!-- Add/Edit Modal -->
  <div id="lc-modal" class="mo" style="display:none" onclick="if(event.target===this)_lcCloseModal()">
    <div class="mo-box" style="max-width:540px">
      <div class="mo-hd"><span id="lc-modal-title">New Legal Case</span><button class="mo-cl" onclick="_lcCloseModal()">✕</button></div>
      <div class="mo-bd" style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">
        <div class="fg" style="grid-column:span 2"><label class="fl">Client *</label>
          <select id="lc-client_id" class="fi"><option value="">— Select client —</option></select></div>
        <div class="fg"><label class="fl">Case Number</label><input id="lc-case_number" class="fi" placeholder="e.g. KBH/2026/001"></div>
        <div class="fg"><label class="fl">Stage *</label>
          <select id="lc-stage" class="fi">${LC_STAGES.map(s => `<option>${s}</option>`).join('')}</select></div>
        <div class="fg"><label class="fl">Lawyer Name</label><input id="lc-lawyer_name" class="fi"></div>
        <div class="fg"><label class="fl">Lawyer Contact</label><input id="lc-lawyer_contact" class="fi"></div>
        <div class="fg"><label class="fl">Filed Date</label><input type="date" id="lc-filed_date" class="fi"></div>
        <div class="fg"><label class="fl">Next Hearing</label><input type="date" id="lc-next_hearing_date" class="fi"></div>
        <div class="fg"><label class="fl">Claim Amount</label><input type="number" id="lc-claim_amount" class="fi" step="0.01" min="0"></div>
        <div class="fg"><label class="fl">Settled Amount</label><input type="number" id="lc-settled_amount" class="fi" step="0.01" min="0"></div>
        <div class="fg" style="grid-column:span 2"><label class="fl">Outcome</label>
          <input id="lc-outcome" class="fi" placeholder="e.g. Judgment in favour, Settlement reached…"></div>
        <div class="fg" style="grid-column:span 2"><label class="fl">Notes</label>
          <textarea id="lc-notes" class="fi" rows="2"></textarea></div>
        <div id="lc-modal-err" style="color:var(--err);font-size:12px;margin-top:4px;grid-column:span 2"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="_lcCloseModal()">Cancel</button>
        <button class="btn btn-p btn-sm" id="lc-save-btn" onclick="_lcSave()">Save</button>
      </div>
    </div>
  </div>`;

  await _lcLoad();
  _lcPopulateClients();
}

let _lcFilter = 'active';
function _lcSetFilter(f, el) {
  _lcFilter = f;
  document.querySelectorAll('.lc-ftab').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  _lcRender();
}

async function _lcLoad() {
  const { data } = await supabase
    .from('legal_cases')
    .select(`*, clients(client_name, client_code), sales(sale_number)`)
    .eq('company_id', S.cid)
    .order('created_at', { ascending: false });
  _lcData = data || [];
  _lcRender();
}

function _lcRender() {
  const bodyEl = document.getElementById('lc-body');
  const kpiEl  = document.getElementById('lc-kpi');
  if (!bodyEl) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  const active   = _lcData.filter(r => r.stage !== 'Closed' && r.stage !== 'Settlement').length;
  const closed   = _lcData.filter(r => r.stage === 'Closed' || r.stage === 'Settlement').length;
  const totalClaim = _lcData.reduce((s, r) => s + Number(r.claim_amount || 0), 0);

  if (kpiEl) {
    kpiEl.innerHTML = [
      { l:'Active Cases', v:active, c:'var(--err)' },
      { l:'Closed',       v:closed, c:'var(--ok)' },
      { l:'Total Claim',  v:fM(totalClaim), c:'var(--info)' },
    ].map(k => `<div class="card" style="padding:14px 16px">
      <div style="font-size:16px;font-weight:800;color:${k.c}">${k.v}</div>
      <div style="font-size:11px;color:var(--t3);margin-top:2px;text-transform:uppercase;letter-spacing:.4px">${k.l}</div>
    </div>`).join('');
  }

  let rows = _lcData;
  if (_lcFilter === 'active') rows = rows.filter(r => r.stage !== 'Closed' && r.stage !== 'Settlement');
  if (_lcFilter === 'closed') rows = rows.filter(r => r.stage === 'Closed' || r.stage === 'Settlement');

  if (!rows.length) {
    bodyEl.innerHTML = `<div class="card"><div class="cb"><div class="empty"><div class="ei">⚖️</div><div class="et">No legal cases in this filter</div></div></div></div>`;
    return;
  }

  const trs = rows.map(r => {
    const stageBadge = r.stage === 'Closed' || r.stage === 'Settlement'
      ? `<span class="badge ok">${esc(r.stage)}</span>`
      : r.stage === 'Hearing' || r.stage === 'Judgment'
      ? `<span class="badge err">${esc(r.stage)}</span>`
      : `<span class="badge warn">${esc(r.stage)}</span>`;
    return `<tr>
      <td>
        <div style="font-weight:700;font-size:13px">${esc(r.clients?.client_name || '—')}</div>
        <div style="font-size:11px;color:var(--t3)">${esc(r.clients?.client_code || '')}</div>
      </td>
      <td class="mono" style="font-size:12px">${esc(r.case_number || '—')}</td>
      <td>${stageBadge}</td>
      <td style="font-size:12px">${esc(r.lawyer_name || '—')}</td>
      <td class="r mono" style="font-size:12px">${r.claim_amount ? fM(r.claim_amount) : '—'}</td>
      <td style="font-size:11px;color:var(--t3)">${r.next_hearing_date ? fD(r.next_hearing_date) : '—'}</td>
      ${isA ? `<td style="text-align:right">
        <button class="btn btn-gh btn-xs" onclick="_lcOpenModal('${r.id}')">Edit</button>
        <button class="btn btn-r btn-xs" onclick="_lcDelete('${r.id}')">Del</button>
      </td>` : '<td></td>'}
    </tr>`;
  }).join('');

  bodyEl.innerHTML = `<div class="card"><div class="cb"><div class="tw"><table class="t">
    <thead><tr><th>Client</th><th>Case #</th><th>Stage</th><th>Lawyer</th><th class="r">Claim</th><th>Next Hearing</th>${isA ? '<th></th>' : ''}</tr></thead>
    <tbody>${trs}</tbody>
  </table></div></div></div>`;
}

async function _lcPopulateClients() {
  const { data } = await supabase.from('clients').select('id, client_name, client_code').eq('company_id', S.cid).order('client_name');
  const sel = document.getElementById('lc-client_id');
  if (!sel || !data) return;
  data.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.client_name} (${c.client_code || '—'})`;
    sel.appendChild(o);
  });
}

let _lcEditId = null;
function _lcOpenModal(id) {
  _lcEditId = id || null;
  const r = id ? _lcData.find(x => x.id === id) : null;
  document.getElementById('lc-modal-title').textContent = id ? 'Edit Legal Case' : 'New Legal Case';
  document.getElementById('lc-client_id').value = r?.client_id || '';
  document.getElementById('lc-case_number').value = r?.case_number || '';
  document.getElementById('lc-stage').value = r?.stage || 'Notice';
  document.getElementById('lc-lawyer_name').value = r?.lawyer_name || '';
  document.getElementById('lc-lawyer_contact').value = r?.lawyer_contact || '';
  document.getElementById('lc-filed_date').value = r?.filed_date || '';
  document.getElementById('lc-next_hearing_date').value = r?.next_hearing_date || '';
  document.getElementById('lc-claim_amount').value = r?.claim_amount || '';
  document.getElementById('lc-settled_amount').value = r?.settled_amount || '';
  document.getElementById('lc-outcome').value = r?.outcome || '';
  document.getElementById('lc-notes').value = r?.notes || '';
  document.getElementById('lc-modal-err').textContent = '';
  document.getElementById('lc-modal').style.display = 'flex';
}
function _lcCloseModal() { document.getElementById('lc-modal').style.display = 'none'; }

async function _lcSave() {
  const clientId = document.getElementById('lc-client_id').value;
  const stage    = document.getElementById('lc-stage').value;
  const errEl    = document.getElementById('lc-modal-err');
  if (!clientId) { errEl.textContent = 'Client is required.'; return; }

  const btn = document.getElementById('lc-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const payload = {
    company_id: S.cid,
    client_id: clientId,
    stage,
    case_number: document.getElementById('lc-case_number').value.trim() || null,
    lawyer_name: document.getElementById('lc-lawyer_name').value.trim() || null,
    lawyer_contact: document.getElementById('lc-lawyer_contact').value.trim() || null,
    filed_date: document.getElementById('lc-filed_date').value || null,
    next_hearing_date: document.getElementById('lc-next_hearing_date').value || null,
    claim_amount: document.getElementById('lc-claim_amount').value ? Number(document.getElementById('lc-claim_amount').value) : null,
    settled_amount: document.getElementById('lc-settled_amount').value ? Number(document.getElementById('lc-settled_amount').value) : null,
    outcome: document.getElementById('lc-outcome').value.trim() || null,
    notes: document.getElementById('lc-notes').value.trim() || null,
    created_by: _lcEditId ? undefined : S.uid,
  };

  let error;
  if (_lcEditId) {
    ({ error } = await supabase.from('legal_cases').update(payload).eq('id', _lcEditId));
  } else {
    ({ error } = await supabase.from('legal_cases').insert(payload));
  }

  btn.disabled = false; btn.textContent = 'Save';
  if (error) { errEl.textContent = error.message; return; }
  _lcCloseModal();
  await _lcLoad();
  if (typeof toast === 'function') toast(_lcEditId ? 'Case updated' : 'Case created', 'ok');
}

async function _lcDelete(id) {
  if (!confirm('Delete this legal case record?')) return;
  await supabase.from('legal_cases').delete().eq('id', id);
  await _lcLoad();
  if (typeof toast === 'function') toast('Deleted', 'ok');
}

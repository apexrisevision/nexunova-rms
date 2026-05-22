// ── Banks Master ─────────────────────────────────────────────────────────────
// Manage company bank accounts used for PDC & payment references

let _banksData = null;

async function rBanks() {
  const el = document.getElementById('pg-banks');
  if (!el) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  el.innerHTML = `
  <div class="ph">
    <div><h2>Banks</h2><p>Company bank accounts used for PDC &amp; payment tracking</p></div>
    ${isA ? `<button class="btn btn-p btn-sm" onclick="_bankOpenModal()">+ Add Bank</button>` : ''}
  </div>
  <div id="banks-body"><div class="card"><div class="cb"><div class="empty"><div class="ei">⏳</div><div class="et">Loading…</div></div></div></div></div>

  <!-- Modal -->
  <div id="bank-modal" class="mo" style="display:none" onclick="if(event.target===this)_bankCloseModal()">
    <div class="mo-box" style="max-width:480px">
      <div class="mo-hd"><span id="bank-modal-title">Add Bank</span><button class="mo-cl" onclick="_bankCloseModal()">✕</button></div>
      <div class="mo-bd">
        <div class="fg"><label class="fl">Bank Name *</label><input id="bk-bank_name" class="fi" placeholder="e.g. HBL"></div>
        <div class="fg"><label class="fl">Account Title *</label><input id="bk-account_title" class="fi" placeholder="Company title on account"></div>
        <div class="fg"><label class="fl">Account Number *</label><input id="bk-account_number" class="fi" placeholder="Account No."></div>
        <div class="fg"><label class="fl">IBAN</label><input id="bk-iban" class="fi" placeholder="PK00XXXX..."></div>
        <div class="fg"><label class="fl">Branch</label><input id="bk-branch" class="fi" placeholder="Branch name/code"></div>
        <div class="fg"><label class="fl">Notes</label><textarea id="bk-notes" class="fi" rows="2"></textarea></div>
        <div class="fg" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="bk-is_active" checked style="width:16px;height:16px">
          <label for="bk-is_active" class="fl" style="margin:0">Active</label>
        </div>
        <div id="bank-modal-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="_bankCloseModal()">Cancel</button>
        <button class="btn btn-p btn-sm" id="bank-save-btn" onclick="_bankSave()">Save</button>
      </div>
    </div>
  </div>`;

  await _banksLoad();
}

async function _banksLoad() {
  const { data, error } = await supabase
    .from('banks')
    .select('*')
    .eq('company_id', S.cid)
    .order('sort_order', { ascending: true })
    .order('bank_name', { ascending: true });

  _banksData = error ? [] : (data || []);
  _banksRender();
}

function _banksRender() {
  const el = document.getElementById('banks-body');
  if (!el) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  if (!_banksData.length) {
    el.innerHTML = `<div class="card"><div class="cb"><div class="empty"><div class="ei">🏦</div><div class="et">No banks added yet${isA ? '<br><button class="btn btn-p btn-sm" style="margin-top:12px" onclick="_bankOpenModal()">+ Add First Bank</button>' : ''}</div></div></div></div>`;
    return;
  }

  const rows = _banksData.map(b => `
    <tr>
      <td style="font-weight:700">${esc(b.bank_name)}</td>
      <td>${esc(b.account_title)}</td>
      <td class="mono" style="font-size:12px">${esc(b.account_number)}</td>
      <td class="mono" style="font-size:11px;color:var(--t3)">${esc(b.iban || '—')}</td>
      <td style="font-size:12px;color:var(--t3)">${esc(b.branch || '—')}</td>
      <td><span class="badge ${b.is_active ? 'ok' : 'g'}">${b.is_active ? 'Active' : 'Inactive'}</span></td>
      ${isA ? `<td style="text-align:right">
        <button class="btn btn-gh btn-xs" onclick="_bankOpenModal('${b.id}')">Edit</button>
        <button class="btn btn-r btn-xs" onclick="_bankDelete('${b.id}')">Del</button>
      </td>` : '<td></td>'}
    </tr>`).join('');

  el.innerHTML = `<div class="card"><div class="cb">
    <div class="tw"><table class="t">
      <thead><tr><th>Bank</th><th>Account Title</th><th>Account #</th><th>IBAN</th><th>Branch</th><th>Status</th>${isA ? '<th></th>' : ''}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div></div>`;
}

let _bankEditId = null;
function _bankOpenModal(id) {
  _bankEditId = id || null;
  const b = id ? _banksData.find(x => x.id === id) : null;
  document.getElementById('bank-modal-title').textContent = id ? 'Edit Bank' : 'Add Bank';
  document.getElementById('bk-bank_name').value = b?.bank_name || '';
  document.getElementById('bk-account_title').value = b?.account_title || '';
  document.getElementById('bk-account_number').value = b?.account_number || '';
  document.getElementById('bk-iban').value = b?.iban || '';
  document.getElementById('bk-branch').value = b?.branch || '';
  document.getElementById('bk-notes').value = b?.notes || '';
  document.getElementById('bk-is_active').checked = b ? b.is_active : true;
  document.getElementById('bank-modal-err').textContent = '';
  document.getElementById('bank-modal').style.display = 'flex';
}
function _bankCloseModal() { document.getElementById('bank-modal').style.display = 'none'; }

async function _bankSave() {
  const name = document.getElementById('bk-bank_name').value.trim();
  const title = document.getElementById('bk-account_title').value.trim();
  const acct = document.getElementById('bk-account_number').value.trim();
  const errEl = document.getElementById('bank-modal-err');
  if (!name || !title || !acct) { errEl.textContent = 'Bank name, account title, and account number are required.'; return; }

  const btn = document.getElementById('bank-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const payload = {
    company_id: S.cid,
    bank_name: name,
    account_title: title,
    account_number: acct,
    iban: document.getElementById('bk-iban').value.trim() || null,
    branch: document.getElementById('bk-branch').value.trim() || null,
    notes: document.getElementById('bk-notes').value.trim() || null,
    is_active: document.getElementById('bk-is_active').checked,
  };

  let error;
  if (_bankEditId) {
    ({ error } = await supabase.from('banks').update(payload).eq('id', _bankEditId));
  } else {
    ({ error } = await supabase.from('banks').insert(payload));
  }

  btn.disabled = false; btn.textContent = 'Save';
  if (error) { errEl.textContent = error.message; return; }
  _bankCloseModal();
  await _banksLoad();
  if (typeof toast === 'function') toast(_bankEditId ? 'Bank updated' : 'Bank added', 'ok');
}

async function _bankDelete(id) {
  if (!confirm('Delete this bank? Make sure no PDC records reference it.')) return;
  const { error } = await supabase.from('banks').delete().eq('id', id);
  if (error) { alert(error.message); return; }
  await _banksLoad();
  if (typeof toast === 'function') toast('Bank deleted', 'ok');
}

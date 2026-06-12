// ── Banks Master ─────────────────────────────────────────────────────────────
// Manage company bank accounts used for PDC & payment references.
// Phase-3 batch-1: restyled onto the nx- foundation kit. Logic/RPCs unchanged
// (list_banks · upsert_bank · delete_bank).

let _banksData = null;
let _bankEditId = null;

function _banksIsAdmin() { return S.role === 'admin' || S.role === 'owner'; }

async function rBanks() {
  const el = document.getElementById('pg-banks');
  if (!el) return;
  el.innerHTML =
    NX.pageHeader('Banks',
      (_banksIsAdmin() ? NX.button('Add bank', { variant:'primary', icon:'plus', onclick:'_bankOpenModal()' }) : '')) +
    '<div id="banks-body">' + NX.card(NX.empty({ icon:'info', message:'Loading…' })) + '</div>' +
    '<div id="bank-modal-host"></div>';
  await _banksLoad();
}

async function _banksLoad() {
  const { data, error } = await supabase.rpc('list_banks', { p_company_id: S.cid });
  _banksData = error ? [] : (data || []);
  _banksRender();
}

function _banksRender() {
  const el = document.getElementById('banks-body');
  if (!el) return;
  const isA = _banksIsAdmin();

  if (!_banksData.length) {
    el.innerHTML = NX.card(NX.empty({
      icon:'inbox',
      message:'No bank accounts yet — add the accounts you use for PDC and payment references.',
      action: isA ? NX.button('Add bank', { variant:'primary', icon:'plus', onclick:'_bankOpenModal()' }) : ''
    }));
    return;
  }

  const cols = [
    { label:'Bank' }, { label:'Account title' }, { label:'Account #', num:true },
    { label:'IBAN', num:true }, { label:'Branch' }, { label:'Status' }
  ];
  if (isA) cols.push({ label:'', width:'140px' });

  const rows = _banksData.map(b => {
    const cells = [
      NX.esc(b.bank_name),
      NX.esc(b.account_title),
      '<span class="num">' + NX.esc(b.account_number) + '</span>',
      '<span class="num">' + NX.esc(b.iban || '—') + '</span>',
      NX.esc(b.branch || '—'),
      NX.badge(b.is_active ? 'Active' : 'Inactive', b.is_active ? 'success' : '', { dot: b.is_active })
    ];
    if (isA) cells.push(
      '<div style="display:flex;gap:6px;justify-content:flex-end">' +
        NX.button('Edit',   { variant:'ghost',  size:'sm', onclick:"_bankOpenModal('" + b.id + "')" }) +
        NX.button('Delete', { variant:'danger', size:'sm', onclick:"_bankDelete('" + b.id + "')" }) +
      '</div>'
    );
    return cells;
  });

  el.innerHTML = NX.card(NX.table({ cols, rows, flush:true }), { flush:true });
}

// ── Add / Edit modal (built on the kit, injected into the host) ──────────────
function _bankOpenModal(id) {
  _bankEditId = id || null;
  const b = id ? _banksData.find(x => x.id === id) : null;
  const active = b ? !!b.is_active : true;
  document.getElementById('bank-modal-host').innerHTML = NX.modal({
    title: id ? 'Edit bank' : 'Add bank', size:'s', onClose:'_bankCloseModal()',
    body:
      NX.field({ label:'Bank name',      name:'bk-bank_name',      required:true, value:b?.bank_name || '',      placeholder:'e.g. HBL' }) +
      NX.field({ label:'Account title',  name:'bk-account_title',  required:true, value:b?.account_title || '',  placeholder:'Company title on account' }) +
      NX.field({ label:'Account number', name:'bk-account_number', required:true, value:b?.account_number || '', placeholder:'Account No.', attrs:'class="nx-input num"' }) +
      NX.field({ label:'IBAN',           name:'bk-iban',           value:b?.iban || '',   placeholder:'PK00XXXX…', attrs:'class="nx-input num"' }) +
      NX.field({ label:'Branch',         name:'bk-branch',         value:b?.branch || '', placeholder:'Branch name / code' }) +
      NX.field({ label:'Notes', name:'bk-notes', el:'textarea', value:b?.notes || '' }) +
      '<label class="nx-field" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer">' +
        '<input type="checkbox" id="bk-is_active"' + (active ? ' checked' : '') + '>' +
        '<span class="nx-label" style="margin:0">Active</span></label>' +
      '<div class="nx-error" id="bank-modal-err"></div>',
    footer:
      NX.button('Cancel', { variant:'ghost', onclick:'_bankCloseModal()' }) +
      NX.button('Save',   { variant:'primary', attrs:'id="bank-save-btn"', onclick:'_bankSave()' })
  });
}
function _bankCloseModal() { const h = document.getElementById('bank-modal-host'); if (h) h.innerHTML = ''; }

async function _bankSave() {
  const name = document.getElementById('bk-bank_name').value.trim();
  const title = document.getElementById('bk-account_title').value.trim();
  const acct = document.getElementById('bk-account_number').value.trim();
  const errEl = document.getElementById('bank-modal-err');
  if (!name || !title || !acct) { errEl.textContent = 'Bank name, account title, and account number are required.'; return; }

  const btn = document.getElementById('bank-save-btn');
  btn.disabled = true; const _bs = btn.querySelector('span'); if (_bs) _bs.textContent = 'Saving…';

  const payload = {
    bank_name: name,
    account_title: title,
    account_number: acct,
    iban: document.getElementById('bk-iban').value.trim() || null,
    branch: document.getElementById('bk-branch').value.trim() || null,
    notes: document.getElementById('bk-notes').value.trim() || null,
    is_active: document.getElementById('bk-is_active').checked,
  };

  const { error } = await supabase.rpc('upsert_bank', {
    p_company_id: S.cid,
    p_data: payload,
    p_id: _bankEditId || null
  });

  btn.disabled = false; if (_bs) _bs.textContent = 'Save';
  if (error) { errEl.textContent = error.message; return; }
  _bankCloseModal();
  await _banksLoad();
  if (typeof toast === 'function') toast(_bankEditId ? 'Bank updated' : 'Bank added', 'ok');
}

async function _bankDelete(id) {
  if (!confirm('Delete this bank? Make sure no PDC records reference it.')) return;
  const { error } = await supabase.rpc('delete_bank', { p_id: id, p_company_id: S.cid });
  if (error) { alert(error.message); return; }
  await _banksLoad();
  if (typeof toast === 'function') toast('Bank deleted', 'ok');
}

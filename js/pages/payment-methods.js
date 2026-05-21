// ══ PAYMENT METHODS SETTINGS ════════════════════════════════════════

let _pmRows   = [];
let _pmEditId = null;

const _pmTypes = [
  { type: 'jazzcash',  icon: '<svg width="28" height="28" fill="none" stroke="#10b981" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>', label: 'JazzCash',      bankFields: false },
  { type: 'easypaisa', icon: '<svg width="28" height="28" fill="none" stroke="#8b5cf6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>', label: 'EasyPaisa',     bankFields: false },
  { type: 'raast',     icon: '<svg width="28" height="28" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>', label: 'Raast',         bankFields: false },
  { type: 'sadapay',   icon: '<svg width="28" height="28" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="22" height="16" x="1" y="4" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>', label: 'SadaPay',       bankFields: false },
  { type: 'nayapay',   icon: '<svg width="28" height="28" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="22" height="16" x="1" y="4" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>', label: 'NayaPay',       bankFields: false },
  { type: 'bank',      icon: '<svg width="28" height="28" fill="none" stroke="#0ea5e9" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>', label: 'Bank Transfer', bankFields: true  },
];

function _pmIcon(type)  { return (_pmTypes.find(t => t.type === type) || {}).icon  || '<svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="22" height="16" x="1" y="4" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>'; }
function _pmLabel(type) { return (_pmTypes.find(t => t.type === type) || {}).label || type; }

async function rPaymentMethods() {
  if (!S || (S.role !== 'admin' && S.role !== 'owner')) { nav('dashboard'); return; }
  const el = document.getElementById('pg-payment-methods');
  if (!el) return;

  el.innerHTML = `<div class="ani module-executive">
    <div class="ph" style="margin-bottom:22px">
      <div class="ph-l" style="display:flex;align-items:center;gap:12px">
        <div style="width:44px;height:44px;background:linear-gradient(135deg,#10b981,#0d9488);border-radius:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 16px rgba(16,185,129,.32)"><svg width="22" height="22" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="22" height="16" x="1" y="4" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div>
        <div>
          <h2 style="margin:0;font-size:21px;font-weight:800;color:var(--text);letter-spacing:-.3px">Payment Methods</h2>
          <p style="margin:3px 0 0;font-size:12px;color:var(--t3)">Configure accounts included in WhatsApp payment links</p>
        </div>
      </div>
      <div class="ph-r">
        <button class="btn" onclick="pmOpenEdit(null)">+ Add Method</button>
      </div>
    </div>
    <div id="pm-grid-wrap"></div>
  </div>`;

  await pmLoad();
}

async function pmLoad() {
  const wrap = document.getElementById('pm-grid-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--t3);font-size:13px">Loading…</div>`;

  const { data, error } = await supabase
    .from('company_payment_methods')
    .select('*')
    .eq('company_id', S.cid)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--err);font-size:13px">Error: ${esc(error.message)}</div>`;
    return;
  }
  _pmRows = data || [];
  _pmRender();
}

function _pmRender() {
  const wrap = document.getElementById('pm-grid-wrap');
  if (!wrap) return;

  if (!_pmRows.length) {
    wrap.innerHTML = `<div style="padding:60px 0;text-align:center">
      <div style="margin-bottom:12px;opacity:.25"><svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="22" height="16" x="1" y="4" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div>
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px">No payment methods yet</div>
      <div style="font-size:13px;color:var(--t3);margin-bottom:20px">Add JazzCash, EasyPaisa, Bank Transfer and more</div>
      <button class="btn" onclick="pmOpenEdit(null)">+ Add First Method</button>
    </div>`;
    return;
  }

  wrap.innerHTML = `<div class="pm-grid">${_pmRows.map(_pmCardHTML).join('')}</div>`;
}

function _pmCardHTML(m) {
  const icon  = _pmIcon(m.method_type);
  const label = _pmLabel(m.method_type);
  return `<div class="pm-card${m.is_active ? '' : ' inactive'}">
    <span class="pm-type-badge">${esc(label)}</span>
    <div class="pm-icon">${icon}</div>
    <div class="pm-title">${esc(m.account_title)}</div>
    <div class="pm-number">${esc(m.account_number)}</div>
    ${m.bank_name ? `<div class="pm-bank" style="display:flex;align-items:center;gap:4px"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>${esc(m.bank_name)}${m.branch_code ? ' · ' + esc(m.branch_code) : ''}</div>` : ''}
    ${m.iban      ? `<div class="pm-bank" style="font-size:10px">IBAN: ${esc(m.iban)}</div>` : ''}
    <div style="margin-top:10px">
      ${m.is_default
        ? `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(16,185,129,.12);color:#059669;border:1px solid rgba(16,185,129,.25)">✓ Default</span>`
        : `<button onclick="pmSetDefault('${m.id}')" style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;border:1px solid var(--line);background:transparent;color:var(--t3);cursor:pointer;font-family:inherit" onmouseover="this.style.borderColor='#10b981';this.style.color='#059669'" onmouseout="this.style.borderColor='var(--line)';this.style.color='var(--t3)'">Set Default</button>`}
    </div>
    <div class="pm-actions">
      <label class="tog" title="${m.is_active ? 'Active' : 'Inactive'}">
        <input type="checkbox" ${m.is_active ? 'checked' : ''} onchange="pmToggleActive('${m.id}',this.checked)">
        <span class="tog-sl"></span>
      </label>
      <button onclick="pmOpenEdit('${m.id}')" style="flex:1;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);color:#6366f1;border-radius:7px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s" onmouseover="this.style.background='rgba(99,102,241,.15)'" onmouseout="this.style.background='rgba(99,102,241,.08)'">Edit</button>
      <button onclick="pmDelete('${m.id}')" style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);color:#dc2626;border-radius:7px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s" onmouseover="this.style.background='rgba(239,68,68,.15)'" onmouseout="this.style.background='rgba(239,68,68,.08)'">Del</button>
    </div>
  </div>`;
}

function pmOpenEdit(id) {
  _pmEditId = id;
  const m = id ? _pmRows.find(r => r.id === id) : null;

  const typeOptions = _pmTypes.map(t =>
    `<option value="${t.type}"${m && m.method_type === t.type ? ' selected' : ''}>${t.label}</option>`
  ).join('');

  document.getElementById('pm-mbody').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="fg">
        <label class="fl">Method Type</label>
        <select id="pm-type" class="fi" onchange="_pmShowFields()">
          ${typeOptions}
        </select>
      </div>
      <div class="fg">
        <label class="fl">Account Title</label>
        <input id="pm-title" class="fi" type="text" placeholder="e.g. Muhammad Ali" value="${esc(m?.account_title || '')}">
      </div>
      <div class="fg">
        <label class="fl" id="pm-num-lbl">Account / Mobile Number</label>
        <input id="pm-number" class="fi" type="text" placeholder="03001234567" value="${esc(m?.account_number || '')}">
      </div>
      <div id="pm-bank-fields" style="display:none;flex-direction:column;gap:14px">
        <div class="fg">
          <label class="fl">Bank Name</label>
          <input id="pm-bank" class="fi" type="text" placeholder="e.g. HBL, MCB, UBL" value="${esc(m?.bank_name || '')}">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="fg">
            <label class="fl">Branch Code</label>
            <input id="pm-branch" class="fi" type="text" placeholder="Optional" value="${esc(m?.branch_code || '')}">
          </div>
          <div class="fg">
            <label class="fl">SWIFT Code</label>
            <input id="pm-swift" class="fi" type="text" placeholder="Optional" value="${esc(m?.swift_code || '')}">
          </div>
        </div>
        <div class="fg">
          <label class="fl">IBAN</label>
          <input id="pm-iban" class="fi" type="text" placeholder="PK36SCBL0000001123456702" value="${esc(m?.iban || '')}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="fg">
          <label class="fl">Display Order</label>
          <input id="pm-order" class="fi" type="number" min="0" value="${m ? m.display_order : _pmRows.length}">
        </div>
        <div class="fg">
          <label class="fl">&nbsp;</label>
          <div style="display:flex;gap:16px;align-items:center;padding-top:6px">
            <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--text);cursor:pointer">
              <input type="checkbox" id="pm-active" ${m ? (m.is_active ? 'checked' : '') : 'checked'}> Active
            </label>
            <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--text);cursor:pointer">
              <input type="checkbox" id="pm-default" ${m?.is_default ? 'checked' : ''}> Default
            </label>
          </div>
        </div>
      </div>
      <div class="fg">
        <label class="fl">Notes (internal)</label>
        <input id="pm-notes" class="fi" type="text" placeholder="Optional" value="${esc(m?.notes || '')}">
      </div>
    </div>
    <div class="mf" style="margin-top:20px">
      <button class="btn-ghost" onclick="cm('m-pm-edit')">Cancel</button>
      <button class="btn" id="pm-save-btn" onclick="pmSave()">Save Method</button>
    </div>`;

  document.getElementById('pm-mtl').textContent = m ? 'Edit Payment Method' : 'Add Payment Method';
  _pmShowFields();
  om('m-pm-edit');
}

function _pmShowFields() {
  const type    = document.getElementById('pm-type')?.value;
  const bankDiv = document.getElementById('pm-bank-fields');
  const numLbl  = document.getElementById('pm-num-lbl');
  if (!bankDiv || !type) return;
  bankDiv.style.display = (type === 'bank') ? 'flex' : 'none';
  const labels = { jazzcash: 'Mobile Number', easypaisa: 'Mobile Number', raast: 'Raast ID', sadapay: 'Mobile Number', nayapay: 'Mobile Number', bank: 'Account Number' };
  if (numLbl) numLbl.textContent = labels[type] || 'Account / Mobile Number';
}

async function pmSave() {
  const type   = document.getElementById('pm-type')?.value;
  const title  = document.getElementById('pm-title')?.value.trim();
  const number = document.getElementById('pm-number')?.value.trim();

  if (!type)   { notify.warning('Select a method type'); return; }
  if (!title)  { notify.warning('Account title is required'); return; }
  if (!number) { notify.warning('Account number is required'); return; }

  const isDefault = document.getElementById('pm-default')?.checked ?? false;

  const payload = {
    company_id:     S.cid,
    method_type:    type,
    account_title:  title,
    account_number: number,
    bank_name:      document.getElementById('pm-bank')?.value.trim()   || null,
    branch_code:    document.getElementById('pm-branch')?.value.trim() || null,
    iban:           document.getElementById('pm-iban')?.value.trim()   || null,
    swift_code:     document.getElementById('pm-swift')?.value.trim()  || null,
    display_order:  parseInt(document.getElementById('pm-order')?.value) || 0,
    is_active:      document.getElementById('pm-active')?.checked ?? true,
    is_default:     isDefault,
    notes:          document.getElementById('pm-notes')?.value.trim()  || null,
    updated_at:     new Date().toISOString(),
  };

  const btn = document.getElementById('pm-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    let error;
    if (_pmEditId) {
      ({ error } = await supabase.from('company_payment_methods').update(payload).eq('id', _pmEditId).eq('company_id', S.cid));
    } else {
      ({ error } = await supabase.from('company_payment_methods').insert(payload));
    }
    if (error) { notify.error('Save failed', { detail: error.message }); return; }

    if (isDefault) await _pmClearOtherDefaults(_pmEditId);

    cm('m-pm-edit');
    notify.success(_pmEditId ? 'Method updated' : 'Method added');
    await pmLoad();
  } catch (e) {
    console.error('[pmSave]', e);
    notify.error('Could not save method', { detail: e.message });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Method'; }
  }
}

async function _pmClearOtherDefaults(keepId) {
  const ids = _pmRows.filter(r => r.is_default && r.id !== keepId).map(r => r.id);
  if (!ids.length) return;
  await supabase.from('company_payment_methods').update({ is_default: false }).in('id', ids).eq('company_id', S.cid);
}

async function pmSetDefault(id) {
  await _pmClearOtherDefaults(id);
  const { error } = await supabase.from('company_payment_methods').update({ is_default: true }).eq('id', id).eq('company_id', S.cid);
  if (error) { notify.error('Could not set default', { detail: error.message }); return; }
  notify.success('Default method updated');
  await pmLoad();
}

async function pmToggleActive(id, checked) {
  const { error } = await supabase.from('company_payment_methods').update({ is_active: checked, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', S.cid);
  if (error) { notify.error('Could not update'); await pmLoad(); return; }
  const m = _pmRows.find(r => r.id === id);
  if (m) m.is_active = checked;
  _pmRender();
}

async function pmDelete(id) {
  const m = _pmRows.find(r => r.id === id);
  if (!m) return;
  if (!confirm(`Delete "${_pmLabel(m.method_type)} — ${m.account_title}"?\nThis cannot be undone.`)) return;
  const { error } = await supabase.from('company_payment_methods').delete().eq('id', id).eq('company_id', S.cid);
  if (error) { notify.error('Could not delete', { detail: error.message }); return; }
  notify.success('Method deleted');
  await pmLoad();
}

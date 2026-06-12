// ══ PAYMENT METHODS SETTINGS ════════════════════════════════════════
// Phase-3 batch-2: restyled onto the nx- foundation kit. Logic/RPCs unchanged
// (list/upsert/delete/set_default/toggle_active). The static m-pm-edit modal is
// replaced by a host-injected NX.modal (same field ids → pmSave untouched).

let _pmRows   = [];
let _pmEditId = null;

const _pmTypes = [
  { type: 'jazzcash',  label: 'JazzCash',      bankFields: false },
  { type: 'easypaisa', label: 'EasyPaisa',     bankFields: false },
  { type: 'raast',     label: 'Raast',         bankFields: false },
  { type: 'sadapay',   label: 'SadaPay',       bankFields: false },
  { type: 'nayapay',   label: 'NayaPay',       bankFields: false },
  { type: 'bank',      label: 'Bank Transfer', bankFields: true  },
];

function _pmLabel(type) { return (_pmTypes.find(t => t.type === type) || {}).label || type; }

async function rPaymentMethods() {
  if (!S || (S.role !== 'admin' && S.role !== 'owner')) { nav('dashboard'); return; }
  const el = document.getElementById('pg-payment-methods');
  if (!el) return;

  el.innerHTML =
    NX.pageHeader('Payment methods', NX.button('Add method', { variant:'primary', icon:'plus', onclick:'pmOpenEdit(null)' })) +
    '<div class="nx-kpi-label" style="text-transform:none;margin:-4px 0 var(--fk-sp-3)">Accounts included in WhatsApp payment links</div>' +
    '<div id="pm-grid-wrap"></div>' +
    '<div id="pm-modal-host"></div>';

  await pmLoad();
}

async function pmLoad() {
  const wrap = document.getElementById('pm-grid-wrap');
  if (!wrap) return;
  wrap.innerHTML = NX.card(NX.empty({ icon:'info', message:'Loading…' }));

  const { data, error } = await supabase.rpc('list_payment_methods', { p_company_id: S.cid });

  if (error) {
    wrap.innerHTML = NX.card(NX.empty({ icon:'alert-triangle', message:'Could not load payment methods — ' + (error.message || 'error') }));
    return;
  }
  _pmRows = data || [];
  _pmRender();
}

function _pmRender() {
  const wrap = document.getElementById('pm-grid-wrap');
  if (!wrap) return;

  if (!_pmRows.length) {
    wrap.innerHTML = NX.card(NX.empty({
      icon:'inbox',
      message:'No payment methods yet — add JazzCash, EasyPaisa, Bank Transfer and more.',
      action: NX.button('Add method', { variant:'primary', icon:'plus', onclick:'pmOpenEdit(null)' })
    }));
    return;
  }

  wrap.innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--fk-sp-3)">' +
    _pmRows.map(_pmCardHTML).join('') + '</div>';
}

function _pmCardHTML(m) {
  const label = _pmLabel(m.method_type);
  const inner =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:var(--fk-sp-2)">' +
      NX.badge(label, 'primary') +
      (m.is_default ? NX.badge('Default', 'success', { dot:true })
                    : NX.button('Set default', { variant:'ghost', size:'sm', onclick:"pmSetDefault('" + m.id + "')" })) +
    '</div>' +
    '<div style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + NX.esc(m.account_title) + '</div>' +
    '<div class="num" style="font-size:var(--fk-fs-body);color:var(--fk-text-muted)">' + NX.esc(m.account_number) + '</div>' +
    (m.bank_name ? '<div class="nx-kpi-label" style="text-transform:none;margin-top:4px">' + NX.esc(m.bank_name) + (m.branch_code ? ' · ' + NX.esc(m.branch_code) : '') + '</div>' : '') +
    (m.iban ? '<div class="nx-kpi-label" style="text-transform:none"><span class="num">IBAN: ' + NX.esc(m.iban) + '</span></div>' : '') +
    '<div style="display:flex;align-items:center;gap:8px;margin-top:var(--fk-sp-3);padding-top:var(--fk-sp-2);border-top:1px solid var(--fk-border)">' +
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer" title="' + (m.is_active ? 'Active' : 'Inactive') + '">' +
        '<input type="checkbox" ' + (m.is_active ? 'checked' : '') + ' onchange="pmToggleActive(\'' + m.id + '\',this.checked)">' +
        '<span class="nx-kpi-label" style="text-transform:none">' + (m.is_active ? 'Active' : 'Inactive') + '</span></label>' +
      '<span style="flex:1"></span>' +
      NX.button('Edit',   { variant:'secondary', size:'sm', onclick:"pmOpenEdit('" + m.id + "')" }) +
      NX.button('Delete', { variant:'danger',    size:'sm', onclick:"pmDelete('" + m.id + "')" }) +
    '</div>';
  return NX.card(inner, { class: m.is_active ? '' : 'nx-card' , compact:true });
}

function pmOpenEdit(id) {
  _pmEditId = id;
  const m = id ? _pmRows.find(r => r.id === id) : null;

  const body =
    NX.field({ label:'Method type', name:'pm-type', el:'select', value:m?.method_type || 'jazzcash',
               options:_pmTypes.map(t => ({ value:t.type, label:t.label })), attrs:'onchange="_pmShowFields()"' }) +
    NX.field({ label:'Account title', name:'pm-title', value:m?.account_title || '', placeholder:'e.g. Muhammad Ali' }) +
    '<div class="nx-field"><label class="nx-label" id="pm-num-lbl">Account / mobile number</label>' +
      '<input class="nx-input" id="pm-number" type="text" placeholder="03001234567" value="' + NX.esc(m?.account_number || '') + '"></div>' +
    '<div id="pm-bank-fields" style="display:none;flex-direction:column">' +
      NX.field({ label:'Bank name', name:'pm-bank', value:m?.bank_name || '', placeholder:'e.g. HBL, MCB, UBL' }) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">' +
        NX.field({ label:'Branch code', name:'pm-branch', value:m?.branch_code || '', placeholder:'Optional' }) +
        NX.field({ label:'SWIFT code',  name:'pm-swift',  value:m?.swift_code || '',  placeholder:'Optional' }) +
      '</div>' +
      NX.field({ label:'IBAN', name:'pm-iban', value:m?.iban || '', placeholder:'PK36SCBL0000001123456702', attrs:'class="nx-input num"' }) +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3);align-items:end">' +
      NX.field({ label:'Display order', name:'pm-order', type:'number', value:(m ? m.display_order : _pmRows.length), attrs:'min="0" class="nx-input num"' }) +
      '<div style="display:flex;gap:16px;align-items:center;padding-bottom:8px">' +
        '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:var(--fk-fs-body);color:var(--fk-text)"><input type="checkbox" id="pm-active" ' + (m ? (m.is_active ? 'checked' : '') : 'checked') + '> Active</label>' +
        '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:var(--fk-fs-body);color:var(--fk-text)"><input type="checkbox" id="pm-default" ' + (m?.is_default ? 'checked' : '') + '> Default</label>' +
      '</div>' +
    '</div>' +
    NX.field({ label:'Notes (internal)', name:'pm-notes', value:m?.notes || '', placeholder:'Optional' });

  document.getElementById('pm-modal-host').innerHTML = NX.modal({
    title: m ? 'Edit payment method' : 'Add payment method', size:'m', onClose:'_pmCloseModal()',
    body,
    footer: NX.button('Cancel', { variant:'ghost', onclick:'_pmCloseModal()' }) +
            NX.button('Save method', { variant:'primary', attrs:'id="pm-save-btn"', onclick:'pmSave()' })
  });
  _pmShowFields();
  setTimeout(() => document.getElementById('pm-title')?.focus(), 80);
}
function _pmCloseModal() { const h = document.getElementById('pm-modal-host'); if (h) h.innerHTML = ''; }

function _pmShowFields() {
  const type    = document.getElementById('pm-type')?.value;
  const bankDiv = document.getElementById('pm-bank-fields');
  const numLbl  = document.getElementById('pm-num-lbl');
  if (!bankDiv || !type) return;
  bankDiv.style.display = (type === 'bank') ? 'flex' : 'none';
  const labels = { jazzcash: 'Mobile number', easypaisa: 'Mobile number', raast: 'Raast ID', sadapay: 'Mobile number', nayapay: 'Mobile number', bank: 'Account number' };
  if (numLbl) numLbl.textContent = labels[type] || 'Account / mobile number';
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
    notes:          document.getElementById('pm-notes')?.value.trim()  || null
  };

  const btn = document.getElementById('pm-save-btn');
  if (btn) { btn.disabled = true; const sp = btn.querySelector('span'); if (sp) sp.textContent = 'Saving…'; }

  try {
    const { error } = await supabase.rpc('upsert_payment_method', {
      p_company_id: S.cid, p_data: payload, p_id: _pmEditId || null
    });
    if (error) { notify.error('Save failed', { detail: error.message }); return; }

    _pmCloseModal();
    notify.success(_pmEditId ? 'Method updated' : 'Method added');
    await pmLoad();
  } catch (e) {
    console.error('[pmSave]', e);
    notify.error('Could not save method', { detail: e.message });
  } finally {
    if (btn) { btn.disabled = false; const sp = btn.querySelector('span'); if (sp) sp.textContent = 'Save method'; }
  }
}

async function pmSetDefault(id) {
  const { error } = await supabase.rpc('set_payment_method_default', { p_id: id, p_company_id: S.cid });
  if (error) { notify.error('Could not set default', { detail: error.message }); return; }
  notify.success('Default method updated');
  await pmLoad();
}

async function pmToggleActive(id, checked) {
  const { error } = await supabase.rpc('toggle_payment_method_active', { p_id: id, p_company_id: S.cid, p_active: checked });
  if (error) { notify.error('Could not update'); await pmLoad(); return; }
  const m = _pmRows.find(r => r.id === id);
  if (m) m.is_active = checked;
  _pmRender();
}

async function pmDelete(id) {
  const m = _pmRows.find(r => r.id === id);
  if (!m) return;
  if (!confirm(`Delete "${_pmLabel(m.method_type)} — ${m.account_title}"?\nThis cannot be undone.`)) return;
  const { error } = await supabase.rpc('delete_payment_method', { p_id: id, p_company_id: S.cid });
  if (error) { notify.error('Could not delete', { detail: error.message }); return; }
  notify.success('Method deleted');
  await pmLoad();
}

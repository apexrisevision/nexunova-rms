// ══ ClientForm — the ONE shared client form (Phase 3E) ════════════════════
// nx-kit modal used by: Clients list "Add", Client profile "Edit", and the
// New Sale 5-step flow's client step. Replaces the legacy ~30-field #m-client
// modal AND the 3D inline quick-create — there is exactly one client form now.
//
//   ClientForm.open({ clientId?, projectId?, onSaved? })
//     clientId  → edit mode (prefilled); omit → create mode
//     projectId → preselect+lock the project (New Sale passes the unit's project)
//     onSaved(client) → called after a successful create/update with
//                       { id, full_name, cnic, projectId, status, isNew:false }
//
// Writes via create_client / update_client only (no localStorage path).
// NIC duplicate check is authoritative via check_client_duplicate.
// On EDIT we send ONLY the lean fields we manage — _update_client_core updates
// just the keys present, so the dropped extended fields (kin/bank/photo/…) are
// preserved untouched.

(function (global) {
  const CATS = ['Individual', 'Investor', 'Corporate', 'NRI', 'VIP'];
  const LEAD_SOURCES = ['Walk-in', 'Referral', 'Facebook', 'Instagram', 'Website', 'WhatsApp', 'Property Portal', 'Agent', 'Newspaper', 'Hoarding / Banner', 'Other'];
  let _state = null;   // { clientId, projectId, onSaved, lockProject }
  let _dupTimer = null;

  // A rectangular document-upload tile (CNIC front/back) — shares the photo
  // upload pipeline via _photo(input, which). idk = short id key, which = target.
  function _docUpload(label, idk, which, url) {
    return `<div>
      <label class="nx-label">${esc(label)}</label>
      <div id="cfm-${idk}-prev" style="height:88px;border-radius:var(--fk-radius-control);overflow:hidden;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);display:grid;place-items:center;font-size:11px;color:var(--fk-text-muted)">${url ? '<img src="' + esc(url) + '" style="width:100%;height:100%;object-fit:cover">' : 'No image'}</div>
      <input type="file" id="cfm-${idk}-file" accept="image/jpeg,image/png" style="display:none" onchange="ClientForm._photo(this,'${which}')">
      <input type="hidden" id="cfm-${which}_url" value="${esc(url || '')}">
      ${NX.button('Upload', { variant: 'secondary', size: 'sm', attrs: 'id="cfm-' + idk + '-btn" style="margin-top:6px"', onclick: "document.getElementById('cfm-" + idk + "-file').click()" })}
    </div>`;
  }

  function _projects() {
    const all = (typeof gprojects === 'function' ? gprojects() : (global._projectsCache || [])) || [];
    return all.filter(p => typeof hasProjectAccess !== 'function' || hasProjectAccess(p.id));
  }

  function open(opts) {
    opts = opts || {};
    const clientId = opts.clientId || null;
    const isEdit = !!clientId;
    const c = isEdit && typeof gclient === 'function' ? gclient(clientId) : null;
    if (isEdit && !c) { if (typeof toast === 'function') toast('Client not found', 'warn'); return; }

    const lockProject = !!opts.projectId || isEdit;
    // default a new client to the active-project lens (topbar selector)
    const projId = opts.projectId || c?.projectId || (isEdit ? '' : (typeof activeProjectId === 'function' ? activeProjectId() : '')) || '';
    _state = { clientId, projectId: projId, onSaved: opts.onSaved || null, lockProject };

    const overseas = (c?.overseasLocal === 'overseas');
    const initials = (((c?.fullName || '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('')) || '?').toUpperCase();
    const photoInner = c?.clientPhotoUrl
      ? `<img src="${esc(c.clientPhotoUrl)}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentNode.textContent='${esc(initials)}'">`
      : esc(initials);
    const projOpts = [{ value: '', label: '— Select project —' }]
      .concat(_projects().map(p => ({ value: p.id, label: p.projectName || p.name || 'Project' })));

    const fld = (o) => NX.field(o);
    const body =
      `<div class="nx-grid-2">
        ${fld({ label: 'Full name', name: 'cfm-full_name', required: true, value: c?.fullName || '' })}
        ${fld({ label: 'Father / Husband name', name: 'cfm-father_name', required: true, value: c?.fatherName || '' })}
      </div>
      <div class="nx-grid-2">
        <div>
          ${fld({ label: 'NIC / CNIC', name: 'cfm-cnic', value: c?.cnic || '', placeholder: '42101-1234567-1', attrs: 'oninput="ClientForm._dup(this.value)" autocomplete="off"' })}
          <div id="cfm-dup" class="nx-banner nx-banner--warn" style="display:none;margin-top:6px"></div>
        </div>
        ${fld({ label: 'Phone', name: 'cfm-phone_primary', required: true, value: c?.phonePrimary || '', placeholder: '03xx-xxxxxxx' })}
      </div>
      <div style="display:flex;align-items:center;gap:var(--fk-sp-3);margin:var(--fk-sp-2) 0">
        <div id="cfm-photo-prev" style="width:56px;height:56px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);display:grid;place-items:center;font-size:18px;font-weight:600;color:var(--fk-text-muted)">${photoInner}</div>
        <div>
          <input type="file" id="cfm-photo-file" accept="image/jpeg,image/png" style="display:none" onchange="ClientForm._photo(this)">
          <input type="hidden" id="cfm-photo_url" value="${esc(c?.clientPhotoUrl || '')}">
          ${NX.button('Upload photo', { variant: 'secondary', size: 'sm', attrs: 'id="cfm-photo-btn"', onclick: "document.getElementById('cfm-photo-file').click()" })}
          <div class="nx-kpi-label" style="text-transform:none;margin-top:4px">JPG or PNG · auto-resized to 512px</div>
        </div>
      </div>
      <label class="nx-check" style="display:flex;align-items:center;gap:8px;margin:var(--fk-sp-2) 0;font-size:13px;color:var(--fk-text-muted);cursor:pointer">
        <input type="checkbox" id="cfm-overseas" ${overseas ? 'checked' : ''} onchange="ClientForm._overseas(this.checked)"> Overseas client (no CNIC — uses passport)
      </label>
      <div id="cfm-passport-wrap" style="${overseas ? '' : 'display:none'}">
        ${fld({ label: 'Passport no', name: 'cfm-passport_no', value: c?.passportNo || '' })}
      </div>
      ${isEdit ? '' : `<div id="cfm-project-wrap" style="${lockProject ? 'display:none' : ''}">${fld({ label: 'Project', name: 'cfm-project', el: 'select', required: true, options: projOpts, value: projId })}</div>`}
      <details style="margin-top:var(--fk-sp-2)"${c && (c.address || c.city || c.email || c.clientCategory || c.referenceBy || c.notes || c.occupation || c.monthlyIncome || c.ntn || c.phoneSecondary || c.companyName || c.leadSource || c.cnicFrontUrl || c.cnicBackUrl || c.bankName || c.bankAccountTitle || c.bankAccountNo || c.bankIban || c.nextOfKinName || c.nextOfKinPhone || c.nextOfKinRelation || c.nextOfKinCnic || c.nextOfKinPhotoUrl) ? ' open' : ''}>
        <summary style="cursor:pointer;font-size:13px;color:var(--fk-text-muted)">More details</summary>
        <div style="margin-top:var(--fk-sp-3)">
          ${fld({ label: 'Address', name: 'cfm-address', el: 'textarea', value: c?.address || '' })}
          <div class="nx-grid-2">
            ${fld({ label: 'City', name: 'cfm-city', value: c?.city || '' })}
            ${fld({ label: 'Country', name: 'cfm-country', value: c?.country || 'Pakistan' })}
          </div>
          <div class="nx-grid-2">
            ${fld({ label: 'Secondary phone', name: 'cfm-phone_secondary', value: c?.phoneSecondary || '', placeholder: '03xx-xxxxxxx' })}
            ${fld({ label: 'WhatsApp', name: 'cfm-whatsapp', value: c?.whatsapp || '' })}
          </div>
          <div class="nx-grid-2">
            ${fld({ label: 'Email', name: 'cfm-email', value: c?.email || '' })}
            ${fld({ label: 'Category', name: 'cfm-client_category', el: 'select', value: c?.clientCategory || 'Individual', options: CATS.map(x => ({ value: x, label: x })) })}
          </div>
          <div class="nx-grid-2">
            ${fld({ label: 'Referred by', name: 'cfm-reference_by', value: c?.referenceBy || '' })}
            ${fld({ label: 'Lead source', name: 'cfm-lead_source', el: 'select', value: c?.leadSource || '', options: [{ value: '', label: '— Select —' }].concat(LEAD_SOURCES.map(x => ({ value: x, label: x }))) })}
          </div>
          <div class="nx-grid-2">
            ${fld({ label: 'Occupation', name: 'cfm-occupation', value: c?.occupation || '' })}
            ${fld({ label: 'Company / Employer', name: 'cfm-company_name', value: c?.companyName || '' })}
          </div>
          <div class="nx-grid-2">
            ${fld({ label: 'Monthly income (PKR)', name: 'cfm-monthly_income', value: (c?.monthlyIncome ?? ''), attrs: 'inputmode="numeric"' })}
            ${fld({ label: 'NTN #', name: 'cfm-ntn', value: c?.ntn || '', placeholder: '1234567-8' })}
          </div>
          ${isEdit ? fld({ label: 'Status', name: 'cfm-status', el: 'select', value: c?.status || 'active', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Historical / Inactive' }] }) : ''}
          ${fld({ label: 'Notes', name: 'cfm-notes', el: 'textarea', value: c?.notes || '' })}

          <div class="nx-kpi-label" style="text-transform:none;margin-top:var(--fk-sp-4);margin-bottom:var(--fk-sp-2);color:var(--fk-text)">Identity Documents (CNIC)</div>
          <div class="nx-grid-2">
            ${_docUpload('CNIC front', 'cnicf', 'cnic_front', c?.cnicFrontUrl)}
            ${_docUpload('CNIC back', 'cnicb', 'cnic_back', c?.cnicBackUrl)}
          </div>

          <div class="nx-kpi-label" style="text-transform:none;margin-top:var(--fk-sp-4);margin-bottom:var(--fk-sp-1);color:var(--fk-text)">Bank Details <span style="text-transform:none;font-weight:400">· for refunds / verification</span></div>
          <div class="nx-grid-2">
            ${fld({ label: 'Bank name', name: 'cfm-bank_name', value: c?.bankName || '' })}
            ${fld({ label: 'Account title', name: 'cfm-bank_account_title', value: c?.bankAccountTitle || '' })}
          </div>
          <div class="nx-grid-2">
            ${fld({ label: 'Account number', name: 'cfm-bank_account_no', value: c?.bankAccountNo || '' })}
            ${fld({ label: 'IBAN', name: 'cfm-bank_iban', value: c?.bankIban || '', placeholder: 'PK00XXXX0000000000000000' })}
          </div>
          <div class="nx-kpi-label" style="text-transform:none;margin-top:var(--fk-sp-3);margin-bottom:var(--fk-sp-1);color:var(--fk-text)">Nominee / Next of Kin</div>
          <div class="nx-grid-2">
            ${fld({ label: 'Nominee name', name: 'cfm-kin_name', value: c?.nextOfKinName || '' })}
            ${fld({ label: 'Relation', name: 'cfm-kin_relation', el: 'select', value: c?.nextOfKinRelation || '', options: [{ value: '', label: '— Relation —' }].concat(['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other'].map(x => ({ value: x, label: x }))) })}
          </div>
          <div class="nx-grid-2">
            ${fld({ label: 'Nominee phone', name: 'cfm-kin_phone', value: c?.nextOfKinPhone || '', placeholder: '03xx-xxxxxxx' })}
            ${fld({ label: 'Nominee CNIC', name: 'cfm-kin_cnic', value: c?.nextOfKinCnic || '', placeholder: '42101-1234567-1' })}
          </div>
          <div style="display:flex;align-items:center;gap:var(--fk-sp-3);margin:var(--fk-sp-2) 0">
            <div id="cfm-kin-photo-prev" style="width:56px;height:56px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);display:grid;place-items:center;font-size:18px;font-weight:600;color:var(--fk-text-muted)">${c?.nextOfKinPhotoUrl ? `<img src="${esc(c.nextOfKinPhotoUrl)}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentNode.textContent='N'">` : 'N'}</div>
            <div>
              <input type="file" id="cfm-kin-photo-file" accept="image/jpeg,image/png" style="display:none" onchange="ClientForm._photo(this,'nominee')">
              <input type="hidden" id="cfm-kin_photo_url" value="${esc(c?.nextOfKinPhotoUrl || '')}">
              ${NX.button('Upload nominee photo', { variant: 'secondary', size: 'sm', attrs: 'id="cfm-kin-photo-btn"', onclick: "document.getElementById('cfm-kin-photo-file').click()" })}
              <div class="nx-kpi-label" style="text-transform:none;margin-top:4px">JPG or PNG · auto-resized to 512px</div>
            </div>
          </div>
        </div>
      </details>
      <div id="cfm-error" class="nx-error" style="margin-top:var(--fk-sp-2)"></div>`;

    const footer =
      NX.button('Cancel', { variant: 'ghost', onclick: 'ClientForm.close()' }) +
      NX.button(isEdit ? 'Save changes' : 'Create client', { variant: 'primary', onclick: 'ClientForm.save()', attrs: 'id="cfm-save"' });

    document.body.insertAdjacentHTML('beforeend', NX.modal({
      id: 'cfm-modal', title: isEdit ? 'Edit client' : 'Add client', size: 'm',
      onClose: 'ClientForm.close()', body, footer
    }));
    setTimeout(() => { const f = document.getElementById('cfm-full_name'); if (f) f.focus(); }, 30);
  }

  function close() { const m = document.getElementById('cfm-modal'); if (m) m.remove(); _state = null; }

  function _overseas(on) {
    const w = document.getElementById('cfm-passport-wrap'); if (w) w.style.display = on ? '' : 'none';
  }

  // Client photo — same legacy storage mechanism (rms-documents bucket, clients/photos
  // folder, public URL → client_photo_url) plus a client-side resize to <=512px.
  function _resize(file, max) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > max || h > max) { const s = Math.min(max / w, max / h); w = Math.round(w * s); h = Math.round(h * s); }
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        cv.toBlob(b => b ? resolve(b) : reject(new Error('resize failed')), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not a valid image')); };
      img.src = url;
    });
  }

  // which = 'client' (default) | 'nominee' — same mechanism (rms-documents bucket,
  // clients/photos path, ≤512px resize), different target hidden input + preview (#19/#20).
  async function _photo(input, which) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) { if (typeof toast === 'function') toast('JPG or PNG only', 'warn'); input.value = ''; return; }
    const TARGETS = {
      nominee:    { btn: 'cfm-kin-photo-btn', hidden: 'cfm-kin_photo_url',  prev: 'cfm-kin-photo-prev', label: 'Upload nominee photo' },
      cnic_front: { btn: 'cfm-cnicf-btn',     hidden: 'cfm-cnic_front_url', prev: 'cfm-cnicf-prev',     label: 'Upload' },
      cnic_back:  { btn: 'cfm-cnicb-btn',     hidden: 'cfm-cnic_back_url',  prev: 'cfm-cnicb-prev',     label: 'Upload' },
    };
    const ids = TARGETS[which] || { btn: 'cfm-photo-btn', hidden: 'cfm-photo_url', prev: 'cfm-photo-prev', label: 'Upload photo' };
    const _docName = { nominee: 'Nominee photo', cnic_front: 'CNIC front', cnic_back: 'CNIC back' }[which] || 'Photo';
    const btn = document.getElementById(ids.btn);
    const setLabel = t => { if (btn) { const s = btn.querySelector('span'); if (s) s.textContent = t; } };
    if (btn) btn.disabled = true; setLabel('Uploading…');
    try {
      const blob = await _resize(file, 512);
      const cid = (typeof S !== 'undefined' && S && S.cid) ? S.cid : 'shared';
      const path = cid + '/clients/photos/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.jpg';
      const up = await supabase.storage.from('rms-documents').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const pub = supabase.storage.from('rms-documents').getPublicUrl(path).data.publicUrl;
      const hidden = document.getElementById(ids.hidden); if (hidden) hidden.value = pub;
      const prev = document.getElementById(ids.prev);
      if (prev) prev.innerHTML = '<img src="' + pub + '" style="width:100%;height:100%;object-fit:cover">';
      if (typeof toast === 'function') toast(_docName + ' uploaded', 'ok');
    } catch (e) {
      if (typeof toast === 'function') toast('Upload failed: ' + (e.message || e), 'err');
    } finally {
      if (btn) btn.disabled = false; setLabel(ids.label); input.value = '';
    }
  }

  function _dup(v) {
    clearTimeout(_dupTimer);
    _dupTimer = setTimeout(() => _dupCheck(v), 350);
  }
  async function _dupCheck(v) {
    const warn = document.getElementById('cfm-dup'); if (!warn) return;
    v = (v || '').trim();
    if (!v) { warn.style.display = 'none'; return; }
    try {
      const { data } = await supabase.rpc('check_client_duplicate', { p_company_id: S.cid, p_cnic: v, p_phone: null });
      if (data && data.found && data.id !== (_state && _state.clientId)) {
        warn.innerHTML = `${NX.icon('alert-triangle', 16)}<span>NIC already registered: <strong>${esc(data.full_name)}</strong> (${esc(data.client_code)}). Consider opening that client instead of creating a duplicate.</span>`;
        warn.style.display = '';
      } else { warn.style.display = 'none'; }
    } catch (e) { /* non-blocking */ }
  }

  function _val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

  async function save() {
    if (typeof demoGuard === 'function' && demoGuard('Save Client')) return;
    const err = document.getElementById('cfm-error');
    if (err) err.textContent = '';
    const isEdit = !!(_state && _state.clientId);

    const name = _val('cfm-full_name'), father = _val('cfm-father_name'), phone = _val('cfm-phone_primary');
    const cnic = _val('cfm-cnic'), email = _val('cfm-email');
    const overseas = document.getElementById('cfm-overseas')?.checked;
    const projId = _state.projectId || _val('cfm-project');

    const fail = (m) => { if (err) err.textContent = m; return false; };
    if (name.length < 2) return fail('Full name is required (min 2 characters).');
    if (!father) return fail('Father / Husband name is required.');
    if (!phone) return fail('Phone number is required.');
    if (!overseas && !cnic) return fail('NIC is required (or tick “Overseas client”).');
    if (cnic && !/^\d{5}-\d{7}-\d$/.test(cnic)) return fail('NIC format: 42101-1234567-1');
    const kinCnic = _val('cfm-kin_cnic');
    if (kinCnic && !/^\d{5}-\d{7}-\d$/.test(kinCnic)) return fail('Nominee CNIC format: 42101-1234567-1');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Invalid email format.');
    if (!isEdit && !projId) return fail('Project is required.');

    // managed-fields-only payload (edit preserves dropped fields — _update_client_core updates present keys only)
    const payload = {
      full_name: name, father_name: father,
      cnic: overseas ? null : cnic, passport_no: overseas ? (_val('cfm-passport_no') || null) : null,
      phone_primary: phone, phone_secondary: _val('cfm-phone_secondary') || null,
      whatsapp: _val('cfm-whatsapp') || null, email: email || null,
      address: _val('cfm-address') || null, city: _val('cfm-city') || null, country: _val('cfm-country') || 'Pakistan',
      client_category: _val('cfm-client_category') || null, reference_by: _val('cfm-reference_by') || null,
      lead_source: _val('cfm-lead_source') || null,
      occupation: _val('cfm-occupation') || null, company_name: _val('cfm-company_name') || null,
      cnic_front_url: _val('cfm-cnic_front_url') || null, cnic_back_url: _val('cfm-cnic_back_url') || null,
      bank_name: _val('cfm-bank_name') || null, bank_account_title: _val('cfm-bank_account_title') || null,
      bank_account_no: _val('cfm-bank_account_no') || null, bank_iban: _val('cfm-bank_iban') || null,
      monthly_income: _val('cfm-monthly_income') ? Number(String(_val('cfm-monthly_income')).replace(/[^\d.]/g, '')) || null : null,
      ntn: _val('cfm-ntn') || null,
      notes: _val('cfm-notes') || null, overseas_local: overseas ? 'overseas' : 'local',
      next_of_kin_name: _val('cfm-kin_name') || null,
      next_of_kin_relation: _val('cfm-kin_relation') || null,
      next_of_kin_phone: _val('cfm-kin_phone') || null,
      next_of_kin_cnic: kinCnic || null,
      next_of_kin_photo_url: _val('cfm-kin_photo_url') || null,
      client_photo_url: _val('cfm-photo_url') || null
    };

    const btn = document.getElementById('cfm-save');
    if (btn) { btn.disabled = true; const sp = btn.querySelector('span'); if (sp) sp.textContent = 'Saving…'; }

    try {
      let res;
      if (isEdit) {
        payload.status = _val('cfm-status') || 'active';
        const r = await supabase.rpc('update_client', { p_id: _state.clientId, p_company_id: S.cid, p_data: payload });
        if (r.error) throw r.error; res = r.data;
      } else {
        payload.company_id = S.cid; payload.project_id = projId; payload.created_by = S.userId || null;
        payload.status = 'active';
        const r = await supabase.rpc('create_client', { p_data: payload });
        if (r.error) throw r.error; res = r.data;
      }
      if (!res || !res.success) {
        if (res && res.error === 'plan_limit') return fail(res.message || 'Client limit reached — upgrade your plan.');
        if (res && res.duplicate_field === 'cnic') return fail('This NIC is already registered to another client.');
        return fail((res && (res.message || res.error)) || 'Save failed.');
      }
      const clientId = isEdit ? _state.clientId : (res.id || res.client_id);
      const cb = _state.onSaved;
      if (typeof loadClientsCache === 'function') { try { await loadClientsCache(S.cid); } catch (e) {} }
      if (typeof logA === 'function') logA('client', (isEdit ? 'Updated' : 'Added') + ' client: ' + name);
      if (typeof toast === 'function') toast(isEdit ? 'Client updated' : 'Client added', 'ok');
      close();
      if (cb) cb({ id: clientId, full_name: name, cnic: payload.cnic, projectId: projId, status: payload.status, isNew: false });
    } catch (e) {
      if (btn) { btn.disabled = false; const sp = btn.querySelector('span'); if (sp) sp.textContent = isEdit ? 'Save changes' : 'Create client'; }
      fail('Could not save client: ' + (e.message || e));
    }
  }

  global.ClientForm = { open, close, save, _dup, _overseas, _dupCheck, _photo };
})(window);

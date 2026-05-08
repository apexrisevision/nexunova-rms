// ══ CLIENTS MODULE ════════════════════════════════════════
// Storage: localStorage only — gdb() / sdb()  |  No Supabase

const CF_FLAGS = {
  Pakistan:'🇵🇰', UAE:'🇦🇪', USA:'🇺🇸', UK:'🇬🇧', 'Saudi Arabia':'🇸🇦',
  Qatar:'🇶🇦', Kuwait:'🇰🇼', Bahrain:'🇧🇭', Oman:'🇴🇲', Canada:'🇨🇦',
  Australia:'🇦🇺', Germany:'🇩🇪', France:'🇫🇷', Turkey:'🇹🇷', India:'🇮🇳',
  China:'🇨🇳', Bangladesh:'🇧🇩', Philippines:'🇵🇭', Malaysia:'🇲🇾',
  Afghanistan:'🇦🇫', Egypt:'🇪🇬', Morocco:'🇲🇦', Indonesia:'🇮🇩'
};

const CF_COUNTRIES = [
  '', 'Afghanistan', 'Australia', 'Bahrain', 'Bangladesh', 'Canada',
  'China', 'Egypt', 'France', 'Germany', 'India', 'Indonesia', 'Iran',
  'Iraq', 'Jordan', 'Kuwait', 'Lebanon', 'Malaysia', 'Morocco', 'Oman',
  'Pakistan', 'Philippines', 'Qatar', 'Saudi Arabia', 'Singapore',
  'Sri Lanka', 'Syria', 'Turkey', 'UAE', 'UK', 'USA', 'Yemen', 'Other'
];

let _iti = null;
let _clientSaving = false;

// ── Cleanup ────────────────────────────────────────────────

function cleanTestClients() {
  const cid = S?.cid;
  const db = gdb();
  if(!db.clients?.[cid]?.length) return;
  const orig = db.clients[cid].length;
  db.clients[cid] = db.clients[cid].filter(c =>
    !(c.name || '').toLowerCase().startsWith('test')
  );
  if(db.clients[cid].length !== orig) sdb(db);
}

// ── Import existing clients from units (one-time migration) ───

function importClientsFromUnits() {
  const cid = S?.cid;
  if(!cid) return;

  const db = gdb();
  db.clients = db.clients || {};
  db.clients[cid] = db.clients[cid] || [];

  const knownNames = new Set(
    db.clients[cid].map(c => (c.name || '').toLowerCase())
  );

  let added = 0;
  gunits().forEach(u => {
    if(!u.customerName) return;
    if(knownNames.has(u.customerName.toLowerCase())) return;
    knownNames.add(u.customerName.toLowerCase());
    db.clients[cid].push({
      id:          uid(),
      company_id:  cid,
      name:        u.customerName,
      phone:       u.phone || '',
      id_number:   u.cnic || '',
      cnic:        u.cnic || '',
      id_type:     'CNIC',
      email:       u.email || '',
      nationality: 'Pakistan'
    });
    added++;
  });

  if(added > 0) sdb(db);
}

// ── List page ──────────────────────────────────────────────

function rClients() {
  importClientsFromUnits();
  cleanTestClients();
  const cid = S?.cid;
  if(!cid) {
    document.getElementById('pg-clients').innerHTML =
      `<div class="card"><div class="empty"><div class="ei">⚠️</div><div class="et">No company selected</div></div></div>`;
    return;
  }
  const isA = S.role === 'admin';
  document.getElementById('pg-clients').innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l"><h2>All Clients</h2><p id="cl-count"></p></div>
      <div class="ph-r">${isA ? `<button class="btn btn-g btn-sm" onclick="openClientModal(null)">+ Add Client</button>` : ''}</div>
    </div>
    <div class="sbar">
      <span class="sbar-ic">🔍</span>
      <input class="sinp" id="c-s" placeholder="Search name, phone, ID, city..." value="${esc(_cs)}" oninput="setCS(this.value)">
    </div>
    <div id="cl-ct"></div>
  </div>`;
  rCLF();
}

function setCS(q) { _cs = q; rCLF(); }

function rCLF() {
  const cid = S?.cid;
  if(!cid) return;
  const ct = document.getElementById('cl-ct');
  if(!ct) return;

  const db = gdb();
  const allUnits = db.units?.[cid] || [];
  let clients = (db.clients?.[cid] || []).map(c => ({...c}));

  // Merge legacy unit-derived clients (backwards compat)
  const knownNames = new Set(clients.map(c => (c.name || '').toLowerCase()));
  allUnits.forEach(u => {
    if(u.customerName && !knownNames.has(u.customerName.toLowerCase())) {
      knownNames.add(u.customerName.toLowerCase());
      clients.push({
        id: 'unit_' + u.id, name: u.customerName, phone: u.phone || '',
        id_number: u.cnic || '', cnic: u.cnic || '', id_type: 'CNIC',
        company_id: cid, _fromUnit: true
      });
    }
  });

  // Search filter
  if(_cs) {
    const q = _cs.toLowerCase();
    clients = clients.filter(c =>
      (c.name       || '').toLowerCase().includes(q) ||
      (c.phone      || '').includes(q) ||
      (c.id_number  || c.cnic || '').toLowerCase().includes(q) ||
      (c.email      || '').toLowerCase().includes(q) ||
      (c.city       || '').toLowerCase().includes(q)
    );
  }

  const countEl = document.getElementById('cl-count');
  if(countEl) countEl.textContent = clients.length + (clients.length === 1 ? ' client' : ' clients');

  if(!clients.length) {
    ct.innerHTML = `<div class="card"><div class="empty"><div class="ei">👥</div><div class="et">No clients found</div></div></div>`;
    return;
  }

  ct.innerHTML = `<div class="ul">` + clients.map(c => {
    const uc   = allUnits.filter(u => u.customerName === c.name || u.client_id === c.id).length;
    const paid = allUnits.filter(u => u.customerName === c.name || u.client_id === c.id)
                         .reduce((s, u) => s + Number(u.totalPaid || 0), 0);
    const flag = CF_FLAGS[c.nationality] || CF_FLAGS[c.country] || '';
    const idNo = c.id_number || c.cnic || '';
    return `<div class="ur" onclick="openClientDetail('${c.id}')">
      <div class="ur-no">${flag ? flag + ' ' : ''}${esc(c.name || 'Unnamed')}</div>
      <div class="ur-meta">
        <div class="ur-name">${c.phone ? esc(c.phone) : '—'}${c.city ? ' · ' + esc(c.city) : ''}</div>
        <div class="ur-sub">${idNo ? esc(idNo) : 'No ID'} · ${uc} unit${uc !== 1 ? 's' : ''}${paid > 0 ? ' · PKR ' + Number(paid).toLocaleString('en-PK') : ''}</div>
      </div>
      <div class="arr">›</div>
    </div>`;
  }).join('') + `</div>`;
}

// ── Detail page ────────────────────────────────────────────

function openClientDetail(id) { _cid = id; rClientDetail(); }

function rClientDetail() {
  const clientId = _cid;
  if(!clientId) { nav('clients'); return; }
  const cid = S?.cid;
  if(!cid) { nav('clients'); return; }

  const db = gdb();
  let client = (db.clients?.[cid] || []).find(c => c.id === clientId);

  // Legacy: unit-derived client
  if(!client && clientId.startsWith('unit_')) {
    const u = (db.units?.[cid] || []).find(u => u.id === clientId.slice(5));
    if(u) client = {
      id: clientId, name: u.customerName, phone: u.phone || '',
      id_number: u.cnic || '', cnic: u.cnic || '', id_type: 'CNIC', company_id: cid
    };
  }

  if(!client) { nav('clients'); return; }

  const isA = S.role === 'admin';
  const allUnits   = db.units?.[cid] || [];
  const clientUnits = allUnits.filter(u => u.customerName === client.name || u.client_id === clientId);
  const flag = CF_FLAGS[client.nationality] || CF_FLAGS[client.country] || '👤';

  const totalPrice = clientUnits.reduce((s, u) => s + Number(u.totalPrice || 0), 0);
  const totalPaid  = clientUnits.reduce((s, u) => s + Number(u.totalPaid  || 0), 0);
  const totalPend  = Math.max(0, totalPrice - totalPaid);

  const row = (l, v) => `<div class="ir"><span class="ir-l">${l}</span><span class="ir-r">${v}</span></div>`;

  document.getElementById('pg-clientdetail').innerHTML = `<div class="ani">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px" class="no-p">
      <button class="bk" onclick="nav('clients')">← Back</button>
      ${isA ? `<button class="btn btn-gh btn-sm" onclick="openClientModal('${clientId}')">✏ Edit</button>` : ''}
      ${isA ? `<button class="btn btn-r btn-sm" onclick="deleteClientConfirm('${clientId}')">🗑 Delete</button>` : ''}
    </div>

    <div class="card mb14">
      <div class="cb">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <h2 style="font-size:24px;font-weight:700;margin-bottom:6px">${flag} ${esc(client.name || 'Unnamed')}</h2>
            <div style="font-size:12px;color:var(--t3)">${esc(client.nationality || '')}${client.nationality ? ' · ' : ''}${client.id_type || 'ID'}: ${esc(client.id_number || client.cnic || '—')}</div>
          </div>
          <div style="display:flex;gap:7px;flex-wrap:wrap" class="no-p">
            ${client.phone ? `<a href="tel:${client.phone}" class="btn btn-gh btn-sm">📱 Call</a>` : ''}
            ${client.phone ? `<a href="https://wa.me/${client.phone.replace(/[^0-9]/g,'')}" target="_blank" class="btn btn-gh btn-sm">💬 WhatsApp</a>` : ''}
            ${client.email ? `<a href="mailto:${client.email}" class="btn btn-gh btn-sm">✉ Email</a>` : ''}
          </div>
        </div>
        ${totalPrice > 0 ? `
        <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
          <div style="font-size:11px;color:var(--t3)">Total Portfolio<br><span style="font-size:15px;font-weight:700;color:var(--t1)">PKR ${Number(totalPrice).toLocaleString('en-PK')}</span></div>
          <div style="font-size:11px;color:var(--t3)">Total Paid<br><span style="font-size:15px;font-weight:700;color:var(--ok)">PKR ${Number(totalPaid).toLocaleString('en-PK')}</span></div>
          <div style="font-size:11px;color:var(--t3)">Pending<br><span style="font-size:15px;font-weight:700;color:${totalPend > 0 ? 'var(--err)' : 'var(--ok)'}">PKR ${Number(totalPend).toLocaleString('en-PK')}</span></div>
        </div>` : ''}
      </div>
    </div>

    <div class="cd">
      <div style="display:flex;flex-direction:column;gap:13px">
        <div class="card">
          <div class="ch"><h3>👤 Personal Info</h3></div>
          <div class="cb">
            ${row('Full Name',  esc(client.name || '—'))}
            ${row('Phone',      client.phone ? `<a href="tel:${client.phone}" style="color:var(--info);text-decoration:none">${esc(client.phone)}</a>` : '—')}
            ${row('Email',      client.email ? `<a href="mailto:${client.email}" style="color:var(--info);text-decoration:none">${esc(client.email)}</a>` : '—')}
            ${row(client.id_type || 'ID', esc(client.id_number || client.cnic || '—'))}
            ${client.dob         ? row('Date of Birth', esc(client.dob))        : ''}
            ${client.gender      ? row('Gender',        esc(client.gender))     : ''}
            ${client.nationality ? row('Nationality',   esc(client.nationality)): ''}
            ${client.occupation  ? row('Occupation',    esc(client.occupation)) : ''}
          </div>
        </div>
        ${(client.street || client.city || client.country) ? `
        <div class="card">
          <div class="ch"><h3>📍 Address</h3></div>
          <div class="cb">
            ${client.street  ? row('Street',  esc(client.street))  : ''}
            ${client.city    ? row('City',    esc(client.city))    : ''}
            ${client.country ? row('Country', esc(client.country)) : ''}
          </div>
        </div>` : ''}
        ${(client.em_name || client.em_phone || client.remarks) ? `
        <div class="card">
          <div class="ch"><h3>📝 Extra</h3></div>
          <div class="cb">
            ${client.em_name ? row('Emergency', esc(client.em_name) + (client.em_phone ? ' · ' + esc(client.em_phone) : '')) : ''}
            ${client.remarks ? row('Remarks',   esc(client.remarks)) : ''}
          </div>
        </div>` : ''}
      </div>

      <div style="display:flex;flex-direction:column;gap:13px">
        <div class="card">
          <div class="ch"><div><h3>🏢 Units Owned</h3><p>${clientUnits.length} unit(s)</p></div></div>
          ${!clientUnits.length
            ? `<div class="empty"><div class="ei">🏢</div><div class="et">No units owned</div></div>`
            : `<div class="ul">` + clientUnits.map(u => {
                const p   = Number(u.totalPaid || 0);
                const r   = Math.max(0, Number(u.totalPrice || 0) - p);
                const pct = u.totalPrice > 0 ? Math.round(p / u.totalPrice * 100) : 0;
                return `<div class="ur" onclick="nav('units');setTimeout(()=>openUD('${u.id}'),100)">
                  <div class="ur-no">${esc(u.unitNo || u.unit_no || '—')}</div>
                  <div style="flex-shrink:0">${sbadge(u.status)}</div>
                  <div class="ur-meta">
                    <div class="ur-name">${esc(u.type || '—')}</div>
                    <div class="ur-sub">${esc(u.floorLabel || u.floor || '—')} · ${esc(String(u.area || '—'))} sqft</div>
                  </div>
                  ${u.totalPrice > 0
                    ? `<div style="flex-shrink:0;width:68px"><div class="pbar"><div class="pbar-f" style="width:${pct}%"></div></div><div style="font-size:9px;color:var(--t3);margin-top:2px">${pct}% paid</div></div>
                       <div class="ur-bal"><div class="ur-v" style="color:${r>0?'var(--err)':'var(--ok)'}">${fM(r>0?r:p)}</div><div class="ur-vs">${r>0?'pending':'paid'}</div></div>`
                    : ''}
                  <div class="arr">›</div>
                </div>`;
              }).join('') + `</div>`
          }
        </div>
      </div>
    </div>
  </div>`;
}

// ── Modal open/close ───────────────────────────────────────

function openClientModal(clientId) {
  const isEdit = !!clientId;
  document.getElementById('client-mtl').textContent = isEdit ? '✏ Edit Client' : '👤 Add Client';
  document.getElementById('cf-client-id').value = clientId || '';

  // Reset all fields
  ['cf-name','cf-dob','cf-occ','cf-email','cf-street','cf-city',
   'cf-em-name','cf-em-phone','cf-remarks','cf-id-num']
    .forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  const sv = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
  sv('cf-gender',  '');
  sv('cf-nat',     'Pakistan');
  sv('cf-country', '');
  sv('cf-id-type', 'CNIC');

  // Clear errors
  document.querySelectorAll('#m-client .cf-err').forEach(el => el.textContent = '');
  document.querySelectorAll('#m-client .cf-inp').forEach(el => el.style.borderColor = '');

  // Populate if editing
  if(isEdit) {
    const c = (gdb().clients?.[S.cid] || []).find(x => x.id === clientId);
    if(c) {
      const set = (id, v) => { const el = document.getElementById(id); if(el && v != null) el.value = v; };
      set('cf-name',     c.name);
      set('cf-dob',      c.dob);
      set('cf-gender',   c.gender);
      set('cf-nat',      c.nationality);
      set('cf-id-type',  c.id_type || 'CNIC');
      set('cf-id-num',   c.id_number || c.cnic);
      set('cf-occ',      c.occupation);
      set('cf-email',    c.email);
      set('cf-em-name',  c.em_name);
      set('cf-em-phone', c.em_phone);
      set('cf-street',   c.street);
      set('cf-city',     c.city);
      set('cf-country',  c.country);
      set('cf-remarks',  c.remarks);
    }
  }

  cfUpdateIdPlaceholder();
  om('m-client');

  // Init intl-tel-input after modal renders
  setTimeout(() => {
    const phoneInp = document.getElementById('cf-phone');
    if(!phoneInp) return;
    if(_iti) { try { _iti.destroy(); } catch(e) {} _iti = null; }
    if(window.intlTelInput) {
      _iti = window.intlTelInput(phoneInp, {
        initialCountry: 'pk',
        preferredCountries: ['pk','ae','sa','gb','us','ca','au'],
        separateDialCode: true,
        utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@23.1.0/build/js/utils.js'
      });
      if(isEdit) {
        const c = (gdb().clients?.[S.cid] || []).find(x => x.id === clientId);
        if(c?.phone) { try { _iti.setNumber(c.phone); } catch(e) {} }
      }
    }
  }, 80);
}

function closeClientModal() { cm('m-client'); }

// ── Form helpers ───────────────────────────────────────────

function cfUpdateIdPlaceholder() {
  const nat      = document.getElementById('cf-nat')?.value;
  const idTypeEl = document.getElementById('cf-id-type');
  const idNumEl  = document.getElementById('cf-id-num');
  const idLbl    = document.getElementById('cf-id-lbl');
  if(!idNumEl) return;
  if(nat === 'Pakistan') {
    if(idTypeEl) idTypeEl.value = 'CNIC';
    idNumEl.placeholder = '42101-1234567-1';
    if(idLbl) idLbl.textContent = 'CNIC *';
  } else {
    if(idTypeEl && idTypeEl.value === 'CNIC') idTypeEl.value = 'Passport';
    idNumEl.placeholder = 'Passport or National ID number';
    if(idLbl) idLbl.textContent = 'ID / Passport *';
  }
}

function cfV(inp) {
  const val   = inp.value.trim();
  const errEl = document.getElementById('e-' + inp.id);
  let msg = '';
  if(inp.id === 'cf-name') {
    if(val && val.length < 3)      msg = 'Min 3 characters required';
    else if(val && /\d/.test(val)) msg = 'Name cannot contain numbers';
  } else if(inp.id === 'cf-id-num') {
    const nat  = document.getElementById('cf-nat')?.value;
    const type = document.getElementById('cf-id-type')?.value;
    if(val && nat === 'Pakistan' && type === 'CNIC' && !/^\d{5}-\d{7}-\d$/.test(val))
      msg = 'Format: 42101-1234567-1';
  } else if(inp.id === 'cf-email') {
    if(val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) msg = 'Invalid email format';
  } else if(inp.id === 'cf-phone') {
    const digits = (_iti ? _iti.getNumber() : val).replace(/\D/g,'');
    if(val && digits.length < 7)  msg = 'Phone number too short';
    if(val && digits.length > 15) msg = 'Phone number too long';
  }
  if(errEl) errEl.textContent = msg;
  inp.style.borderColor = msg ? 'var(--err)' : '';
}

// ── Save ───────────────────────────────────────────────────

function saveClientForm() {
  console.log('Save clicked');
  console.log('DB:', gdb());
  console.log('CID:', S?.cid);

  const name = document.getElementById('cf-name')?.value?.trim();
  if(!name) { alert('Name is required!'); return; }

  const rawPhone = document.getElementById('cf-phone')?.value?.trim() || '';
  const itiNum   = _iti ? _iti.getNumber() : '';
  const phone    = itiNum.replace(/\D/g,'').length > 4 ? itiNum : rawPhone;

  const db = gdb();
  db.clients = db.clients || {};
  db.clients[S.cid] = db.clients[S.cid] || [];
  const client = { id: uid(), cid: S.cid, name, phone, createdAt: new Date().toISOString() };
  db.clients[S.cid].push(client);
  sdb(db);

  console.log('Saved client:', client);
  console.log('DB after save:', gdb());

  alert('Client saved successfully! Name: ' + name);
  cm('m-client');
  rClients();
}

// ── Delete ─────────────────────────────────────────────────

function deleteClientConfirm(clientId) {
  const db  = gdb();
  const cid = S?.cid;
  const c   = (db.clients?.[cid] || []).find(x => x.id === clientId);
  if(!confirm(`Delete ${c?.name || 'this client'}? This cannot be undone.`)) return;
  if(db.clients?.[cid]) {
    db.clients[cid] = db.clients[cid].filter(x => x.id !== clientId);
    sdb(db);
  }
  toast('Client deleted', 'ok');
  nav('clients');
}

// ══ AGENTS MODULE ════════════════════════════════════════
// Storage: localStorage only — gdb() / sdb()

let _agS  = '';
let _agId = null;
let _agIti = null;

// ── List page ──────────────────────────────────────────

function rAgents() {
  const cid = S?.cid;
  if (!cid) {
    document.getElementById('pg-agents').innerHTML =
      `<div class="card"><div class="empty"><div class="ei">⚠️</div><div class="et">No company selected</div></div></div>`;
    return;
  }
  const isA = S.role === 'admin';
  document.getElementById('pg-agents').innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l"><h2>Sales Agents</h2><p id="ag-count"></p></div>
      <div class="ph-r">${isA ? `<button class="btn btn-g btn-sm" onclick="openAgentModal(null)">+ Add Agent</button>` : ''}</div>
    </div>
    <div class="sbar">
      <span class="sbar-ic">🔍</span>
      <input class="sinp" id="ag-s" placeholder="Search name, phone, email..." value="${esc(_agS)}" oninput="setAGS(this.value)">
    </div>
    <div id="ag-ct"></div>
  </div>`;
  rAGF();
}

function setAGS(q) { _agS = q; rAGF(); }

function rAGF() {
  const cid = S?.cid;
  if (!cid) return;
  const ct = document.getElementById('ag-ct');
  if (!ct) return;

  const db       = gdb();
  const allUnits = db.units?.[cid] || [];
  let   agents   = (db.agents?.[cid] || []).map(a => ({...a}));

  if (_agS) {
    const q = _agS.toLowerCase();
    agents = agents.filter(a =>
      (a.name  || '').toLowerCase().includes(q) ||
      (a.phone || '').includes(q) ||
      (a.email || '').toLowerCase().includes(q)
    );
  }

  const countEl = document.getElementById('ag-count');
  if (countEl) countEl.textContent = agents.length + (agents.length === 1 ? ' agent' : ' agents');

  if (!agents.length) {
    ct.innerHTML = `<div class="card"><div class="empty"><div class="ei">&#x1F468;&#x200D;&#x1F4BC;</div><div class="et">No agents found</div>${S.role === 'admin' ? '<div class="es">Add your first sales agent</div>' : ''}</div></div>`;
    return;
  }

  ct.innerHTML = `<div class="ul">` + agents.map(a => {
    const agUnits  = allUnits.filter(u => u.soldBy === a.name && u.status !== 'Available' && u.status !== 'Dead');
    const totalComm = agUnits.reduce((s, u) => s + Number(u.totalPrice || 0) * Number(a.commission || 0) / 100, 0);
    const stBadge  = a.status === 'Inactive'
      ? `<span class="badge bd"><span class="b-dot"></span>Inactive</span>`
      : `<span class="badge ba"><span class="b-dot"></span>Active</span>`;
    return `<div class="ur" onclick="openAgentDetail('${a.id}')">
      <div class="ur-no">&#x1F468;&#x200D;&#x1F4BC; ${esc(a.name || 'Unnamed')}</div>
      <div style="flex-shrink:0">${stBadge}</div>
      <div class="ur-meta">
        <div class="ur-name">${a.phone ? esc(a.phone) : '—'}${a.email ? ' · ' + esc(a.email) : ''}</div>
        <div class="ur-sub">${agUnits.length} sale${agUnits.length !== 1 ? 's' : ''} · ${Number(a.commission || 0)}% commission${totalComm > 0 ? ' · ' + fM(totalComm) + ' earned' : ''}</div>
      </div>
      <div class="arr">›</div>
    </div>`;
  }).join('') + `</div>`;
}

// ── Detail page ────────────────────────────────────────

function openAgentDetail(id) { _agId = id; nav('agentdetail'); }

function rAgentDetail() {
  const agentId = _agId;
  if (!agentId) { nav('agents'); return; }
  const cid = S?.cid;
  if (!cid)    { nav('agents'); return; }

  const db    = gdb();
  const agent = (db.agents?.[cid] || []).find(a => a.id === agentId);
  if (!agent) { nav('agents'); return; }

  const isA      = S.role === 'admin';
  const allUnits = db.units?.[cid] || [];
  const agUnits  = allUnits.filter(u => u.soldBy === agent.name && u.status !== 'Available' && u.status !== 'Dead');

  const totalSales    = agUnits.reduce((s, u) => s + Number(u.totalPrice || 0), 0);
  const totalCommEarned = agUnits.reduce((s, u) => s + Number(u.totalPrice || 0) * Number(agent.commission || 0) / 100, 0);

  const stBadge = agent.status === 'Inactive'
    ? `<span class="badge bd"><span class="b-dot"></span>Inactive</span>`
    : `<span class="badge ba"><span class="b-dot"></span>Active</span>`;
  const row = (l, v) => `<div class="ir"><span class="ir-l">${l}</span><span class="ir-r">${v}</span></div>`;

  document.getElementById('pg-agentdetail').innerHTML = `<div class="ani">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px" class="no-p">
      <button class="bk" onclick="nav('agents')">← Back</button>
      ${isA ? `<button class="btn btn-gh btn-sm" onclick="openAgentModal('${agentId}')">✏ Edit</button>` : ''}
      ${isA ? `<button class="btn btn-r btn-sm" onclick="deleteAgentConfirm('${agentId}')">🗑 Delete</button>` : ''}
    </div>

    <div class="card mb14">
      <div class="cb">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
              <h2 style="font-size:24px;font-weight:700">&#x1F468;&#x200D;&#x1F4BC; ${esc(agent.name || 'Unnamed')}</h2>
              ${stBadge}
            </div>
            <div style="font-size:12px;color:var(--t3)">${Number(agent.commission || 0)}% commission rate</div>
          </div>
          <div style="display:flex;gap:7px;flex-wrap:wrap" class="no-p">
            ${agent.phone ? `<a href="tel:${agent.phone}" class="btn btn-gh btn-sm">📱 Call</a>` : ''}
            ${agent.phone ? `<a href="https://wa.me/${(agent.phone || '').replace(/[^0-9]/g, '')}" target="_blank" class="btn btn-gh btn-sm">💬 WhatsApp</a>` : ''}
            ${agent.email ? `<a href="mailto:${agent.email}" class="btn btn-gh btn-sm">✉ Email</a>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
          <div style="font-size:11px;color:var(--t3)">Total Sales<br><span style="font-size:15px;font-weight:700;color:var(--t1)">${agUnits.length} unit${agUnits.length !== 1 ? 's' : ''}</span></div>
          <div style="font-size:11px;color:var(--t3)">Portfolio Value<br><span style="font-size:15px;font-weight:700;color:var(--t1)">PKR ${Number(totalSales).toLocaleString('en-PK')}</span></div>
          <div style="font-size:11px;color:var(--t3)">Commission Earned<br><span style="font-size:15px;font-weight:700;color:var(--ok)">PKR ${Number(totalCommEarned).toLocaleString('en-PK')}</span></div>
        </div>
      </div>
    </div>

    <div class="cd">
      <div style="display:flex;flex-direction:column;gap:13px">
        <div class="card">
          <div class="ch"><h3>&#x1F468;&#x200D;&#x1F4BC; Agent Info</h3></div>
          <div class="cb">
            ${row('Full Name',  esc(agent.name || '—'))}
            ${row('Phone',      agent.phone ? `<a href="tel:${agent.phone}" style="color:var(--info);text-decoration:none">${esc(agent.phone)}</a>` : '—')}
            ${row('Email',      agent.email ? `<a href="mailto:${agent.email}" style="color:var(--info);text-decoration:none">${esc(agent.email)}</a>` : '—')}
            ${row('CNIC / ID',  esc(agent.cnic || '—'))}
            ${row('Commission', `${Number(agent.commission || 0)}%`)}
            ${row('Status',     stBadge)}
            ${agent.address ? row('Address', esc(agent.address)) : ''}
            ${agent.remarks ? row('Remarks', esc(agent.remarks)) : ''}
          </div>
        </div>

        <div class="card">
          <div class="ch"><h3>📊 Performance</h3></div>
          <div class="cb">
            ${row('Units Sold',         agUnits.length)}
            ${row('Total Portfolio',     fMF(totalSales))}
            ${row('Commission Rate',     `${Number(agent.commission || 0)}%`)}
            ${row('Total Commission',    `<span style="color:var(--ok);font-weight:700">${fMF(totalCommEarned)}</span>`)}
            ${row('Member Since',        agent.createdAt ? fD(agent.createdAt.slice(0,10)) : '—')}
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:13px">
        <div class="card">
          <div class="ch"><div><h3>🏢 Sales Record</h3><p>${agUnits.length} unit${agUnits.length !== 1 ? 's' : ''} sold</p></div></div>
          ${!agUnits.length
            ? `<div class="empty"><div class="ei">🏢</div><div class="et">No sales yet</div><div class="es">Units sold by this agent will appear here</div></div>`
            : `<div class="tw" style="overflow-x:auto"><table class="t"><thead><tr>
                 <th>Unit No</th><th>Client</th><th>Total Price</th><th>Commission</th><th>Status</th>
               </tr></thead><tbody>` +
              agUnits.map(u => {
                const comm = Number(u.totalPrice || 0) * Number(agent.commission || 0) / 100;
                return `<tr onclick="openUD('${u.id}')" style="cursor:pointer">
                  <td><strong>${esc(u.unitNo || '—')}</strong></td>
                  <td>${esc(u.customerName || '—')}</td>
                  <td>${fMF(u.totalPrice)}</td>
                  <td style="color:var(--ok);font-weight:600">${fMF(comm)}</td>
                  <td>${sbadge(u.status)}</td>
                </tr>`;
              }).join('') +
              `</tbody></table></div>
               <div style="padding:12px 14px;border-top:1px solid var(--line);font-size:12px;color:var(--t3);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
                 <span>Portfolio: <strong style="color:var(--t1)">${fMF(totalSales)}</strong></span>
                 <span>Commission: <strong style="color:var(--ok)">${fMF(totalCommEarned)}</strong></span>
               </div>`
          }
        </div>
      </div>
    </div>
  </div>`;
}

// ── Modal ──────────────────────────────────────────────

function openAgentModal(agentId) {
  const isEdit = !!agentId;
  document.getElementById('agent-mtl').textContent = isEdit ? 'Edit Agent' : 'Add Agent';
  document.getElementById('af-agent-id').value = agentId || '';

  ['af-name','af-email','af-cnic','af-address','af-remarks'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const sv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  sv('af-commission', '2');
  sv('af-status', 'Active');

  // Clear phone
  const phoneEl = document.getElementById('af-phone');
  if (phoneEl) phoneEl.value = '';

  document.querySelectorAll('#m-agent .af-err').forEach(el => el.textContent = '');

  if (isEdit) {
    const a = (gdb().agents?.[S.cid] || []).find(x => x.id === agentId);
    if (a) {
      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
      set('af-name',       a.name);
      set('af-email',      a.email);
      set('af-cnic',       a.cnic);
      set('af-commission', a.commission);
      set('af-status',     a.status || 'Active');
      set('af-address',    a.address);
      set('af-remarks',    a.remarks);
    }
  }

  om('m-agent');

  setTimeout(() => {
    const phoneInp = document.getElementById('af-phone');
    if (!phoneInp) return;
    if (_agIti) { try { _agIti.destroy(); } catch(e) {} _agIti = null; }
    if (window.intlTelInput) {
      _agIti = window.intlTelInput(phoneInp, {
        initialCountry: 'pk',
        preferredCountries: ['pk','ae','sa','gb','us','ca','au'],
        separateDialCode: true,
        utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@23.1.0/build/js/utils.js'
      });
      if (isEdit) {
        const a = (gdb().agents?.[S.cid] || []).find(x => x.id === agentId);
        if (a?.phone) { try { _agIti.setNumber(a.phone); } catch(e) { phoneInp.value = a.phone; } }
      }
    } else {
      if (isEdit) {
        const a = (gdb().agents?.[S.cid] || []).find(x => x.id === agentId);
        if (a?.phone) phoneInp.value = a.phone;
      }
    }
  }, 80);
}

function closeAgentModal() { cm('m-agent'); }

// ── Save ───────────────────────────────────────────────

function saveAgentForm() {
  const name       = document.getElementById('af-name')?.value?.trim();
  const rawPhone   = document.getElementById('af-phone')?.value?.trim() || '';
  const itiNum     = _agIti ? _agIti.getNumber() : '';
  const phone      = itiNum.replace(/\D/g, '').length > 4 ? itiNum : rawPhone;
  const commission = parseFloat(document.getElementById('af-commission')?.value);

  let hasErr = false;
  const setErr = (id, msg) => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    if (msg) hasErr = true;
  };

  setErr('e-af-name',
    !name               ? 'Full name is required' :
    name.length < 3     ? 'Min 3 characters' :
    /\d/.test(name)     ? 'Name cannot contain numbers' : '');

  setErr('e-af-phone',
    !phone || phone.replace(/\D/g, '').length < 7 ? 'Valid phone number is required' : '');

  setErr('e-af-comm',
    isNaN(commission) || commission < 0 || commission > 100 ? 'Commission must be 0–100%' : '');

  if (hasErr) return;

  const cid        = S?.cid;
  const existingId = document.getElementById('af-agent-id')?.value?.trim() || '';

  const db = gdb();
  db.agents        = db.agents || {};
  db.agents[cid]   = db.agents[cid] || [];

  const dup = db.agents[cid].find(a => a.phone === phone && a.id !== existingId);
  if (dup) {
    setErr('e-af-phone', 'An agent with this phone already exists');
    return;
  }

  const agentData = {
    id:         existingId || uid(),
    company_id: cid,
    name,
    phone,
    email:      document.getElementById('af-email')?.value?.trim()   || '',
    cnic:       document.getElementById('af-cnic')?.value?.trim()    || '',
    commission,
    status:     document.getElementById('af-status')?.value          || 'Active',
    address:    document.getElementById('af-address')?.value?.trim() || '',
    remarks:    document.getElementById('af-remarks')?.value?.trim() || ''
  };

  const idx = db.agents[cid].findIndex(a => a.id === agentData.id);
  if (idx !== -1) {
    db.agents[cid][idx] = { ...db.agents[cid][idx], ...agentData };
  } else {
    agentData.createdAt = new Date().toISOString();
    db.agents[cid].push(agentData);
  }

  sdb(db);
  logA('agent', (existingId ? 'Updated' : 'Added') + ' agent: ' + name);
  toast(existingId ? 'Agent updated!' : 'Agent added!', 'ok');
  cm('m-agent');
  rAgents();
}

// ── Delete ─────────────────────────────────────────────

function deleteAgentConfirm(agentId) {
  const db  = gdb();
  const cid = S?.cid;
  const a   = (db.agents?.[cid] || []).find(x => x.id === agentId);
  if (!confirm(`Delete agent "${a?.name || 'this agent'}"? This cannot be undone.`)) return;
  if (db.agents?.[cid]) {
    db.agents[cid] = db.agents[cid].filter(x => x.id !== agentId);
    sdb(db);
  }
  logA('agent', 'Deleted agent: ' + (a?.name || agentId));
  toast('Agent deleted', 'ok');
  nav('agents');
}

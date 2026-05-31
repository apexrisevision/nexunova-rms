// ══════════════════════════════════════════════════════════════════════════════
// LOG A CALL — 8-STEP WIZARD
// Replaces the old openConModal / saveCon in modals.js
// ══════════════════════════════════════════════════════════════════════════════

let _cnStep  = 1;
let _cnBusy  = false;   // prevents double-save
let _cnState = {};

const _CN_STEPS = [
  { n:1, icon:'👤', label:'Client'      },
  { n:2, icon:'📡', label:'Channel'     },
  { n:3, icon:'📲', label:'Outcome'     },
  { n:4, icon:'💬', label:'Response'    },
  { n:5, icon:'📝', label:'Notes'       },
  { n:6, icon:'🔮', label:'Next Action' },
  { n:7, icon:'🏷️', label:'Status'      },
  { n:8, icon:'📎', label:'Attach'      },
];

// ─── OPEN / INIT ──────────────────────────────────────────────────────────────
function openConModal(unitId, intent) {
  _cnStep = 1;
  _cnBusy = false;
  _cnState = {
    unitId:              unitId || null,
    clientId:            null,
    saleId:              null,
    clientData:          null,
    // Step 2
    channel:             'Call',
    direction:           'Outbound',
    contactDate:         td(),
    contactTime:         new Date().toTimeString().slice(0,5),
    agentId:             S.userId,
    // Step 3
    outcome:             null,
    // Step 4
    responseType:        null,
    outcomeNotes:        '',
    // Step 5
    notes:               '',
    // Step 6 — pre-arm promise mode when opened via the "Add Promise" action
    promiseToPay:        intent === 'promise',
    promiseAmount:       null,
    promiseDate:         null,
    nextFollowupDate:    null,
    nextFollowupChannel: null,
    // Step 7
    statusTag:           'Active',
    escalationFlag:      null,
    internalNotes:       '',
    // Step 8
    pendingFiles:        [],   // File objects waiting to upload
    attachmentUrls:      [],   // uploaded URLs
  };

  _cnBuildShell();
  om('m-con');

  if (unitId) {
    _cnLoadClient(unitId);
  }
}

// ─── MODAL SHELL ─────────────────────────────────────────────────────────────
function _cnBuildShell() {
  const dndView    = document.getElementById('cn-dnd-view');
  const wizardView = document.getElementById('cn-wizard-view');
  if (dndView)    dndView.style.display    = 'none';
  if (wizardView) wizardView.style.display = '';

  _cnRenderAll();
}

function _cnRenderAll() {
  _cnUpdateHeader();
  _cnRenderStepBar();
  // snapshot persists; only refresh its container
  const snapEl = document.getElementById('cn-snapshot');
  if (snapEl && !_cnState.clientData) snapEl.innerHTML = '';
  _cnRenderFields();
  _cnRenderFooter();
}

// ─── HEADER ──────────────────────────────────────────────────────────────────
const _CN_STEP_TITLES = [
  '', 'Select Client', 'How Did You Contact?', 'Did You Reach Them?',
  'Client Response', 'What Was Discussed?', 'Next Actions',
  'Case Status & Tags', 'Supporting Documents',
];
const _CN_STEP_SUBS = [
  '', 'Choose the unit/client you contacted',
  'Channel, direction, date and time',
  'Did the client answer or respond?',
  'What did the client say? (if you reached them)',
  'Summary of the conversation — minimum 20 characters required',
  'Payment promise and next follow-up schedule',
  'Status tag, escalation level, and manager-only notes',
  'Upload screenshots, letters, or documents (optional)',
];
function _cnUpdateHeader() {
  const title = document.getElementById('cn-step-title');
  const sub   = document.getElementById('cn-step-sub');
  if (title) title.textContent = _CN_STEP_TITLES[_cnStep] || 'Log a Call';
  if (sub)   sub.textContent   = `Step ${_cnStep} of 8 — ${_CN_STEP_SUBS[_cnStep] || ''}`;
}

// ─── STEP BAR ─────────────────────────────────────────────────────────────────
function _cnRenderStepBar() {
  const el = document.getElementById('cn-step-bar');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:0;margin-bottom:14px;overflow-x:auto;padding-bottom:4px">
      ${_CN_STEPS.map(s => {
        const done   = s.n < _cnStep;
        const active = s.n === _cnStep;
        const cc     = done ? '#10b981' : active ? 'var(--brand,#6366f1)' : 'var(--t3)';
        const bg     = done ? 'rgba(16,185,129,.14)' : active ? 'rgba(99,102,241,.12)' : 'transparent';
        const line   = done ? '#10b981' : 'var(--line)';
        return `<div style="display:flex;align-items:center;flex:1;min-width:0">
          <div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0">
            <div style="width:26px;height:26px;border-radius:50%;background:${bg};border:2px solid ${cc};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:${cc};flex-shrink:0">
              ${done ? '✓' : s.n}
            </div>
            <div style="font-size:9px;font-weight:600;color:${cc};white-space:nowrap;max-width:52px;text-overflow:ellipsis;overflow:hidden;text-align:center">${s.label}</div>
          </div>
          ${s.n < 8 ? `<div style="flex:1;height:2px;background:${line};margin:0 2px;margin-bottom:14px;min-width:4px"></div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

// ─── FIELDS (per step) ───────────────────────────────────────────────────────
function _cnRenderFields() {
  const el = document.getElementById('cn-step-fields');
  if (!el) return;
  const generators = [null, _cnS1, _cnS2, _cnS3, _cnS4, _cnS5, _cnS6, _cnS7, _cnS8];
  el.innerHTML = (generators[_cnStep] || (() => ''))();
  _cnAttachListeners();
}

// ─── FOOTER ──────────────────────────────────────────────────────────────────
function _cnRenderFooter() {
  const el = document.getElementById('cn-wizard-footer');
  if (!el) return;
  const isFirst = _cnStep === 1;
  const isLast  = _cnStep === 8;
  el.innerHTML = `
    <button class="btn btn-gh" onclick="cm('m-con')">Cancel</button>
    <div style="flex:1;display:flex;justify-content:center;align-items:center">
      <span style="font-size:11px;color:var(--t3)">${_cnStep} / 8</span>
    </div>
    ${isFirst ? '' : `<button class="btn btn-gh" onclick="_cnPrev()">← Back</button>`}
    ${isLast
      ? `<button class="btn btn-gh" onclick="_cnSave(true)" ${_cnBusy?'disabled':''}>Save & Log Another</button>
         <button class="btn btn-d"  onclick="_cnSave(false)" ${_cnBusy?'disabled':''}>${_cnBusy ? '⏳ Saving…' : '💾 Save Log'}</button>`
      : `<button class="btn btn-d"  onclick="_cnNext()">Next →</button>`}`;
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
function _cnNext() {
  if (!_cnValidate()) return;
  // Skip step 4 if not reached
  let next = _cnStep + 1;
  if (_cnStep === 3 && _cnState.outcome !== 'reached') next = 5;
  _cnStep = Math.min(next, 8);
  _cnRenderAll();
  // Scroll modal body to top
  const mb = document.getElementById('cn-wizard-body');
  if (mb) mb.scrollTop = 0;
}

function _cnPrev() {
  // Reverse skip of step 4
  let prev = _cnStep - 1;
  if (_cnStep === 5 && _cnState.outcome !== 'reached') prev = 3;
  _cnStep = Math.max(prev, 1);
  _cnRenderAll();
  const mb = document.getElementById('cn-wizard-body');
  if (mb) mb.scrollTop = 0;
}

// ─── VALIDATION ──────────────────────────────────────────────────────────────
function _cnValidate() {
  const t = toast;
  if (_cnStep === 1) {
    if (!_cnState.unitId) { t.error('Please select a unit'); return false; }
    if (!_cnState.contactDate) { t.error('Contact date is required'); return false; }
    return true;
  }
  if (_cnStep === 2) {
    if (!_cnState.channel) { t.error('Select a contact channel'); return false; }
    return true;
  }
  if (_cnStep === 3) {
    if (!_cnState.outcome) { t.error('Select a contact outcome'); return false; }
    return true;
  }
  if (_cnStep === 4) {
    if (_cnState.outcome === 'reached' && !_cnState.responseType) {
      t.error('Select how the client responded'); return false;
    }
    return true;
  }
  if (_cnStep === 5) {
    const n = (_cnState.notes || '').trim();
    if (n.length < 20) {
      t.error(`Notes too short — ${20 - n.length} more characters needed`);
      document.getElementById('cn-notes')?.classList.add('inp-err');
      return false;
    }
    return true;
  }
  if (_cnStep === 6) {
    if (_cnState.promiseToPay) {
      if (!(_cnState.promiseAmount > 0)) { t.error('Enter promise amount'); return false; }
      if (!_cnState.promiseDate) { t.error('Enter promise payment date'); return false; }
    }
    return true;
  }
  return true;
}

// ─── CLIENT LOAD & DND CHECK ─────────────────────────────────────────────────
async function _cnLoadClient(unitId) {
  const snapEl = document.getElementById('cn-snapshot');
  if (snapEl) {
    snapEl.style.display = '';
    snapEl.innerHTML = `<div style="padding:10px 14px;font-size:12px;color:var(--t3);background:rgba(99,102,241,.04);border-radius:var(--rm);margin-bottom:10px">⏳ Loading client data…</div>`;
  }
  try {
    const unit = gunit(unitId);
    if (!unit) { if (snapEl) snapEl.innerHTML = ''; return; }

    let clientId = unit.clientId || null;

    // If not in cache, fetch via sale
    if (!clientId && unit.saleId) {
      const { data: sale } = await supabase.rpc('get_sale_for_lookup', { p_sale_id: unit.saleId, p_company_id: S.cid });
      clientId = sale?.client_id || null;
    }

    _cnState.saleId   = unit.saleId || null;
    _cnState.clientId = clientId;

    if (clientId) {
      const { data: client } = await supabase.rpc('get_client_by_id', { p_id: clientId, p_company_id: S.cid });
      if (client) {
        _cnState.clientData = client;
        _cnRenderSnapshot(unit, client);
        if (client.dnd_status) { _cnShowDND(client); return; }
        return;
      }
    }
    // No client record — show basic unit info
    _cnRenderSnapshot(unit, null);
  } catch(e) {
    console.warn('[_cnLoadClient]', e);
    if (snapEl) snapEl.innerHTML = '';
  }
}

// ─── CLIENT SNAPSHOT BANNER ──────────────────────────────────────────────────
function _cnRenderSnapshot(unit, client) {
  const snapEl = document.getElementById('cn-snapshot');
  if (!snapEl || !unit) return;

  const pending        = actualPending(unit);
  const overdueDays    = typeof daysSincePay === 'function' ? daysSincePay(unit) : null;
  const lastConDays    = typeof daysSinceContact === 'function' ? daysSinceContact(unit) : null;
  const allLogs        = (window._contactLogsCache || []).filter(c => c.unit_id === unit.id);
  const lastLog        = allLogs[0];
  const openPromises   = allLogs.filter(c => c.promise_to_pay && c.promise_date && c.promise_date >= td());

  const statusLabel  = pending > 0 ? `<strong style="color:#ef4444">PKR ${fM(pending)}</strong>` : `<strong style="color:#10b981">Cleared</strong>`;
  const overdueLabel = overdueDays != null ? `${overdueDays}d` : '—';
  const contLabel    = lastConDays != null ? `${lastConDays}d ago` : 'Never';

  const dndBadge = (client?.dnd_status)
    ? `<span style="background:rgba(239,68,68,.14);color:#ef4444;border:1px solid rgba(239,68,68,.3);padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;flex-shrink:0">🚫 DND</span>` : '';

  const escFlag = _unitEscalation ? _unitEscalation(allLogs) : null;
  const flagColors = { Red:'#ef4444', Orange:'#f97316', Yellow:'#f59e0b' };
  const flagBadge = escFlag?.flag
    ? `<span style="background:${flagColors[escFlag.flag]}22;color:${flagColors[escFlag.flag]};border:1px solid ${flagColors[escFlag.flag]}44;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">🚨 ${escFlag.flag}</span>` : '';

  snapEl.style.display = '';
  snapEl.innerHTML = `
    <div style="background:rgba(99,102,241,.05);border:1px solid rgba(99,102,241,.15);border-radius:var(--rm);padding:10px 14px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px">
        <strong style="font-size:13px;color:var(--t1)">${esc(unit.customerName || 'No client')}</strong>
        <span style="font-size:11px;color:var(--t3)">· Unit ${esc(unit.unitNo)}</span>
        ${client ? `<span style="font-size:11px;color:var(--t3)">${esc(client.phone_primary || client.phonePrimary || '')}</span>` : ''}
        ${dndBadge}${flagBadge}
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px">
        <span><span style="color:var(--t3)">Outstanding</span> ${statusLabel}</span>
        <span><span style="color:var(--t3)">Overdue</span> <strong style="color:${overdueDays&&overdueDays>30?'#f59e0b':'var(--t2)'}">${overdueLabel}</strong></span>
        <span><span style="color:var(--t3)">Last contact</span> <strong>${contLabel}</strong></span>
        ${lastLog ? `<span><span style="color:var(--t3)">Last response</span> <strong>${esc(lastLog.response_received||'—')}</strong></span>` : ''}
        ${openPromises.length ? `<span><span style="color:var(--t3)">Open promises</span> <strong style="color:#10b981">${openPromises.length}</strong></span>` : ''}
      </div>
    </div>`;
}

// ─── DND BLOCKED ─────────────────────────────────────────────────────────────
function _cnShowDND(client) {
  document.getElementById('cn-wizard-view').style.display = 'none';
  const dndEl = document.getElementById('cn-dnd-view');
  dndEl.style.display = '';
  const isAdmin = S.role === 'admin' || S.role === 'owner';
  dndEl.innerHTML = `
    <div class="mh">
      <div><h3>🚫 Contact Blocked</h3><p>This client is marked Do Not Disturb</p></div>
      <button class="mx" onclick="cm('m-con')">✕</button>
    </div>
    <div class="mb" style="text-align:center;padding:28px 24px">
      <div style="font-size:52px;margin-bottom:10px">🚫</div>
      <h3 style="font-size:15px;font-weight:800;color:var(--err);margin:0 0 6px">Do Not Contact — DND Active</h3>
      <p style="font-size:13px;color:var(--t2);margin:0 0 16px">${esc(client.full_name || '')} has been placed on the Do Not Disturb list.</p>
      <div style="background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.2);border-radius:var(--r);padding:12px 16px;text-align:left;max-width:400px;margin:0 auto 20px">
        ${client.dnd_type   ? `<div style="font-size:12px;margin-bottom:5px"><span style="color:var(--t3);min-width:70px;display:inline-block">DND Type</span> <strong>${esc(client.dnd_type)}</strong></div>` : ''}
        ${client.dnd_reason ? `<div style="font-size:12px;margin-bottom:5px"><span style="color:var(--t3);min-width:70px;display:inline-block">Reason</span> ${esc(client.dnd_reason)}</div>` : ''}
        ${client.dnd_set_date ? `<div style="font-size:12px"><span style="color:var(--t3);min-width:70px;display:inline-block">Set On</span> ${fD(client.dnd_set_date)}</div>` : ''}
      </div>
      ${isAdmin ? `
        <div style="margin-bottom:14px">
          <label style="display:inline-flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);padding:8px 14px;border-radius:var(--rm)">
            <input type="checkbox" id="cn-dnd-override" style="width:15px;height:15px">
            <span>I acknowledge DND and take responsibility — proceed with override</span>
          </label>
        </div>
        <button class="btn btn-d" onclick="_cnDNDOverride()" style="margin-right:8px">Proceed with Override</button>` : ''}
      <button class="btn btn-gh" onclick="cm('m-con')">← Go Back</button>
    </div>`;
}

function _cnDNDOverride() {
  if (!document.getElementById('cn-dnd-override')?.checked) {
    toast('Check the acknowledgement box first', 'warn');
    return;
  }
  document.getElementById('cn-dnd-view').style.display    = 'none';
  document.getElementById('cn-wizard-view').style.display = '';
  _cnRenderAll();
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP HTML GENERATORS
// ══════════════════════════════════════════════════════════════════════════════

// Step 1 — Client
function _cnS1() {
  const units = gunits().filter(u => !u.isAvailable && u.customerName);
  const users = (window._appUsersCache || []).filter(u => u.is_active !== false);
  const isAdmin = S.role === 'admin' || S.role === 'owner';

  const unitOpts = units.length
    ? `<option value="">-- Select unit / client --</option>` +
      units.map(u => `<option value="${u.id}" ${u.id === _cnState.unitId ? 'selected' : ''}>${esc(u.unitNo)} — ${esc(u.customerName)}</option>`).join('')
    : `<option value="">No sold units yet — record a sale first</option>`;

  const agentOpts = users.length
    ? `<option value="">— Select agent —</option>` +
      users.map(u => `<option value="${u.id}" ${u.id===_cnState.agentId?'selected':''}>${esc(u.full_name||u.name||u.fullName||u.username||'')}</option>`).join('')
    : `<option value="">No staff yet — add users in Admin → Users & Roles</option>`;

  const agentControl = isAdmin
    ? `<select id="cn-agent" class="inp-light">${agentOpts}</select>`
    : `<input class="inp-light" readonly value="${esc(S.name||'')}" style="background:var(--hover);cursor:default"><input type="hidden" id="cn-agent" value="${esc(S.userId||'')}">`;

  return `
    <div class="fr">
      <label class="fl">Unit / Client *</label>
      <select id="cn-unit" class="inp-light">${unitOpts}</select>
    </div>
    <div class="g2">
      <div class="fr">
        <label class="fl">Agent Logging Call</label>
        ${agentControl}
      </div>
      <div class="fr">
        <label class="fl">Contact Date *</label>
        <input id="cn-date" type="date" class="inp-light" value="${esc(_cnState.contactDate)}">
      </div>
    </div>`;
}

// Step 2 — Channel
function _cnS2() {
  const channels = [
    { v:'Call',      icon:'📞', label:'Phone Call' },
    { v:'WhatsApp',  icon:'💬', label:'WhatsApp'   },
    { v:'Meeting',   icon:'🤝', label:'Meeting'    },
    { v:'Email',     icon:'📧', label:'Email'      },
    { v:'SMS',       icon:'📱', label:'SMS'        },
    { v:'Visit',     icon:'🏠', label:'Site Visit'  },
  ];
  return `
    <div class="fr">
      <label class="fl">Contact Channel *</label>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px" id="cn-ch-grid">
        ${channels.map(c => {
          const on = _cnState.channel === c.v;
          return `<div id="cn-ch-${c.v}" onclick="_cnPickChannel('${c.v}')"
            style="padding:12px 8px;border:2px solid ${on?'var(--brand,#6366f1)':'var(--line)'};border-radius:var(--rm);cursor:pointer;text-align:center;background:${on?'rgba(99,102,241,.08)':'transparent'};transition:all 150ms">
            <div style="font-size:20px">${c.icon}</div>
            <div style="font-size:11px;font-weight:700;color:${on?'var(--brand,#6366f1)':'var(--t1)'};margin-top:3px">${c.label}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="g2" style="margin-top:10px">
      <div class="fr">
        <label class="fl">Direction</label>
        <select id="cn-dir" class="inp-light">
          <option value="Outbound" ${_cnState.direction==='Outbound'?'selected':''}>↗ Outbound (We called)</option>
          <option value="Inbound"  ${_cnState.direction==='Inbound' ?'selected':''}>↙ Inbound (Client called)</option>
        </select>
      </div>
      <div class="fr">
        <label class="fl">Time</label>
        <input id="cn-time" type="time" class="inp-light" value="${esc(_cnState.contactTime)}">
      </div>
    </div>`;
}

// Step 3 — Outcome
function _cnS3() {
  const outcomes = [
    { v:'reached',      icon:'✅', label:'Reached',            desc:'Client picked up / replied',      color:'#10b981' },
    { v:'no_answer',    icon:'📵', label:'No Answer',          desc:'Phone rang but no response',      color:'#f59e0b' },
    { v:'voicemail',    icon:'📬', label:'Voicemail',          desc:'Left a voice message',            color:'#6366f1' },
    { v:'wrong_number', icon:'❌', label:'Wrong / Disconnected', desc:'Number invalid or disconnected', color:'#ef4444' },
    { v:'busy',         icon:'🔔', label:'Line Busy',          desc:'Line was busy',                   color:'#64748b' },
    { v:'callback',     icon:'🔄', label:'Call Back Later',    desc:'Client asked to call back later', color:'#8b5cf6' },
  ];
  return `
    <div class="fr">
      <label class="fl">Contact Outcome *</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px" id="cn-out-grid">
        ${outcomes.map(o => {
          const on = _cnState.outcome === o.v;
          return `<div id="cn-out-${o.v}" onclick="_cnPickOutcome('${o.v}')"
            style="padding:12px 14px;border:2px solid ${on?o.color:'var(--line)'};border-radius:var(--r);cursor:pointer;display:flex;gap:10px;align-items:center;background:${on?'rgba(0,0,0,.04)':'transparent'};transition:all 150ms">
            <span style="font-size:22px;flex-shrink:0">${o.icon}</span>
            <div>
              <div style="font-size:12px;font-weight:700;color:${on?o.color:'var(--t1)'}">${o.label}</div>
              <div style="font-size:10px;color:var(--t3)">${o.desc}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

// Step 4 — Response (9 types if reached; simplified notes if not)
function _cnS4() {
  if (_cnState.outcome !== 'reached') {
    return `
      <div style="text-align:center;padding:16px;background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.2);border-radius:var(--r);margin-bottom:14px">
        <div style="font-size:36px;margin-bottom:6px">📵</div>
        <div style="font-size:14px;font-weight:700;color:var(--t1)">Client Was Not Reached</div>
        <div style="font-size:12px;color:var(--t3);margin-top:3px">Outcome: ${esc((_cnState.outcome||'').replace(/_/g,' '))}</div>
      </div>
      <div class="fr">
        <label class="fl">Additional Notes (optional)</label>
        <textarea id="cn-outcome-notes" class="inp-light" rows="3"
          placeholder="Any additional details — busy tone, answered and hung up, etc.">${esc(_cnState.outcomeNotes||'')}</textarea>
      </div>`;
  }

  const responses = [
    { v:'will_pay',            icon:'💰', label:'Will Pay',            desc:'Promised payment soon',               color:'#10b981' },
    { v:'asked_extension',     icon:'📅', label:'Asked Extension',     desc:'Needs more time',                     color:'#6366f1' },
    { v:'asked_restructuring', icon:'🔄', label:'Restructuring',       desc:'Wants revised payment plan',          color:'#8b5cf6' },
    { v:'dispute',             icon:'⚖️', label:'Dispute',             desc:'Disputes amount or contract',         color:'#ef4444' },
    { v:'hardship',            icon:'😔', label:'Hardship',            desc:'Facing financial difficulties',       color:'#f59e0b' },
    { v:'wants_cancel',        icon:'🚫', label:'Wants to Cancel',     desc:'Wants to exit agreement',             color:'#ef4444' },
    { v:'wants_transfer',      icon:'🔀', label:'Wants Transfer',      desc:'Wants a different unit',              color:'#f59e0b' },
    { v:'unresponsive',        icon:'😶', label:'Unresponsive',        desc:'No meaningful conversation',         color:'#64748b' },
    { v:'aggressive',          icon:'😠', label:'Aggressive',          desc:'Hostile or threatening tone',         color:'#ef4444' },
  ];
  return `
    <div class="fr">
      <label class="fl">Client Response *</label>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px" id="cn-res-grid">
        ${responses.map(r => {
          const on = _cnState.responseType === r.v;
          return `<div id="cn-res-${r.v}" onclick="_cnPickResponse('${r.v}')"
            style="padding:10px 8px;border:2px solid ${on?r.color:'var(--line)'};border-radius:var(--rm);cursor:pointer;text-align:center;background:${on?'rgba(0,0,0,.04)':'transparent'};transition:all 150ms">
            <div style="font-size:18px">${r.icon}</div>
            <div style="font-size:10px;font-weight:700;color:${on?r.color:'var(--t1)'};margin-top:3px;line-height:1.3">${r.label}</div>
            <div style="font-size:9px;color:var(--t3);margin-top:2px;line-height:1.3">${r.desc}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

// Step 5 — Notes
function _cnS5() {
  const len   = (_cnState.notes || '').length;
  const valid = len >= 20;
  return `
    <div class="fr">
      <label class="fl">Call Summary *</label>
      <textarea id="cn-notes" class="inp-light" rows="6"
        placeholder="What was discussed? Client's exact words, tone, any specific dates or amounts mentioned, commitments made…"
        style="resize:vertical">${esc(_cnState.notes || '')}</textarea>
      <div id="cn-note-count" style="text-align:right;font-size:10px;margin-top:4px;color:${valid?'#10b981':'#f59e0b'}">
        ${len} characters ${valid ? '✓ minimum met' : `— need ${20 - len} more`}
      </div>
    </div>
    <div style="background:rgba(99,102,241,.04);border:1px solid rgba(99,102,241,.12);border-radius:var(--rm);padding:10px 14px">
      <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">💡 Tips for Good Notes</div>
      <div style="font-size:11px;color:var(--t3);line-height:1.7">
        • Quote exact words: <em>"Client said 'I'll pay by end of month'"</em><br>
        • Note tone: calm / frustrated / cooperative / hostile<br>
        • Record any specific dates, amounts, or conditions mentioned
      </div>
    </div>`;
}

// Step 6 — Next Action
function _cnS6() {
  return `
    <div style="margin-bottom:14px">
      <div onclick="_cnTogglePromise()" style="display:flex;align-items:center;gap:10px;padding:11px 14px;background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.2);border-radius:var(--rm);cursor:pointer">
        <input type="checkbox" id="cn-promise-cb" ${_cnState.promiseToPay?'checked':''} style="width:16px;height:16px;cursor:pointer" onclick="event.stopPropagation()">
        <label for="cn-promise-cb" style="font-size:13px;font-weight:700;cursor:pointer;color:var(--t1);margin:0">✅ Client promised to pay</label>
      </div>
      <div id="cn-promise-fields" style="${_cnState.promiseToPay?'':'display:none'};margin-top:8px">
        <div class="g2">
          <div class="fr">
            <label class="fl">Promise Amount (PKR) *</label>
            <input id="cn-pa" type="number" class="inp-light" min="0" placeholder="0" value="${_cnState.promiseAmount||''}">
          </div>
          <div class="fr">
            <label class="fl">Payment By Date *</label>
            <input id="cn-pd" type="date" class="inp-light" value="${_cnState.promiseDate||''}">
          </div>
        </div>
      </div>
    </div>
    <div style="border-top:1px solid var(--line);padding-top:14px">
      <div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:10px">📅 Schedule Next Follow-Up</div>
      <div class="g2">
        <div class="fr">
          <label class="fl">Follow-up Date</label>
          <input id="cn-fdate" type="date" class="inp-light" value="${_cnState.nextFollowupDate||''}">
        </div>
        <div class="fr">
          <label class="fl">Preferred Channel</label>
          <select id="cn-fch" class="inp-light">
            <option value=""         ${!_cnState.nextFollowupChannel?'selected':''}>-- Same as today (${esc(_cnState.channel)}) --</option>
            <option value="Call"     ${_cnState.nextFollowupChannel==='Call'    ?'selected':''}>📞 Call</option>
            <option value="WhatsApp" ${_cnState.nextFollowupChannel==='WhatsApp'?'selected':''}>💬 WhatsApp</option>
            <option value="Meeting"  ${_cnState.nextFollowupChannel==='Meeting' ?'selected':''}>🤝 Meeting</option>
            <option value="Email"    ${_cnState.nextFollowupChannel==='Email'   ?'selected':''}>📧 Email</option>
            <option value="SMS"      ${_cnState.nextFollowupChannel==='SMS'     ?'selected':''}>📱 SMS</option>
            <option value="Visit"    ${_cnState.nextFollowupChannel==='Visit'   ?'selected':''}>🏠 Visit</option>
          </select>
        </div>
      </div>
    </div>`;
}

// Step 7 — Status & Tags
function _cnS7() {
  const statuses = ['Active','Pending','Escalated','Resolved','Closed'];
  const flags    = [
    { v:null,     label:'None',               color:'var(--t3)' },
    { v:'Yellow', label:'🟡 Yellow — Monitor', color:'#f59e0b'  },
    { v:'Orange', label:'🟠 Orange — Urgent',  color:'#f97316'  },
    { v:'Red',    label:'🔴 Red — Critical',   color:'#ef4444'  },
  ];
  return `
    <div class="fr">
      <label class="fl">Case Status Tag</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap" id="cn-st-group">
        ${statuses.map(s => {
          const on = _cnState.statusTag === s;
          return `<button type="button" id="cn-st-${s}" onclick="_cnPickStatus('${s}')"
            class="btn ${on?'btn-d':'btn-gh'} btn-sm">${s}</button>`;
        }).join('')}
      </div>
    </div>
    <div class="fr" style="margin-top:12px">
      <label class="fl">Escalation Flag</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap" id="cn-fl-group">
        ${flags.map(f => {
          const on = _cnState.escalationFlag === f.v;
          return `<div id="cn-fl-${f.v||'none'}" onclick="_cnPickFlag(${JSON.stringify(f.v)})"
            style="padding:7px 14px;border:2px solid ${on?f.color:'var(--line)'};border-radius:var(--rm);cursor:pointer;font-size:12px;font-weight:600;color:${on?f.color:'var(--t2)'};background:${on?'rgba(0,0,0,.03)':'transparent'};transition:all 150ms">${f.label}</div>`;
        }).join('')}
      </div>
    </div>
    <div class="fr" style="margin-top:12px">
      <label class="fl">Internal Notes <span style="font-size:10px;font-weight:500;color:var(--t3)">(manager-only, not shown to client)</span></label>
      <textarea id="cn-internal" class="inp-light" rows="3"
        placeholder="Strategy notes, risk observations, management instructions…">${esc(_cnState.internalNotes||'')}</textarea>
    </div>`;
}

// Step 8 — Attachments
function _cnS8() {
  const files = _cnState.pendingFiles || [];
  return `
    <div>
      <div id="cn-drop-zone"
        style="border:2px dashed var(--line);border-radius:var(--r);padding:32px 20px;cursor:pointer;text-align:center;transition:all 200ms"
        ondragover="event.preventDefault();document.getElementById('cn-drop-zone').style.borderColor='var(--brand)'"
        ondragleave="document.getElementById('cn-drop-zone').style.borderColor='var(--line)'"
        ondrop="_cnHandleDrop(event)"
        onclick="document.getElementById('cn-file-input').click()">
        <div style="font-size:40px;margin-bottom:8px">📎</div>
        <div style="font-size:13px;font-weight:600;color:var(--t2)">Drag & drop files here, or click to browse</div>
        <div style="font-size:11px;color:var(--t3);margin-top:4px">PDF, JPG, PNG, Word docs — max 10 MB each</div>
        <input type="file" id="cn-file-input" style="display:none" multiple accept="image/*,.pdf,.doc,.docx"
          onchange="_cnHandleFileSelect(this.files)">
      </div>
      <div id="cn-file-list" style="margin-top:10px">
        ${files.map((f,i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--canvas);border:1px solid var(--line);border-radius:var(--rm);margin-bottom:6px">
            <span style="font-size:16px">${f.type?.startsWith('image') ? '🖼️' : '📄'}</span>
            <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>
            <span style="font-size:11px;color:var(--t3)">${(f.size/1024).toFixed(0)} KB</span>
            <button type="button" class="btn btn-gh btn-xs" style="flex-shrink:0" onclick="_cnRemoveFile(${i})">✕</button>
          </div>`).join('')}
      </div>
      <p style="font-size:11px;color:var(--t3);text-align:center;margin-top:8px">Attachments are optional — you can save the log without any files.</p>
    </div>`;
}

// ─── STEP INTERACTION HELPERS ─────────────────────────────────────────────────
function _cnPickChannel(v) {
  _cnState.channel = v;
  document.querySelectorAll('#cn-ch-grid > div').forEach(el => {
    const on = el.id === `cn-ch-${v}`;
    el.style.borderColor  = on ? 'var(--brand,#6366f1)' : 'var(--line)';
    el.style.background   = on ? 'rgba(99,102,241,.08)' : 'transparent';
    el.querySelector('div:last-child').style.color = on ? 'var(--brand,#6366f1)' : 'var(--t1)';
  });
}

function _cnPickOutcome(v) {
  _cnState.outcome = v;
  const colors = { reached:'#10b981', no_answer:'#f59e0b', voicemail:'#6366f1', wrong_number:'#ef4444', busy:'#64748b', callback:'#8b5cf6' };
  document.querySelectorAll('#cn-out-grid > div').forEach(el => {
    const key  = el.id.replace('cn-out-','');
    const on   = key === v;
    const c    = colors[key] || 'var(--brand)';
    el.style.borderColor = on ? c : 'var(--line)';
    el.style.background  = on ? 'rgba(0,0,0,.04)' : 'transparent';
    el.querySelector('.cn-out-lbl')?.style && (el.querySelector('div > div:first-child').style.color = on ? c : 'var(--t1)');
  });
}

function _cnPickResponse(v) {
  _cnState.responseType = v;
  const colors = { will_pay:'#10b981', asked_extension:'#6366f1', asked_restructuring:'#8b5cf6', dispute:'#ef4444', hardship:'#f59e0b', wants_cancel:'#ef4444', wants_transfer:'#f59e0b', unresponsive:'#64748b', aggressive:'#ef4444' };
  document.querySelectorAll('#cn-res-grid > div').forEach(el => {
    const key = el.id.replace('cn-res-','');
    const on  = key === v;
    const c   = colors[key] || 'var(--brand)';
    el.style.borderColor = on ? c : 'var(--line)';
    el.style.background  = on ? 'rgba(0,0,0,.04)' : 'transparent';
  });
}

function _cnPickStatus(v) {
  _cnState.statusTag = v;
  document.querySelectorAll('#cn-st-group button').forEach(btn => {
    const on = btn.id === `cn-st-${v}`;
    btn.className = `btn ${on?'btn-d':'btn-gh'} btn-sm`;
  });
}

function _cnPickFlag(v) {
  _cnState.escalationFlag = v;
  const colors = { Yellow:'#f59e0b', Orange:'#f97316', Red:'#ef4444' };
  document.querySelectorAll('#cn-fl-group > div').forEach(el => {
    const key = el.id === 'cn-fl-none' ? null : el.id.replace('cn-fl-','');
    const on  = key === v;
    const c   = colors[key] || 'var(--t3)';
    el.style.borderColor = on ? c : 'var(--line)';
    el.style.color       = on ? c : 'var(--t2)';
    el.style.background  = on ? 'rgba(0,0,0,.03)' : 'transparent';
  });
}

function _cnTogglePromise() {
  _cnState.promiseToPay = !_cnState.promiseToPay;
  const cb = document.getElementById('cn-promise-cb');
  const pf = document.getElementById('cn-promise-fields');
  if (cb) cb.checked = _cnState.promiseToPay;
  if (pf) pf.style.display = _cnState.promiseToPay ? '' : 'none';
}

function _cnUpdateNoteCount(val) {
  _cnState.notes = val;
  const len   = val.length;
  const valid = len >= 20;
  const el    = document.getElementById('cn-note-count');
  if (el) {
    el.textContent = `${len} characters ${valid ? '✓ minimum met' : `— need ${20-len} more`}`;
    el.style.color = valid ? '#10b981' : '#f59e0b';
  }
  document.getElementById('cn-notes')?.classList.toggle('inp-err', !!val && !valid);
}

// ─── FILE HANDLING ────────────────────────────────────────────────────────────
function _cnHandleDrop(e) {
  e.preventDefault();
  document.getElementById('cn-drop-zone').style.borderColor = 'var(--line)';
  _cnHandleFileSelect(e.dataTransfer.files);
}

function _cnHandleFileSelect(fileList) {
  const maxSize = 10 * 1024 * 1024; // 10 MB
  Array.from(fileList).forEach(f => {
    if (f.size > maxSize) { toast(`${f.name} exceeds 10 MB limit`, 'err'); return; }
    _cnState.pendingFiles.push(f);
  });
  _cnRenderFields(); // re-render step 8 to show file list
}

function _cnRemoveFile(idx) {
  _cnState.pendingFiles.splice(idx, 1);
  _cnRenderFields();
}

// ─── EVENT LISTENERS (syncs DOM → state on step 1 & 2 fields) ────────────────
function _cnAttachListeners() {
  // Step 1
  const unitSel = document.getElementById('cn-unit');
  if (unitSel) unitSel.addEventListener('change', async e => {
    _cnState.unitId = e.target.value || null;
    _cnState.clientId = null; _cnState.clientData = null;
    const snap = document.getElementById('cn-snapshot');
    if (snap) snap.innerHTML = '';
    if (_cnState.unitId) await _cnLoadClient(_cnState.unitId);
  });
  const dateFld = document.getElementById('cn-date');
  if (dateFld) dateFld.addEventListener('change', e => _cnState.contactDate = e.target.value);
  const agentSel = document.getElementById('cn-agent');
  if (agentSel) agentSel.addEventListener('change', e => _cnState.agentId = e.target.value);

  // Step 2
  const dirSel = document.getElementById('cn-dir');
  if (dirSel) dirSel.addEventListener('change', e => _cnState.direction = e.target.value);
  const timeFld = document.getElementById('cn-time');
  if (timeFld) timeFld.addEventListener('change', e => _cnState.contactTime = e.target.value);

  // Step 5
  const notesFld = document.getElementById('cn-notes');
  if (notesFld) notesFld.addEventListener('input', e => _cnUpdateNoteCount(e.target.value));

  // Step 6
  const promiseCb = document.getElementById('cn-promise-cb');
  if (promiseCb) promiseCb.addEventListener('change', e => {
    _cnState.promiseToPay = e.target.checked;
    const pf = document.getElementById('cn-promise-fields');
    if (pf) pf.style.display = _cnState.promiseToPay ? '' : 'none';
  });
  const paFld = document.getElementById('cn-pa');
  if (paFld) paFld.addEventListener('input', e => _cnState.promiseAmount = parseFloat(e.target.value)||null);
  const pdFld = document.getElementById('cn-pd');
  if (pdFld) pdFld.addEventListener('change', e => _cnState.promiseDate = e.target.value);
  const fdFld = document.getElementById('cn-fdate');
  if (fdFld) fdFld.addEventListener('change', e => _cnState.nextFollowupDate = e.target.value);
  const fchSel = document.getElementById('cn-fch');
  if (fchSel) fchSel.addEventListener('change', e => _cnState.nextFollowupChannel = e.target.value||null);

  // Step 4 notes
  const outNotes = document.getElementById('cn-outcome-notes');
  if (outNotes) outNotes.addEventListener('input', e => _cnState.outcomeNotes = e.target.value);

  // Step 7
  const intFld = document.getElementById('cn-internal');
  if (intFld) intFld.addEventListener('input', e => _cnState.internalNotes = e.target.value);
}

// ══════════════════════════════════════════════════════════════════════════════
// SAVE
// ══════════════════════════════════════════════════════════════════════════════
async function _cnSave(logAnother) {
  if (_cnBusy) return;
  if (!_cnValidateFull()) return;

  _cnBusy = true;
  _cnRenderFooter(); // disable buttons

  try {
    // ── 1. Upload attachments ──────────────────────────────────────────────
    const uploadedUrls = [];
    for (const file of (_cnState.pendingFiles || [])) {
      try {
        const path = `${S.cid}/${Date.now()}_${file.name.replace(/\s+/g,'_')}`;
        const { data: upData, error: upErr } = await supabase.storage
          .from('recovery-documents').upload(path, file, { upsert: false });
        if (!upErr && upData) {
          const { data: urlData } = supabase.storage.from('recovery-documents').getPublicUrl(path);
          if (urlData?.publicUrl) uploadedUrls.push(urlData.publicUrl);
        } else {
          console.warn('[upload]', upErr);
        }
      } catch(e) { console.warn('[upload file]', e); }
    }

    // ── 2. Build response_received value ──────────────────────────────────
    let responseReceived;
    if (_cnState.outcome === 'reached') {
      responseReceived = _cnState.responseType || 'unresponsive';
    } else {
      const outcomeMap = {
        no_answer:    'NoResponse',
        voicemail:    'Voicemail',
        wrong_number: 'WrongNumber',
        busy:         'Busy',
        callback:     'CallBack',
      };
      responseReceived = outcomeMap[_cnState.outcome] || 'NoResponse';
    }

    // ── 3. Compute escalation flag ─────────────────────────────────────────
    const existingLogs = (window._contactLogsCache || []).filter(c => c.unit_id === _cnState.unitId);
    const escalation   = _cnState.escalationFlag ||
      (typeof _computeNewFlag === 'function' ? _computeNewFlag(existingLogs, { response_received: responseReceived }) : null);

    // ── 4. Build contact_log payload ──────────────────────────────────────
    const notesText = [_cnState.notes].concat(
      _cnState.outcomeNotes ? ['[Outcome notes: ' + _cnState.outcomeNotes + ']'] : []
    ).join('\n\n');

    const payload = {
      company_id:           S.cid,
      unit_id:              _cnState.unitId,
      client_name:          gunit(_cnState.unitId)?.customerName || '',
      contact_date:         _cnState.contactDate || td(),
      contact_time:         _cnState.contactTime || null,
      channel:              _cnState.channel,
      direction:            _cnState.direction,
      agent_id:             _cnState.agentId || S.userId,
      response_received:    responseReceived,
      remarks:              notesText || null,
      promise_to_pay:       _cnState.promiseToPay,
      promise_amount:       _cnState.promiseToPay ? (_cnState.promiseAmount || null) : null,
      promise_date:         _cnState.promiseToPay ? (_cnState.promiseDate   || null) : null,
      next_followup_date:   _cnState.nextFollowupDate   || null,
      next_followup_channel:_cnState.nextFollowupChannel || null,
      internal_notes:       _cnState.internalNotes || null,
      status_tag:           _cnState.statusTag,
      escalation_flag:      escalation,
      created_by:           S.userId,
    };

    // Add attachment URLs if any
    if (uploadedUrls.length) payload.attachments = uploadedUrls;

    // ── 5. Insert contact_log ─────────────────────────────────────────────
    const { data: logRes, error: logErr } = await supabase.rpc('create_contact_log', {
      p_company_id: S.cid,
      p_data: payload
    });
    if (logErr) throw logErr;
    const logData = logRes?.row || { id: logRes?.id, ...payload };

    // Update cache
    if (!window._contactLogsCache) window._contactLogsCache = [];
    window._contactLogsCache.unshift(logData);
    if (typeof _clCache !== 'undefined' && _clCache) _clCache.unshift(logData);
    const uIdx = (window._unitsCache || []).findIndex(u => u.id === _cnState.unitId);
    if (uIdx >= 0) window._unitsCache[uIdx].lastContactDate = _cnState.contactDate;

    // ── 6. Insert payment_promise (if applicable) ─────────────────────────
    if (_cnState.promiseToPay && _cnState.promiseAmount > 0 && _cnState.promiseDate) {
      try {
        const unit = gunit(_cnState.unitId);
        await supabase.rpc('create_payment_promise', {
          p_company_id: S.cid,
          p_data: {
            client_id:        _cnState.clientId || null,
            sale_id:          _cnState.saleId   || unit?.saleId || null,
            promised_amount:  _cnState.promiseAmount,
            promise_date:     _cnState.promiseDate,
            promise_made_on:  _cnState.contactDate || new Date().toISOString().slice(0,10),
            logged_by:        S.userId || '',
            status:           'pending',
            notes:            `Promised during ${_cnState.channel} on ${_cnState.contactDate}`
          }
        });
      } catch(e) { console.warn('[payment_promises insert]', e); }
    }

    // ── 7. Insert follow_up_reminder (if applicable) ──────────────────────
    if (_cnState.nextFollowupDate) {
      try {
        const unit = gunit(_cnState.unitId);
        await supabase.rpc('create_follow_up_reminder', {
          p_company_id: S.cid,
          p_data: {
            unit_id:        _cnState.unitId,
            client_id:      _cnState.clientId || null,
            sale_id:        _cnState.saleId   || unit?.saleId || null,
            contact_log_id: logData.id,
            remind_at:      _cnState.nextFollowupDate + 'T09:00:00+00:00',
            channels:       [_cnState.nextFollowupChannel || _cnState.channel],
            message:        `Follow-up from ${_cnState.channel} contact on ${_cnState.contactDate}`,
            status:         'pending',
            created_by:     S.userId
          }
        });
      } catch(e) { console.warn('[follow_up_reminders insert]', e); }
    }

    // ── 8. Done ───────────────────────────────────────────────────────────
    toast(`Contact logged · ${_cnState.channel} · ${_cnState.contactDate}`, 'ok');

    if (logAnother) {
      openConModal(null);
      _cnState.contactDate = td();
    } else {
      cm('m-con');
    }

    // Defer sidebar + page refresh so they can never block the success path
    setTimeout(() => {
      try { buildSB(); } catch(e) { console.warn('[buildSB]', e); }
      if (!logAnother) {
        try {
          const ap = document.querySelector('.pg.on')?.id?.replace('pg-', '');
          if (ap) nav(ap);
        } catch(e) { console.warn('[nav after log]', e); }
      }
    }, 0);

  } catch(e) {
    console.error('[_cnSave]', e);
    toast('Save failed: ' + (e?.message || e), 'err');
  } finally {
    _cnBusy = false;
    _cnRenderFooter();
  }
}

// Full final validation (all required fields before save)
function _cnValidateFull() {
  if (!_cnState.unitId)    { toast('No unit selected', 'err');           return false; }
  if (!_cnState.contactDate){ toast('Contact date is required', 'err');  return false; }
  if (!_cnState.channel)   { toast('Select a contact channel', 'err');   return false; }
  if (!_cnState.outcome)   { toast('Select a contact outcome', 'err');   return false; }
  if (_cnState.outcome === 'reached' && !_cnState.responseType) {
    toast('Select client response type', 'err'); return false;
  }
  const n = (_cnState.notes || '').trim();
  if (n.length < 20) { toast(`Notes must be at least 20 characters (${n.length} entered)`, 'err'); return false; }
  if (_cnState.promiseToPay) {
    if (!(_cnState.promiseAmount > 0)) { toast('Enter promise amount', 'err'); return false; }
    if (!_cnState.promiseDate)         { toast('Enter promise payment date', 'err'); return false; }
  }
  return true;
}

// Legacy stub — kept for any inline callers in index.html
function saveCon() { _cnSave(false); }
function _togglePromiseFields(show) {
  const w = document.getElementById('cn-promise-fields');
  if (w) w.style.display = show ? '' : 'none';
}

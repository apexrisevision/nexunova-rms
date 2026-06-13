// ══ FIELD VISITS MODULE ════════════════════════════════════════

let _fvData      = [];
let _fvAnalytics = null;
let _fvFilter    = 'all';

const _FV_OUTCOMES = {
  contacted:          { label:'Contacted',         tone:'info' },
  payment_collected:  { label:'Payment Collected', tone:'success' },
  promise_received:   { label:'Promise Received',  tone:'warning' },
  not_found:          { label:'Not Found',         tone:'' },
  refused:            { label:'Refused',           tone:'danger' },
  other:              { label:'Other',             tone:'' },
};

// ── Entry point ────────────────────────────────────────────────
async function rFieldVisits() {
  const pg = document.getElementById('pg-fieldvisits');
  if (!pg) return;

  pg.innerHTML = `<div class="ani">
    ${NX.pageHeader('Field Visits',
      NX.button('Log Visit', { variant:'primary', icon:'plus', onclick:'fvOpenLog()' }) +
      NX.button('Refresh',   { variant:'ghost', size:'sm', onclick:'_fvLoad()' }),
      { icon:'map-pin', tone:'', sub:'Track field recovery visits and outcomes' })}
    <div id="fv-stats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:18px">
      ${[...Array(5)].map(()=>NX.kpi({label:'Loading…',value:'—'})).join('')}
    </div>
    <div id="fv-filter" style="margin-bottom:14px"></div>
    <div id="fv-body"><div style="padding:48px;text-align:center;color:var(--fk-text-muted)">Loading…</div></div>
  </div>`;

  await _fvLoad();
}

// ── Data ───────────────────────────────────────────────────────
async function _fvLoad() {
  try {
    const [{ data: rows, error: e1 }, { data: analytics }] = await Promise.all([
      supabase.rpc('get_field_visits', { p_company_id: S.cid }),
      supabase.rpc('get_field_visit_analytics', { p_company_id: S.cid, p_days: 30 })
    ]);
    if (e1) throw e1;
    _fvData      = Array.isArray(rows) ? rows : [];
    _fvAnalytics = analytics || {};
    _fvRenderStats();
    _fvRenderFilter();
    _fvRenderTable();
  } catch(e) {
    const body = document.getElementById('fv-body');
    if (body) body.innerHTML = NX.card(NX.empty({ icon:'x-circle', tone:'danger', message: esc(e.message||'Failed to load visits') }));
  }
}

// ── Stats ──────────────────────────────────────────────────────
function _fvRenderStats() {
  const el = document.getElementById('fv-stats');
  if (!el) return;
  const a = _fvAnalytics || {};
  const total   = _fvData.length;
  const today   = _fvData.filter(v => v.visit_date===new Date().toISOString().split('T')[0]).length;
  const paid    = _fvData.filter(v => v.outcome==='payment_collected').length;
  const promise = _fvData.filter(v => v.outcome==='promise_received').length;
  const refused = _fvData.filter(v => v.outcome==='refused').length;

  el.innerHTML = [
    NX.kpi({ label:'Total Visits',    value: total,                          dot:'' }),
    NX.kpi({ label:'Today',           value: today,                          dot:'primary' }),
    NX.kpi({ label:'Payment Coll.',   value: paid,                           dot:'success' }),
    NX.kpi({ label:'Promise Given',   value: promise,                        dot:'warning' }),
    NX.kpi({ label:'Refused',         value: refused,                        dot:'danger' }),
  ].join('');
}

// ── Filter tabs ────────────────────────────────────────────────
function _fvRenderFilter() {
  const el = document.getElementById('fv-filter');
  if (!el) return;
  const countOf = key => key==='all' ? _fvData.length : _fvData.filter(v=>v.outcome===key).length;
  el.innerHTML = NX.tabs({
    tabs: [
      { k:'all',               label:'All',       count: countOf('all') },
      { k:'payment_collected', label:'Collected',  count: countOf('payment_collected') },
      { k:'promise_received',  label:'Promise',    count: countOf('promise_received') },
      { k:'contacted',         label:'Contacted',  count: countOf('contacted') },
      { k:'not_found',         label:'Not Found',  count: countOf('not_found') },
      { k:'refused',           label:'Refused',    count: countOf('refused') },
    ],
    active: _fvFilter,
    onSelect: "fvSetFilter('%k')"
  });
}

function fvSetFilter(f) {
  _fvFilter = f;
  _fvRenderFilter();
  _fvRenderTable();
}

function _fvFiltered() {
  return _fvFilter==='all' ? _fvData : _fvData.filter(v=>v.outcome===_fvFilter);
}

// ── Table ──────────────────────────────────────────────────────
function _fvRenderTable() {
  const body = document.getElementById('fv-body');
  if (!body) return;
  const rows = _fvFiltered();

  if (!rows.length) {
    body.innerHTML = NX.card(NX.empty({
      icon: _fvFilter==='all' ? 'map-pin' : 'check-circle',
      tone: _fvFilter==='all' ? undefined  : 'success',
      message: _fvFilter==='all' ? 'No field visits logged yet'
             : 'No visits with this outcome',
      action: _fvFilter==='all' ? NX.button('Log First Visit', { variant:'primary', icon:'plus', onclick:'fvOpenLog()' }) : ''
    }));
    return;
  }

  body.innerHTML = NX.card(`
    <table class="nx-table">
      <thead><tr>
        <th style="width:100px">Outcome</th>
        <th>Client</th>
        <th class="hide-sm">Property</th>
        <th class="num hide-sm">Collected</th>
        <th>Date</th>
        <th class="hide-sm">Officer</th>
        <th class="hide-sm">Notes</th>
      </tr></thead>
      <tbody>${rows.map(_fvRow).join('')}</tbody>
    </table>`, { flush: true });
}

function _fvRow(v) {
  const out = _FV_OUTCOMES[v.outcome] || { label: v.outcome||'Other', tone:'' };
  const outBadge = NX.badge(out.label, out.tone, {dot:true});

  const prop = [v.project_name, v.unit_info].filter(Boolean).join(' · ') || '—';
  const hasGPS = v.gps_lat && v.gps_lng;
  const hasPhoto = v.photo_url;

  return `<tr>
    <td>${outBadge}</td>
    <td>
      <div style="font-weight:600;font-size:13px">${esc(v.client_name||'—')}</div>
      <div style="font-size:11px;color:var(--fk-text-muted)">${esc(v.client_phone||'—')}</div>
    </td>
    <td class="hide-sm" style="font-size:12px;color:var(--fk-text-muted)">${esc(prop)}</td>
    <td class="num hide-sm" style="font-size:12px;color:var(--fk-success);font-weight:600">${v.amount_collected>0?'PKR '+fM(v.amount_collected):'—'}</td>
    <td>
      <div style="font-size:12px">${fD(v.visit_date)}</div>
      ${hasGPS?`<a href="https://maps.google.com/?q=${v.gps_lat},${v.gps_lng}" target="_blank" style="font-size:11px;color:var(--fk-primary)">${NX.icon('map-pin',10)} GPS</a>`:''}
      ${hasPhoto?`<a href="${esc(v.photo_url)}" target="_blank" style="font-size:11px;color:var(--fk-primary);margin-left:4px">${NX.icon('image',10)} Photo</a>`:''}
    </td>
    <td class="hide-sm" style="font-size:12px;color:var(--fk-text-muted)">${esc(v.officer_name||'—')}</td>
    <td class="hide-sm" style="font-size:11px;color:var(--fk-text-muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v.notes||'')}">${esc((v.notes||'').substring(0,60))}${(v.notes||'').length>60?'…':''}</td>
  </tr>`;
}

// ── Log Visit Modal ────────────────────────────────────────────
let _fvClientsCache = [];

async function fvOpenLog(prefill) {
  prefill = prefill || {};

  if (!document.getElementById('m-fv-log')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="m-fv-log" class="mov">
      <div class="nx-modal nx-modal--m">
        <div class="nx-modal-header">
          <h3 class="nx-modal-title">Log Field Visit</h3>
          <button class="nx-modal-close" onclick="cm('m-fv-log')">${NX.icon('x',16)}</button>
        </div>
        <div class="nx-modal-body" id="m-fv-log-body">
          <div style="padding:28px;text-align:center;color:var(--fk-text-muted)">Loading…</div>
        </div>
        <div class="nx-modal-footer">
          ${NX.button('Cancel',    { variant:'ghost',   onclick:"cm('m-fv-log')" })}
          ${NX.button('Log Visit', { variant:'primary', attrs:'id="fv-log-save-btn"', onclick:'fvSubmitLog()' })}
        </div>
      </div>
    </div>`);
  }

  om('m-fv-log');
  const body = document.getElementById('m-fv-log-body');
  body.innerHTML = `<div style="padding:28px;text-align:center;color:var(--fk-text-muted)">Loading clients…</div>`;

  if (!_fvClientsCache.length) {
    const { data } = await supabase.rpc('list_clients_lookup', { p_company_id: S.cid });
    _fvClientsCache = Array.isArray(data) ? data : [];
  }

  const today = new Date().toISOString().split('T')[0];
  body.innerHTML = `
    <div class="nx-field">
      <label class="nx-label" for="fv-l-client">Client <span class="nx-req">*</span></label>
      <select class="nx-select" id="fv-l-client">
        <option value="">— Select client —</option>
        ${_fvClientsCache.map(c=>`<option value="${c.id}" ${prefill.clientId===c.id?'selected':''}>${esc(c.full_name||'')} (${esc(c.client_code||'')})</option>`).join('')}
      </select>
      <div class="nx-error"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="nx-field">
        <label class="nx-label" for="fv-l-date">Visit Date <span class="nx-req">*</span></label>
        <input class="nx-input" type="date" id="fv-l-date" value="${today}" max="${today}">
        <div class="nx-error"></div>
      </div>
      <div class="nx-field">
        <label class="nx-label" for="fv-l-outcome">Outcome <span class="nx-req">*</span></label>
        <select class="nx-select" id="fv-l-outcome" onchange="fvOnOutcomeChange(this.value)">
          ${Object.entries(_FV_OUTCOMES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
        </select>
        <div class="nx-error"></div>
      </div>
    </div>
    <div id="fv-l-conditional"></div>
    <div class="nx-field">
      <label class="nx-label" for="fv-l-address">Address Visited</label>
      <input class="nx-input" type="text" id="fv-l-address" placeholder="Street, area, city">
      <div class="nx-error"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="nx-field">
        <label class="nx-label" for="fv-l-lat">GPS Latitude</label>
        <div style="display:flex;gap:6px">
          <input class="nx-input" type="number" id="fv-l-lat" step="any" placeholder="Latitude" style="flex:1">
          ${NX.button('GPS', { variant:'ghost', size:'sm', onclick:'fvGetGPS()' })}
        </div>
      </div>
      <div class="nx-field">
        <label class="nx-label" for="fv-l-lng">GPS Longitude</label>
        <input class="nx-input" type="number" id="fv-l-lng" step="any" placeholder="Longitude">
      </div>
    </div>
    <div class="nx-field">
      <label class="nx-label" for="fv-l-notes">Notes</label>
      <textarea class="nx-textarea" id="fv-l-notes" rows="3" placeholder="Describe what happened during the visit…"></textarea>
      <div class="nx-error"></div>
    </div>`;

  fvOnOutcomeChange(document.getElementById('fv-l-outcome')?.value||'contacted');
}

function fvOnOutcomeChange(outcome) {
  const el = document.getElementById('fv-l-conditional');
  if (!el) return;

  if (outcome==='payment_collected') {
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="nx-field">
          <label class="nx-label" for="fv-l-amount">Amount Collected (PKR) <span class="nx-req">*</span></label>
          <input class="nx-input" type="number" id="fv-l-amount" min="1" placeholder="0">
          <div class="nx-error"></div>
        </div>
        <div class="nx-field">
          <label class="nx-label" for="fv-l-method">Payment Method</label>
          <select class="nx-select" id="fv-l-method">
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
      </div>`;
  } else if (outcome==='promise_received') {
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="nx-field">
          <label class="nx-label" for="fv-l-promise-amount">Promised Amount (PKR)</label>
          <input class="nx-input" type="number" id="fv-l-promise-amount" min="0" placeholder="0">
          <div class="nx-error"></div>
        </div>
        <div class="nx-field">
          <label class="nx-label" for="fv-l-promise-date">Promise Date</label>
          <input class="nx-input" type="date" id="fv-l-promise-date">
          <div class="nx-error"></div>
        </div>
      </div>`;
  } else {
    el.innerHTML = '';
  }
}

function fvGetGPS() {
  if (!navigator.geolocation) { notify.error('GPS not available in this browser.'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const latEl = document.getElementById('fv-l-lat');
    const lngEl = document.getElementById('fv-l-lng');
    if (latEl) latEl.value = pos.coords.latitude.toFixed(6);
    if (lngEl) lngEl.value = pos.coords.longitude.toFixed(6);
    if (typeof showToast==='function') showToast('GPS location captured','ok');
  }, () => { notify.error('Could not get GPS location. Please enter manually.'); });
}

async function fvSubmitLog() {
  const clientId = document.getElementById('fv-l-client')?.value;
  const date     = document.getElementById('fv-l-date')?.value;
  const outcome  = document.getElementById('fv-l-outcome')?.value;
  const address  = document.getElementById('fv-l-address')?.value?.trim()||null;
  const lat      = parseFloat(document.getElementById('fv-l-lat')?.value||'')||null;
  const lng      = parseFloat(document.getElementById('fv-l-lng')?.value||'')||null;
  const notes    = document.getElementById('fv-l-notes')?.value?.trim()||null;

  if (!clientId) { notify.error('Please select a client.'); return; }
  if (!date)     { notify.error('Visit date is required.'); return; }
  if (!outcome)  { notify.error('Please select an outcome.'); return; }

  const amtEl    = document.getElementById('fv-l-amount');
  const methodEl = document.getElementById('fv-l-method');
  const promAmt  = document.getElementById('fv-l-promise-amount');
  const promDate = document.getElementById('fv-l-promise-date');

  const collected = outcome==='payment_collected' ? parseFloat(amtEl?.value||0)||0 : null;
  if (outcome==='payment_collected' && !(collected>0)) { notify.error('Enter the amount collected.'); return; }

  const btn = document.getElementById('fv-log-save-btn');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }

  try {
    const { data, error } = await supabase.rpc('log_field_visit', {
      p_company_id:        S.cid,
      p_client_id:         clientId,
      p_visit_date:        date,
      p_outcome:           outcome,
      p_address:           address,
      p_gps_lat:           lat,
      p_gps_lng:           lng,
      p_notes:             notes,
      p_amount_collected:  collected,
      p_payment_method:    outcome==='payment_collected' ? (methodEl?.value||null) : null,
      p_promised_amount:   outcome==='promise_received'  ? parseFloat(promAmt?.value||0)||null : null,
      p_promise_date:      outcome==='promise_received'  ? (promDate?.value||null) : null,
      p_officer_name:      S.name||null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error||'Failed');
    cm('m-fv-log');
    if (typeof showToast==='function') showToast('Field visit logged successfully','ok');
    await _fvLoad();
  } catch(e) {
    notify.error(e.message||'Failed to log visit');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Log Visit'; }
  }
}

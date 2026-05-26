// ══ FIELD VISITS — Mobile Recovery ════════════════════════════
// Field visit logging with GPS, outcome tracking, analytics.
// ═════════════════════════════════════════════════════════════

let _fvData = [];
let _fvAnalytics = {};
let _fvFilter = { search: '', outcome: '', date_from: '', date_to: '' };

async function rFieldVisits() {
  const el = document.getElementById('pg-fieldvisits');
  if (!el) return;

  el.innerHTML = `
    <div class="ph">
      <div class="ph-l">
        <div class="ph-title">Field Visits</div>
        <div class="ph-sub">Track officer field recovery visits</div>
      </div>
      <div class="ph-r">
        <button class="btn btn-g" onclick="fvOpenLog()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Log Visit
        </button>
      </div>
    </div>

    <div class="fv-kpi-strip" id="fv-kpi-strip" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
      <div class="kpi"><div class="kpi-lbl"><span class="kpi-lbl-dot"></span>Total Visits</div><div class="kpi-val" id="fv-k-total">—</div></div>
      <div class="kpi"><div class="kpi-lbl"><span class="kpi-lbl-dot" style="--ka:#6366f1"></span>This Month</div><div class="kpi-val" id="fv-k-month">—</div></div>
      <div class="kpi"><div class="kpi-lbl"><span class="kpi-lbl-dot" style="--ka:#22c55e"></span>Today</div><div class="kpi-val" id="fv-k-today">—</div></div>
      <div class="kpi"><div class="kpi-lbl"><span class="kpi-lbl-dot" style="--ka:#f59e0b"></span>Payment Collected</div><div class="kpi-val" id="fv-k-collected">—</div></div>
    </div>

    <div class="fbar" style="margin-bottom:16px">
      <input class="inp" id="fv-search" placeholder="Search officer, client, unit…" oninput="fvFilter()" style="flex:1;min-width:180px">
      <select class="inp" id="fv-outcome" onchange="fvFilter()" style="min-width:160px">
        <option value="">All Outcomes</option>
        <option value="contacted">Contacted</option>
        <option value="payment_collected">Payment Collected</option>
        <option value="promise_received">Promise Received</option>
        <option value="not_found">Not Found</option>
        <option value="refused">Refused</option>
        <option value="other">Other</option>
      </select>
      <input class="inp" type="date" id="fv-date-from" onchange="fvFilter()" title="From date">
      <input class="inp" type="date" id="fv-date-to"   onchange="fvFilter()" title="To date">
    </div>

    <div class="fv-table-wrap tbl-wrap">
      <table class="data-tbl">
        <thead><tr>
          <th>Date</th>
          <th>Officer</th>
          <th>Client</th>
          <th>Unit / Project</th>
          <th>Location</th>
          <th>Outcome</th>
          <th>Notes</th>
        </tr></thead>
        <tbody id="fv-tbody"></tbody>
      </table>
    </div>`;

  await fvLoad();
}

async function fvLoad() {
  const co = gco();
  if (!co) return;

  const [analyticsRes, visitsRes] = await Promise.all([
    sb.rpc('get_field_visit_analytics', { p_company_id: co }),
    sb.rpc('get_field_visits', { p_company_id: co }),
  ]);

  if (analyticsRes.data && analyticsRes.data.success !== false) {
    _fvAnalytics = analyticsRes.data;
    _fvSetKpis(_fvAnalytics);
  }

  _fvData = Array.isArray(visitsRes.data) ? visitsRes.data : [];
  fvRender(_fvData);
}

function _fvSetKpis(a) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '0'; };
  set('fv-k-total',     a.total     ?? 0);
  set('fv-k-month',     a.this_month ?? 0);
  set('fv-k-today',     a.today     ?? 0);
  set('fv-k-collected', a.collected ?? 0);
}

function fvFilter() {
  _fvFilter.search    = (document.getElementById('fv-search')    || {}).value || '';
  _fvFilter.outcome   = (document.getElementById('fv-outcome')   || {}).value || '';
  _fvFilter.date_from = (document.getElementById('fv-date-from') || {}).value || '';
  _fvFilter.date_to   = (document.getElementById('fv-date-to')   || {}).value || '';

  const q = _fvFilter.search.toLowerCase();
  const filtered = _fvData.filter(v => {
    if (_fvFilter.outcome && v.outcome !== _fvFilter.outcome) return false;
    if (_fvFilter.date_from && v.visit_date < _fvFilter.date_from) return false;
    if (_fvFilter.date_to   && v.visit_date > _fvFilter.date_to)   return false;
    if (q && !((v.officer_name||'').toLowerCase().includes(q) ||
               (v.client_name||'').toLowerCase().includes(q)  ||
               (v.unit_no||'').toLowerCase().includes(q)       ||
               (v.project_name||'').toLowerCase().includes(q))) return false;
    return true;
  });
  fvRender(filtered);
}

const _FV_OUTCOME_LABELS = {
  contacted:         'Contacted',
  payment_collected: 'Payment Collected',
  promise_received:  'Promise Received',
  not_found:         'Not Found',
  refused:           'Refused',
  other:             'Other',
};
const _FV_OUTCOME_COLORS = {
  contacted:         '#6366f1',
  payment_collected: '#22c55e',
  promise_received:  '#f59e0b',
  not_found:         '#94a3b8',
  refused:           '#ef4444',
  other:             '#64748b',
};

function fvRender(rows) {
  const tb = document.getElementById('fv-tbody');
  if (!tb) return;
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--t4)">No field visits found</td></tr>';
    return;
  }
  tb.innerHTML = rows.map(v => {
    const color = _FV_OUTCOME_COLORS[v.outcome] || '#64748b';
    const label = esc(_FV_OUTCOME_LABELS[v.outcome] || v.outcome || '—');
    const dt    = v.visit_date ? new Date(v.visit_date).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';
    const loc   = v.location_name ? esc(v.location_name) : (v.latitude ? `${Number(v.latitude).toFixed(4)}, ${Number(v.longitude).toFixed(4)}` : '—');
    const notes = v.notes ? `<span title="${esc(v.notes)}">${esc(v.notes.length>40 ? v.notes.slice(0,40)+'…' : v.notes)}</span>` : '—';
    const photo = v.photo_url
      ? `<a href="${esc(v.photo_url)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--brand)">View Photo</a>`
      : '';
    return `<tr>
      <td style="white-space:nowrap">${dt}${v.visit_time ? '<br><span style="font-size:11px;color:var(--t4)">' + esc(String(v.visit_time).slice(0,5)) + '</span>' : ''}</td>
      <td>${esc(v.officer_name || '—')}</td>
      <td>${esc(v.client_name || '—')}</td>
      <td>${v.unit_no ? `<b>${esc(v.unit_no)}</b>` : ''}${v.project_name ? `<br><span style="font-size:11px;color:var(--t4)">${esc(v.project_name)}</span>` : ''}</td>
      <td style="font-size:12px;color:var(--t3)">${loc}</td>
      <td><span style="display:inline-block;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600;background:${color}22;color:${color}">${label}</span></td>
      <td style="font-size:12px;max-width:200px">${notes}${photo ? '<br>' + photo : ''}</td>
    </tr>`;
  }).join('');
}

// ── Log Visit Modal ────────────────────────────────────────
function fvOpenLog() {
  const co = gco();
  if (!co) return;

  const today = new Date().toISOString().slice(0, 10);
  const now   = new Date().toTimeString().slice(0, 5);

  const clients = typeof gclients === 'function' ? gclients() : [];
  const clientOpts = clients.map(c =>
    `<option value="${esc(c.id)}" data-name="${esc(c.full_name||c.name||'')}">${esc(c.full_name||c.name||'')}</option>`
  ).join('');

  const html = `
    <div class="mh">
      <div class="mt">Log Field Visit</div>
      <button class="mc" onclick="cm('fv-modal')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="mb" style="display:flex;flex-direction:column;gap:12px">
      <div class="g2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="fg">
          <label class="fl">Visit Date *</label>
          <input class="inp" type="date" id="fv-l-date" value="${today}">
        </div>
        <div class="fg">
          <label class="fl">Time</label>
          <input class="inp" type="time" id="fv-l-time" value="${now}">
        </div>
      </div>
      <div class="fg">
        <label class="fl">Officer Name *</label>
        <input class="inp" id="fv-l-officer" placeholder="Your name" value="${(typeof S !== 'undefined' && S.name) ? S.name : ''}">
      </div>
      <div class="fg">
        <label class="fl">Client</label>
        <select class="inp" id="fv-l-client" onchange="fvClientChange(this)">
          <option value="">— Select Client —</option>
          ${clientOpts}
        </select>
      </div>
      <div class="g2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="fg">
          <label class="fl">Unit No.</label>
          <input class="inp" id="fv-l-unit" placeholder="e.g. B-204">
        </div>
        <div class="fg">
          <label class="fl">Project</label>
          <input class="inp" id="fv-l-project" placeholder="Project name">
        </div>
      </div>
      <div class="fg">
        <label class="fl">Outcome *</label>
        <select class="inp" id="fv-l-outcome">
          <option value="contacted">Contacted</option>
          <option value="payment_collected">Payment Collected</option>
          <option value="promise_received">Promise Received</option>
          <option value="not_found">Not Found</option>
          <option value="refused">Refused</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="fg">
        <label class="fl">Location</label>
        <div class="fv-location-row" style="display:flex;gap:8px;align-items:flex-end">
          <input class="inp" id="fv-l-location" placeholder="Address or area" style="flex:1">
          <button class="btn btn-gh" onclick="fvGetGPS()" title="Get GPS location" style="white-space:nowrap;flex-shrink:0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
            GPS
          </button>
        </div>
        <input type="hidden" id="fv-l-lat">
        <input type="hidden" id="fv-l-lng">
      </div>
      <div class="fg">
        <label class="fl">Notes</label>
        <textarea class="inp" id="fv-l-notes" rows="3" placeholder="What happened during the visit?"></textarea>
      </div>
      <div class="fg">
        <label class="fl">Photo (optional)</label>
        <input class="inp" type="file" id="fv-l-photo" accept="image/*" capture="environment" onchange="fvPhotoPreview(this)">
        <div id="fv-l-photo-prev" style="margin-top:6px"></div>
      </div>
    </div>
    <div class="mf" style="display:flex;justify-content:flex-end;gap:10px">
      <button class="btn btn-gh" onclick="cm('fv-modal')">Cancel</button>
      <button class="btn btn-g" onclick="fvSubmit()">Save Visit</button>
    </div>`;

  let modal = document.getElementById('fv-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'fv-modal';
    modal.className = 'mov';
    modal.innerHTML = '<div class="md">' + html + '</div>';
    document.body.appendChild(modal);
  } else {
    modal.querySelector('.md').innerHTML = html;
  }
  om('fv-modal');
}

function fvClientChange(sel) {
  const opt = sel.options[sel.selectedIndex];
  const name = opt.getAttribute('data-name') || '';
  const unitEl = document.getElementById('fv-l-unit');
  // If client has a linked unit in memory, could auto-fill — skip for now
}

function fvGetGPS() {
  if (!navigator.geolocation) {
    toast('GPS not supported on this device', 'warn'); return;
  }
  const btn = document.querySelector('[onclick="fvGetGPS()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Getting…'; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const latEl = document.getElementById('fv-l-lat');
      const lngEl = document.getElementById('fv-l-lng');
      const locEl = document.getElementById('fv-l-location');
      if (latEl) latEl.value = lat;
      if (lngEl) lngEl.value = lng;
      if (locEl && !locEl.value) locEl.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Got it'; btn.style.color='var(--ok)'; }
    },
    err => {
      toast('Could not get location: ' + err.message, 'warn');
      if (btn) { btn.disabled = false; btn.textContent = 'GPS'; }
    },
    { timeout: 10000, enableHighAccuracy: true }
  );
}

function fvPhotoPreview(input) {
  const prev = document.getElementById('fv-l-photo-prev');
  if (!prev || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    prev.innerHTML = `<img src="${e.target.result}" style="max-height:80px;border-radius:6px;border:1px solid var(--line)">`;
  };
  reader.readAsDataURL(input.files[0]);
}

async function fvSubmit() {
  const co = gco();
  if (!co) return;

  const officerEl  = document.getElementById('fv-l-officer');
  const dateEl     = document.getElementById('fv-l-date');
  const timeEl     = document.getElementById('fv-l-time');
  const clientEl   = document.getElementById('fv-l-client');
  const unitEl     = document.getElementById('fv-l-unit');
  const projectEl  = document.getElementById('fv-l-project');
  const outcomeEl  = document.getElementById('fv-l-outcome');
  const locationEl = document.getElementById('fv-l-location');
  const latEl      = document.getElementById('fv-l-lat');
  const lngEl      = document.getElementById('fv-l-lng');
  const notesEl    = document.getElementById('fv-l-notes');

  const officerName = (officerEl?.value || '').trim();
  const visitDate   = dateEl?.value || '';

  if (!officerName) { toast('Officer name is required', 'err'); officerEl?.focus(); return; }
  if (!visitDate)   { toast('Visit date is required', 'err'); dateEl?.focus(); return; }

  const clientId   = clientEl?.value || '';
  const clientName = clientEl
    ? (clientEl.options[clientEl.selectedIndex]?.getAttribute('data-name') || '')
    : '';

  const data = {
    officer_id:    (typeof S !== 'undefined' && S.userId) ? S.userId : null,
    officer_name:  officerName,
    client_id:     clientId || null,
    client_name:   clientName || null,
    unit_id:       null,
    unit_no:       unitEl?.value?.trim() || null,
    project_name:  projectEl?.value?.trim() || null,
    visit_date:    visitDate,
    visit_time:    timeEl?.value || null,
    latitude:      latEl?.value ? parseFloat(latEl.value) : null,
    longitude:     lngEl?.value ? parseFloat(lngEl.value) : null,
    location_name: locationEl?.value?.trim() || null,
    outcome:       outcomeEl?.value || 'other',
    notes:         notesEl?.value?.trim() || null,
    photo_url:     null,
  };

  // Photo upload if present
  const photoInput = document.getElementById('fv-l-photo');
  if (photoInput?.files[0]) {
    const file = photoInput.files[0];
    const ext  = file.name.split('.').pop();
    const path = `field-visits/${co}/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('rms-files').upload(path, file, { upsert: true });
    if (!upErr) {
      const { data: pub } = sb.storage.from('rms-files').getPublicUrl(path);
      data.photo_url = pub?.publicUrl || null;
    }
  }

  const saveBtn = document.querySelector('#fv-modal .btn-g');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  const { data: res, error } = await sb.rpc('log_field_visit', {
    p_company_id: co,
    p_data: data,
  });

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Visit'; }

  if (error || (res && res.success === false)) {
    toast(error?.message || res?.error || 'Failed to save visit', 'err'); return;
  }

  toast('Visit logged successfully', 'ok');
  cm('fv-modal');
  await fvLoad();
}

// ── Offline Call Log Queue ─────────────────────────────────
// Offline queuing for call logs — syncs when back online.
const _FV_QUEUE_KEY = 'rms.offline.calllog';

function fvQueueCallLog(data) {
  try {
    const q = JSON.parse(localStorage.getItem(_FV_QUEUE_KEY) || '[]');
    q.push({ ...data, _queued_at: Date.now() });
    localStorage.setItem(_FV_QUEUE_KEY, JSON.stringify(q));
  } catch (e) { /* ignore */ }
}

async function fvSyncOfflineQueue() {
  const co = gco();
  if (!co || !navigator.onLine) return;
  let q;
  try { q = JSON.parse(localStorage.getItem(_FV_QUEUE_KEY) || '[]'); } catch (e) { return; }
  if (!q.length) return;

  const remaining = [];
  for (const item of q) {
    const { _queued_at, ...payload } = item;
    const { error } = await sb.from('contact_logs').insert({ ...payload, company_id: co });
    if (error) remaining.push(item);
  }
  localStorage.setItem(_FV_QUEUE_KEY, JSON.stringify(remaining));
  if (remaining.length < q.length) {
    toast(`${q.length - remaining.length} offline call log(s) synced`, 'ok');
  }
}

// Run sync on reconnect
window.addEventListener('online', fvSyncOfflineQueue);

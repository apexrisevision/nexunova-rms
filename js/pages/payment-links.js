// ══ SMART PAYMENT LINKS MODULE ════════════════════════════════════
// Pages: payment-links (dashboard) + payment-link-detail

// ── State ─────────────────────────────────────────────────────────
let _plRows      = [];
let _plTab       = 'all';
let _plSearch    = '';
let _plFromDate  = '';
let _plToDate    = '';
let _plStats     = null;

// ── Create modal state ────────────────────────────────────────────
let _plcSales       = [];
let _plcInstalls    = [];
let _plcMethods     = [];
let _plcSelInstalls = new Set();
let _plcSelMethods  = new Set();
let _plcAmount      = 0;
let _plcExternalSaleId = null; // pre-fill from sale/radar

// ── Verify modal state ────────────────────────────────────────────
let _plvLink = null;

// ── Upload modal state ────────────────────────────────────────────
let _plusLink = null;
let _plusFile = null;

// ═══════════════════════════════════════════════════════════════════
// MAIN DASHBOARD PAGE
// ═══════════════════════════════════════════════════════════════════
async function rPayLinks() {
  const el = document.getElementById('pg-paylinks');
  if (!el) return;
  const cid = S?.cid;
  if (!cid) { el.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><div class="et">No company selected</div></div></div>`; return; }

  el.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l">
        <h2>Smart Payment Links</h2>
        <p>Send payment requests via WhatsApp &amp; track collections</p>
      </div>
      <div class="ph-r" style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-g btn-sm" onclick="plOpenCreate()">+ New Payment Link</button>
        <button class="btn btn-gh btn-sm" onclick="nav('payment-methods')">Manage Methods</button>
        <button class="btn btn-print btn-sm" onclick="window.print()">Print</button>
      </div>
    </div>

    <!-- Stats -->
    <div class="pl-stats-grid" id="pl-stats-grid">
      ${[1,2,3,4,5].map(()=>`<div class="pl-stat-card"><div class="pl-shimmer" style="width:40px;height:40px;border-radius:8px;margin-bottom:10px"></div><div class="pl-shimmer" style="width:70%"></div><div class="pl-shimmer" style="width:50%;margin-top:6px"></div></div>`).join('')}
    </div>

    <!-- Tabs -->
    <div class="pl-tabs" id="pl-tabs">
      <button class="pl-tab active" data-tab="all"      onclick="plSetTab('all')">All</button>
      <button class="pl-tab"        data-tab="screenshot_received" onclick="plSetTab('screenshot_received')">Pending Verify</button>
      <button class="pl-tab"        data-tab="sent"     onclick="plSetTab('sent')">Awaiting Payment</button>
      <button class="pl-tab"        data-tab="verified" onclick="plSetTab('verified')">Verified</button>
      <button class="pl-tab"        data-tab="rejected" onclick="plSetTab('rejected')">Rejected</button>
      <button class="pl-tab"        data-tab="expired"  onclick="plSetTab('expired')">⏰ Expired</button>
    </div>

    <!-- Filters -->
    <div class="pl-filters">
      <div class="fg">
        <label>From</label>
        <input class="inp-light" type="date" style="padding:7px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px"
          onchange="_plFromDate=this.value;plLoad()">
      </div>
      <div class="fg">
        <label>To</label>
        <input class="inp-light" type="date" style="padding:7px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px"
          onchange="_plToDate=this.value;plLoad()">
      </div>
      <div class="fg">
        <label>Search Client</label>
        <input class="inp-light" type="text" placeholder="Name…" style="padding:7px 10px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px;min-width:160px"
          oninput="_plSearch=this.value.toLowerCase();plRenderTable()">
      </div>
      <button class="btn btn-gh btn-sm" onclick="_plFromDate='';_plToDate='';_plSearch='';document.querySelectorAll('.pl-filters input').forEach(i=>i.value='');plLoad()">↺ Clear</button>
    </div>

    <!-- Table -->
    <div id="pl-table-wrap"><div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading…</div></div>
  </div>`;

  await Promise.all([plLoadStats(), plLoad()]);
}

async function plLoadStats() {
  try {
    const { data, error } = await supabase.rpc('get_payment_link_stats', { p_company_id: S.cid, p_days: 30 });
    if (error) throw error;
    _plStats = data;
    _plRenderStats(data);
  } catch(e) {
    const el = document.getElementById('pl-stats-grid');
    if (el) el.innerHTML = `<div style="color:var(--t3);font-size:12px">Stats unavailable</div>`;
  }
}

function _plRenderStats(s) {
  const el = document.getElementById('pl-stats-grid');
  if (!el) return;
  const cards = [
    { icon:'', val: s?.total_sent||0,             lbl:'Sent (30d)',    accent:'#6366f1' },
    { icon:'', val: s?.pending_verification||0,   lbl:'Pending Verify',accent:'#f59e0b' },
    { icon:'', val: s?.verified||0,               lbl:'Verified',      accent:'#10b981' },
    { icon:'', val: (s?.success_rate||0)+'%',     lbl:'Success Rate',  accent:'#3b82f6' },
    { icon:'', val: 'PKR '+_fmtM(s?.total_collected||0), lbl:'Collected', accent:'#8b5cf6' },
  ];
  el.innerHTML = cards.map(c => `
    <div class="pl-stat-card">
      <div class="pl-sc-accent" style="background:${c.accent}"></div>
      <div class="pl-sc-icon">${c.icon}</div>
      <div class="pl-sc-val">${esc(String(c.val))}</div>
      <div class="pl-sc-lbl">${c.lbl}</div>
    </div>`).join('');
}

function _fmtM(n) {
  n = Number(n||0);
  if (n >= 1e7) return (n/1e7).toFixed(1)+'Cr';
  if (n >= 1e5) return (n/1e5).toFixed(1)+'L';
  return Number(n).toLocaleString('en-PK');
}

async function plLoad() {
  const wrap = document.getElementById('pl-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading…</div>`;
  try {
    const params = {
      p_company_id: S.cid,
      p_status:     _plTab === 'all' ? null : _plTab,
      p_from_date:  _plFromDate || null,
      p_to_date:    _plToDate   || null,
      p_limit:      200,
      p_offset:     0
    };
    const { data, error } = await supabase.rpc('get_payment_links', params);
    if (error) throw error;
    _plRows = data || [];
    _plUpdateTabCounts();
    plRenderTable();
  } catch(e) {
    if (wrap) wrap.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><div class="et">Failed to load</div><div class="es">${esc(e.message)}</div></div></div>`;
  }
}

function _plUpdateTabCounts() {
  const counts = {};
  _plRows.forEach(r => { counts[r.status] = (counts[r.status]||0)+1; });
  const tabMap = { screenshot_received: 'screenshot_received', sent: 'sent',
    verified: 'verified', rejected: 'rejected', expired: 'expired' };
  Object.entries(tabMap).forEach(([k, v]) => {
    const btn = document.querySelector(`.pl-tab[data-tab="${k}"]`);
    if (!btn) return;
    const cnt = counts[v] || 0;
    const existing = btn.querySelector('.pl-tab-count');
    if (existing) existing.remove();
    if (cnt > 0) btn.innerHTML += `<span class="pl-tab-count">${cnt}</span>`;
  });
}

function plSetTab(tab) {
  _plTab = tab;
  document.querySelectorAll('.pl-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  plRenderTable();
}

function plRenderTable() {
  const wrap = document.getElementById('pl-table-wrap');
  if (!wrap) return;
  let rows = _plRows.filter(r => {
    if (_plTab !== 'all' && r.status !== _plTab) return false;
    if (_plSearch) {
      const hay = ((r.client_name||'')+(r.ref_code||'')+(r.unit_number||'')+(r.project_name||'')).toLowerCase();
      if (!hay.includes(_plSearch)) return false;
    }
    return true;
  });

  if (!rows.length) {
    wrap.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>
      <div class="et">No payment links found</div>
      <div class="es">Click "New Payment Link" to send your first request</div>
      <button class="btn btn-g btn-sm" style="margin-top:12px" onclick="plOpenCreate()">+ New Payment Link</button>
    </div></div>`;
    return;
  }

  wrap.innerHTML = `<div class="pl-table-wrap">
    <table class="pl-table">
      <thead><tr>
        <th>Ref#</th><th>Date</th><th>Client</th><th>Property</th>
        <th>Amount</th><th>Status</th><th>Officer</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows.map(_plRowHTML).join('')}</tbody>
    </table>
  </div>`;
}

function _plRowHTML(r) {
  const badge = _plBadge(r.status);
  const date  = r.sent_at ? new Date(r.sent_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  const actions = _plRowActions(r);
  return `<tr>
    <td><span class="pl-ref" style="cursor:pointer" onclick="plOpenDetail('${r.id}')">${esc(r.ref_code)}</span></td>
    <td><span class="pl-date">${date}${r.days_since_sent > 0 ? '<br><span style="font-size:10px;color:var(--t3)">'+r.days_since_sent+'d ago</span>' : ''}</span></td>
    <td><div style="font-weight:600;font-size:13px">${esc(r.client_name||'—')}</div><div style="font-size:11px;color:var(--t3)">${esc(r.client_phone||'')}</div></td>
    <td><div style="font-size:13px">${esc(r.unit_number||'—')}</div><div style="font-size:11px;color:var(--t3)">${esc(r.project_name||'')}</div></td>
    <td><span class="pl-amount">PKR ${fM(r.requested_amount)}</span>${r.client_claimed_amount && r.client_claimed_amount !== r.requested_amount ? '<br><span style="font-size:10px;color:var(--t3)">Claimed: PKR '+fM(r.client_claimed_amount)+'</span>' : ''}</td>
    <td>${badge}</td>
    <td><span style="font-size:12px;color:var(--t3)">${esc(r.sent_by||'—')}</span></td>
    <td><div class="pl-actions">${actions}</div></td>
  </tr>`;
}

function _plBadge(status) {
  const map = {
    sent:                 ['','Sent',              'sent'],
    screenshot_received:  ['','Screenshot Received','screenshot'],
    verified:             ['','Verified',           'verified'],
    rejected:             ['','Rejected',           'rejected'],
    expired:              ['⏰','Expired',            'expired'],
    cancelled:            ['','Cancelled',          'cancelled'],
  };
  const [ic, lbl, cls] = map[status] || ['?', status, 'gray'];
  return `<span class="pl-badge ${cls}">${ic} ${lbl}</span>`;
}

function _plRowActions(r) {
  const id = r.id;
  switch (r.status) {
    case 'sent':
      return `<button class="pl-btn blue"  onclick="plResend('${id}')">Resend</button>
              <button class="pl-btn orange" onclick="plOpenUpload('${id}')">Upload</button>
              <button class="pl-btn gray"   onclick="plCancel('${id}')">Cancel</button>`;
    case 'screenshot_received':
      return `<button class="pl-btn green"  onclick="plOpenVerify('${id}')">Verify</button>
              <button class="pl-btn red"    onclick="plOpenReject('${id}')">Reject</button>
              <button class="pl-btn blue"   onclick="plViewScreenshot('${r.screenshot_url}')">Screenshot</button>`;
    case 'verified':
      return `<button class="pl-btn blue"  onclick="plOpenDetail('${id}')">View PRV</button>
              <button class="pl-btn green"  onclick="plResendConfirm('${id}')">Confirm</button>`;
    case 'rejected':
      return `<button class="pl-btn blue"  onclick="plOpenCreate(null,'${r.client_id}','${r.sale_id}')">New Link</button>`;
    default:
      return `<button class="pl-btn gray"  onclick="plOpenDetail('${id}')">View</button>`;
  }
}

// ─── Actions ─────────────────────────────────────────────────────
async function plResend(id) {
  const row = _plRows.find(r => r.id === id);
  if (!row) return;
  if (!confirm('Resend reminder to ' + (row.client_name||'client') + '?')) return;
  try {
    const { data, error } = await supabase.rpc('send_payment_link_reminder', {
      p_payment_link_id: id, p_sent_by: S.name || S.userId || 'officer'
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    openWhatsApp(row.client_phone || '', data.message_text);
    toast('Reminder sent via WhatsApp', 'ok');
    plLoad();
  } catch(e) {
    if (e.message === 'too_soon') { toast('Wait at least 2 days after sending before reminding', 'warn'); return; }
    toast('Error: ' + e.message, 'err');
  }
}

async function plCancel(id) {
  if (!confirm('Cancel this payment link? The client will not be able to pay using this link.')) return;
  try {
    const { data, error } = await supabase.rpc('cancel_payment_link', {
      p_payment_link_id: id, p_cancelled_by: S.name || 'officer', p_reason: 'Cancelled by officer'
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast('Payment link cancelled', 'ok');
    plLoad();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

function plViewScreenshot(url) {
  if (!url) { toast('No screenshot available', 'warn'); return; }
  window.open(url, '_blank');
}

async function plResendConfirm(id) {
  try {
    const { data, error } = await supabase.rpc('send_payment_confirmation', { p_payment_link_id: id });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    window.open(data.whatsapp_url + '?text=' + encodeURIComponent(data.message_text), '_blank');
    toast('Confirmation WhatsApp opened', 'ok');
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ─── Detail view ──────────────────────────────────────────────────
async function plOpenDetail(id) {
  const el = document.getElementById('pg-paylink-detail');
  if (!el) { nav('paylinks'); return; }
  // Navigate to detail page and load
  _plDetailId = id;
  nav('paylink-detail');
}

let _plDetailId = null;

async function rPayLinkDetail() {
  const el = document.getElementById('pg-paylink-detail');
  if (!el) return;
  el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading…</div>`;
  if (!_plDetailId) { el.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><div class="et">No link selected</div></div></div>`; return; }

  try {
    const { data, error } = await supabase.rpc('get_payment_link_detail',
      { p_id: _plDetailId, p_company_id: S.cid });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Not found');
    _plRenderDetail(data);
  } catch(e) {
    el.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><div class="et">Error</div><div class="es">${esc(e.message)}</div><button class="btn btn-g btn-sm" style="margin-top:12px" onclick="nav('paylinks')">← Back to Links</button></div></div>`;
  }
}

function _plRenderDetail(data) {
  const el = document.getElementById('pg-paylink-detail');
  if (!el) return;
  const lk = data.link;
  const hist = data.history || [];
  const reminders = data.reminders || [];
  const badge = _plBadge(lk.status);
  const sentDate = lk.sent_at ? new Date(lk.sent_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

  el.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l">
        <h2>Payment Link Detail</h2>
        <p style="font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--brand)">${esc(lk.ref_code)}</p>
      </div>
      <div class="ph-r" style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-gh btn-sm" onclick="nav('paylinks')">← Back</button>
        ${lk.status==='sent' ? `<button class="btn btn-g btn-sm" onclick="plResend('${lk.id}')">Send Reminder</button>` : ''}
        ${lk.status==='screenshot_received' ? `<button class="btn btn-g btn-sm" onclick="plOpenVerify('${lk.id}')">Verify</button>` : ''}
        ${lk.status==='verified' ? `<button class="btn btn-g btn-sm" onclick="plResendConfirm('${lk.id}')">Resend Confirmation</button>` : ''}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">

      <!-- Left: Link info -->
      <div class="card" style="padding:18px">
        <div style="font-size:13px;font-weight:700;color:var(--t3);margin-bottom:12px">LINK DETAILS</div>
        <div class="pl-claim-box">
          ${_plDetailRow('Ref Code',`<span style="font-family:'JetBrains Mono',monospace;color:var(--brand)">${esc(lk.ref_code)}</span>`)}
          ${_plDetailRow('Status', badge)}
          ${_plDetailRow('Client', esc(lk.client_name||'—'))}
          ${_plDetailRow('Phone', esc(lk.client_phone||'—'))}
          ${_plDetailRow('Property', esc((lk.unit_number||'?')+' — '+(lk.project_name||'?')))}
          ${_plDetailRow('Amount', `<strong>PKR ${fM(lk.requested_amount)}</strong>`)}
          ${_plDetailRow('Sent By', esc(lk.sent_by||'—'))}
          ${_plDetailRow('Sent At', sentDate)}
          ${lk.expires_at ? _plDetailRow('Expires', new Date(lk.expires_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})) : ''}
          ${lk.prv_number ? _plDetailRow('PRV#', `<span style="font-family:'JetBrains Mono',monospace;color:#10b981">${esc(lk.prv_number)}</span>`) : ''}
          ${lk.verified_by ? _plDetailRow('Verified By', esc(lk.verified_by)) : ''}
          ${lk.rejection_reason ? _plDetailRow('Rejection Reason', esc(lk.rejection_reason)) : ''}
        </div>
        ${lk.whatsapp_url ? `<a href="${esc(lk.whatsapp_url)}" target="_blank" class="btn btn-g btn-sm" style="margin-top:14px;display:inline-block;text-decoration:none">Open WhatsApp</a>` : ''}
      </div>

      <!-- Right: Screenshot + claim -->
      <div class="card" style="padding:18px">
        ${lk.screenshot_url ? `
          <div style="font-size:13px;font-weight:700;color:var(--t3);margin-bottom:12px">SCREENSHOT</div>
          <img src="${esc(lk.screenshot_url)}" class="pl-screenshot-preview" onclick="window.open(this.src,'_blank')" alt="Payment screenshot">
          <div class="pl-claim-box" style="margin-top:14px">
            <div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">CLIENT'S CLAIM</div>
            ${_plDetailRow('Claimed Amount', lk.client_claimed_amount ? 'PKR '+fM(lk.client_claimed_amount) : '—')}
            ${_plDetailRow('Method', esc(lk.client_claimed_method||'—'))}
            ${_plDetailRow('Ref/TxnID', esc(lk.client_claimed_ref||'—'))}
            ${_plDetailRow('Date', lk.client_claimed_date ? new Date(lk.client_claimed_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—')}
            ${lk.client_notes ? _plDetailRow('Notes', esc(lk.client_notes)) : ''}
          </div>
        ` : `<div style="text-align:center;padding:40px 20px;color:var(--t3)">
          <div style="font-size:36px;margin-bottom:8px"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
          <div>No screenshot uploaded yet</div>
          ${lk.status==='sent' ? `<button class="btn btn-g btn-sm" style="margin-top:12px" onclick="plOpenUpload('${lk.id}')">Upload Screenshot</button>` : ''}
        </div>`}
      </div>
    </div>

    <!-- Status timeline -->
    <div class="card" style="padding:18px;margin-bottom:20px">
      <div style="font-size:13px;font-weight:700;color:var(--t3);margin-bottom:12px">STATUS HISTORY</div>
      <ul class="pl-timeline">
        ${hist.map(h => `<li>
          <div class="pl-tl-dot"></div>
          <div style="flex:1">
            <div style="font-weight:600">${esc(h.from_status||'—')} → ${esc(h.to_status)}</div>
            ${h.notes ? `<div style="font-size:12px;color:var(--t3)">${esc(h.notes)}</div>` : ''}
            <div class="pl-tl-time">${h.changed_by ? esc(h.changed_by)+' · ' : ''}${h.changed_at ? new Date(h.changed_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : ''}</div>
          </div>
        </li>`).join('')}
      </ul>
    </div>

    <!-- Reminders -->
    ${reminders.length ? `<div class="card" style="padding:18px">
      <div style="font-size:13px;font-weight:700;color:var(--t3);margin-bottom:12px">REMINDERS SENT (${reminders.length})</div>
      ${reminders.map(r=>`<div style="padding:8px 0;border-bottom:1px solid var(--line);font-size:13px">
        <div><strong>Reminder #${r.reminder_number}</strong> — ${r.sent_by||'officer'} — ${r.sent_at ? new Date(r.sent_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : ''}</div>
      </div>`).join('')}
    </div>` : ''}
  </div>`;
}

function _plDetailRow(label, val) {
  return `<div class="pl-claim-row"><span class="pl-claim-label">${label}</span><span class="pl-claim-val">${val}</span></div>`;
}

// ═══════════════════════════════════════════════════════════════════
// CREATE PAYMENT LINK MODAL
// ═══════════════════════════════════════════════════════════════════
async function plOpenCreate(extraData, preClientId, preSaleId) {
  _plcSelInstalls.clear();
  _plcSelMethods.clear();
  _plcAmount = 0;
  _plcExternalSaleId = preSaleId || null;

  om('m-create-pl');
  _plcRenderForm();

  // Load payment methods
  try {
    const { data } = await supabase.from('company_payment_methods')
      .select('*').eq('company_id', S.cid).eq('is_active', true).order('display_order');
    _plcMethods = data || [];
    _plcSelMethods = new Set((_plcMethods).map(m => m.id));
  } catch(e) { _plcMethods = []; }

  // Pre-fill client if provided
  if (preClientId) {
    const sel = document.getElementById('plc-client');
    if (sel) { sel.value = preClientId; await _plcOnClientChange(); }
  }
  if (preSaleId) {
    const sel = document.getElementById('plc-sale');
    if (sel) { sel.value = preSaleId; await _plcOnSaleChange(); }
  }

  _plcRenderMethods();
  _plcRenderPreview();
}

function _plcRenderForm() {
  const body = document.getElementById('m-create-pl-body');
  if (!body) return;

  const clients = (window._clientsCache || []).filter(c => c.companyId === S.cid || c.company_id === S.cid);

  body.innerHTML = `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
  <!-- LEFT: Form -->
  <div>
    <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:10px">Client & Property</div>

    <div class="fr" style="margin-bottom:12px">
      <label class="fl">Client *</label>
      <select id="plc-client" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px" onchange="_plcOnClientChange()">
        <option value="">— Select Client —</option>
        ${clients.map(c=>`<option value="${c.id}">${esc(c.full_name||c.name||'')} ${c.phone_primary?'('+c.phone_primary+')':''}</option>`).join('')}
      </select>
    </div>

    <div class="fr" style="margin-bottom:12px">
      <label class="fl">Sale / Unit *</label>
      <select id="plc-sale" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px" onchange="_plcOnSaleChange()">
        <option value="">— Select client first —</option>
      </select>
    </div>

    <div id="plc-installments-section" style="display:none;margin-bottom:12px">
      <label class="fl">Installments</label>
      <div id="plc-install-list" style="max-height:180px;overflow-y:auto;border:1.5px solid var(--line);border-radius:var(--rm);padding:6px"></div>
    </div>

    <div class="g2" style="margin-bottom:12px">
      <div class="fr">
        <label class="fl">Amount (PKR) *</label>
        <input id="plc-amount" type="number" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px"
          placeholder="0" oninput="_plcAmount=Number(this.value);_plcRenderPreview()">
      </div>
      <div class="fr">
        <label class="fl">Valid for</label>
        <select id="plc-validity" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px">
          <option value="3">3 days</option>
          <option value="7" selected>7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
          <option value="0">No expiry</option>
        </select>
      </div>
    </div>

    <div class="fr" style="margin-bottom:12px">
      <label class="fl">Description</label>
      <input id="plc-desc" type="text" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px"
        placeholder="Installment payment…" oninput="_plcRenderPreview()">
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:8px">Payment Methods</div>
    <div id="plc-methods-list" class="pl-method-list">
      <div style="color:var(--t3);font-size:12px;padding:8px">Loading methods…</div>
    </div>
    ${_plcMethods.length === 0 ? `<div style="margin-top:8px;padding:10px;background:rgba(245,158,11,.08);border-radius:8px;font-size:12px;color:#d97706">
      No payment methods configured. <a href="#" onclick="nav('payment-methods');cm('m-create-pl');return false" style="color:var(--brand)">Add methods first →</a>
    </div>` : ''}
  </div>

  <!-- RIGHT: Preview -->
  <div>
    <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:10px">WhatsApp Preview</div>
    <div id="plc-preview-box" class="pl-preview-box" style="min-height:320px">
      Select a client and sale to see preview…
    </div>
  </div>
  </div>`;
}

async function _plcOnClientChange() {
  const clientId = document.getElementById('plc-client')?.value;
  if (!clientId) return;
  const saleSel = document.getElementById('plc-sale');
  if (!saleSel) return;
  saleSel.innerHTML = '<option value="">Loading…</option>';

  try {
    const { data } = await supabase
      .from('sales').select('id, sale_number, unit_id, units(unit_no), projects(project_name)')
      .eq('company_id', S.cid).eq('client_id', clientId).eq('status', 'active');
    _plcSales = data || [];
    saleSel.innerHTML = '<option value="">— Select Sale —</option>' +
      _plcSales.map(s => {
        const uNo = s.units?.unit_no || '?';
        const pNm = s.projects?.project_name || '?';
        return `<option value="${s.id}">${esc(uNo)} — ${esc(pNm)} (${esc(s.sale_number||'')})</option>`;
      }).join('');
    if (_plcExternalSaleId) {
      saleSel.value = _plcExternalSaleId;
      await _plcOnSaleChange();
    }
  } catch(e) {
    saleSel.innerHTML = '<option value="">Error loading sales</option>';
  }
}

async function _plcOnSaleChange() {
  const saleId = document.getElementById('plc-sale')?.value;
  if (!saleId) return;
  const section = document.getElementById('plc-installments-section');
  const list    = document.getElementById('plc-install-list');
  if (!section || !list) return;
  list.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:6px">Loading…</div>';
  section.style.display = 'block';
  _plcSelInstalls.clear();

  try {
    const { data } = await supabase
      .from('installments')
      .select('id, installment_number, installment_type, due_date, amount_due, amount_paid, status')
      .eq('company_id', S.cid).eq('sale_id', saleId)
      .in('status', ['pending', 'partial', 'overdue'])
      .order('installment_number');
    _plcInstalls = data || [];

    if (!_plcInstalls.length) {
      list.innerHTML = '<div style="color:var(--ok);font-size:12px;padding:6px">All installments paid!</div>';
      return;
    }

    list.innerHTML = _plcInstalls.map(i => {
      const outstanding = Math.max(0, i.amount_due - i.amount_paid);
      const lbl = i.installment_type === 'down_payment' ? 'Down Payment' : 'Inst #'+i.installment_number;
      const due = i.due_date ? new Date(i.due_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
      const overdue = i.due_date && new Date(i.due_date) < new Date();
      return `<label style="display:flex;align-items:center;gap:10px;padding:7px 8px;border-bottom:1px solid var(--line);cursor:pointer;font-size:13px">
        <input type="checkbox" value="${i.id}" onchange="_plcToggleInstall('${i.id}',${outstanding},this.checked)">
        <div style="flex:1">
          <div style="font-weight:600">${lbl} ${overdue?'<span style="color:#ef4444;font-size:10px">OVERDUE</span>':''}</div>
          <div style="font-size:11px;color:var(--t3)">Due: ${due}</div>
        </div>
        <div style="font-weight:700;color:var(--brand)">PKR ${fM(outstanding)}</div>
      </label>`;
    }).join('');

    // Auto-select all overdue
    _plcInstalls.forEach(i => {
      if (i.due_date && new Date(i.due_date) < new Date()) {
        _plcSelInstalls.add(i.id);
        const cb = list.querySelector(`input[value="${i.id}"]`);
        if (cb) cb.checked = true;
      }
    });
    _plcRecalcAmount();
    _plcRenderPreview();
  } catch(e) {
    list.innerHTML = `<div style="color:var(--err);font-size:12px;padding:6px">Error: ${esc(e.message)}</div>`;
  }
}

function _plcToggleInstall(id, outstanding, checked) {
  if (checked) _plcSelInstalls.add(id);
  else         _plcSelInstalls.delete(id);
  _plcRecalcAmount();
  _plcRenderPreview();
}

function _plcRecalcAmount() {
  let total = 0;
  _plcInstalls.forEach(i => {
    if (_plcSelInstalls.has(i.id)) total += Math.max(0, i.amount_due - i.amount_paid);
  });
  _plcAmount = total;
  const amtEl = document.getElementById('plc-amount');
  if (amtEl) amtEl.value = total || '';
}

function _plcRenderMethods() {
  const el = document.getElementById('plc-methods-list');
  if (!el) return;
  if (!_plcMethods.length) {
    el.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:8px">No payment methods configured</div>';
    return;
  }
  const icons = { jazzcash:'', easypaisa:'', bank:'', raast:'', sadapay:'', nayapay:'', other:'' };
  el.innerHTML = _plcMethods.map(m => `
    <div class="pl-method-item${_plcSelMethods.has(m.id)?' selected':''}" onclick="_plcToggleMethod('${m.id}',this)">
      <input type="checkbox" ${_plcSelMethods.has(m.id)?'checked':''} onchange="_plcToggleMethod('${m.id}',this.closest('.pl-method-item'))" style="pointer-events:none">
      <span class="pl-method-icon">${icons[m.method_type]||''}</span>
      <div style="flex:1">
        <div class="pl-method-name">${esc(m.account_title)}</div>
        <div class="pl-method-num">${esc(m.account_number)}</div>
      </div>
    </div>`).join('');
}

function _plcToggleMethod(id, el) {
  if (_plcSelMethods.has(id)) _plcSelMethods.delete(id);
  else _plcSelMethods.add(id);
  el.classList.toggle('selected', _plcSelMethods.has(id));
  const cb = el.querySelector('input[type=checkbox]');
  if (cb) cb.checked = _plcSelMethods.has(id);
  _plcRenderPreview();
}

function _plcRenderPreview() {
  const el = document.getElementById('plc-preview-box');
  if (!el) return;
  const clientSel = document.getElementById('plc-client');
  const saleSel   = document.getElementById('plc-sale');
  if (!clientSel?.value || !saleSel?.value) {
    el.textContent = 'Select a client and sale to see preview…';
    return;
  }
  const client = (window._clientsCache||[]).find(c=>c.id===clientSel.value);
  const saleRow = _plcSales.find(s=>s.id===saleSel.value);
  const selMethods = _plcMethods.filter(m=>_plcSelMethods.has(m.id));
  const selectedInstalls = _plcInstalls.filter(i=>_plcSelInstalls.has(i.id));
  const firstDue = selectedInstalls[0]?.due_date
    ? new Date(selectedInstalls[0].due_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
    : null;

  const msg = _plBuildInitialMsg({
    clientName:  client?.full_name || '—',
    unitNumber:  saleRow?.units?.unit_no || '—',
    projectName: saleRow?.projects?.project_name || '—',
    amount:      _plcAmount || 0,
    dueDate:     firstDue,
    refCode:     'PL-XXXX-XXXXX',
    methods:     selMethods,
    companyName: (window._projectsCache||[]).find(p=>true)?.company_name || 'Company'
  });
  el.textContent = msg;
}

async function plSaveCreate() {
  const clientId = document.getElementById('plc-client')?.value;
  const saleId   = document.getElementById('plc-sale')?.value;
  const amount   = Number(document.getElementById('plc-amount')?.value || 0);
  const desc     = document.getElementById('plc-desc')?.value || null;
  const validity = Number(document.getElementById('plc-validity')?.value || 7);

  if (!clientId) { toast('Select a client', 'warn'); return; }
  if (!saleId)   { toast('Select a sale', 'warn'); return; }
  if (amount <= 0) { toast('Enter a valid amount', 'warn'); return; }
  if (!_plcSelMethods.size) { toast('Select at least one payment method', 'warn'); return; }

  const btn = document.getElementById('plc-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

  try {
    const { data, error } = await supabase.rpc('create_payment_link', {
      p_company_id:          S.cid,
      p_client_id:           clientId,
      p_sale_id:             saleId,
      p_installment_ids:     Array.from(_plcSelInstalls),
      p_amount:              amount,
      p_description:         desc,
      p_sent_by:             S.name || 'officer',
      p_sent_by_user_id:     S.userId || null,
      p_expires_in_days:     validity,
      p_selected_method_ids: Array.from(_plcSelMethods)
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed to create link');

    cm('m-create-pl');
    toast('Payment link created: ' + data.ref_code, 'ok');

    // Open WhatsApp
    window.open(data.whatsapp_url + '?text=' + encodeURIComponent(data.message_text), '_blank');

    plLoad();
  } catch(e) {
    const msg = e.message === 'no_payment_methods' ? 'No payment methods configured. Add methods first.' : e.message;
    toast('Error: ' + msg, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send via WhatsApp'; }
  }
}

function plCopyMessage() {
  const preview = document.getElementById('plc-preview-box');
  if (!preview || preview.textContent.startsWith('Select')) { toast('Build the message first', 'warn'); return; }
  navigator.clipboard.writeText(preview.textContent).then(() => toast('Message copied!', 'ok'));
}

// ═══════════════════════════════════════════════════════════════════
// UPLOAD SCREENSHOT MODAL
// ═══════════════════════════════════════════════════════════════════
async function plOpenUpload(id) {
  _plusLink = _plRows.find(r => r.id === id) || { id };
  _plusFile = null;
  const body = document.getElementById('m-upload-pl-body');
  if (!body) return;

  body.innerHTML = `
    <div class="fr" style="margin-bottom:12px">
      <label class="fl">Screenshot File *</label>
      <div class="pl-dropzone" id="pl-dz" onclick="document.getElementById('pl-file-input').click()">
        <div class="pl-dz-icon"><svg width="24" height="24" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
        <div style="font-size:13px;font-weight:600">Click or drag &amp; drop</div>
        <div class="pl-dz-hint">JPG, PNG, WebP or PDF — max 10MB</div>
        <input type="file" id="pl-file-input" accept="image/*,application/pdf" style="display:none"
          onchange="_plusHandleFile(this.files[0])">
      </div>
      <div id="pl-preview-thumb" style="margin-top:10px;display:none">
        <img id="pl-thumb" style="max-height:120px;border-radius:8px;border:1px solid var(--line)">
        <div id="pl-filename" style="font-size:12px;color:var(--t3);margin-top:4px"></div>
      </div>
    </div>
    <div class="g2">
      <div class="fr">
        <label class="fl">Claimed Amount</label>
        <input id="plus-amount" type="number" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px" placeholder="0">
      </div>
      <div class="fr">
        <label class="fl">Payment Date</label>
        <input id="plus-date" type="date" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px" value="${new Date().toISOString().slice(0,10)}">
      </div>
      <div class="fr">
        <label class="fl">Method Used</label>
        <select id="plus-method" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px">
          <option value="">— Select —</option>
          <option value="jazzcash">JazzCash</option>
          <option value="easypaisa">EasyPaisa</option>
          <option value="bank_transfer">Bank Transfer</option>
          <option value="raast">Raast</option>
          <option value="sadapay">SadaPay</option>
          <option value="nayapay">NayaPay</option>
          <option value="cash">Cash</option>
        </select>
      </div>
      <div class="fr">
        <label class="fl">Transaction ID / Ref</label>
        <input id="plus-ref" type="text" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px" placeholder="TXN123…">
      </div>
    </div>
    <div class="fr" style="margin-top:8px">
      <label class="fl">Client Notes</label>
      <textarea id="plus-notes" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px;resize:vertical;min-height:60px" placeholder="Any notes from client…"></textarea>
    </div>
    <div id="plus-progress" style="display:none;margin-top:10px">
      <div style="height:4px;background:var(--line);border-radius:2px;overflow:hidden">
        <div id="plus-bar" style="height:100%;background:var(--brand);width:0%;transition:width .3s;border-radius:2px"></div>
      </div>
      <div id="plus-pct" style="font-size:11px;color:var(--t3);margin-top:4px;text-align:center">Uploading…</div>
    </div>`;

  // Drag and drop
  const dz = document.getElementById('pl-dz');
  if (dz) {
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); _plusHandleFile(e.dataTransfer.files[0]); };
  }

  om('m-upload-pl');
}

function _plusHandleFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('File too large (max 10MB)', 'err'); return; }
  _plusFile = file;
  const thumb = document.getElementById('pl-thumb');
  const fn    = document.getElementById('pl-filename');
  const wrap  = document.getElementById('pl-preview-thumb');
  if (thumb && file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = e => { thumb.src = e.target.result; };
    reader.readAsDataURL(file);
    wrap.style.display = 'block';
  }
  if (fn) fn.textContent = file.name + ' (' + (file.size/1024).toFixed(0) + ' KB)';
}

async function plSaveUpload() {
  if (!_plusFile) { toast('Select a screenshot file', 'warn'); return; }
  const btn = document.getElementById('plus-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }

  try {
    // Upload to Supabase Storage
    const ext = _plusFile.name.split('.').pop();
    const now  = Date.now();
    const fy   = new Date().getMonth() >= 6 ? (new Date().getFullYear()%100)+''+(new Date().getFullYear()%100+1) : (new Date().getFullYear()%100-1)+''+(new Date().getFullYear()%100);
    const path = `${S.cid}/${fy}/${_plusLink?.ref_code||now}.${ext}`;

    const prog = document.getElementById('plus-progress');
    const bar  = document.getElementById('plus-bar');
    const pct  = document.getElementById('plus-pct');
    if (prog) { prog.style.display = 'block'; }

    const { data: upData, error: upErr } = await supabase.storage
      .from('payment-screenshots').upload(path, _plusFile, { upsert: true });
    if (upErr) throw upErr;
    if (bar) { bar.style.width = '70%'; }
    if (pct) { pct.textContent = 'Processing…'; }

    const { data: urlData } = supabase.storage.from('payment-screenshots').getPublicUrl(path);
    const screenshotUrl = urlData?.publicUrl || path;

    const { data, error } = await supabase.rpc('upload_payment_screenshot', {
      p_payment_link_id:       _plusLink.id,
      p_screenshot_url:        screenshotUrl,
      p_uploaded_by:           S.name || 'officer',
      p_client_claimed_amount: Number(document.getElementById('plus-amount')?.value||0) || null,
      p_client_claimed_method: document.getElementById('plus-method')?.value || null,
      p_client_claimed_ref:    document.getElementById('plus-ref')?.value || null,
      p_client_claimed_date:   document.getElementById('plus-date')?.value || null,
      p_client_notes:          document.getElementById('plus-notes')?.value || null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');

    if (bar) bar.style.width = '100%';
    cm('m-upload-pl');
    toast('Screenshot uploaded — ready for verification', 'ok');
    plLoad();
  } catch(e) {
    toast('Upload failed: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Upload & Submit'; }
  }
}

// ═══════════════════════════════════════════════════════════════════
// VERIFY PAYMENT LINK MODAL
// ═══════════════════════════════════════════════════════════════════
async function plOpenVerify(id) {
  const row = _plRows.find(r => r.id === id);
  _plvLink = row || { id };

  const body = document.getElementById('m-verify-pl-body');
  if (!body) { om('m-verify-pl'); return; }

  // Fetch full detail
  try {
    const { data } = await supabase.rpc('get_payment_link_detail',
      { p_id: id, p_company_id: S.cid });
    if (data?.success) _plvLink = { ...data.link, id };
  } catch(e) {}

  const lk = _plvLink;
  const sentDate = lk.sent_at ? new Date(lk.sent_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';

  body.innerHTML = `<div class="pl-split-modal">
  <!-- LEFT: Claim -->
  <div>
    <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:12px">Client's Claim</div>
    <div class="pl-claim-box" style="margin-bottom:14px">
      ${_plDetailRow('Ref#', `<span style="font-family:'JetBrains Mono',monospace;color:var(--brand)">${esc(lk.ref_code||id)}</span>`)}
      ${_plDetailRow('Client', esc(lk.client_name||'—'))}
      ${_plDetailRow('Property', esc((lk.unit_number||'?')+' — '+(lk.project_name||'?')))}
      ${_plDetailRow('Requested', `<strong>PKR ${fM(lk.requested_amount||0)}</strong>`)}
      ${_plDetailRow('Sent', sentDate)}
    </div>
    ${lk.screenshot_url ? `
      <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:8px">Screenshot</div>
      <img src="${esc(lk.screenshot_url)}" class="pl-screenshot-preview" onclick="window.open(this.src,'_blank')" alt="Screenshot">
      <div class="pl-claim-box" style="margin-top:12px">
        <div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">CLAIMED BY CLIENT</div>
        ${_plDetailRow('Amount', lk.client_claimed_amount ? `<strong>PKR ${fM(lk.client_claimed_amount)}</strong>` : '—')}
        ${_plDetailRow('Method', esc(lk.client_claimed_method||'—'))}
        ${_plDetailRow('Ref/TxnID', esc(lk.client_claimed_ref||'—'))}
        ${_plDetailRow('Date', lk.client_claimed_date ? new Date(lk.client_claimed_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—')}
        ${lk.client_notes ? _plDetailRow('Notes', esc(lk.client_notes)) : ''}
      </div>` : `<div style="text-align:center;padding:20px;color:var(--t3);font-size:12px">No screenshot available</div>`}
  </div>

  <!-- RIGHT: Verify form -->
  <div>
    <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:12px">Verification Form</div>
    <div style="font-size:12px;color:var(--t3);margin-bottom:12px">Match with your bank statement:</div>

    <div class="fr" style="margin-bottom:12px">
      <label class="fl">Actual Amount Received (PKR) *</label>
      <input id="plv-amount" type="number" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px"
        value="${lk.client_claimed_amount||lk.requested_amount||''}" placeholder="0">
    </div>
    <div class="g2" style="margin-bottom:12px">
      <div class="fr">
        <label class="fl">Payment Date *</label>
        <input id="plv-date" type="date" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px"
          value="${lk.client_claimed_date || new Date().toISOString().slice(0,10)}">
      </div>
      <div class="fr">
        <label class="fl">Payment Method *</label>
        <select id="plv-method" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px">
          <option value="bank_transfer">Bank Transfer</option>
          <option value="cash">Cash</option>
          <option value="jazzcash">JazzCash</option>
          <option value="easypaisa">EasyPaisa</option>
          <option value="raast">Raast</option>
          <option value="cheque">Cheque</option>
          <option value="adjustment">Adjustment</option>
        </select>
      </div>
    </div>
    <div class="fr" style="margin-bottom:12px">
      <label class="fl">Bank Reference *</label>
      <input id="plv-ref" type="text" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px"
        value="${esc(lk.client_claimed_ref||'')}" placeholder="Bank ref or TxnID">
    </div>
    <div class="fr" style="margin-bottom:16px">
      <label class="fl">Verification Notes</label>
      <textarea id="plv-notes" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px;resize:vertical;min-height:60px" placeholder="Any notes…"></textarea>
    </div>

    ${lk.client_claimed_amount && lk.requested_amount && Math.abs(lk.client_claimed_amount - lk.requested_amount) > 1 ?
      `<div style="padding:10px 12px;background:rgba(245,158,11,.08);border-radius:8px;font-size:12px;color:#d97706;margin-bottom:14px">
        Amount mismatch — Requested: PKR ${fM(lk.requested_amount)} | Claimed: PKR ${fM(lk.client_claimed_amount)}
      </div>` : ''}
  </div>
  </div>`;

  // Pre-select method
  const methodSel = document.getElementById('plv-method');
  if (methodSel && lk.client_claimed_method) {
    const map = { jazzcash:'jazzcash', easypaisa:'easypaisa', bank:'bank_transfer',
      bank_transfer:'bank_transfer', raast:'raast', cash:'cash' };
    methodSel.value = map[lk.client_claimed_method] || 'bank_transfer';
  }

  om('m-verify-pl');
}

async function plSaveVerify() {
  const amount = Number(document.getElementById('plv-amount')?.value || 0);
  const date   = document.getElementById('plv-date')?.value;
  const method = document.getElementById('plv-method')?.value || 'bank_transfer';
  const ref    = document.getElementById('plv-ref')?.value || null;
  const notes  = document.getElementById('plv-notes')?.value || null;

  if (amount <= 0) { toast('Enter actual amount received', 'warn'); return; }
  if (!date)       { toast('Enter payment date', 'warn'); return; }

  const btn = document.getElementById('plv-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }

  try {
    const { data, error } = await supabase.rpc('verify_payment_link', {
      p_payment_link_id:     _plvLink.id,
      p_verified_by:         S.name || 'accountant',
      p_verified_by_user_id: S.userId || null,
      p_actual_amount:       amount,
      p_payment_date:        date,
      p_payment_method:      method,
      p_bank_ref:            ref,
      p_verification_notes:  notes
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Verification failed');

    cm('m-verify-pl');
    toast('Payment verified — PRV ' + data.prv_number + ' generated', 'ok');
    plLoad();

    // Prompt for confirmation WhatsApp
    if (data.confirmation_whatsapp_url) {
      setTimeout(() => {
        if (confirm('Send WhatsApp confirmation to client? (PRV: ' + data.prv_number + ')')) {
          window.open(data.confirmation_whatsapp_url + '?text=' + encodeURIComponent(data.confirmation_message), '_blank');
        }
      }, 400);
    }
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Verify & Generate PRV'; }
  }
}

// ─── Reject modal ─────────────────────────────────────────────────
async function plOpenReject(id) {
  const row = _plRows.find(r => r.id === id);
  _plvLink = row || { id };
  const body = document.getElementById('m-reject-pl-body');
  if (body) {
    body.innerHTML = `<div class="fr">
      <label class="fl">Reason for Rejection *</label>
      <textarea id="plrj-reason" class="inp-light" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px;resize:vertical;min-height:90px"
        placeholder="e.g. Amount does not match bank statement, unclear screenshot, wrong account…"></textarea>
    </div>
    <div style="margin-top:10px;padding:10px;background:rgba(239,68,68,.06);border-radius:8px;font-size:12px;color:#dc2626">
      Rejecting will notify the client to re-submit via WhatsApp.
    </div>`;
  }
  om('m-reject-pl');
}

async function plSaveReject() {
  const reason = document.getElementById('plrj-reason')?.value?.trim();
  if (!reason) { toast('Enter rejection reason', 'warn'); return; }
  const btn = document.getElementById('plrj-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Rejecting…'; }
  try {
    const { data, error } = await supabase.rpc('reject_payment_link', {
      p_payment_link_id: _plvLink.id,
      p_rejected_by:     S.name || 'accountant',
      p_rejection_reason: reason
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    cm('m-reject-pl');
    toast('Payment link rejected', 'ok');
    if (data.rejection_whatsapp_url && confirm('Send rejection reason to client via WhatsApp?')) {
      window.open(data.rejection_whatsapp_url + '?text=' + encodeURIComponent(data.rejection_message), '_blank');
    }
    plLoad();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Reject'; }
  }
}

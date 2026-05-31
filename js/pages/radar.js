// ══ RECOVERY RADAR ════════════════════════════════════════════
// AI-style daily prediction: top clients most likely to pay today
// RPCs: generate_recovery_radar, get_latest_radar, log_radar_action,
//        update_radar_outcome, get_radar_accuracy_stats, get_radar_history

let _radarData   = null;   // current radar log row
let _radarStates = {};     // {clientId: {action, paidAmount, paidDate}}
let _radarTab    = 'radar'; // 'radar' | 'accuracy' | 'history'

// ─── Entry point ─────────────────────────────────────────────
async function rRadar() {
  const pg = document.getElementById('pg-radar');
  if (!pg) return;
  _radarStates = {};
  _radarTab    = 'radar';

  pg.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l">
        <h2>Recovery Radar</h2>
        <p id="rr-subtitle">Loading today's predictions…</p>
      </div>
      <div class="ph-r" style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-g btn-sm"   id="rr-gen-btn"  onclick="rrGenerate()">Regenerate</button>
        <button class="btn btn-gh btn-sm"  onclick="rrShowTab('accuracy')">Accuracy</button>
        <button class="btn btn-gh btn-sm"  onclick="rrShowTab('history')">History</button>
        <button class="btn btn-print btn-sm" onclick="window.print()">Print</button>
      </div>
    </div>

    <!-- Tab strip -->
    <div style="display:flex;border-bottom:2px solid var(--line);margin-bottom:14px">
      <button id="rr-tab-radar-btn"    class="btn btn-xs" style="padding:8px 16px;border:none;border-bottom:2px solid var(--brand);margin-bottom:-2px;font-size:13px;font-weight:700;color:var(--brand);background:none;cursor:pointer" onclick="rrShowTab('radar')">Today's Radar</button>
      <button id="rr-tab-risk-btn"     class="btn btn-xs" style="padding:8px 16px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;font-size:13px;font-weight:600;color:var(--t3);background:none;cursor:pointer" onclick="rrShowTab('risk')">Default Risk</button>
      <button id="rr-tab-accuracy-btn" class="btn btn-xs" style="padding:8px 16px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;font-size:13px;font-weight:600;color:var(--t3);background:none;cursor:pointer" onclick="rrShowTab('accuracy')">Accuracy</button>
      <button id="rr-tab-history-btn"  class="btn btn-xs" style="padding:8px 16px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;font-size:13px;font-weight:600;color:var(--t3);background:none;cursor:pointer" onclick="rrShowTab('history')">History</button>
    </div>

    <div id="rr-tab-radar"><div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading…</div></div>
    <div id="rr-tab-risk"     style="display:none"></div>
    <div id="rr-tab-accuracy" style="display:none"></div>
    <div id="rr-tab-history"  style="display:none"></div>
  </div>`;

  await _rrLoad();
}

function rrShowTab(tab) {
  _radarTab = tab;
  ['radar','risk','accuracy','history'].forEach(t => {
    const div = document.getElementById('rr-tab-'+t);
    const btn = document.getElementById('rr-tab-'+t+'-btn');
    if (div) div.style.display = t === tab ? '' : 'none';
    if (btn) {
      btn.style.borderBottomColor = t === tab ? 'var(--brand)' : 'transparent';
      btn.style.color             = t === tab ? 'var(--brand)' : 'var(--t3)';
      btn.style.fontWeight        = t === tab ? '700' : '600';
    }
  });
  if (tab === 'risk')     _rrLoadRisk();
  if (tab === 'accuracy') _rrLoadAccuracy();
  if (tab === 'history')  _rrLoadHistory();
}

// ─── Load latest radar ────────────────────────────────────────
async function _rrLoad() {
  const body = document.getElementById('rr-tab-radar');
  if (!body) return;
  try {
    const { data, error } = await supabase.rpc('get_latest_radar', { p_company_id: S.cid });
    if (error) throw error;
    _radarData = data;
    _rrRender();
  } catch(e) {
    body.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <div class="et">Could not load radar</div>
      <div class="es">${esc(e.message||'Unknown error')}</div>
      <button class="btn btn-g btn-sm" style="margin-top:12px" onclick="rrGenerate()">Generate First Radar</button>
    </div></div>`;
  }
}

// ─── Render main radar tab ────────────────────────────────────
function _rrRender() {
  const body = document.getElementById('rr-tab-radar');
  const sub  = document.getElementById('rr-subtitle');
  if (!body) return;

  if (!_radarData) {
    body.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>
      <div class="et">No radar generated yet</div>
      <div class="es">Generate your first radar to see today's top prospects</div>
      <button class="btn btn-g btn-sm" style="margin-top:12px" onclick="rrGenerate()">Generate Radar</button>
    </div></div>`;
    return;
  }

  const d     = _radarData;
  const today = new Date().toLocaleDateString('en-PK', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
  const genAt = d.generated_at ? new Date(d.generated_at).toLocaleTimeString('en-PK', {hour:'2-digit', minute:'2-digit'}) : '—';
  const clients = Array.isArray(d.top_clients) ? d.top_clients : [];
  const isStale = d.is_stale;
  const isToday = d.is_today;

  if (sub) {
    sub.textContent = isToday
      ? `Today · Generated at ${genAt} · ${d.clients_analyzed} clients analyzed`
      : `Last radar: ${fD(d.generated_date)} — ${d.is_stale ? 'Stale (>24h)' : 'Recent'}`;
  }

  const staleBanner = isStale ? `
    <div style="padding:10px 14px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:8px;margin-bottom:12px;font-size:12px;color:#f59e0b;display:flex;align-items:center;gap:8px">
      <span>This radar is from <strong>${fD(d.generated_date)}</strong>. Click <strong>Regenerate</strong> for fresh predictions.</span>
    </div>` : '';

  // ─── Hero stat cards ───
  const statCards = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      ${_rrStatCard('Clients Analyzed', d.clients_analyzed, 'var(--brand)', '')}
      ${_rrStatCard('Top Predictions',  clients.length, '#22c55e', '')}
      ${_rrStatCard('Potential Today',  'PKR '+fM(d.total_potential_recovery||0), '#f59e0b', '')}
      ${_rrStatCard('Generated', isToday ? 'Today '+genAt : fD(d.generated_date), 'var(--t2)', '')}
    </div>`;

  // ─── Client cards ───
  const cardHtml = !clients.length
    ? `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div><div class="et">No clients scored for today</div><div class="es">All clients may be up to date or no data available</div></div></div>`
    : clients.map((c, i) => _rrClientCard(c, i, d.id)).join('');

  body.innerHTML = staleBanner + statCards + cardHtml;
}

function _rrStatCard(label, value, color, icon) {
  return `<div style="flex:1;min-width:140px;padding:14px 16px;border-radius:10px;background:var(--surface);border:1px solid var(--line)">
    <div style="font-size:18px;margin-bottom:4px">${icon}</div>
    <div style="font-size:11px;color:var(--t3);font-weight:600;letter-spacing:.5px;text-transform:uppercase">${label}</div>
    <div style="font-size:20px;font-weight:800;color:${color};margin-top:2px">${value}</div>
  </div>`;
}

// ─── Single client card ───────────────────────────────────────
function _rrClientCard(c, idx, radarId) {
  const state = _radarStates[c.client_id] || {};
  const score = c.final_score || 0;
  const bd    = c.breakdown   || {};
  const reasons = Array.isArray(c.reasons) ? c.reasons : [];

  // Score ring color
  const scoreColor  = score >= 80 ? '#22c55e' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444';
  const scoreLabel  = score >= 80 ? 'PLATINUM' : score >= 60 ? 'GOOD' : score >= 40 ? 'AT RISK' : 'CRITICAL';

  // Rank medal
  const medals  = ['1.','2.','3.'];
  const rankBadge = idx < 3 ? medals[idx] : `#${idx+1}`;

  // Card state tint
  let cardBg = 'var(--surface)';
  let statusLine = '';
  if (state.action === 'paid') {
    cardBg = 'rgba(34,197,94,.06)';
    statusLine = `<div style="margin-top:10px;padding:8px 12px;background:rgba(34,197,94,.15);border-radius:8px;color:#22c55e;font-size:12px;font-weight:700">PAID — PKR ${fM(state.paidAmount||0)} on ${fD(state.paidDate||td())}</div>`;
  } else if (state.action === 'called') {
    cardBg = 'rgba(245,158,11,.04)';
    statusLine = `<div style="margin-top:10px;padding:8px 12px;background:rgba(245,158,11,.12);border-radius:8px;color:#f59e0b;font-size:12px;font-weight:700">Called at ${state.calledAt||'—'}</div>`;
  } else if (state.action === 'refused') {
    cardBg = 'rgba(239,68,68,.04)';
    statusLine = `<div style="margin-top:10px;padding:8px 12px;background:rgba(239,68,68,.12);border-radius:8px;color:#ef4444;font-size:12px;font-weight:700">Refused payment</div>`;
  } else if (state.action === 'whatsapp') {
    statusLine = `<div style="margin-top:10px;padding:8px 12px;background:rgba(34,197,94,.12);border-radius:8px;color:#22c55e;font-size:12px;font-weight:700">WhatsApp sent</div>`;
  }

  // Score breakdown bars
  const bdItems = [
    { key:'pattern',     label:'Pattern',  val: bd.pattern||0,      max:30, color:'#3b82f6' },
    { key:'salary',      label:'Salary',   val: bd.salary||0,       max:20, color:'#8b5cf6' },
    { key:'promise',     label:'Promise',  val: bd.promise||0,      max:30, color:'#22c55e' },
    { key:'contact',     label:'Contact',  val: bd.contact||0,      max:10, color:'#f59e0b' },
    { key:'overdue',     label:'Overdue',  val: bd.overdue||0,      max:10, color:'#ef4444' },
    { key:'pdc_penalty', label:'PDC',      val: bd.pdc_penalty||0,  max:0,  color:'#6b7280' },
    { key:'agent_bonus', label:'Agent',    val: bd.agent_bonus||0,  max:5,  color:'#0ea5e9' },
  ];

  const bdBars = bdItems.map(b => {
    const pct = b.max > 0 ? Math.abs(b.val)/b.max*100 : (b.val !== 0 ? 100 : 0);
    const clr = b.val < 0 ? '#ef4444' : b.color;
    return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0">
      <span style="font-size:10px;color:var(--t3);width:50px;flex-shrink:0">${b.label}</span>
      <div style="flex:1;height:5px;background:var(--line);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${Math.min(100,Math.abs(pct))}%;background:${clr};border-radius:3px"></div>
      </div>
      <span style="font-size:11px;font-weight:700;color:${b.val<0?'#ef4444':b.val>0?clr:'var(--t3)'};width:28px;text-align:right">${b.val>0?'+':''}${b.val}</span>
    </div>`;
  }).join('');

  // Next Best Action banner
  const _naThemes = {
    coordinate_legal:  { bg:'rgba(239,68,68,.12)',  border:'rgba(239,68,68,.3)',  color:'#ef4444', icon:'&#9878;' },
    hold_pdc:          { bg:'rgba(245,158,11,.12)', border:'rgba(245,158,11,.3)', color:'#f59e0b', icon:'!!'      },
    escalate:          { bg:'rgba(245,158,11,.12)', border:'rgba(245,158,11,.3)', color:'#f59e0b', icon:'&#8593;' },
    legal_notice:      { bg:'rgba(239,68,68,.12)',  border:'rgba(239,68,68,.3)',  color:'#ef4444', icon:'!'       },
    field_visit:       { bg:'rgba(59,130,246,.12)', border:'rgba(59,130,246,.3)', color:'#3b82f6', icon:'&#9658;' },
    follow_up_promise: { bg:'rgba(34,197,94,.12)',  border:'rgba(34,197,94,.3)',  color:'#22c55e', icon:'&#10003;'},
    call:              { bg:'rgba(59,130,246,.12)', border:'rgba(59,130,246,.3)', color:'#3b82f6', icon:'&#9742;' },
    send_reminder:     { bg:'rgba(107,114,128,.10)',border:'rgba(107,114,128,.2)',color:'var(--t3)',icon:'&#8594;' },
  };
  const na       = c.next_action         || 'send_reminder';
  const naMsg    = c.next_action_message || 'Send payment reminder via WhatsApp';
  const naTheme  = _naThemes[na] || _naThemes['send_reminder'];
  const naBanner = `<div style="margin-bottom:12px;padding:9px 12px;background:${naTheme.bg};border:1px solid ${naTheme.border};border-radius:8px;display:flex;align-items:center;gap:10px">
    <span style="font-size:15px;font-weight:900;color:${naTheme.color};flex-shrink:0">${naTheme.icon}</span>
    <div>
      <div style="font-size:9px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:${naTheme.color}">NEXT BEST ACTION</div>
      <div style="font-size:12px;font-weight:600;color:var(--t1)">${esc(naMsg)}</div>
    </div>
  </div>`;

  const phone = c.phone || '';
  const waMsgRaw = `Assalam o Alaikum ${c.client_name},\n\nAap ki installment overdue hai:\nProperty: ${c.unit_no||'—'} - ${c.project_name||'—'}\nAmount Due: PKR ${fM(c.overdue_amount||0)}\n\nAaj payment ka wada hai. Bara meherbani ho gi agar aaj payment kar dein.\n\nShukriya.`;
  const waPhone = phone.replace(/[^0-9]/g,'').replace(/^0/,'92');
  const waUrl   = 'https://wa.me/' + waPhone + '?text=' + encodeURIComponent(waMsgRaw);

  return `<div id="rr-card-${c.client_id}" class="card" style="margin-bottom:12px;background:${cardBg};border-left:4px solid ${scoreColor};transition:background .3s">
    <div class="cb" style="padding:16px 18px">

      <!-- Header row -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="font-size:22px;font-weight:800;min-width:36px">${rankBadge}</div>
          <div>
            <div style="font-size:17px;font-weight:800;color:var(--t1)">${esc(c.client_name||'—')}</div>
            <div style="font-size:11px;color:var(--t3);font-family:monospace">${esc(c.client_code||'—')}</div>
            ${phone ? `<div style="font-size:12px;color:var(--info);margin-top:2px"><a href="tel:${esc(phone)}" style="color:var(--info);text-decoration:none">${esc(phone)}</a></div>` : ''}
          </div>
        </div>
        <!-- Score ring -->
        <div style="text-align:center;flex-shrink:0">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="28" fill="none" stroke="var(--line)" stroke-width="7"/>
            <circle cx="36" cy="36" r="28" fill="none" stroke="${scoreColor}" stroke-width="7"
              stroke-dasharray="${2*Math.PI*28}" stroke-dashoffset="${(1-score/100)*2*Math.PI*28}"
              stroke-linecap="round" transform="rotate(-90 36 36)"/>
            <text x="36" y="40" text-anchor="middle" font-size="16" font-weight="800" fill="${scoreColor}">${score}</text>
          </svg>
          <div style="font-size:9px;font-weight:800;color:${scoreColor};letter-spacing:.5px;margin-top:-4px">${scoreLabel}</div>
        </div>
      </div>

      <!-- Property + financials -->
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;background:var(--canvas);border-radius:8px">
        ${c.unit_no ? `<div style="font-size:11px;color:var(--t3)">Unit<br><span style="font-size:13px;font-weight:700;color:var(--t1)">${esc(c.unit_no)}</span></div>` : ''}
        ${c.project_name ? `<div style="font-size:11px;color:var(--t3)">Project<br><span style="font-size:13px;font-weight:700;color:var(--t1)">${esc(c.project_name)}</span></div>` : ''}
        <div style="font-size:11px;color:var(--t3)">Overdue<br><span style="font-size:13px;font-weight:700;color:#ef4444">PKR ${fM(c.overdue_amount||0)}</span></div>
        <div style="font-size:11px;color:var(--t3)">Outstanding<br><span style="font-size:13px;font-weight:700;color:var(--t1)">PKR ${fM(c.total_outstanding||0)}</span></div>
        ${c.oldest_overdue_days ? `<div style="font-size:11px;color:var(--t3)">Oldest Overdue<br><span style="font-size:13px;font-weight:700;color:#f59e0b">${c.oldest_overdue_days} days</span></div>` : ''}
      </div>

      ${naBanner}

      <!-- 2-col: reasons + breakdown -->
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">
        <!-- Why this prediction -->
        <div style="flex:1;min-width:200px">
          <div style="font-size:11px;font-weight:700;color:var(--t3);letter-spacing:.5px;margin-bottom:6px">WHY THIS PREDICTION</div>
          ${reasons.length
            ? reasons.map(r => `<div style="font-size:12px;color:var(--t1);padding:3px 0;display:flex;align-items:flex-start;gap:6px"><span style="color:#22c55e;flex-shrink:0">&#10003;</span>${esc(r)}</div>`).join('')
            : `<div style="font-size:12px;color:var(--t3)">Based on overdue pattern</div>`}
        </div>
        <!-- Score breakdown -->
        <div style="flex:1;min-width:200px">
          <div style="font-size:11px;font-weight:700;color:var(--t3);letter-spacing:.5px;margin-bottom:6px">SCORE BREAKDOWN</div>
          ${bdBars}
        </div>
      </div>

      ${statusLine}

      <!-- Action buttons -->
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        ${phone ? `<a href="tel:${esc(phone)}" class="btn btn-g btn-sm" onclick="rrLogCall('${radarId}','${c.client_id}','${esc(c.client_name)}')" style="text-decoration:none">Call</a>` : ''}
        ${phone ? `<a href="${waUrl}" target="_blank" class="btn btn-gh btn-sm" onclick="rrLogWA('${radarId}','${c.client_id}')" style="text-decoration:none">WhatsApp</a>` : ''}
        <button class="btn btn-gh btn-sm" onclick="rrMarkRefused('${radarId}','${c.client_id}')">Refused</button>
        <button class="btn btn-gh btn-sm" onclick="openClientDetail('${c.client_id}')">Profile</button>
        ${c.unit_no ? `<button class="btn btn-d btn-sm" onclick="rrReceivePayment('${c.client_id}','${c.sale_id||''}','${c.unit_no||''}')">Receive Payment</button>` : ''}
        ${c.sale_id && (na==='legal_notice'||na==='escalate') ? `<button class="btn btn-sm" style="background:rgba(220,38,38,.1);color:#dc2626;border:1px solid rgba(220,38,38,.3)" onclick="window.open('reports/demand-notice.html?sale_id=${encodeURIComponent(c.sale_id)}&cid='+encodeURIComponent(S.cid),'_blank')">Demand Notice</button>` : ''}
        ${c.sale_id && typeof plOpenCreate==='function' ? `<button class="btn btn-sm" style="background:rgba(34,197,94,.12);color:#16a34a;border:1px solid rgba(34,197,94,.3)" onclick="plOpenCreate(null,'${c.client_id}','${c.sale_id}')">Payment Link</button>` : ''}
      </div>

    </div>
  </div>`;
}

// ─── Action handlers ──────────────────────────────────────────

function rrLogCall(radarId, clientId, clientName) {
  const now = new Date().toLocaleTimeString('en-PK', {hour:'2-digit', minute:'2-digit'});
  _radarStates[clientId] = { action:'called', calledAt: now };
  _rrRefreshCard(clientId, radarId);

  supabase.rpc('log_radar_action', {
    p_radar_log_id: radarId, p_client_id: clientId,
    p_action_taken: 'called', p_action_by: S.username||'officer',
    p_company_id: S.cid
  }).catch(e => console.warn('[rrLogCall]', e));
}

function rrLogWA(radarId, clientId) {
  _radarStates[clientId] = { ...(_radarStates[clientId]||{}), action:'whatsapp' };
  _rrRefreshCard(clientId, radarId);

  supabase.rpc('log_radar_action', {
    p_radar_log_id: radarId, p_client_id: clientId,
    p_action_taken: 'whatsapp_sent', p_action_by: S.username||'officer',
    p_company_id: S.cid
  }).catch(e => console.warn('[rrLogWA]', e));
}

function rrMarkRefused(radarId, clientId) {
  _radarStates[clientId] = { action:'refused' };
  _rrRefreshCard(clientId, radarId);

  supabase.rpc('log_radar_action', {
    p_radar_log_id: radarId, p_client_id: clientId,
    p_action_taken: 'no_action', p_action_by: S.username||'officer',
    p_company_id: S.cid
  }).catch(e => console.warn('[rrMarkRefused]', e));
}

function rrMarkPaid(radarId, clientId, amount, dateStr) {
  _radarStates[clientId] = { action:'paid', paidAmount: amount, paidDate: dateStr };
  _rrRefreshCard(clientId, radarId);

  supabase.rpc('update_radar_outcome', {
    p_radar_log_id: radarId, p_client_id: clientId,
    p_payment_amount: amount, p_payment_date: dateStr
  }).catch(e => console.warn('[rrMarkPaid]', e));

  toast('Payment recorded · PKR ' + fM(amount) + ' marked as received', 'ok');
}

function rrReceivePayment(clientId, saleId, unitNo) {
  // Navigate to payments module pre-loaded for this client
  // After payment completes, officer can manually mark paid on radar
  nav('recovery');
  setTimeout(() => toast('Navigate to the client to record payment · Return to Radar to mark as paid', 'info'), 300);
}

// Re-render a single card in place
function _rrRefreshCard(clientId, radarId) {
  if (!_radarData) return;
  const clients = Array.isArray(_radarData.top_clients) ? _radarData.top_clients : [];
  const idx     = clients.findIndex(c => c.client_id === clientId);
  if (idx === -1) return;
  const el = document.getElementById('rr-card-' + clientId);
  if (!el) return;
  el.outerHTML = _rrClientCard(clients[idx], idx, radarId);
}

// ─── Generate / Regenerate ────────────────────────────────────
async function rrGenerate() {
  const btn = document.getElementById('rr-gen-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Generating…'; }
  try {
    const { data, error } = await supabase.rpc('generate_recovery_radar', {
      p_company_id:   S.cid,
      p_target_date:  td(),
      p_top_n:        10,
      p_generated_by: S.username || 'officer'
    });
    if (error) throw error;
    _radarData   = data;
    _radarStates = {};
    _rrRender();
    toast(`Radar generated · ${data.clients_analyzed} clients analyzed · PKR ${fM(data.total_potential_recovery)} potential`, 'ok');
  } catch(e) {
    console.error('[rrGenerate]', e);
    toast('Radar generation failed: ' + (e?.message || 'Unknown error'), 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Regenerate'; }
  }
}

// ─── Accuracy tab ─────────────────────────────────────────────
async function _rrLoadAccuracy() {
  const body = document.getElementById('rr-tab-accuracy');
  if (!body || body.dataset.loaded) return;
  body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading accuracy stats…</div>';

  try {
    const { data, error } = await supabase.rpc('get_radar_accuracy_stats', {
      p_company_id: S.cid, p_days: 30
    });
    if (error) throw error;

    const s = data || {};
    const accPct = s.accuracy_percent || 0;
    const accColor = accPct >= 70 ? '#22c55e' : accPct >= 50 ? '#f59e0b' : '#ef4444';

    body.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <div class="ch"><h3>Radar Accuracy — Last 30 Days</h3></div>
        <div class="cb">
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
            ${_rrStatCard('Total Predictions', s.total_predictions||0, 'var(--brand)', '')}
            ${_rrStatCard('Paid',              s.total_paid||0, '#22c55e', '')}
            ${_rrStatCard('Accuracy',          (accPct||0)+'%', accColor, '')}
            ${_rrStatCard('Recovered',         'PKR '+fM(s.total_recovered||0), '#22c55e', '')}
          </div>

          <div style="display:flex;gap:14px;flex-wrap:wrap">
            <div style="flex:1;min-width:200px;padding:14px;background:var(--canvas);border-radius:8px">
              <div style="font-size:11px;color:var(--t3);font-weight:600;letter-spacing:.5px;margin-bottom:4px">AVG SCORE — PAID</div>
              <div style="font-size:24px;font-weight:800;color:#22c55e">${s.avg_score_paid !== null && s.avg_score_paid !== undefined ? s.avg_score_paid : '—'}</div>
              <div style="font-size:11px;color:var(--t3)">of clients who paid</div>
            </div>
            <div style="flex:1;min-width:200px;padding:14px;background:var(--canvas);border-radius:8px">
              <div style="font-size:11px;color:var(--t3);font-weight:600;letter-spacing:.5px;margin-bottom:4px">AVG SCORE — UNPAID</div>
              <div style="font-size:24px;font-weight:800;color:#ef4444">${s.avg_score_unpaid !== null && s.avg_score_unpaid !== undefined ? s.avg_score_unpaid : '—'}</div>
              <div style="font-size:11px;color:var(--t3)">of clients who didn't pay</div>
            </div>
          </div>

          ${!s.total_predictions ? '<div style="margin-top:14px;font-size:12px;color:var(--t3)">No action data yet. Use the action buttons on each card to track outcomes.</div>' : ''}
        </div>
      </div>`;

    body.dataset.loaded = '1';
  } catch(e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">${esc(e.message)}</div></div></div>`;
  }
}

// ─── History tab ──────────────────────────────────────────────
async function _rrLoadHistory() {
  const body = document.getElementById('rr-tab-history');
  if (!body || body.dataset.loaded) return;
  body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading history…</div>';

  try {
    const { data, error } = await supabase.rpc('get_radar_history', {
      p_company_id: S.cid, p_days: 30
    });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];

    if (!rows.length) {
      body.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div class="et">No radar history yet</div><div class="es">Radar logs appear after you generate them daily.</div></div></div>`;
      body.dataset.loaded = '1';
      return;
    }

    body.innerHTML = `<div class="card">
      <div class="ch"><h3>Radar History — Last 30 Days</h3></div>
      <div class="tw"><table class="t" style="width:100%">
        <thead><tr><th>Date</th><th>Generated At</th><th>Clients Analyzed</th><th>Top Predictions</th><th class="r">Potential</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td style="font-weight:700">${fD(r.generated_date)}</td>
            <td style="font-size:12px;color:var(--t3)">${r.generated_at ? new Date(r.generated_at).toLocaleTimeString('en-PK',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
            <td>${r.clients_analyzed||0}</td>
            <td>${r.top_count||0}</td>
            <td class="r" style="font-weight:700;color:var(--ok)">PKR ${fM(r.total_potential_recovery||0)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
    body.dataset.loaded = '1';
  } catch(e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">${esc(e.message)}</div></div></div>`;
  }
}

// ─── Dashboard Widget ─────────────────────────────────────────
async function _rDashRadar() {
  const el = document.getElementById('d-radar-widget');
  if (!el) return;

  try {
    const { data } = await supabase.rpc('get_latest_radar', { p_company_id: S.cid });
    if (!data) {
      el.innerHTML = `<div class="db-card">
        <div class="db-card-ch">
          <div class="db-card-hl">
            <div class="db-card-title">Recovery Radar</div>
            <div class="db-card-sub">AI-powered daily predictions</div>
          </div>
          <button class="db-btn" onclick="nav('radar')">Generate</button>
        </div>
        <div class="db-empty">
          <div class="db-empty-tx">No radar yet — generate today's predictions</div>
        </div>
      </div>`;
      return;
    }

    const clients = Array.isArray(data.top_clients) ? data.top_clients : [];
    const isToday = data.is_today;
    const genAt   = data.generated_at ? new Date(data.generated_at).toLocaleTimeString('en-PK',{hour:'2-digit',minute:'2-digit'}) : '—';

    const barClass = s => s>=80?'green':s>=50?'amber':'red';

    el.innerHTML = `<div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <div class="db-card-title">Recovery Radar</div>
          <div class="db-card-sub">${isToday?'Today · Generated '+genAt:'Last: '+fD(data.generated_date)} · PKR ${fM(data.total_potential_recovery||0)} potential</div>
        </div>
        <button class="db-btn" onclick="nav('radar')">View Full →</button>
      </div>
      ${!clients.length
        ? `<div class="db-empty"><div class="db-empty-tx">No predictions available</div></div>`
        : clients.slice(0,5).map((c,i) => {
            const score = c.final_score||0;
            const bc    = barClass(score);
            const sc    = bc==='green'?'#16A34A':bc==='amber'?'#D97706':'#DC2626';
            return `<div class="db-radar-row" onclick="nav('radar')">
              <div class="db-radar-top">
                <div class="db-radar-rk">${i+1}</div>
                <div class="db-radar-nm">${esc((c.client_name||'').substring(0,24))}</div>
                <div class="db-radar-sc" style="color:${sc}">${score}</div>
              </div>
              <div class="db-radar-sub">PKR ${fM(c.overdue_amount||0)} overdue</div>
              <div class="db-radar-bar"><div class="db-radar-bar-fill ${bc}" style="width:${Math.min(score,100)}%"></div></div>
            </div>`;
          }).join('')
      }
      <div class="db-radar-footer">
        <span class="db-radar-total">Total potential: <b>PKR ${fM(data.total_potential_recovery||0)}</b></span>
        <button class="db-radar-lnk" onclick="nav('radar')">Open Radar →</button>
      </div>
    </div>`;
  } catch(e) {
    console.warn('[_rDashRadar]', e);
  }
}

// ════════════════════════════════════════════════════════════════
// MODULE 1.1 — DEFAULT RISK BOARD  (Recovery Intelligence Engine)
// ----------------------------------------------------------------
// Re-lenses the live client health scores as DEFAULT RISK so officers
// get an auto-prioritized, colour-tiered, trend-aware call list with
// bulk actions. Risk = 100 − health score.
// Reuses existing RPCs ONLY (no schema change):
//   get_clients_by_health_category, recalculate_all_health_scores,
//   create_escalation.
// Risk trend is computed against a per-company localStorage snapshot
// captured on the previous visit ("since last review"). A durable
// server-side trend history is a documented backend follow-up.
// ════════════════════════════════════════════════════════════════

let _riskData       = [];
let _riskSel        = new Set();
let _riskTierFilter = 'ALL';

const _RISK_TIERS = {
  critical: { label:'Critical', color:'#ef4444', bg:'rgba(239,68,68,.10)',  border:'rgba(239,68,68,.32)' },
  high:     { label:'High',     color:'#f59e0b', bg:'rgba(245,158,11,.10)', border:'rgba(245,158,11,.32)' },
  moderate: { label:'Moderate', color:'#3b82f6', bg:'rgba(59,130,246,.10)', border:'rgba(59,130,246,.30)' },
  low:      { label:'Low',      color:'#22c55e', bg:'rgba(34,197,94,.10)',  border:'rgba(34,197,94,.30)' },
};

// Map a client to a risk tier — prefer the server health category,
// fall back to the numeric health score.
function _riskTierFor(healthScore, category) {
  const c = (category || '').toUpperCase();
  if (c === 'CRITICAL') return 'critical';
  if (c === 'AT RISK')  return 'high';
  if (c === 'GOOD')     return 'moderate';
  if (c === 'PLATINUM') return 'low';
  const h = Number(healthScore);
  if (!isFinite(h)) return 'high';
  if (h <= 25) return 'critical';
  if (h <= 50) return 'high';
  if (h <= 75) return 'moderate';
  return 'low';
}

function _riskSnapKey()      { return 'rms.risk.snapshot.' + (typeof S !== 'undefined' && S && S.cid ? S.cid : 'x'); }
function _riskLoadSnap()     { try { return JSON.parse(localStorage.getItem(_riskSnapKey()) || '{}'); } catch(e) { return {}; } }
function _riskSaveSnap(map)  { try { localStorage.setItem(_riskSnapKey(), JSON.stringify(map)); } catch(e) {} }

// ─── Load + score ────────────────────────────────────────────────
async function _rrLoadRisk(force) {
  const body = document.getElementById('rr-tab-risk');
  if (!body) return;
  if (body.dataset.loaded && !force) return;
  body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3)">⏳ Scoring default risk…</div>';

  try {
    const { data, error } = await supabase.rpc('get_clients_by_health_category', {
      p_company_id: S.cid, p_category: 'ALL'
    });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];

    // Server-side trends: previous health scores from client_health_history (>12h ago)
    let snap = {};
    try {
      const { data: trendData } = await supabase.rpc('get_health_score_trends', { p_company_id: S.cid });
      if (trendData && typeof trendData === 'object') snap = trendData;
    } catch(_) {}

    _riskData = rows.map(c => {
      const health = Number(c.score);
      const risk   = Math.max(0, Math.min(100, 100 - (isFinite(health) ? health : 50)));
      const tier   = _riskTierFor(health, c.category);
      let trend = 'new';
      const prev = snap[c.client_id];
      if (prev !== undefined && prev !== null && isFinite(Number(prev))) {
        const dPrev = Number(prev);
        if      (health < dPrev - 1) trend = 'deteriorating'; // health fell → risk up
        else if (health > dPrev + 1) trend = 'improving';
        else                         trend = 'stable';
      }
      return {
        client_id: c.client_id, client_name: c.client_name, client_code: c.client_code,
        phone: c.phone, health, risk, tier, category: c.category,
        exposure: Number(c.exposure || 0), last_payment_date: c.last_payment_date, trend
      };
    });

    // Auto-prioritise: highest risk first, then largest exposure.
    _riskData.sort((a, b) => b.risk - a.risk || b.exposure - a.exposure);
    _riskSel.clear();
    _rrRenderRisk();

    body.dataset.loaded = '1';
  } catch(e) {
    body.dataset.loaded = '';
    body.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
      <div class="et">Could not score risk</div>
      <div class="es">${esc(e.message || 'Unknown error')}</div>
      <button class="btn btn-g btn-sm" style="margin-top:12px" onclick="_rrLoadRisk(true)">Retry</button>
    </div></div>`;
  }
}

function _riskSummaryCard(label, value, color) {
  return `<div style="flex:1;min-width:120px;padding:12px 14px;border-radius:10px;background:var(--surface);border:1px solid var(--line);border-top:3px solid ${color}">
    <div style="font-size:11px;color:var(--t3);font-weight:600;letter-spacing:.4px;text-transform:uppercase">${label}</div>
    <div style="font-size:20px;font-weight:800;color:${color};margin-top:3px">${value}</div>
  </div>`;
}

// ─── Render ──────────────────────────────────────────────────────
function _rrRenderRisk() {
  const body = document.getElementById('rr-tab-risk');
  if (!body) return;

  const counts = { critical:0, high:0, moderate:0, low:0 };
  let atRiskExposure = 0;
  _riskData.forEach(c => {
    counts[c.tier] = (counts[c.tier] || 0) + 1;
    if (c.tier === 'critical' || c.tier === 'high') atRiskExposure += c.exposure;
  });

  const filtered = _riskTierFilter === 'ALL'
    ? _riskData
    : _riskData.filter(c => c.tier === _riskTierFilter);

  const summary = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    ${_riskSummaryCard('Critical Risk',     counts.critical, _RISK_TIERS.critical.color)}
    ${_riskSummaryCard('High Risk',         counts.high,     _RISK_TIERS.high.color)}
    ${_riskSummaryCard('Moderate',          counts.moderate, _RISK_TIERS.moderate.color)}
    ${_riskSummaryCard('Low Risk',          counts.low,      _RISK_TIERS.low.color)}
    ${_riskSummaryCard('At-Risk Exposure',  'PKR ' + fM(atRiskExposure), '#ef4444')}
  </div>`;

  const chips = ['ALL','critical','high','moderate','low'].map(t => {
    const active = _riskTierFilter === t;
    const lbl = t === 'ALL' ? 'All' : _RISK_TIERS[t].label;
    const clr = t === 'ALL' ? 'var(--brand)' : _RISK_TIERS[t].color;
    return `<button class="btn btn-xs" style="padding:5px 12px;border-radius:20px;border:1px solid ${active?clr:'var(--line)'};background:${active?clr:'transparent'};color:${active?'#fff':'var(--t2)'};font-weight:700;cursor:pointer" onclick="rrRiskFilter('${t}')">${lbl}</button>`;
  }).join('');

  const toolbar = `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
    <div style="display:flex;gap:6px;flex-wrap:wrap">${chips}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-gh btn-sm" onclick="rrRiskSelectHigh()">Select Critical + High</button>
      <button class="btn btn-gh btn-sm" id="rr-risk-refresh" onclick="rrRiskRefresh()">Refresh Scores</button>
    </div>
  </div>`;

  if (!_riskData.length) {
    body.innerHTML = summary + toolbar + `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg></div>
      <div class="et">No client scores yet</div>
      <div class="es">Click <strong>Refresh Scores</strong> to compute default risk for all clients.</div>
    </div></div>`;
    return;
  }

  const rowsHtml = filtered.map((c, i) => _riskRow(c, i)).join('');

  body.innerHTML = summary + toolbar + `
    <div class="card"><div class="cb" style="padding:0">
      <div class="tw"><table class="t" style="width:100%">
        <thead><tr>
          <th style="width:34px"><input type="checkbox" id="rr-risk-all" onclick="rrRiskSelectAll(this.checked)"></th>
          <th style="width:34px">#</th>
          <th>Client</th>
          <th class="hide-sm">Phone</th>
          <th>Default Risk</th>
          <th>Trend</th>
          <th class="r">Exposure</th>
          <th class="hide-sm r">Last Payment</th>
          <th style="width:1%"></th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
    </div></div>
    <div id="rr-risk-bulkbar"></div>`;

  _rrRenderBulkBar();
}

function _riskRow(c, i) {
  const t   = _RISK_TIERS[c.tier] || _RISK_TIERS.high;
  const sel = _riskSel.has(c.client_id);
  const trendCfg = {
    deteriorating: { ic:'▲', color:'#ef4444',  lbl:'Worsening' },
    improving:     { ic:'▼', color:'#22c55e',  lbl:'Improving' },
    stable:        { ic:'=', color:'var(--t3)', lbl:'Stable' },
    new:           { ic:'•', color:'var(--t3)', lbl:'New / no prior score' },
  }[c.trend] || { ic:'•', color:'var(--t3)', lbl:'' };

  const phone   = c.phone || '';
  const waPhone = phone.replace(/[^0-9]/g, '').replace(/^0/, '92');

  return `<tr style="background:${sel ? 'rgba(108,99,255,.06)' : ''}">
    <td onclick="event.stopPropagation()"><input type="checkbox" ${sel?'checked':''} onclick="rrRiskToggle('${c.client_id}', this)"></td>
    <td style="color:var(--t3);font-size:11px;font-family:monospace">${i+1}</td>
    <td style="cursor:pointer" onclick="openClientDetail('${c.client_id}')">
      <div style="font-weight:700;font-size:13px">${esc(c.client_name||'—')}</div>
      <div style="font-size:10px;color:var(--t3);font-family:monospace">${esc(c.client_code||'—')}</div>
    </td>
    <td class="hide-sm" style="font-size:12px;color:var(--t2)">${phone?`<a href="tel:${esc(phone)}" style="color:var(--info);text-decoration:none">${esc(phone)}</a>`:'—'}</td>
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:34px;height:34px;border-radius:50%;background:${t.bg};border:2px solid ${t.border};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:${t.color};flex-shrink:0">${Math.round(c.risk)}</div>
        <span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:20px;background:${t.bg};color:${t.color};border:1px solid ${t.border};white-space:nowrap">${t.label}</span>
      </div>
    </td>
    <td><span title="${trendCfg.lbl}" style="font-size:13px;font-weight:800;color:${trendCfg.color}">${trendCfg.ic}</span></td>
    <td class="r" style="font-size:12px;font-weight:700;color:${c.exposure>0?'var(--err)':'var(--t3)'}">${c.exposure>0?'PKR '+fM(c.exposure):'—'}</td>
    <td class="hide-sm r" style="font-size:11px;color:var(--t3)">${c.last_payment_date?fD(c.last_payment_date):'—'}</td>
    <td onclick="event.stopPropagation()" style="white-space:nowrap">
      ${phone?`<a href="tel:${esc(phone)}" class="btn btn-gh btn-xs" style="text-decoration:none">Call</a>`:''}
      ${phone?`<a href="https://wa.me/${waPhone}" target="_blank" class="btn btn-gh btn-xs" style="text-decoration:none">WA</a>`:''}
      <button class="btn btn-gh btn-xs" onclick="rrRiskEscalateOne('${c.client_id}')">Escalate</button>
    </td>
  </tr>`;
}

function _rrRenderBulkBar() {
  const bar = document.getElementById('rr-risk-bulkbar');
  if (!bar) return;
  const n = _riskSel.size;
  if (!n) { bar.innerHTML = ''; return; }
  bar.innerHTML = `<div style="position:sticky;bottom:0;margin-top:12px;padding:12px 16px;background:var(--surface);border:1px solid var(--brand);border-radius:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;box-shadow:0 6px 24px rgba(0,0,0,.12)">
    <span style="font-weight:800;color:var(--brand)">${n} selected</span>
    <div style="flex:1"></div>
    <button class="btn btn-d btn-sm"  onclick="rrRiskBulkEscalate()">Escalate Selected</button>
    <button class="btn btn-gh btn-sm" onclick="rrRiskBulkWhatsApp()">WhatsApp Selected</button>
    <button class="btn btn-gh btn-sm" onclick="rrRiskExport()">Export CSV</button>
    <button class="btn btn-gh btn-sm" onclick="rrRiskClearSel()">Clear</button>
  </div>`;
}

// ─── Selection + filter handlers ─────────────────────────────────
function rrRiskFilter(t) { _riskTierFilter = t; _rrRenderRisk(); }

function rrRiskToggle(id, el) {
  const checked = el && el.checked;
  if (checked) _riskSel.add(id); else _riskSel.delete(id);
  const tr = el && el.closest ? el.closest('tr') : null;
  if (tr) tr.style.background = checked ? 'rgba(108,99,255,.06)' : '';
  _rrRenderBulkBar();
}

function rrRiskSelectAll(checked) {
  const filtered = _riskTierFilter === 'ALL' ? _riskData : _riskData.filter(c => c.tier === _riskTierFilter);
  filtered.forEach(c => { if (checked) _riskSel.add(c.client_id); else _riskSel.delete(c.client_id); });
  _rrRenderRisk();
}

function rrRiskSelectHigh() {
  _riskData.forEach(c => { if (c.tier === 'critical' || c.tier === 'high') _riskSel.add(c.client_id); });
  _rrRenderRisk();
}

function rrRiskClearSel() { _riskSel.clear(); _rrRenderRisk(); }

async function rrRiskRefresh() {
  const btn = document.getElementById('rr-risk-refresh');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Scoring…'; }
  try {
    const { error } = await supabase.rpc('recalculate_all_health_scores', { p_company_id: S.cid });
    if (error) throw error;
    await _rrLoadRisk(true);
    toast('Risk scores refreshed', 'ok');
  } catch(e) {
    toast('Refresh failed: ' + (e?.message || 'Unknown error'), 'err');
    if (btn) { btn.disabled = false; btn.innerHTML = 'Refresh Scores'; }
  }
}

// ─── Escalation (reuses create_escalation RPC) ───────────────────
async function _riskCreateEscalation(c) {
  try {
    const { error } = await supabase.rpc('create_escalation', {
      p_company_id: S.cid,
      p_data: {
        client_id:    c.client_id,
        from_level:   1,
        to_level:     2,
        reason:       'Auto-escalated from Risk Board — default risk ' + Math.round(c.risk) + '/100 ('
                      + (_RISK_TIERS[c.tier] ? _RISK_TIERS[c.tier].label : '') + '), exposure PKR ' + fM(c.exposure),
        status:       'open',
        escalated_by: (typeof S !== 'undefined' && S.uid) ? S.uid : null
      }
    });
    if (error) return { ok:false, err:error.message };
    return { ok:true };
  } catch(e) { return { ok:false, err:e.message }; }
}

async function rrRiskEscalateOne(id) {
  const c = _riskData.find(x => x.client_id === id);
  if (!c) return;
  if (!confirm('Escalate ' + (c.client_name || 'this client') + ' (officer → manager) for high default risk?')) return;
  const r = await _riskCreateEscalation(c);
  if (r.ok) toast('Escalation created · ' + (c.client_name || ''), 'ok');
  else      toast('Escalation failed: ' + (r.err || ''), 'err');
}

async function rrRiskBulkEscalate() {
  const ids = Array.from(_riskSel);
  if (!ids.length) return;
  if (!confirm('Create escalations (officer → manager) for ' + ids.length + ' selected client(s)?')) return;
  let ok = 0, fail = 0;
  for (const id of ids) {
    const c = _riskData.find(x => x.client_id === id);
    if (!c) { fail++; continue; }
    const r = await _riskCreateEscalation(c);
    if (r.ok) ok++; else fail++;
  }
  if (ok) toast(ok + ' escalation(s) created' + (fail ? ', ' + fail + ' failed' : ''), 'ok');
  else    toast('Could not create escalations · ' + fail + ' failed', 'err');
  _riskSel.clear();
  _rrRenderRisk();
}

function rrRiskBulkWhatsApp() {
  const sel = _riskData.filter(c => _riskSel.has(c.client_id) && c.phone);
  if (!sel.length) { toast('No phone numbers in selection', 'info'); return; }
  const cap = Math.min(sel.length, 8);
  for (let i = 0; i < cap; i++) {
    const wp = sel[i].phone.replace(/[^0-9]/g, '').replace(/^0/, '92');
    window.open('https://wa.me/' + wp, '_blank');
  }
  if (sel.length > cap) toast('Opened first ' + cap + ' chats · ' + (sel.length - cap) + ' more (browser bulk-tab limit)', 'info');
}

function rrRiskExport() {
  const sel = _riskSel.size ? _riskData.filter(c => _riskSel.has(c.client_id)) : _riskData;
  if (!sel.length) return;
  const hdr  = ['Rank','Client Code','Name','Phone','Risk','Tier','Trend','Exposure (PKR)','Last Payment'];
  const rows = sel.map((c, i) => [
    i + 1, c.client_code || '', c.client_name || '', c.phone || '',
    Math.round(c.risk), (_RISK_TIERS[c.tier] ? _RISK_TIERS[c.tier].label : ''),
    c.trend, c.exposure || 0, c.last_payment_date || ''
  ]);
  const csv = [hdr, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'default-risk-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
}

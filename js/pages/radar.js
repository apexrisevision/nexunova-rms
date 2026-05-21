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
      <button id="rr-tab-accuracy-btn" class="btn btn-xs" style="padding:8px 16px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;font-size:13px;font-weight:600;color:var(--t3);background:none;cursor:pointer" onclick="rrShowTab('accuracy')">Accuracy</button>
      <button id="rr-tab-history-btn"  class="btn btn-xs" style="padding:8px 16px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;font-size:13px;font-weight:600;color:var(--t3);background:none;cursor:pointer" onclick="rrShowTab('history')">History</button>
    </div>

    <div id="rr-tab-radar"><div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading…</div></div>
    <div id="rr-tab-accuracy" style="display:none"></div>
    <div id="rr-tab-history"  style="display:none"></div>
  </div>`;

  await _rrLoad();
}

function rrShowTab(tab) {
  _radarTab = tab;
  ['radar','accuracy','history'].forEach(t => {
    const div = document.getElementById('rr-tab-'+t);
    const btn = document.getElementById('rr-tab-'+t+'-btn');
    if (div) div.style.display = t === tab ? '' : 'none';
    if (btn) {
      btn.style.borderBottomColor = t === tab ? 'var(--brand)' : 'transparent';
      btn.style.color             = t === tab ? 'var(--brand)' : 'var(--t3)';
      btn.style.fontWeight        = t === tab ? '700' : '600';
    }
  });
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

  toast.success('Payment recorded in Radar', { detail: 'PKR ' + fM(amount) + ' marked as received' });
}

function rrReceivePayment(clientId, saleId, unitNo) {
  // Navigate to payments module pre-loaded for this client
  // After payment completes, officer can manually mark paid on radar
  nav('recovery');
  setTimeout(() => toast.info('Navigate to the client to record payment', {detail: 'Return to Radar to mark as paid'}), 300);
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
      p_top_n:        5,
      p_generated_by: S.username || 'officer'
    });
    if (error) throw error;
    _radarData   = data;
    _radarStates = {};
    _rrRender();
    toast.success('Radar generated!', { detail: `${data.clients_analyzed} clients analyzed · PKR ${fM(data.total_potential_recovery)} potential` });
  } catch(e) {
    console.error('[rrGenerate]', e);
    toast.error('Radar generation failed', { detail: e.message || 'Unknown error' });
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

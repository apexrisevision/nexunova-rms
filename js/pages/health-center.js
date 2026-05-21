// ══ CLIENT HEALTH CENTER ══════════════════════════════════════
// Filterable list of all clients by health score category.
// Powered by: calculate_client_health_score, get_clients_by_health_category RPCs.

let _hcFilter = 'ALL';
let _hcData   = [];

async function rHealthCenter() {
  const pg = document.getElementById('pg-healthcenter');
  if (!pg) return;

  _hcData = [];

  pg.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l">
        <h2>Client Health Center</h2>
        <p id="hc-subtitle">Loading scores…</p>
      </div>
      <div class="ph-r" style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-gh btn-sm" id="hc-recalc-btn" onclick="hcRecalcAll()">Recalculate All</button>
        <button class="btn btn-gh btn-sm" onclick="hcExportCSV()">Export CSV</button>
      </div>
    </div>

    <!-- Category filter tabs -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px" id="hc-tabs">
      ${['ALL','PLATINUM','GOOD','AT RISK','CRITICAL'].map(f =>
        `<button id="hc-tab-${f.replace(' ','-')}" class="btn btn-sm ${f==='ALL'?'btn-g':'btn-gh'}" onclick="hcSetFilter('${f}')">${_hcTabLabel(f)}</button>`
      ).join('')}
    </div>

    <div id="hc-body">
      <div style="padding:48px;text-align:center;color:var(--t3);font-size:13px">⏳ Loading…</div>
    </div>
  </div>`;

  await _hcLoad();
}

function _hcTabLabel(f) {
  return {ALL:'All Clients', PLATINUM:'Platinum', GOOD:'Good', 'AT RISK':'At Risk', CRITICAL:'Critical'}[f] || f;
}

async function _hcLoad() {
  const body = document.getElementById('hc-body');
  if (!body) return;

  try {
    const { data, error } = await supabase.rpc('get_clients_by_health_category', {
      p_company_id: S.cid,
      p_category:   'ALL'
    });
    if (error) throw error;
    _hcData = Array.isArray(data) ? data : [];
    _hcRender();
  } catch(e) {
    if (body) body.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Failed to load health data</div><div class="es">${esc(e.message||'Error')}</div></div></div>`;
  }
}

function hcSetFilter(f) {
  _hcFilter = f;
  ['ALL','PLATINUM','GOOD','AT RISK','CRITICAL'].forEach(t => {
    const btn = document.getElementById('hc-tab-'+t.replace(' ','-'));
    if (btn) btn.className = `btn btn-sm ${_hcFilter===t?'btn-g':'btn-gh'}`;
  });
  _hcRender();
}

const _hcCatCfg = {
  PLATINUM: { color:'#22c55e', bg:'rgba(34,197,94,.12)',  border:'rgba(34,197,94,.3)',  emoji:'' },
  GOOD:     { color:'#3b82f6', bg:'rgba(59,130,246,.12)', border:'rgba(59,130,246,.3)', emoji:'' },
  'AT RISK':{ color:'#f59e0b', bg:'rgba(245,158,11,.12)', border:'rgba(245,158,11,.3)', emoji:'' },
  CRITICAL: { color:'#ef4444', bg:'rgba(239,68,68,.12)',  border:'rgba(239,68,68,.3)',  emoji:'' },
};

function _hcRender() {
  const body     = document.getElementById('hc-body');
  const subtitle = document.getElementById('hc-subtitle');
  if (!body) return;

  const filtered = _hcFilter === 'ALL' ? _hcData : _hcData.filter(c => c.category === _hcFilter);

  if (subtitle) {
    const counts = { PLATINUM:0, GOOD:0, 'AT RISK':0, CRITICAL:0 };
    _hcData.forEach(c => { if (counts[c.category] !== undefined) counts[c.category]++; });
    subtitle.innerHTML = `${_hcData.length} clients scored &nbsp;·&nbsp; `
      + `<span style="color:#22c55e">${counts.PLATINUM}</span> &nbsp;`
      + `<span style="color:#3b82f6">${counts.GOOD}</span> &nbsp;`
      + `<span style="color:#f59e0b">${counts['AT RISK']}</span> &nbsp;`
      + `<span style="color:#ef4444">${counts.CRITICAL}</span>`;
  }

  if (!filtered.length) {
    const msg = _hcFilter === 'ALL'
      ? 'No health scores yet — click Recalculate All to score clients'
      : `No clients in ${_hcFilter} category`;
    body.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div><div class="et">${msg}</div></div></div>`;
    return;
  }

  body.innerHTML = `<div class="tw"><table class="t" style="width:100%">
    <thead><tr>
      <th style="width:32px">#</th>
      <th>Client</th>
      <th class="hide-sm">Phone</th>
      <th>Health Score</th>
      <th class="r">Exposure</th>
      <th class="hide-sm r">Last Payment</th>
      <th style="width:40px"></th>
    </tr></thead>
    <tbody>
      ${filtered.map((c, i) => {
        const cc  = _hcCatCfg[c.category] || _hcCatCfg['AT RISK'];
        const exp = Number(c.exposure || 0);
        return `<tr style="cursor:pointer" onclick="hcOpenClient('${c.client_id}')">
          <td style="color:var(--t3);font-size:11px;font-family:monospace">${i+1}</td>
          <td>
            <div style="font-weight:700;font-size:13px">${esc(c.client_name||'—')}</div>
            <div style="font-size:10px;color:var(--t3);font-family:monospace">${esc(c.client_code||'—')}</div>
          </td>
          <td class="hide-sm" style="font-size:12px;color:var(--t2)">${esc(c.phone||'—')}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:34px;height:34px;border-radius:50%;background:${cc.bg};border:2px solid ${cc.border};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:${cc.color};flex-shrink:0">${c.score}</div>
              <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:${cc.bg};color:${cc.color};border:1px solid ${cc.border};white-space:nowrap">${cc.emoji} ${c.category}</span>
            </div>
          </td>
          <td class="r" style="font-size:12px;font-weight:700;color:${exp>0?'var(--err)':'var(--t3)'}">
            ${exp>0?'PKR '+fM(exp):'—'}
          </td>
          <td class="hide-sm r" style="font-size:11px;color:var(--t3)">${c.last_payment_date?fD(c.last_payment_date):'—'}</td>
          <td onclick="event.stopPropagation()">
            <button class="btn btn-gh btn-xs" title="Recalculate" onclick="hcRecalcOne('${c.client_id}',this)">↺</button>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
}

function hcOpenClient(clientId) {
  openClientDetail(clientId);
  setTimeout(() => cdSwitchTab('health'), 100);
}

async function hcRecalcOne(clientId, btn) {
  const orig = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }
  try {
    await supabase.rpc('calculate_client_health_score', { p_client_id: clientId, p_company_id: S.cid });
    await _hcLoad();
  } catch(e) {
    console.warn('[hcRecalcOne]', e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}

async function hcRecalcAll() {
  const btn = document.getElementById('hc-recalc-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Recalculating…'; }
  try {
    const { error } = await supabase.rpc('recalculate_all_health_scores', { p_company_id: S.cid });
    if (error) throw error;
    await _hcLoad();
    if (typeof showToast === 'function') showToast('All health scores updated', 'ok');
  } catch(e) {
    console.warn('[hcRecalcAll]', e);
    if (typeof showToast === 'function') showToast('Recalculation failed', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Recalculate All'; }
  }
}

function hcExportCSV() {
  const filtered = _hcFilter === 'ALL' ? _hcData : _hcData.filter(c => c.category === _hcFilter);
  if (!filtered.length) { alert('No data to export'); return; }

  const hdr  = ['Client Code','Name','Phone','Score','Category','Exposure (PKR)','Last Payment'];
  const rows = filtered.map(c => [
    c.client_code || '',
    c.client_name || '',
    c.phone       || '',
    c.score,
    c.category,
    c.exposure    || 0,
    c.last_payment_date || ''
  ]);

  const csv = [hdr, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(','))
    .join('\n');

  const a    = document.createElement('a');
  a.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `client-health-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

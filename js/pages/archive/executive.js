// ══ EXECUTIVE DASHBOARD (Module 8.1) ══════════════════════════════
// One-glance portfolio + recovery analytics for owners/managers.
// Backend: get_executive_dashboard(p_company_id).

let _exData = null;

async function rExecutive() {
  const pg = document.getElementById('pg-executive');
  if (!pg) return;
  pg.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l"><h2>Executive Dashboard</h2><p>Portfolio value, recovery performance, aging and officer leaderboard at a glance.</p></div>
      <div class="ph-r" style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-gh btn-sm" onclick="_exExport()">Export CSV</button>
        <button class="btn btn-gh btn-sm" onclick="_exLoad()">↺ Refresh</button>
      </div>
    </div>
    <div id="ex-body"><div style="padding:40px;text-align:center;color:var(--t3)">⏳ Loading…</div></div>
  </div>`;
  await _exLoad();
}

async function _exLoad() {
  const body = document.getElementById('ex-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3)">⏳ Loading…</div>';
  try {
    const { data, error } = await supabase.rpc('get_executive_dashboard', { p_company_id: S.cid });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    _exData = data;
    _exRender();
  } catch(e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Could not load dashboard</div><div class="es">${esc(e.message||'Error')}</div></div></div>`;
  }
}

function _exKpi(label, value, color, sub) {
  return `<div class="card" style="flex:1;min-width:170px"><div class="cb">
    <div style="font-size:11px;color:var(--t3);font-weight:600;letter-spacing:.4px;text-transform:uppercase">${label}</div>
    <div style="font-size:21px;font-weight:800;color:${color};margin-top:4px">${value}</div>
    ${sub?`<div style="font-size:11px;color:var(--t3);margin-top:2px">${sub}</div>`:''}
  </div></div>`;
}

function _exRender() {
  const body = document.getElementById('ex-body');
  if (!body || !_exData) return;
  const k = _exData.kpis || {};
  const aging = _exData.aging || {};
  const trend = Array.isArray(_exData.trend) ? _exData.trend : [];
  const officers = Array.isArray(_exData.officers) ? _exData.officers : [];
  const projects = Array.isArray(_exData.projects) ? _exData.projects : [];

  const rateColor = (k.collection_rate||0) >= 70 ? 'var(--ok)' : (k.collection_rate||0) >= 40 ? '#f59e0b' : 'var(--err)';

  const kpis = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    ${_exKpi('Portfolio Value', 'PKR '+fM(k.portfolio_value||0), 'var(--t1)')}
    ${_exKpi('Collected', 'PKR '+fM(k.collected||0), 'var(--ok)')}
    ${_exKpi('Outstanding', 'PKR '+fM(k.outstanding||0), 'var(--err)')}
    ${_exKpi('Collection Rate', (k.collection_rate||0)+'%', rateColor)}
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
    ${_exKpi('Active Legal Cases', (k.active_legal_cases||0)+'', (k.active_legal_cases||0)>0?'var(--err)':'var(--t2)')}
    ${_exKpi('PDC Due (30d)', 'PKR '+fM(k.pdc_due_month||0), '#3b82f6', (k.pdc_due_month_count||0)+' cheque(s)')}
    ${_exKpi('Active Campaigns', (k.active_campaigns||0)+'', 'var(--brand)')}
  </div>`;

  const charts = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;margin-bottom:14px">
    <div class="card"><div class="ch"><h3>12-Month Trend (billed vs collected)</h3></div>
      <div class="cb"><div style="height:240px;position:relative"><canvas id="ex-trend-canvas"></canvas></div></div></div>
    <div class="card"><div class="ch"><h3>Overdue Aging</h3></div>
      <div class="cb"><div style="height:240px;position:relative"><canvas id="ex-aging-canvas"></canvas></div></div></div>
  </div>`;

  const officersTbl = `<div class="card">
    <div class="ch"><h3>Officer Leaderboard (last 90 days)</h3></div>
    <div class="cb" style="padding:0">${officers.length ? `
      <div class="tw"><table class="t" style="width:100%">
        <thead><tr><th>#</th><th>Officer</th><th class="r">Payments</th><th class="r">Collected</th></tr></thead>
        <tbody>${officers.map((o,i)=>`<tr>
          <td style="color:var(--t3);font-family:monospace">${i+1}</td>
          <td><div style="font-weight:700;font-size:13px">${esc(o.officer_name||o.username||'—')}</div>
              <div style="font-size:10px;color:var(--t3);font-family:monospace">@${esc(o.username||'')}</div></td>
          <td class="r" style="font-size:12px;font-weight:700">${o.payments||0}</td>
          <td class="r" style="font-size:12px;font-weight:700;color:var(--ok)">PKR ${fM(o.collected||0)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<div class="empty" style="padding:24px"><div class="es">No collections in the last 90 days.</div></div>`}
    </div>
  </div>`;

  const projTbl = `<div class="card" style="margin-top:14px">
    <div class="ch"><h3>Project Heat Map</h3></div>
    <div class="cb" style="padding:0">${projects.length ? `
      <div class="tw"><table class="t" style="width:100%">
        <thead><tr><th>Project</th><th class="r">Billed</th><th class="r">Collected</th><th class="r">Outstanding</th><th class="r">Rate</th></tr></thead>
        <tbody>${projects.map(p=>{
          const rc = (p.collection_rate||0) >= 70 ? 'var(--ok)' : (p.collection_rate||0) >= 40 ? '#f59e0b' : 'var(--err)';
          return `<tr>
            <td style="font-weight:700;font-size:13px">${esc(p.project_name||'—')}</td>
            <td class="r" style="font-size:12px">PKR ${fM(p.billed||0)}</td>
            <td class="r" style="font-size:12px;color:var(--ok)">PKR ${fM(p.collected||0)}</td>
            <td class="r" style="font-size:12px;color:var(--err)">PKR ${fM(p.outstanding||0)}</td>
            <td class="r" style="font-size:12px;font-weight:700;color:${rc}">${p.collection_rate||0}%</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : `<div class="empty" style="padding:24px"><div class="es">No project data yet.</div></div>`}
    </div>
  </div>`;

  body.innerHTML = kpis + charts + officersTbl + projTbl;

  // Trend chart
  if (typeof Chart !== 'undefined' && trend.length) {
    const ctx = document.getElementById('ex-trend-canvas');
    if (window._exTrendChart) { try { window._exTrendChart.destroy(); } catch(e) {} window._exTrendChart = null; }
    window._exTrendChart = new Chart(ctx, {
      type: 'line',
      data: { labels: trend.map(t=>t.label), datasets: [
        { label:'Billed',    data: trend.map(t=>Number(t.billed||0)),    borderColor:'#94a3b8', backgroundColor:'rgba(148,163,184,.12)', fill:true, tension:.3, borderWidth:2, pointRadius:2 },
        { label:'Collected', data: trend.map(t=>Number(t.collected||0)), borderColor:'#6C63FF', backgroundColor:'rgba(108,99,255,.14)', fill:true, tension:.3, borderWidth:2, pointRadius:2 }
      ]},
      options: { responsive:true, maintainAspectRatio:false,
        scales:{ y:{ beginAtZero:true, ticks:{ callback:v=>fM(v) } } },
        plugins:{ legend:{ position:'bottom', labels:{boxWidth:10} } } }
    });
  }
  // Aging chart
  if (typeof Chart !== 'undefined') {
    const ctx = document.getElementById('ex-aging-canvas');
    if (window._exAgingChart) { try { window._exAgingChart.destroy(); } catch(e) {} window._exAgingChart = null; }
    const b = ['d1_30','d31_60','d61_90','d90_plus'];
    const lbls = ['1–30','31–60','61–90','90+'];
    window._exAgingChart = new Chart(ctx, {
      type: 'bar',
      data: { labels: lbls, datasets: [{
        label:'Overdue', data: b.map(x => Number((aging[x]||{}).amount || 0)),
        backgroundColor: ['#f59e0b','#fb923c','#ef4444','#b91c1c'], borderRadius:4
      }]},
      options: { responsive:true, maintainAspectRatio:false,
        scales:{ y:{ beginAtZero:true, ticks:{ callback:v=>fM(v) } } },
        plugins:{ legend:{ display:false },
          tooltip:{ callbacks:{ label: c => 'PKR ' + fM(c.parsed.y) + '  (' + ((aging[b[c.dataIndex]]||{}).count||0) + ' items)' } } } }
    });
  }
}

function _exExport() {
  if (!_exData) return;
  const k = _exData.kpis || {};
  const rows = [['Section','Key','Value','Extra']];
  Object.entries(k).forEach(([key,val]) => rows.push(['KPI', key, val, '']));
  (_exData.trend||[]).forEach(t => rows.push(['Trend', t.label, t.billed, t.collected]));
  ['d1_30','d31_60','d61_90','d90_plus'].forEach(x => { const a=(_exData.aging||{})[x]||{}; rows.push(['Aging', x, a.amount||0, a.count||0]); });
  (_exData.officers||[]).forEach(o => rows.push(['Officer', o.officer_name||o.username, o.collected, o.payments]));
  (_exData.projects||[]).forEach(p => rows.push(['Project', p.project_name, p.outstanding, p.collection_rate+'%']));
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'executive-dashboard-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
}

// ══ RECOVERY FORECASTING (Module 1.4) ═════════════════════════════
// Predicted collection for the next 30/60/90 days from scheduled
// installments (weighted by trailing-90-day collection rate) + the
// pending-promise pipeline. Project- and officer-wise breakdowns, plus
// a backward 6-month billed-vs-collected chart for accuracy context.
// Backend: forecast_recovery(p_company_id).

let _fcData = null;

async function rForecasting() {
  const pg = document.getElementById('pg-forecasting');
  if (!pg) return;
  pg.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l">
        <h2>Recovery Forecasting</h2>
        <p>Predicted collection for the next 30 / 60 / 90 days — from scheduled installments, the promise pipeline, and your historical collection rate.</p>
      </div>
      <div class="ph-r" style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-gh btn-sm" onclick="_fcExport()">Export CSV</button>
        <button class="btn btn-gh btn-sm" onclick="_fcLoad()">↺ Refresh</button>
      </div>
    </div>
    <div id="fc-body"><div style="padding:40px;text-align:center;color:var(--t3)">⏳ Computing forecast…</div></div>
  </div>`;
  await _fcLoad();
}

async function _fcLoad() {
  const body = document.getElementById('fc-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3)">⏳ Computing forecast…</div>';
  try {
    const { data, error } = await supabase.rpc('forecast_recovery', { p_company_id: S.cid });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    _fcData = data;
    _fcRender();
  } catch(e) {
    body.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
      <div class="et">Could not compute forecast</div>
      <div class="es">${esc(e.message || 'Error')}</div>
    </div></div>`;
  }
}

function _fcRender() {
  const body = document.getElementById('fc-body');
  if (!body || !_fcData) return;
  const d         = _fcData;
  const h         = d.historical || {};
  const horizons  = Array.isArray(d.horizons)       ? d.horizons       : [];
  const byProject = Array.isArray(d.by_project)     ? d.by_project     : [];
  const byOfficer = Array.isArray(d.by_officer)     ? d.by_officer     : [];
  const monthly   = Array.isArray(d.monthly_actual) ? d.monthly_actual : [];

  const confBanner = !h.has_history
    ? `<div style="padding:10px 14px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:8px;margin-bottom:14px;font-size:12px;color:#f59e0b">No payment history yet — forecasts assume 100% collection and will sharpen as payments accumulate.</div>`
    : `<div style="font-size:12px;color:var(--t3);margin-bottom:14px">Based on a trailing-90-day collection rate of <b style="color:var(--t1)">${h.rate_pct}%</b> (PKR ${fM(h.collected_90||0)} collected of PKR ${fM(h.billed_90||0)} billed).</div>`;

  const hcards = horizons.map(z => {
    const color = z.days===30 ? 'var(--brand)' : z.days===60 ? '#3b82f6' : '#8b5cf6';
    return `<div class="card" style="flex:1;min-width:220px">
      <div class="cb">
        <div style="font-size:12px;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Next ${z.days} days</div>
        <div style="font-size:26px;font-weight:800;color:${color};margin:6px 0">PKR ${fM(z.forecast||0)}</div>
        <div style="font-size:11px;color:var(--t3)">forecast collection</div>
        <div style="display:flex;gap:18px;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
          <div><div style="font-size:10px;color:var(--t3)">Scheduled due</div><div style="font-size:13px;font-weight:700">PKR ${fM(z.scheduled_due||0)}</div></div>
          <div><div style="font-size:10px;color:var(--t3)">Promised</div><div style="font-size:13px;font-weight:700;color:var(--ok)">PKR ${fM(z.promised||0)}</div></div>
        </div>
      </div>
    </div>`;
  }).join('');

  body.innerHTML = `
    ${confBanner}
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">${hcards}</div>

    <div class="card" style="margin-bottom:14px">
      <div class="ch"><h3>Billed vs Collected — last 6 months</h3></div>
      <div class="cb"><div id="fc-chart-wrap" style="height:260px;position:relative"><canvas id="fc-chart"></canvas></div></div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px">
      <div class="card">
        <div class="ch"><h3>By Project — 90-day pipeline</h3></div>
        <div class="cb" style="padding:0">${byProject.length ? `
          <div class="tw"><table class="t" style="width:100%">
            <thead><tr><th>Project</th><th class="r">Scheduled Due</th><th class="r">Forecast</th></tr></thead>
            <tbody>${byProject.map(p => `<tr>
              <td style="font-weight:700;font-size:13px">${esc(p.project_name||'—')}</td>
              <td class="r" style="font-size:12px;font-weight:700">PKR ${fM(p.scheduled_due||0)}</td>
              <td class="r" style="font-size:12px;font-weight:700;color:var(--brand)">PKR ${fM(p.forecast||0)}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : `<div class="empty" style="padding:24px"><div class="es">No scheduled installments in the next 90 days.</div></div>`}
        </div>
      </div>

      <div class="card">
        <div class="ch"><h3>By Officer — promise pipeline (90d)</h3></div>
        <div class="cb" style="padding:0">${byOfficer.length ? `
          <div class="tw"><table class="t" style="width:100%">
            <thead><tr><th>Officer</th><th class="r">Pending</th><th class="r">Promised</th></tr></thead>
            <tbody>${byOfficer.map(o => `<tr>
              <td>
                <div style="font-weight:700;font-size:13px">${esc(o.officer_name||o.username||'—')}</div>
                <div style="font-size:10px;color:var(--t3);font-family:monospace">@${esc(o.username||'')}</div>
              </td>
              <td class="r" style="font-size:12px;font-weight:700">${o.pending_count||0}</td>
              <td class="r" style="font-size:12px;font-weight:700;color:var(--ok)">PKR ${fM(o.promised||0)}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : `<div class="empty" style="padding:24px"><div class="es">No pending promises in the next 90 days.</div></div>`}
        </div>
      </div>
    </div>
  `;

  if (typeof Chart !== 'undefined' && monthly.length) {
    const ctx = document.getElementById('fc-chart');
    if (window._fcChart) { try { window._fcChart.destroy(); } catch(e) {} window._fcChart = null; }
    window._fcChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: monthly.map(m => m.label),
        datasets: [
          { label: 'Billed',    data: monthly.map(m => Number(m.billed    || 0)), backgroundColor: 'rgba(148,163,184,.6)',  borderRadius: 4 },
          { label: 'Collected', data: monthly.map(m => Number(m.collected || 0)), backgroundColor: 'rgba(108,99,255,.85)', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { callback: v => 'PKR ' + fM(v) } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } }
      }
    });
  } else if (!monthly.length) {
    const wrap = document.getElementById('fc-chart-wrap');
    if (wrap) wrap.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3);font-size:12px">No monthly data yet</div>';
  }
}

function _fcExport() {
  if (!_fcData) return;
  const rows = [['Section','Key','Scheduled/Billed','Forecast/Collected','Promised/Pending']];
  (_fcData.horizons||[]).forEach(z => rows.push(['Horizon', z.days+'d', z.scheduled_due, z.forecast, z.promised]));
  (_fcData.by_project||[]).forEach(p => rows.push(['Project', p.project_name, p.scheduled_due, p.forecast, '']));
  (_fcData.by_officer||[]).forEach(o => rows.push(['Officer', o.officer_name||o.username, '', o.promised, o.pending_count]));
  (_fcData.monthly_actual||[]).forEach(m => rows.push(['Month', m.label, m.billed, m.collected, '']));
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'recovery-forecast-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
}

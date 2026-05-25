// ══════════════════════════════════════════════════════════════════════════════
// RECOVERY DASHBOARD — the recovery team's home screen
// Reuses the .db-* design-system classes (dashboard-premium.css, blue-600 palette)
// plus a few rd-* helpers (recovery-dashboard.css). Page id: pg-recovery-dashboard
// ══════════════════════════════════════════════════════════════════════════════

if (!window._rdCI) window._rdCI = {};
function _rdDestroyCharts(){ Object.values(window._rdCI).forEach(c=>{try{c.destroy();}catch(e){}}); window._rdCI={}; }

function _rdI(p,s=14){return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;}
const _RDIC = {
  alert:  'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4"/><path d="M12 17h.01',
  units:  '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  money:  '<line x1="12" x2="12" y1="1" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  hand:   '<path d="M11 12 8.5 9.5a1.41 1.41 0 0 0-2 2L10 15"/><path d="M14 13.5 11.5 11a1.41 1.41 0 0 0-2 2l3 3"/>',
  rate:   '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  phone:  '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33A2 2 0 0 1 3.54 1h3a2 2 0 0 1 2 1.72c.127.966.362 1.917.7 2.83a2 2 0 0 1-.45 2.11L8.09 9a16 16 0 0 0 6.29 6.29l.79-.99a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z"/>',
  wa:     '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  check:  '<polyline points="20 6 9 17 4 12"/>',
  circI:  '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  bar:    '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  radar:  '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',
  activity:'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  file:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
};

async function rRecDash(){
  const pg = document.getElementById('pg-recovery-dashboard');
  if (!pg) return;
  _rdDestroyCharts();

  // ── Skeleton ──
  pg.innerHTML = `<div class="db-skel">
    <div class="db-sk-kpis rd-kpis5">${[0,1,2,3,4].map(()=>`<div class="db-sb" style="height:88px;border-radius:10px"></div>`).join('')}</div>
    <div class="db-sk-r1"><div class="db-sb" style="height:280px"></div><div class="db-sb" style="height:280px"></div></div>
    <div class="db-sk-r2"><div class="db-sb" style="height:300px"></div><div class="db-sb" style="height:300px"></div></div>
    <div class="db-sb" style="height:96px;border-radius:10px"></div>
    <div class="db-sk-r2"><div class="db-sb" style="height:280px"></div><div class="db-sb" style="height:280px"></div></div>
  </div>`;

  // ── Cache-derived core ──
  const units   = gunits();
  const od      = getOverdueDays();
  const sold    = units.filter(u => u.status!=='Available' && u.status!=='Dead');
  const pending = sold.filter(u => actualPending(u) > 0);
  const overdueUnits = pending.filter(u => isOverdue(u, od)).sort((a,b)=>actualPending(b)-actualPending(a));
  const totalOutstanding = pending.reduce((s,u)=>s+actualPending(u),0);
  const totalPaid        = sold.reduce((s,u)=>s+actualPaid(u),0);
  const totalPortfolio   = sold.reduce((s,u)=>s+Number(u.totalPrice||0),0);
  const recovPct         = totalPortfolio>0 ? Math.round(totalPaid/totalPortfolio*100) : 0;
  const fus      = gfus();
  const todayFus = [...fus.today, ...fus.overdue];

  // Aging buckets — outstanding split by days since last payment
  const ag = { b1:0, b2:0, b3:0, b4:0 };  // 0-30 / 31-60 / 61-90 / 90+
  pending.forEach(u => {
    const d = daysSincePay(u), ap = actualPending(u);
    if (d===null || d>90) ag.b4 += ap;
    else if (d>60) ag.b3 += ap;
    else if (d>30) ag.b2 += ap;
    else ag.b1 += ap;
  });

  // ── Async data (KPIs, promises, AI radar) ──
  let monthColl=0, recentPays=[], promises=[], radar=[];
  try {
    const [kRes, pRes, rRes] = await Promise.all([
      supabase.rpc('get_dashboard_kpis', { p_company_id:S.cid }).then(r=>r.data).catch(()=>null),
      supabase.rpc('get_all_promises',   { p_company_id:S.cid }).then(r=>r.data).catch(()=>null),
      supabase.rpc('get_latest_radar',   { p_company_id:S.cid }).then(r=>r.data).catch(()=>null),
    ]);
    if (kRes?.success){ monthColl=Number(kRes.this_month_collection||0); recentPays=Array.isArray(kRes.recent_payments)?kRes.recent_payments:[]; }
    promises = Array.isArray(pRes) ? pRes : [];
    radar    = Array.isArray(rRes) ? rRes : (rRes?.top_clients || rRes?.clients || []);
  } catch(e){ console.warn('[rRecDash] async load failed', e); }

  const t = td();
  const wkEnd = (()=>{ const d=new Date(); d.setDate(d.getDate()+7); return d.toISOString().slice(0,10); })();
  const promisesToday = promises.filter(p => p.status==='pending' && p.promise_date===t).length;
  const weekPromises  = promises
    .filter(p => p.promise_date && p.promise_date>=t && p.promise_date<=wkEnd)
    .sort((a,b)=>(a.promise_date||'').localeCompare(b.promise_date||''));

  // Recent recovery activity — merge calls + payments + promises
  const activity = [];
  (gcons()||[]).forEach(c => {
    const u = gunit(c.unit_id);
    activity.push({ kind:'call', ts:c.created_at || (c.contact_date?c.contact_date+'T00:00:00':''),
      title:`Call logged — ${u?.customerName||c.client_name||'Client'}`,
      sub:`${u?.unitNo||'—'}${c.response_received?' · '+c.response_received:(c.channel?' · '+c.channel:'')}` });
  });
  recentPays.forEach(r => {
    activity.push({ kind:'pay', ts:(r.payment_date?r.payment_date+'T00:00:00':''),
      title:`Payment received — PKR ${fM(Number(r.amount||0))}`, sub:`${r.client_name||'—'}` });
  });
  promises.forEach(p => {
    const made = p.promise_made_on || p.created_at || p.promise_date || '';
    activity.push({ kind:'promise', ts:(made && made.length<=10 ? made+'T00:00:00' : made),
      title:`Promise — PKR ${fM(Number(p.promised_amount||0))}`, sub:`${p.client_name||'—'} · due ${fD(p.promise_date)}` });
  });
  activity.sort((a,b)=>(b.ts||'').localeCompare(a.ts||''));
  const feed = activity.slice(0,10);

  const radarTop = [...radar].sort((a,b)=>(b.final_score||0)-(a.final_score||0)).slice(0,5);

  // ════════════════════════ RENDER ════════════════════════
  pg.innerHTML = `<div class="db ani">

  <!-- ROW 1 — Recovery KPIs (5) -->
  <div class="db-kpis rd-kpis5">
    ${_rdKpi('red',  _RDIC.alert, 'Total Overdue Amount', `<span class="db-pkr">PKR</span>${fMH(totalOutstanding)}`, `${pending.length} unit${pending.length!==1?'s':''} with dues`)}
    ${_rdKpi('red',  _RDIC.units, 'Units Overdue', String(overdueUnits.length), overdueUnits.length?'Past due — needs action':'All current')}
    ${_rdKpi('green',_RDIC.money, 'Collected This Month', `<span class="db-pkr">PKR</span>${fMH(monthColl)}`, `${recentPays.length} payment${recentPays.length!==1?'s':''} logged`)}
    ${_rdKpi('amber',_RDIC.hand,  'Promises Due Today', String(promisesToday), promisesToday?'Follow up to confirm':'No promises today')}
    ${_rdKpi('blue', _RDIC.rate,  'Recovery Rate', `${recovPct}<span style="font-size:14px;font-weight:500;color:var(--text-muted);margin-left:2px">%</span>`, `PKR ${fMH(totalPaid)} of ${fMH(totalPortfolio)}`)}
  </div>

  <!-- ROW 2 — Aging buckets (60%) + Today's Action List (40%) -->
  <div class="db-grid-r1">
    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_rdI(_RDIC.bar)} Aging Buckets</p>
          <p class="db-card-sub">Outstanding by days overdue</p>
        </div>
        <button class="db-btn" onclick="openRptViewer('aging')">${_rdI(_RDIC.bar,12)} Aging Report</button>
      </div>
      <div class="db-chart-wrap" style="height:200px;padding-top:10px"><canvas id="rd-chart-aging"></canvas></div>
    </div>

    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_rdI(_RDIC.phone,14)} Today's Action List</p>
          <p class="db-card-sub">${todayFus.length} follow-up${todayFus.length!==1?'s':''} due</p>
        </div>
        <button class="db-btn" onclick="nav('contacts')">All →</button>
      </div>
      ${todayFus.length===0
        ? `<div class="db-empty"><span class="db-empty-ic">${_rdI(_RDIC.check,24)}</span><p class="db-empty-tx">No follow-ups due today</p></div>`
        : todayFus.slice(0,6).map(c => {
            const u=gunit(c.unit_id), pend=u?actualPending(u):0, isOd=c.next_followup_date<t;
            return `<div class="db-fu-row2">
              <div class="db-fu2-body">
                <div class="db-fu2-name">${esc(c.client_name||u?.customerName||'—')}</div>
                <div class="db-fu2-unit">${esc(u?.unitNo||'—')}${isOd?' · <span style="color:#DC2626;font-size:10px">Overdue</span>':''}</div>
              </div>
              <div class="db-fu2-amt">${pend>0?'PKR '+fM(pend):'—'}</div>
              <button class="db-fu2-call" onclick="event.stopPropagation();openConModal('${c.unit_id||''}')">${_rdI(_RDIC.phone,11)} Call</button>
            </div>`;
          }).join('')}
    </div>
  </div>

  <!-- ROW 3 — Top 10 Overdue Units (50%) + Promise Tracker (50%) -->
  <div class="db-grid-r2">
    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_rdI(_RDIC.circI)} Top 10 Overdue Units</p>
          <p class="db-card-sub">By highest outstanding amount</p>
        </div>
        <button class="db-btn" onclick="nav('recovery')">Queue →</button>
      </div>
      ${!overdueUnits.length
        ? `<div class="db-empty"><span class="db-empty-ic">${_rdI(_RDIC.check,24)}</span><p class="db-empty-tx">No overdue units — great work!</p></div>`
        : `<div class="db-tbl-wrap"><table class="db-tbl">
            <thead><tr><th>Unit</th><th>Client</th><th>Days</th><th>Amount</th><th>Last Contact</th><th>Actions</th></tr></thead>
            <tbody>${overdueUnits.slice(0,10).map(u=>{
              const d2=daysSincePay(u);
              const clr=(d2===null||d2>90)?'#DC2626':d2>60?'#EA580C':'#D97706';
              const logs=gcons(u.id).sort((a,b)=>(b.contact_date||'').localeCompare(a.contact_date||''));
              const lc=logs[0]?.contact_date?fD(logs[0].contact_date):'—';
              return `<tr>
                <td><span class="db-unit-chip">${esc(u.unitNo||'—')}</span></td>
                <td style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" class="db-tbl-mute">${esc((u.customerName||'—').substring(0,16))}</td>
                <td style="color:${clr};font-weight:600;font-size:12px;white-space:nowrap">${d2===null?'Never':d2+'d'}</td>
                <td style="color:${clr};font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap">PKR ${fM(actualPending(u))}</td>
                <td class="db-tbl-mute" style="white-space:nowrap;font-size:11px">${lc}</td>
                <td style="white-space:nowrap">
                  <button class="rd-actbtn" title="Log Call" onclick="event.stopPropagation();openConModal('${u.id}')">${_rdI(_RDIC.phone,13)}</button>
                  <button class="rd-actbtn green" title="WhatsApp" onclick="event.stopPropagation();_rqWA('${u.id}')">${_rdI(_RDIC.wa,13)}</button>
                  <button class="rd-actbtn blue" title="Add Promise" onclick="event.stopPropagation();openConModal('${u.id}','promise')">${_rdI(_RDIC.check,13)}</button>
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`}
    </div>

    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_rdI(_RDIC.hand)} Promise-to-Pay Tracker</p>
          <p class="db-card-sub">${weekPromises.length} promise${weekPromises.length!==1?'s':''} due this week</p>
        </div>
        <button class="db-btn" onclick="nav('promises')">All →</button>
      </div>
      ${!weekPromises.length
        ? `<div class="db-empty"><span class="db-empty-ic">${_rdI(_RDIC.hand,24)}</span><p class="db-empty-tx">No promises due this week</p></div>`
        : `<div class="db-tbl-wrap"><table class="db-tbl">
            <thead><tr><th>Client</th><th>Amount</th><th>Promise Date</th><th>Status</th></tr></thead>
            <tbody>${weekPromises.slice(0,10).map(p=>{
              const st = (p.status==='kept'||p.status==='partial') ? {c:'kept',l:'Kept'}
                       : p.status==='broken' ? {c:'broken',l:'Broken'}
                       : {c:'pending',l: p.promise_date===t ? 'Pending · Today' : 'Pending'};
              return `<tr>
                <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">${esc(p.client_name||'—')}</td>
                <td style="font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap">PKR ${fM(Number(p.promised_amount||0))}</td>
                <td class="db-tbl-mute" style="white-space:nowrap">${fD(p.promise_date)}</td>
                <td><span class="rd-pp-pill ${st.c}">${st.l}</span></td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`}
    </div>
  </div>

  <!-- ROW 4 — Recovery Quick Reports -->
  <div class="db-card" style="overflow:visible">
    <div class="db-card-ch">
      <div class="db-card-hl">
        <p class="db-card-title">${_rdI(_RDIC.file)} Recovery Quick Reports</p>
        <p class="db-card-sub">Run or export — no navigation needed</p>
      </div>
    </div>
    <div class="rd-qr-grid">
      ${_rdQuickReport('outstanding',    'Outstanding Report')}
      ${_rdQuickReport('aging',          'Aging Analysis')}
      ${_rdQuickReport('agent_recovery', 'Agent Recovery')}
      ${_rdQuickReport('field_visits',   'Field Visits')}
    </div>
  </div>

  <!-- ROW 5 — Recent Activity (50%) + AI Radar Alerts (50%) -->
  <div class="db-grid-r2">
    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_rdI(_RDIC.activity)} Recent Recovery Activity</p>
          <p class="db-card-sub">Last ${feed.length} action${feed.length!==1?'s':''}</p>
        </div>
      </div>
      ${!feed.length
        ? `<div class="db-empty"><span class="db-empty-ic">${_rdI(_RDIC.activity,24)}</span><p class="db-empty-tx">No recent activity</p></div>`
        : feed.map(a=>{
            const ic = a.kind==='pay'?_RDIC.money : a.kind==='promise'?_RDIC.hand : _RDIC.phone;
            const cl = a.kind==='pay'?'green' : a.kind==='promise'?'amber' : 'blue';
            const when = a.ts ? _rdAgo(a.ts) : '';
            return `<div class="rd-act-row">
              <div class="rd-act-ic ${cl}">${_rdI(ic,13)}</div>
              <div class="rd-act-body">
                <div class="rd-act-title">${esc(a.title)}</div>
                <div class="rd-act-sub">${esc(a.sub||'')}</div>
              </div>
              <div class="rd-act-when">${when}</div>
            </div>`;
          }).join('')}
    </div>

    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_rdI(_RDIC.radar)} AI Radar Alerts</p>
          <p class="db-card-sub">Top 5 likely to pay today</p>
        </div>
        <button class="db-btn" onclick="nav('radar')">Open Radar →</button>
      </div>
      ${!radarTop.length
        ? `<div class="db-empty"><span class="db-empty-ic">${_rdI(_RDIC.radar,24)}</span><p class="db-empty-tx">No clients scored for today</p></div>`
        : radarTop.map((c,i)=>{
            const sc=Math.round(c.final_score||0);
            const clr = sc>=80?'#16A34A' : sc>=60?'#2563EB' : sc>=40?'#D97706' : '#DC2626';
            return `<div class="rd-radar-row" onclick="nav('radar')">
              <div class="rd-radar-rank">${i+1}</div>
              <div class="rd-radar-body">
                <div class="rd-radar-name">${esc(c.client_name||'—')}</div>
                <div class="rd-radar-meta">${esc(c.unit_no||'—')}${c.overdue_amount?' · PKR '+fM(Number(c.overdue_amount)):''}</div>
              </div>
              <div class="rd-radar-score" style="color:${clr};border-color:${clr}33;background:${clr}14">${sc}</div>
            </div>`;
          }).join('')}
    </div>
  </div>

  </div>`;

  requestAnimationFrame(()=>_rdInitAging(ag));
}

// ── KPI card (matches dashboard .db-kpi compact layout) ──
function _rdKpi(accent, iconPath, label, valHtml, sub){
  return `<div class="db-kpi db-kpi-accent-${accent}">
    <div class="db-kpi-row">
      <div class="db-kpi-ic ${accent}">${_rdI(iconPath,14)}</div>
      <div class="db-kpi-body">
        <div class="db-kpi-lbl">${label}</div>
        <div class="db-kpi-val db-kpi-val-sm">${valHtml}</div>
        <div class="db-kpi-sub">${sub}</div>
      </div>
    </div>
  </div>`;
}

// ── Quick report card with Run + Excel ──
function _rdQuickReport(key, label){
  return `<div class="rd-qr-card">
    <div class="rd-qr-ic">${_rdI(_RDIC.file,15)}</div>
    <div class="rd-qr-name">${esc(label)}</div>
    <div class="rd-qr-acts">
      <button class="rd-qr-run" onclick="openRptViewer('${key}')">Run &#9654;</button>
      <button class="rd-qr-dl" onclick="_rhRunExcel('${key}')">Excel &#8595;</button>
    </div>
  </div>`;
}

// ── Relative-time label for the activity feed ──
function _rdAgo(ts){
  try {
    const diff = Date.now() - new Date(ts).getTime();
    if (isNaN(diff)) return '';
    const m=Math.floor(diff/60000), h=Math.floor(diff/3600000), d=Math.floor(diff/86400000);
    if (diff<60000) return 'now';
    if (m<60) return m+'m';
    if (h<24) return h+'h';
    if (d<7)  return d+'d';
    return fD(ts.slice(0,10));
  } catch { return ''; }
}

// ── Aging bucket bar chart ──
function _rdInitAging(ag){
  if (typeof Chart === 'undefined') return;
  const el = document.getElementById('rd-chart-aging');
  if (!el) return;
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const cs = getComputedStyle(document.documentElement);
  const tipBg=cs.getPropertyValue('--x-surface-2').trim()||(isDark?'#1e2230':'#F4F6FA');
  const tipTx=cs.getPropertyValue('--x-text').trim()||(isDark?'#F4F5F8':'#0F172A');
  const tipMut=cs.getPropertyValue('--x-text-3').trim()||(isDark?'#A0A4B5':'#6B7280');
  const tipBdr=cs.getPropertyValue('--x-border').trim()||(isDark?'rgba(255,255,255,.07)':'rgba(15,23,42,.07)');
  window._rdCI['aging'] = new Chart(el, {
    type:'bar',
    data:{
      labels:['0–30 days','31–60 days','61–90 days','90+ days'],
      datasets:[{ data:[ag.b1,ag.b2,ag.b3,ag.b4],
        backgroundColor:['#2563EB','#D97706','#EA580C','#DC2626'],
        borderRadius:4, borderSkipped:false, maxBarThickness:64 }]
    },
    options:{
      responsive:true, maintainAspectRatio:false, animation:{duration:600},
      plugins:{ legend:{display:false}, tooltip:{
        backgroundColor:tipBg, titleColor:tipMut, bodyColor:tipTx, borderColor:tipBdr,
        borderWidth:1, padding:10, cornerRadius:6, callbacks:{ label:ctx=>' PKR '+fM(ctx.raw) } } },
      scales:{
        x:{ grid:{display:false}, border:{display:false}, ticks:{ font:{family:'Inter',size:11}, color:tipMut } },
        y:{ display:false, grid:{display:false}, min:0 }
      }
    }
  });
}

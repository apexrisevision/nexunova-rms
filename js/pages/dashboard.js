// ══ DASHBOARD ══════════════════════════════════════════════
// Nexunova RMS v2.1 — Redesigned premium dashboard renderer
// Preserves all original logic, improves visual quality only
// ═══════════════════════════════════════════════════════════

function rDash(){
  const units=gunits(),recs=grecs(),t=td();
  const od=getOverdueDays();
  const soldUnits=units.filter(u=>u.status!=='Available'&&u.status!=='Dead');
  const totalU=units.length,soldU=soldUnits.length,availU=units.filter(u=>u.status==='Available').length;
  const totalR=recs.reduce((s,r)=>s+Number(r.amt),0);
  const outstand=soldUnits.reduce((s,u)=>s+actualPending(u),0);
  const totalPortfolio=soldUnits.reduce((s,u)=>s+Number(u.totalPrice||0),0);
  const overdueUnits=soldUnits.filter(u=>isOverdue(u,od)&&actualPending(u)>0).sort((a,b)=>actualPending(b)-actualPending(a));
  const fus=gfus();
  const ms=(()=>{const d=new Date();d.setDate(1);return d.toISOString().slice(0,10);})();
  const monthR=recs.filter(r=>r.date>=ms).reduce((s,r)=>s+Number(r.amt),0);
  const recovPct=totalPortfolio>0?Math.round(totalR/totalPortfolio*100):0;
  const pendingUnits=soldUnits.filter(u=>actualPending(u)>0).length;
  const fuAlerts=fus.overdue.length+fus.today.length;
  const pctColor=recovPct>=75?'var(--ok)':recovPct>=40?'var(--warn)':'var(--err)';

  // Recent 5 payments for activity feed
  const recentRecs=[...recs].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);

  document.getElementById('pg-dashboard').innerHTML=`<div class="ani">

  <!-- PRINT HEADER -->
  <div class="print-header"><h2 style="color:var(--ink)">Nexunova RMS — Dashboard — ${new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'})}</h2></div>

  <!-- ── PAGE HEADER ── -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:22px;gap:16px;flex-wrap:wrap">
    <div>
      <h2 style="font-family:var(--font-display);font-size:22px;font-weight:800;color:var(--text);letter-spacing:-0.6px;margin:0 0 3px">
        Good ${getGreeting()}, ${(S.name||'').split(' ')[0]} 👋
      </h2>
      <p style="font-size:12px;color:var(--t3);margin:0">
        ${new Date().toLocaleDateString('en-PK',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${S.coName}
      </p>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${fuAlerts>0?`<div onclick="nav('contacts')" style="display:flex;align-items:center;gap:6px;padding:7px 14px;background:var(--warn-bg);border:1px solid rgba(245,158,11,0.25);border-radius:99px;font-size:12px;font-weight:600;color:var(--warn);cursor:pointer">
        <span>📅</span> ${fuAlerts} Follow-up${fuAlerts!==1?'s':''} Due
      </div>`:''}
      ${overdueUnits.length>0?`<div onclick="nav('reports')" style="display:flex;align-items:center;gap:6px;padding:7px 14px;background:var(--err-bg);border:1px solid rgba(239,68,68,0.2);border-radius:99px;font-size:12px;font-weight:600;color:var(--err);cursor:pointer">
        <span>🚨</span> ${overdueUnits.length} Overdue
      </div>`:''}
    </div>
  </div>

  <!-- ── KPI CARDS ── -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:22px">

    ${kpiCard({
      accent:'var(--brand)',
      icon:'🏢',
      label:'Total Units',
      value:totalU,
      sub:`${soldU} sold &nbsp;·&nbsp; ${availU} available`,
      mono:true
    })}

    ${kpiCard({
      accent:'var(--ok)',
      icon:'💰',
      label:'Total Collected',
      value:fM(totalR),
      sub:`This month: <b>${fM(monthR)}</b>`,
      color:'var(--ok)'
    })}

    ${kpiCard({
      accent:'var(--err)',
      icon:'⏳',
      label:'Outstanding',
      value:fM(outstand),
      sub:`${pendingUnits} units with pending balance`,
      color:'var(--err)'
    })}

    ${kpiCard({
      accent:'var(--warn)',
      icon:'🔔',
      label:'Overdue Units',
      value:overdueUnits.length,
      sub:`${fuAlerts} follow-up${fuAlerts!==1?'s':''} pending`,
      color:overdueUnits.length>0?'var(--err)':'var(--ok)',
      mono:true,
      clickable:true,
      onclick:"nav('reports')"
    })}

  </div>

  <!-- ── RECOVERY PROGRESS ── -->
  <div class="progress-card" style="margin-bottom:22px">
    <div class="progress-card-info">
      <div class="progress-label">
        <span>📈 Overall Recovery Progress</span>
        <span style="font-size:10px;font-weight:600;padding:3px 9px;border-radius:99px;background:${recovPct>50?'var(--ok-bg)':'var(--warn-bg)'};color:${recovPct>50?'var(--ok)':'var(--warn)'}">
          ${recovPct>75?'On Track 🟢':recovPct>40?'In Progress 🟡':'Needs Attention 🔴'}
        </span>
      </div>
      <div class="progress-sub">${fM(totalR)} collected of ${fM(totalPortfolio)} total portfolio value</div>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width:${recovPct}%;background:linear-gradient(90deg,${pctColor},${recovPct>50?'#4ADE80':'#FCD34D'})"></div>
      </div>
    </div>
    <div class="progress-card-pct" style="color:${pctColor}">${recovPct}%</div>
  </div>

  <!-- ── QUICK ACTIONS ── -->
  <div style="margin-bottom:6px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--t4);margin-bottom:12px">Quick Actions</div>
    <div class="qa-grid">

      <div class="qa-card primary-qa" onclick="openRecModal(null)">
        <div class="qa-icon">💰</div>
        <div class="qa-title" style="color:white">Add Payment</div>
        <div class="qa-sub" style="color:rgba(255,255,255,0.65)">Record a recovery</div>
      </div>

      <div class="qa-card" onclick="openConModal(null)"
        style="--hover-accent:var(--info)">
        <div class="qa-icon">📞</div>
        <div class="qa-title" style="color:var(--text)">Log a Call</div>
        <div class="qa-sub" style="color:var(--t3)">Record contact</div>
      </div>

      <div class="qa-card" onclick="nav('search')">
        <div class="qa-icon">🔍</div>
        <div class="qa-title" style="color:var(--text)">Find a Unit</div>
        <div class="qa-sub" style="color:var(--t3)">Search &amp; view details</div>
      </div>

      <div class="qa-card dark-qa" onclick="nav('reports')">
        <div class="qa-icon">📊</div>
        <div class="qa-title" style="color:#fff">Reports &amp; Export</div>
        <div class="qa-sub" style="color:rgba(255,255,255,0.42)">Excel, Print, Analytics</div>
      </div>

    </div>
  </div>

  <!-- ── BOTTOM 2-COL ── -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:22px">

    <!-- OVERDUE UNITS -->
    <div class="card">
      <div class="ch" style="background:${overdueUnits.length?'rgba(239,68,68,0.03)':'var(--surface)'}">
        <div>
          <h3 style="color:${overdueUnits.length?'var(--err)':'var(--ok)'}">
            ${overdueUnits.length?'🚨':'✅'} Overdue — ${od}+ Days
            <span class="sec-badge${overdueUnits.length?'':' ok'}" style="margin-left:6px">${overdueUnits.length}</span>
          </h3>
          <p>Sorted by highest pending amount</p>
        </div>
        <button class="btn btn-gh btn-xs" onclick="nav('reports')">View All →</button>
      </div>

      <div style="padding:0">
        ${!overdueUnits.length
          ? '<div class="empty"><div class="ei">🎉</div><div class="et">All clear — no overdue units!</div></div>'
          : overdueUnits.slice(0,7).map((u,i)=>{
              const d2=daysSincePay(u);const sev=overdueSeverity(u);
              const clr=sev==='critical'?'var(--err)':'var(--warn)';
              const nm=esc(u.customerName||'').substring(0,20)+(u.customerName&&u.customerName.length>20?'…':'');
              return `<div style="display:flex;align-items:center;gap:12px;padding:11px 18px;border-bottom:1px solid var(--line2);cursor:pointer;transition:background 0.1s" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''" onclick="openUD('${u.id}')">
                <div style="width:4px;height:36px;border-radius:99px;background:${clr};flex-shrink:0"></div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)">${esc(u.unitNo)} <span style="color:var(--t3);font-weight:400">—</span> ${nm}</div>
                  <div style="font-size:11px;color:var(--t3);margin-top:2px">Pending: <span style="color:${clr};font-weight:700">${fM(actualPending(u))}</span></div>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <div style="font-size:11px;font-weight:700;color:${clr}">${d2===null?'Never paid':d2+'d ago'}</div>
                  <div style="font-size:10px;color:var(--t4);margin-top:2px">#${i+1}</div>
                </div>
              </div>`;
            }).join('')
        }
        ${overdueUnits.length>7?`<div style="padding:10px 18px;font-size:11px;color:var(--info);font-weight:600;cursor:pointer;text-align:center;border-top:1px solid var(--line2)" onclick="nav('reports')">+${overdueUnits.length-7} more units — Open Reports →</div>`:''}
      </div>
    </div>

    <!-- FOLLOW-UPS -->
    <div class="card">
      <div class="ch" style="background:${fuAlerts?'rgba(245,158,11,0.03)':'var(--surface)'}">
        <div>
          <h3 style="color:${fuAlerts?'var(--warn)':'var(--ok)'}">
            ${fuAlerts?'📅':'✅'} Follow-up Schedule
            <span class="sec-badge${fus.overdue.length?'':' ok'}" style="margin-left:6px">${fuAlerts}</span>
          </h3>
          <p>${fus.overdue.length} overdue · ${fus.today.length} due today</p>
        </div>
        <button class="btn btn-d btn-xs" onclick="openConModal(null)">+ Log Call</button>
      </div>

      <div style="padding:0">
        ${!fuAlerts
          ? '<div class="empty"><div class="ei">🎉</div><div class="et">No follow-ups due today!</div></div>'
          : [...fus.overdue.slice(0,4),...fus.today.slice(0,4)].map(c=>{
              const uu=gunit(c.uid);const isOv=c.fu<t;
              const dDiff=isOv?Math.ceil((new Date(t)-new Date(c.fu))/86400000):0;
              const clr=isOv?'var(--err)':'var(--warn)';
              return `<div style="display:flex;align-items:center;gap:12px;padding:11px 18px;border-bottom:1px solid var(--line2);cursor:pointer;transition:background 0.1s" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''" onclick="openUD('${c.uid}')">
                <div style="width:32px;height:32px;border-radius:8px;background:${isOv?'var(--err-bg)':'var(--warn-bg)'};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${ctic(c.type)}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12px;font-weight:700;color:var(--text)">${esc(uu?.unitNo||'?')} — ${esc((uu?.customerName||'?').substring(0,16))}</div>
                  <div style="font-size:11px;color:${clr};font-weight:600;margin-top:2px">${isOv?dDiff+'d overdue ⚠':'Due Today 📅'}</div>
                </div>
                <button class="btn btn-gh btn-xs" onclick="event.stopPropagation();openUD('${c.uid}')">View</button>
              </div>`;
            }).join('')
        }
        ${fuAlerts>8?`<div style="padding:10px 18px;font-size:11px;color:var(--info);font-weight:600;cursor:pointer;text-align:center;border-top:1px solid var(--line2)" onclick="nav('contacts')">View all in Call Logs →</div>`:''}
      </div>
    </div>
  </div>

  <!-- ── RECENT PAYMENTS ── -->
  ${recentRecs.length?`
  <div class="card">
    <div class="ch">
      <div>
        <h3>💳 Recent Payments</h3>
        <p>Last ${recentRecs.length} payment${recentRecs.length!==1?'s':''} recorded</p>
      </div>
      <button class="btn btn-gh btn-xs" onclick="nav('recovery')">All Payments →</button>
    </div>
    <div style="padding:0">
      ${recentRecs.map((r,i)=>{
        const u=gunit(r.uid);
        const isLast=i===recentRecs.length-1;
        return `<div style="display:flex;align-items:center;gap:14px;padding:11px 20px;${isLast?'':'border-bottom:1px solid var(--line2)'}transition:background 0.1s" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
          <div style="width:32px;height:32px;border-radius:8px;background:var(--ok-bg);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">
            ${r.type==='Bank'?'🏦':r.type==='Adjustment'?'📋':'💵'}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;color:var(--text)">${esc(u?.unitNo||r.uid)} — ${esc((u?.customerName||'—').substring(0,20))}</div>
            <div style="font-size:11px;color:var(--t3);margin-top:2px">${r.type} · ${r.date}</div>
          </div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:600;color:var(--ok);flex-shrink:0">+${fM(Number(r.amt))}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`:''}

  </div>`;
}

/* ── Helper: KPI card HTML ── */
function kpiCard({accent,icon,label,value,sub,color,mono,clickable,onclick}){
  return `<div class="kpi" style="--ka:${accent};--kc:${color||'var(--text)'};${clickable?'cursor:pointer':'cursor:default'}" ${clickable&&onclick?`onclick="${onclick}"`:''}
    onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='var(--sh2)'"
    onmouseout="this.style.transform='';this.style.boxShadow=''">
    <div class="kpi-lbl">
      <span class="kpi-lbl-dot"></span>${label}
    </div>
    <div class="kpi-val" style="${mono?'font-family:var(--font-display)':'font-family:var(--font-display)'}">${value}</div>
    <div class="kpi-sub">${sub}</div>
  </div>`;
}

/* ── Helper: Greeting based on hour ── */
function getGreeting(){
  const h=new Date().getHours();
  if(h<12)return 'morning';
  if(h<17)return 'afternoon';
  return 'evening';
}

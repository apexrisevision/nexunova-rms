// ══ DASHBOARD ═══════════════════════════════════════════════
// Nexunova RMS v2.2 — Operator-first redesign
// Simple 3-card KPI, clear overdue list, clean payments table
// ════════════════════════════════════════════════════════════

function rDash(){
  const units=gunits(),recs=grecs(),t=td();
  const od=getOverdueDays();
  const soldUnits=units.filter(u=>u.status!=='Available'&&u.status!=='Dead');
  const totalU=units.length,
        soldU=soldUnits.length,
        availU=units.filter(u=>u.status==='Available').length;

  const totalR=recs.reduce((s,r)=>s+Number(r.amt),0);
  const outstand=soldUnits.reduce((s,u)=>s+actualPending(u),0);
  const totalPortfolio=soldUnits.reduce((s,u)=>s+Number(u.totalPrice||0),0);
  const recovPct=totalPortfolio>0?Math.round(totalR/totalPortfolio*100):0;

  const overdueUnits=soldUnits
    .filter(u=>isOverdue(u,od)&&actualPending(u)>0)
    .sort((a,b)=>actualPending(b)-actualPending(a));

  const fus=gfus();
  const ms=(()=>{const d=new Date();d.setDate(1);return d.toISOString().slice(0,10);})();
  const monthR=recs.filter(r=>r.date>=ms).reduce((s,r)=>s+Number(r.amt),0);
  const fuAlerts=fus.overdue.length+fus.today.length;
  const pendingUnits=soldUnits.filter(u=>actualPending(u)>0).length;
  const pctColor=recovPct>=75?'var(--ok)':recovPct>=40?'var(--warn)':'var(--err)';

  const recentRecs=[...recs].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6);

  document.getElementById('pg-dashboard').innerHTML=`<div class="ani">

  <!-- ── PAGE HEADER ─────────────────────────── -->
  <div class="dash-header">
    <div>
      <h2 class="dash-greeting">Good ${getGreeting()}, ${(S.name||'').split(' ')[0]} 👋</h2>
      <p class="dash-date">${new Date().toLocaleDateString('en-PK',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} &nbsp;·&nbsp; ${S.coName}</p>
    </div>
    <div class="dash-alert-chips">
      ${fuAlerts>0?`<button class="dash-chip warn" onclick="nav('contacts')">📅 ${fuAlerts} Follow-up${fuAlerts!==1?'s':''} Due</button>`:''}
      ${overdueUnits.length>0?`<button class="dash-chip danger" onclick="nav('reports')">🚨 ${overdueUnits.length} Overdue</button>`:''}
    </div>
  </div>

  <!-- ── 3 BIG KPI CARDS ──────────────────────── -->
  <div class="dash-kpi-row">

    <div class="dash-kpi blue" onclick="nav('units')">
      <div class="dkpi-top">
        <span class="dkpi-icon">🏢</span>
        <span class="dkpi-trend">All</span>
      </div>
      <div class="dkpi-val">${totalU}</div>
      <div class="dkpi-lbl">Total Units</div>
    </div>

    <div class="dash-kpi green" onclick="nav('units')">
      <div class="dkpi-top">
        <span class="dkpi-icon">✅</span>
        <span class="dkpi-trend ok">${soldU > 0 ? Math.round(soldU/totalU*100)+'%' : '—'}</span>
      </div>
      <div class="dkpi-val">${soldU}</div>
      <div class="dkpi-lbl">Units Sold</div>
    </div>

    <div class="dash-kpi orange" onclick="nav('units')">
      <div class="dkpi-top">
        <span class="dkpi-icon">🔓</span>
        <span class="dkpi-trend warn">${availU} left</span>
      </div>
      <div class="dkpi-val">${availU}</div>
      <div class="dkpi-lbl">Available</div>
    </div>

  </div>

  <!-- ── FINANCIAL SUMMARY BAR ────────────────── -->
  <div class="dash-fin-bar">
    <div class="dash-fin-item">
      <span class="dash-fin-icon">💰</span>
      <div>
        <div class="dash-fin-lbl">Total Collected</div>
        <div class="dash-fin-val green">${fM(totalR)}</div>
      </div>
    </div>
    <div class="dash-fin-sep"></div>
    <div class="dash-fin-item">
      <span class="dash-fin-icon">⏳</span>
      <div>
        <div class="dash-fin-lbl">Outstanding</div>
        <div class="dash-fin-val red">${fM(outstand)}</div>
      </div>
    </div>
    <div class="dash-fin-sep"></div>
    <div class="dash-fin-item">
      <span class="dash-fin-icon">📅</span>
      <div>
        <div class="dash-fin-lbl">This Month</div>
        <div class="dash-fin-val blue">${fM(monthR)}</div>
      </div>
    </div>
    <div class="dash-fin-sep hide-xs"></div>
    <div class="dash-fin-item hide-xs">
      <span class="dash-fin-icon">📈</span>
      <div>
        <div class="dash-fin-lbl">Recovery Rate</div>
        <div class="dash-fin-val" style="color:${pctColor}">${recovPct}%</div>
      </div>
    </div>
  </div>

  <!-- ── QUICK ACTIONS ─────────────────────────── -->
  <div class="dash-section-hd">
    <span class="dash-section-lbl">⚡ Quick Actions</span>
  </div>
  <div class="dash-qa-row">
    <button class="dash-qa-btn green-qa" onclick="openRecModal(null)">
      <span class="dqa-icon">💰</span>
      <span class="dqa-text">Add Payment</span>
      <span class="dqa-sub">Record money received</span>
    </button>
    <button class="dash-qa-btn blue-qa" onclick="openConModal(null)">
      <span class="dqa-icon">📞</span>
      <span class="dqa-text">Log a Call</span>
      <span class="dqa-sub">Record a contact</span>
    </button>
    <button class="dash-qa-btn brand-qa" onclick="nav('search')">
      <span class="dqa-icon">🔍</span>
      <span class="dqa-text">Find a Unit</span>
      <span class="dqa-sub">Search all records</span>
    </button>
    <button class="dash-qa-btn dark-qa" onclick="nav('reports')">
      <span class="dqa-icon">📊</span>
      <span class="dqa-text">Reports</span>
      <span class="dqa-sub">Export &amp; analytics</span>
    </button>
  </div>

  <!-- ── 2-COL: OVERDUE + FOLLOW-UPS ──────────── -->
  <div class="dash-2col">

    <!-- OVERDUE UNITS -->
    <div class="card">
      <div class="ch" style="${overdueUnits.length?'background:rgba(239,68,68,0.025)':''}">
        <div>
          <h3 style="color:${overdueUnits.length?'var(--err)':'var(--ok)'}">
            ${overdueUnits.length?'🚨':'✅'}
            Overdue — ${od}+ Days
            <span class="sec-badge${overdueUnits.length?'':' ok'}" style="margin-left:6px">${overdueUnits.length}</span>
          </h3>
          <p>${overdueUnits.length?'By highest unpaid amount':'All units are up to date'}</p>
        </div>
        <button class="btn btn-gh btn-xs" onclick="nav('reports')">View All →</button>
      </div>
      <div>
        ${!overdueUnits.length
          ?'<div class="empty"><div class="ei">🎉</div><div class="et">All clear — no overdue units!</div></div>'
          :overdueUnits.slice(0,6).map((u,i)=>{
              const d2=daysSincePay(u);
              const sev=overdueSeverity(u);
              const clr=sev==='critical'?'var(--err)':'var(--warn)';
              const nm=(u.customerName||'').substring(0,18)+((u.customerName||'').length>18?'…':'');
              return `<div class="od-row" onclick="openUD('${u.id}')">
                <div class="od-severity-bar" style="background:${clr}"></div>
                <div class="od-rank">${i+1}</div>
                <div class="od-info">
                  <div class="od-name">${esc(u.unitNo)} <span class="od-sep">·</span> <span class="od-cust">${esc(nm)}</span></div>
                  <div class="od-days" style="color:${clr}">${d2===null?'⚠ Never paid':'⏱ '+d2+' days ago'}</div>
                </div>
                <div class="od-amount" style="color:${clr}">${fM(actualPending(u))}</div>
              </div>`;
            }).join('')
        }
        ${overdueUnits.length>6?`<div class="more-link" onclick="nav('reports')">+${overdueUnits.length-6} more units → Open Reports</div>`:''}
      </div>
    </div>

    <!-- FOLLOW-UP SCHEDULE -->
    <div class="card">
      <div class="ch" style="${fuAlerts?'background:rgba(245,158,11,0.025)':''}">
        <div>
          <h3 style="color:${fuAlerts?'var(--warn)':'var(--ok)'}">
            ${fuAlerts?'📅':'✅'}
            Follow-up Schedule
            <span class="sec-badge${fus.overdue.length?'':' ok'}" style="margin-left:6px">${fuAlerts}</span>
          </h3>
          <p>${fus.overdue.length} overdue &nbsp;·&nbsp; ${fus.today.length} due today</p>
        </div>
        <button class="btn btn-d btn-xs" onclick="openConModal(null)">+ Log Call</button>
      </div>
      <div>
        ${!fuAlerts
          ?'<div class="empty"><div class="ei">🎉</div><div class="et">No follow-ups due today!</div></div>'
          :[...fus.overdue.slice(0,4),...fus.today.slice(0,4)].map(c=>{
              const uu=gunit(c.uid);
              const isOv=c.fu<t;
              const dDiff=isOv?Math.ceil((new Date(t)-new Date(c.fu))/86400000):0;
              const clr=isOv?'var(--err)':'var(--warn)';
              return `<div class="od-row" onclick="openUD('${c.uid}')">
                <div class="fu-type-ic" style="background:${isOv?'var(--err-bg)':'var(--warn-bg)'}">
                  ${ctic(c.type)}
                </div>
                <div class="od-info">
                  <div class="od-name">${esc(uu?.unitNo||'?')} <span class="od-sep">·</span> <span class="od-cust">${esc((uu?.customerName||'?').substring(0,16))}</span></div>
                  <div class="od-days" style="color:${clr}">${isOv?'⚠ '+dDiff+'d overdue':'📅 Due Today'}</div>
                </div>
                <button class="btn btn-gh btn-xs" onclick="event.stopPropagation();openUD('${c.uid}')">View</button>
              </div>`;
            }).join('')
        }
        ${fuAlerts>8?`<div class="more-link" onclick="nav('contacts')">View all in Call Logs →</div>`:''}
      </div>
    </div>

  </div>

  <!-- ── RECENT PAYMENTS TABLE ─────────────────── -->
  ${recentRecs.length?`
  <div class="card dash-pay-card">
    <div class="ch">
      <div>
        <h3>💳 Recent Payments</h3>
        <p>Last ${recentRecs.length} payment${recentRecs.length!==1?'s':''} recorded</p>
      </div>
      <button class="btn btn-gh btn-xs" onclick="nav('recovery')">All Payments →</button>
    </div>
    <div class="pay-tbl-wrap">
      <table class="pay-tbl">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Customer</th>
            <th class="hide-sm">Type</th>
            <th class="hide-sm">Date</th>
            <th class="pay-tbl-amt">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${recentRecs.map(r=>{
            const u=gunit(r.uid);
            const ic=r.type==='Bank'?'🏦':r.type==='Adjustment'?'📋':'💵';
            return `<tr onclick="openUD('${r.uid}')" style="cursor:pointer">
              <td><span class="pay-unit-chip">${esc(u?.unitNo||r.uid)}</span></td>
              <td class="pay-cust-cell">${esc((u?.customerName||'—').substring(0,22))}</td>
              <td class="hide-sm"><span class="pay-type-pill">${ic} ${r.type}</span></td>
              <td class="hide-sm pay-date-cell">${r.date}</td>
              <td class="pay-amt-cell">+${fM(Number(r.amt))}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>`:''}

  </div>`; // end .ani
}

/* ── Legacy kpiCard helper (used by other pages) ── */
function kpiCard({accent,icon,label,value,sub,color,mono,clickable,onclick}){
  return `<div class="kpi" style="--ka:${accent};--kc:${color||'var(--text)'};${clickable?'cursor:pointer':'cursor:default'}" ${clickable&&onclick?`onclick="${onclick}"`:''}
    onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='var(--sh2)'"
    onmouseout="this.style.transform='';this.style.boxShadow=''">
    <div class="kpi-lbl"><span class="kpi-lbl-dot"></span>${label}</div>
    <div class="kpi-val">${value}</div>
    <div class="kpi-sub">${sub}</div>
  </div>`;
}

/* ── Greeting ── */
function getGreeting(){
  const h=new Date().getHours();
  if(h<12)return 'morning';
  if(h<17)return 'afternoon';
  return 'evening';
}

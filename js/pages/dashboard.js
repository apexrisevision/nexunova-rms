// ══ DASHBOARD ══════════════════════════════════
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

  document.getElementById('pg-dashboard').innerHTML=`<div class="ani">
  <div class="print-header"><h2 style="color:var(--ink)">Nexunova RMS — Dashboard — ${new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'})}</h2></div>

  <!-- KPI CARDS -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
    <div class="kpi" style="--ka:var(--brand)">
      <div class="kpi-lbl">🏢 Total Units</div>
      <div class="kpi-val">${totalU}</div>
      <div class="kpi-sub">${soldU} sold · ${availU} available</div>
    </div>
    <div class="kpi" style="--ka:var(--ok);--kc:var(--ok)">
      <div class="kpi-lbl">💰 Total Collected</div>
      <div class="kpi-val">${fM(totalR)}</div>
      <div class="kpi-sub">This month: <b>${fM(monthR)}</b></div>
    </div>
    <div class="kpi" style="--ka:var(--err);--kc:var(--err)">
      <div class="kpi-lbl">⏳ Outstanding</div>
      <div class="kpi-val">${fM(outstand)}</div>
      <div class="kpi-sub">${pendingUnits} units pending</div>
    </div>
    <div class="kpi" style="--ka:var(--warn);--kc:var(--warn);cursor:pointer" onclick="nav('reports')">
      <div class="kpi-lbl">🔔 Overdue Units</div>
      <div class="kpi-val">${overdueUnits.length}</div>
      <div class="kpi-sub">${fuAlerts} follow-up${fuAlerts!==1?'s':''} pending →</div>
    </div>
  </div>

  <!-- PROGRESS BAR -->
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px 22px;margin-bottom:20px;box-shadow:var(--sh)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div>
        <div style="font-size:13px;font-weight:700">📈 Overall Recovery Progress</div>
        <div style="font-size:11px;color:var(--t3);margin-top:2px">${fM(totalR)} collected of ${fM(totalPortfolio)} total</div>
      </div>
      <span style="font-family:var(--mono),monospace;font-size:28px;font-weight:700;color:${recovPct>50?'var(--ok)':'var(--warn)'}">${recovPct}%</span>
    </div>
    <div style="height:10px;background:#EEF0F5;border-radius:99px;overflow:hidden">
      <div style="height:100%;border-radius:99px;width:${recovPct}%;background:linear-gradient(90deg,var(--ok),#4ADE80);transition:width .4s ease"></div>
    </div>
  </div>

  <!-- QUICK ACTIONS -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
    <div onclick="openRecModal(null)" style="background:linear-gradient(135deg,var(--brand),#A8872E);border-radius:var(--r);padding:20px 16px;cursor:pointer;transition:all .15s;box-shadow:0 4px 14px rgba(201,168,76,.3)" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
      <div style="font-size:24px;margin-bottom:7px">💰</div>
      <div style="font-size:14px;font-weight:700;color:var(--ink)">Add Payment</div>
      <div style="font-size:11px;color:rgba(11,21,38,.6);margin-top:2px">Record a recovery</div>
    </div>
    <div onclick="openConModal(null)" style="background:var(--surface);border:1.5px solid var(--line);border-radius:var(--r);padding:20px 16px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='var(--brand)';this.style.boxShadow='var(--sh2)';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--line)';this.style.boxShadow='';this.style.transform=''">
      <div style="font-size:24px;margin-bottom:7px">📞</div>
      <div style="font-size:14px;font-weight:700;color:var(--text)">Log a Call</div>
      <div style="font-size:11px;color:var(--t3);margin-top:2px">Record contact</div>
    </div>
    <div onclick="nav('search')" style="background:var(--surface);border:1.5px solid var(--line);border-radius:var(--r);padding:20px 16px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='var(--brand)';this.style.boxShadow='var(--sh2)';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--line)';this.style.boxShadow='';this.style.transform=''">
      <div style="font-size:24px;margin-bottom:7px">🔍</div>
      <div style="font-size:14px;font-weight:700;color:var(--text)">Find a Unit</div>
      <div style="font-size:11px;color:var(--t3);margin-top:2px">Search &amp; view</div>
    </div>
    <div onclick="nav('reports')" style="background:var(--ink);border-radius:var(--r);padding:20px 16px;cursor:pointer;transition:all .15s;box-shadow:var(--sh)" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='var(--sh2)'" onmouseout="this.style.transform='';this.style.boxShadow='var(--sh)'">
      <div style="font-size:24px;margin-bottom:7px">📊</div>
      <div style="font-size:14px;font-weight:700;color:#fff">Reports &amp; Export</div>
      <div style="font-size:11px;color:rgba(255,255,255,.45);margin-top:2px">Excel, Print, Analytics</div>
    </div>
  </div>

  <!-- 2-COL: Overdue + Follow-ups -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
    <!-- OVERDUE -->
    <div class="card">
      <div class="ch" style="background:${overdueUnits.length?'rgba(220,38,38,.04)':'var(--surface)'}">
        <div>
          <h3 style="color:${overdueUnits.length?'var(--err)':'var(--ok)'}">${overdueUnits.length?'🚨':'✅'} Overdue — ${od}+ Days
            <span class="sec-badge${overdueUnits.length?'':' ok'}" style="margin-left:6px">${overdueUnits.length}</span>
          </h3>
          <p>Sorted by highest pending amount</p>
        </div>
        <button class="btn btn-gh btn-xs" onclick="nav('reports')">View All →</button>
      </div>
      <div style="padding:0">
        ${!overdueUnits.length
          ? '<div class="empty"><div class="ei">🎉</div><div class="et">All clear — no overdue units!</div></div>'
          : overdueUnits.slice(0,7).map(u=>{
              const d2=daysSincePay(u);const sev=overdueSeverity(u);
              const clr=sev==='critical'?'var(--err)':'var(--warn)';
              const nm=esc(u.customerName||'').substring(0,20)+(u.customerName&&u.customerName.length>20?'…':'');
              return `<div style="display:flex;align-items:center;gap:12px;padding:10px 18px;border-bottom:1px solid var(--line2);cursor:pointer" onclick="openUD('${u.id}')">
                <div style="width:8px;height:8px;border-radius:50%;background:${clr};flex-shrink:0"></div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.unitNo)} — ${nm}</div>
                  <div style="font-size:11px;color:var(--t3);margin-top:1px">Pending: <span style="color:${clr};font-weight:700">${fM(actualPending(u))}</span></div>
                </div>
                <div style="font-size:11px;font-weight:700;color:${clr};flex-shrink:0">${d2===null?'Never paid':d2+'d ago'}</div>
              </div>`;
            }).join('')
        }
        ${overdueUnits.length>7?`<div style="padding:10px 18px;font-size:11px;color:var(--info);font-weight:600;cursor:pointer;text-align:center" onclick="nav('reports')">+${overdueUnits.length-7} more — Open Reports</div>`:''}
      </div>
    </div>
    <!-- FOLLOW-UPS -->
    <div class="card">
      <div class="ch" style="background:${fuAlerts?'rgba(217,119,6,.04)':'var(--surface)'}">
        <div>
          <h3 style="color:${fuAlerts?'var(--warn)':'var(--ok)'}">${fuAlerts?'📅':'✅'} Follow-up Schedule
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
              return `<div style="display:flex;align-items:center;gap:12px;padding:10px 18px;border-bottom:1px solid var(--line2);cursor:pointer" onclick="openUD('${c.uid}')">
                <div style="font-size:18px;flex-shrink:0">${ctic(c.type)}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12px;font-weight:700">${esc(uu?.unitNo||'?')} — ${esc((uu?.customerName||'?').substring(0,16))}</div>
                  <div style="font-size:11px;color:${isOv?'var(--err)':'var(--warn)'};font-weight:600;margin-top:1px">${isOv?dDiff+'d overdue ⚠':'Due Today 📅'}</div>
                </div>
                <button class="btn btn-gh btn-xs" onclick="event.stopPropagation();openUD('${c.uid}')">View</button>
              </div>`;
            }).join('')
        }
        ${fuAlerts>8?`<div style="padding:10px 18px;font-size:11px;color:var(--info);font-weight:600;cursor:pointer;text-align:center" onclick="nav('contacts')">View all in Call Logs →</div>`:''}
      </div>
    </div>
  </div>
  </div>`;
}


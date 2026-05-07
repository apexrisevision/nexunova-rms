// ══ REPORTS PAGE ═════════════════════════════════
// Report types config
const RPT={
  unit:{ic:'🏢',lbl:'Units',sub:'All Units Report',subs:[{id:'all',lbl:'All Units'},{id:'sold',lbl:'Sold'},{id:'available',lbl:'Available'},{id:'overdue',lbl:'Overdue'},{id:'adjustment',lbl:'Adjustment'},{id:'cashsale',lbl:'Cash Sale'}]},
  client:{ic:'👤',lbl:'Clients',sub:'Client Reports',subs:[{id:'list',lbl:'Client List'},{id:'defaulters',lbl:'Defaulters'},{id:'ledger',lbl:'Client Ledger'}]},
  recovery:{ic:'💰',lbl:'Payments',sub:'Payment Reports',subs:[{id:'all',lbl:'All Payments'},{id:'daily',lbl:'Daily'},{id:'monthly',lbl:'Monthly'},{id:'bytype',lbl:'By Type'},{id:'bystaff',lbl:'By Staff'}]},
  staff:{ic:'👥',lbl:'Staff',sub:'Staff Reports',subs:[{id:'summary',lbl:'Summary'},{id:'payments',lbl:'Payments'},{id:'calls',lbl:'Calls'}]},
  contacts:{ic:'📞',lbl:'Call Logs',sub:'Contact Reports',subs:[{id:'all',lbl:'All Logs'},{id:'overdue',lbl:'Follow-up Overdue'},{id:'today',lbl:'Due Today'},{id:'upcoming',lbl:'Upcoming'},{id:'willpay',lbl:'Will Pay'}]},
  followup:{ic:'📅',lbl:'Follow-ups',sub:'Follow-up Schedule',subs:[{id:'all',lbl:'All'},{id:'overdue',lbl:'Overdue'},{id:'today',lbl:'Today'},{id:'upcoming',lbl:'Upcoming'}]},
  activity:{ic:'📋',lbl:'Daily Activity',sub:'Staff Activity Report',subs:[{id:'all',lbl:'All Staff'},{id:'bystaff',lbl:'By Staff'}]},
  aging:{ic:'⏰',lbl:'Aging Analysis',sub:'Overdue Bucket Report',subs:[{id:'all',lbl:'All Overdue'},{id:'30',lbl:'30+ Days'},{id:'60',lbl:'60+ Days'},{id:'90',lbl:'90+ Days'},{id:'180',lbl:'180+ Days'}]},
  statement:{ic:'📄',lbl:'Client Statement',sub:'Full Account Statement',subs:[{id:'unit',lbl:'By Unit'},{id:'client',lbl:'By Client Name'}]},
};

function rReports(){
  const keys=Object.keys(RPT);
  const pg=document.getElementById('pg-reports');
  pg.innerHTML=`<div class="ani">
  <div class="print-header"><h2 style="color:var(--ink)">Nexunova RMS — ${RPT[_rt]?.lbl||''} Report — ${new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'})}</h2></div>

  <!-- PAGE TITLE -->
  <div class="ph" style="margin-bottom:14px">
    <div class="ph-l"><h2>📊 Reports &amp; Analytics</h2><p>Select a report type, apply filters, then export or print</p></div>
  </div>

  <!-- REPORT TYPE BUTTONS -->
  <div class="rpt-types" id="rpt-type-row">
    ${keys.map(k=>`
    <div class="rpt-type-btn${_rt===k?' active':''}" onclick="setRT('${k}')">
      <span class="rbt-ic">${RPT[k].ic}</span>
      <div><div class="rbt-lb">${RPT[k].lbl}</div><div class="rbt-sub">${RPT[k].sub}</div></div>
    </div>`).join('')}
  </div>

  <!-- SUB-TYPE PILLS -->
  <div class="rpt-subs" id="rpt-sub-row">
    <span style="font-size:11px;font-weight:700;color:var(--t3);align-self:center;margin-right:6px">VIEW:</span>
    ${(RPT[_rt]?.subs||[]).map(s=>`<button class="rpt-sub-btn${_rs===s.id?' active':''}" onclick="setRS('${s.id}')">${s.lbl}</button>`).join('')}
  </div>

  <!-- FILTER + ACTION BAR — always-visible From/To -->
  <div class="rpt-actions" id="rpt-act-bar">
    <div class="fg">
      <label class="fl" style="font-size:10px">FROM DATE</label>
      <input class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px;outline:none;min-width:130px" type="date" id="r-fr">
    </div>
    <div class="fg">
      <label class="fl" style="font-size:10px">TO DATE</label>
      <input class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px;outline:none;min-width:130px" type="date" id="r-to">
    </div>
    <div class="fg">
      <label class="fl" style="font-size:10px">QUICK SELECT</label>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-gh btn-xs" onclick="setDatePreset('today')">Today</button>
        <button class="btn btn-gh btn-xs" onclick="setDatePreset('week')">This Week</button>
        <button class="btn btn-gh btn-xs" onclick="setDatePreset('month')">This Month</button>
        <button class="btn btn-gh btn-xs" onclick="setDatePreset('all')">All Time</button>
      </div>
    </div>
    <div class="rpt-action-btns no-p">
      <button class="btn btn-g btn-sm" onclick="runRpt()" style="min-width:80px">▶ Run</button>
      <button class="btn btn-gr btn-sm" onclick="expRptExcel()" style="gap:5px;min-width:130px"><span>📥</span> Export Excel</button>
      <button class="btn btn-d btn-sm" onclick="printRpt()" style="gap:5px;min-width:120px"><span>🖨</span> Print / PDF</button>
      <button class="btn btn-gh btn-sm" onclick="expRpt()" title="Export as CSV"><span>↓</span> CSV</button>
    </div>
  </div>

  <!-- REPORT OUTPUT -->
  <div id="r-ct"></div>
  </div>`;

  runRpt();
}
function setRT(t){_rt=t;_rs=(RPT[t]?.subs?.[0]?.id)||'all';rReports();}
function setRS(s){_rs=s;runRpt();
  document.querySelectorAll('.rpt-sub-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector(`.rpt-sub-btn[onclick="setRS('${s}')"]`)?.classList.add('active');
}
function getDF(){
  const fr=document.getElementById('r-fr')?.value||'';
  const to=document.getElementById('r-to')?.value||'';
  return{fr,to};
}
function setDatePreset(preset){
  const t=td();
  const frEl=document.getElementById('r-fr');
  const toEl=document.getElementById('r-to');
  if(!frEl||!toEl)return;
  if(preset==='today'){frEl.value=t;toEl.value=t;}
  else if(preset==='week'){const d=new Date();d.setDate(d.getDate()-d.getDay());frEl.value=d.toISOString().slice(0,10);toEl.value=t;}
  else if(preset==='month'){const d=new Date();d.setDate(1);frEl.value=d.toISOString().slice(0,10);toEl.value=t;}
  else{frEl.value='';toEl.value='';}
  runRpt();
}

// ── REPORT SUMMARY BANNER ──
function rptBanner(items){
  const df=getDF();
  let drTxt='All Time';
  if(df.fr&&df.to&&df.fr===df.to)drTxt='Date: '+fD(df.fr);
  else if(df.fr&&df.to)drTxt=fD(df.fr)+' → '+fD(df.to);
  else if(df.fr)drTxt='From '+fD(df.fr);
  else if(df.to)drTxt='Until '+fD(df.to);
  const drHtml=`<span style="color:var(--t3);font-size:11px">📅 <b>${drTxt}</b></span><span style="color:var(--t4)">·</span>`;
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;padding:10px 16px;background:var(--canvas);border-radius:var(--rm);margin-bottom:10px;font-size:12px;align-items:center">
    ${drHtml}${items.map(i=>`<span style="color:${i.c||'var(--text)'}">${i.ic||''} <b>${i.v}</b> ${i.l}</span>`).join('<span style="color:var(--t4)">·</span>')}
  </div>`;
}

function runRpt(){
  const ct=document.getElementById('r-ct');if(!ct)return;
  const df=getDF();let html='';

  // ── UNITS ──
  if(_rt==='unit'){
    let u=gunits();
    if(_rs==='sold')u=u.filter(x=>x.status!=='Available'&&x.status!=='Dead');
    else if(_rs==='available')u=u.filter(x=>x.status==='Available');
    else if(_rs==='adjustment')u=u.filter(x=>x.status==='Adjustment');
    else if(_rs==='cashsale')u=u.filter(x=>x.status==='CashSale');
    else if(_rs==='overdue'){const od=getOverdueDays();u=u.filter(x=>isOverdue(x,od)&&actualPending(x)>0).sort((a,b)=>actualPending(b)-actualPending(a));}
    const tPd=u.reduce((s,x)=>s+actualPaid(x),0);
    const tPn=u.reduce((s,x)=>s+actualPending(x),0);
    html=rptBanner([
      {ic:'🏢',v:u.length,l:'units',c:'var(--text)'},
      {ic:'💚',v:fM(tPd),l:'collected',c:'var(--ok)'},
      {ic:'🔴',v:fM(tPn),l:'pending',c:'var(--err)'}
    ])+`<div class="card"><div class="tw"><table class="t">
    <thead><tr><th>Unit</th><th>Floor</th><th>Type</th><th>Area</th><th>Status</th><th>Client</th><th>Phone</th><th>Booking</th><th>Total Price</th><th>Paid</th><th>Pending</th><th>Recovery</th><th>Last Pay</th><th>Sold By</th><th>Remarks</th></tr></thead>
    <tbody>${u.map(x=>{const pd=actualPaid(x),rm=actualPending(x),p2=pct(pd,x.totalPrice),d=daysSincePay(x);
      return `<tr class="cr" onclick="openUD('${x.id}')">
        <td style="font-weight:700">${esc(x.unitNo)}</td>
        <td style="font-size:11px">${x.floorLabel||x.floor}</td>
        <td style="font-size:11px">${x.type}</td>
        <td style="font-size:11px">${x.area}</td>
        <td>${sbadge(x.status)}</td>
        <td style="font-weight:600">${esc(x.customerName)||'<span style="color:var(--t3)">—</span>'}</td>
        <td style="font-size:11px;color:var(--t3)">${esc(x.phone)||'—'}</td>
        <td style="font-size:11px;color:var(--t3)">${esc(x.bookingNo)||'—'}</td>
        <td class="mono">${x.totalPrice?fM(x.totalPrice):'—'}</td>
        <td class="mono c-g">${x.totalPrice?fM(pd):'—'}</td>
        <td class="mono" style="color:${rm>0?'var(--err)':'var(--ok)'};font-weight:${rm===0?700:400}">${x.totalPrice?(rm===0?'✅ Paid':fM(rm)):'—'}</td>
        <td><div style="display:flex;align-items:center;gap:5px"><div style="width:40px;height:4px;background:#EEF0F5;border-radius:2px;overflow:hidden"><div style="height:100%;width:${p2}%;background:var(--ok);border-radius:2px"></div></div><span style="font-size:10px;color:var(--t3)">${p2}%</span></div></td>
        <td style="font-size:11px;color:${d!==null&&d>30?'var(--err)':'var(--t3)'}">${d!==null?d+'d ago':'Never'}</td>
        <td style="font-size:11px;color:var(--t3)">${esc(x.soldBy)||'—'}</td>
        <td style="font-size:11px;color:var(--t3);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.remarks)}">${esc(x.remarks)||'—'}</td>
      </tr>`;}).join('')}</tbody></table></div></div>`;

  // ── CLIENTS ──
  } else if(_rt==='client'){
    let u=gunits().filter(x=>x.customerName);
    if(_rs==='defaulters')u=u.filter(x=>actualPending(x)>0).sort((a,b)=>actualPending(b)-actualPending(a));
    if(_rs==='ledger'){
      const cl={};u.forEach(x=>{const k=x.customerName;if(!cl[k])cl[k]={units:[],phone:x.phone};cl[k].units.push(x);});
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>#</th><th>Client Name</th><th>Phone</th><th>Units</th><th>Total Value</th><th>Paid</th><th class="r">Pending</th><th>Recovery</th></tr></thead>
      <tbody>${Object.entries(cl).sort((a,b)=>a[0].localeCompare(b[0])).map(([nm,d],i)=>{
        const tv=d.units.reduce((s,x)=>s+Number(x.totalPrice||0),0);
        const tp=d.units.reduce((s,x)=>s+actualPaid(x),0);
        const rm=d.units.reduce((s,x)=>s+actualPending(x),0);
        const p2=pct(tp,tv);
        return `<tr><td style="font-size:11px;color:var(--t3)">${i+1}</td><td><b>${esc(nm)}</b></td><td style="font-size:11px">${esc(d.phone)||'—'}</td><td>${d.units.length}</td><td class="mono">${fM(tv)}</td><td class="mono c-g">${fM(tp)}</td><td class="r mono" style="color:${rm>0?'var(--err)':'var(--ok)'}">${fM(rm)}</td><td><div style="display:flex;align-items:center;gap:5px"><div style="width:40px;height:4px;background:#EEF0F5;border-radius:2px;overflow:hidden"><div style="height:100%;width:${p2}%;background:var(--ok);border-radius:2px"></div></div><span style="font-size:10px;color:var(--t3)">${p2}%</span></div></td></tr>`;
      }).join('')}</tbody></table></div></div>`;
    } else {
      html=rptBanner([{ic:'👤',v:u.length,l:'clients'},{ic:'💚',v:fM(u.reduce((s,x)=>s+actualPaid(x),0)),l:'paid',c:'var(--ok)'},{ic:'🔴',v:fM(u.reduce((s,x)=>s+actualPending(x),0)),l:'pending',c:'var(--err)'}])+`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Unit</th><th>Floor</th><th>Client</th><th>Phone</th><th>Booking</th><th>Sale Type</th><th>Sold By</th><th>Last Pay</th><th>Remarks</th><th>Paid</th><th class="r">Pending</th></tr></thead>
      <tbody>${u.map(x=>{const pd=actualPaid(x),rm=actualPending(x),d=daysSincePay(x);
        return `<tr class="cr" onclick="openUD('${x.id}')"><td style="font-weight:700">${esc(x.unitNo)}</td><td style="font-size:11px">${x.floorLabel||x.floor}</td><td><b>${esc(x.customerName)}</b></td><td style="font-size:11px">${esc(x.phone)||'—'}</td><td style="font-size:11px">${esc(x.bookingNo)||'—'}</td><td>${sbadge(x.status)}</td><td style="font-size:11px">${esc(x.soldBy)||'—'}</td><td style="font-size:11px;color:${d!==null&&d>30?'var(--err)':'var(--t3)'}">${d!==null?d+'d ago':'—'}</td><td style="font-size:11px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.remarks)||'—'}</td><td class="mono c-g">${fM(pd)}</td><td class="r mono" style="color:${rm>0?'var(--err)':'var(--ok)'}">${fM(rm)}</td></tr>`;
      }).join('')}</tbody></table></div></div>`;
    }

  // ── PAYMENTS / RECOVERY ──
  } else if(_rt==='recovery'){
    let recs=grecs();
    if(df.fr)recs=recs.filter(r=>r.date>=df.fr);if(df.to)recs=recs.filter(r=>r.date<=df.to);
    if(_rs==='daily'){
      const gp={};recs.forEach(r=>{const d=r.date;if(!gp[d])gp[d]={n:0,t:0};gp[d].n++;gp[d].t+=Number(r.amt);});
      const days=Object.keys(gp).sort().reverse();
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Date</th><th class="r">Payments</th><th class="r">Total Collected</th></tr></thead>
      <tbody>${days.map(d=>`<tr><td><b>${fD(d)}</b></td><td class="r">${gp[d].n}</td><td class="r mono c-g" style="font-weight:700">${fM(gp[d].t)}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else if(_rs==='monthly'){
      const gp={};recs.forEach(r=>{const m=r.date.slice(0,7);if(!gp[m])gp[m]={n:0,t:0};gp[m].n++;gp[m].t+=Number(r.amt);});
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Month</th><th class="r">Payments</th><th class="r">Total Collected</th></tr></thead>
      <tbody>${Object.keys(gp).sort().reverse().map(m=>`<tr><td><b>${m}</b></td><td class="r">${gp[m].n}</td><td class="r mono c-g">${fM(gp[m].t)}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else if(_rs==='bytype'){
      const types=['Cash','Bank','Adjustment'];
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Payment Type</th><th class="r">Count</th><th class="r">Total (PKR)</th></tr></thead>
      <tbody>${types.map(tp=>{const tr=recs.filter(r=>r.ptype===tp);const t=tr.reduce((s,r)=>s+Number(r.amt),0);return tr.length?`<tr><td>${pbadge(tp)}</td><td class="r">${tr.length}</td><td class="r mono c-g" style="font-weight:700">${fM(t)}</td></tr>`:''}).join('')}</tbody></table></div></div>`;
    } else if(_rs==='bystaff'){
      const um={};recs.forEach(r=>{if(!um[r.by])um[r.by]={n:0,t:0};um[r.by].n++;um[r.by].t+=Number(r.amt);});
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Staff Member</th><th class="r">Payments</th><th class="r">Total Collected</th></tr></thead>
      <tbody>${Object.entries(um).sort((a,b)=>b[1].t-a[1].t).map(([id,d])=>`<tr><td><b>${gunm(id)}</b></td><td class="r">${d.n}</td><td class="r mono c-g" style="font-weight:700">${fM(d.t)}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else {
      recs.sort((a,b)=>b.date.localeCompare(a.date));const tot=recs.reduce((s,r)=>s+Number(r.amt),0);
      const cash=recs.filter(r=>r.ptype==='Cash').reduce((s,r)=>s+Number(r.amt),0);
      const bank=recs.filter(r=>r.ptype==='Bank').reduce((s,r)=>s+Number(r.amt),0);
      html=rptBanner([{ic:'💳',v:recs.length,l:'payments'},{ic:'💚',v:fM(tot),l:'total',c:'var(--ok)'},{ic:'💵',v:fM(cash),l:'cash'},{ic:'🏦',v:fM(bank),l:'bank'}])+`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Date</th><th>Unit</th><th>Client</th><th>Floor</th><th>Type</th><th>Payment Type</th><th>Receipt</th><th>Notes</th><th>By</th><th class="r">Amount</th>${S.role==='admin'?'<th></th>':''}</tr></thead>
      <tbody>${recs.map(r=>{const u=gunit(r.uid);return `<tr class="cr" onclick="openUD('${r.uid}')"><td>${fD(r.date)}</td><td style="font-weight:700">${esc(u?.unitNo||'?')}</td><td>${esc(u?.customerName||'—')}</td><td style="font-size:11px">${u?.floorLabel||''}</td><td style="font-size:11px">${u?.type||''}</td><td>${pbadge(r.ptype)}</td><td style="font-size:11px;color:var(--t3)">${r.rcpt||'—'}</td><td style="font-size:11px;color:var(--t3);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.notes||'—'}</td><td style="font-size:11px;color:var(--t3)">${gunm(r.by)}</td><td class="r mono c-g" style="font-weight:700">+${fM(r.amt)}</td>${S.role==='admin'?`<td><button class="btn btn-r btn-xs" onclick="event.stopPropagation();delRec('${r.id}')">Del</button></td>`:''}</tr>`;}).join('')}</tbody></table></div></div>`;
    }

  // ── STAFF ──
  } else if(_rt==='staff'){
    const db2=gdb();const users=db2.users.filter(u=>u.companyIds.includes(S.cid));
    const recs=grecs();const cons=gcons();
    if(_rs==='payments'){
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Staff Member</th><th>Role</th><th class="r">Payments</th><th class="r">💵 Cash</th><th class="r">🏦 Bank</th><th class="r">⚖ Adj</th><th class="r">Total</th></tr></thead>
      <tbody>${users.map(usr=>{const ur=recs.filter(r=>r.by===usr.id);const tot=ur.reduce((s,r)=>s+Number(r.amt),0);const cash=ur.filter(r=>r.ptype==='Cash').reduce((s,r)=>s+Number(r.amt),0);const bank=ur.filter(r=>r.ptype==='Bank').reduce((s,r)=>s+Number(r.amt),0);const adj=ur.filter(r=>r.ptype==='Adjustment').reduce((s,r)=>s+Number(r.amt),0);return ur.length?`<tr><td><b>${esc(usr.name)}</b></td><td style="font-size:11px">${usr.role}</td><td class="r">${ur.length}</td><td class="r mono">${cash?fM(cash):'—'}</td><td class="r mono">${bank?fM(bank):'—'}</td><td class="r mono">${adj?fM(adj):'—'}</td><td class="r mono c-g" style="font-weight:700">${fM(tot)}</td></tr>`:''}).join('')}</tbody></table></div></div>`;
    } else if(_rs==='calls'){
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Staff</th><th class="r">Total</th><th class="r">📞 Calls</th><th class="r">💬 WA</th><th class="r">🤝 Meeting</th><th class="r">✅ Will Pay</th><th class="r">❌ No Resp</th></tr></thead>
      <tbody>${users.map(usr=>{const uc=cons.filter(c=>c.by===usr.id);return uc.length?`<tr><td><b>${esc(usr.name)}</b></td><td class="r" style="font-weight:700">${uc.length}</td><td class="r">${uc.filter(c=>c.type==='Call').length||'—'}</td><td class="r">${uc.filter(c=>c.type==='WhatsApp').length||'—'}</td><td class="r">${uc.filter(c=>c.type==='Meeting').length||'—'}</td><td class="r" style="color:var(--ok)">${uc.filter(c=>c.status==='WillPay').length||'—'}</td><td class="r" style="color:var(--err)">${uc.filter(c=>c.status==='NoResponse').length||'—'}</td></tr>`:''}).join('')}</tbody></table></div></div>`;
    } else {
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Staff</th><th>Role</th><th class="r">Payments</th><th class="r">Collected</th><th class="r">Calls</th><th class="r">Will Pay</th><th class="r">No Response</th></tr></thead>
      <tbody>${users.map(usr=>{const ur=recs.filter(r=>r.by===usr.id);const uc=cons.filter(c=>c.by===usr.id);const tot=ur.reduce((s,r)=>s+Number(r.amt),0);return `<tr><td><b>${esc(usr.name)}</b></td><td style="font-size:11px">${usr.role==='admin'?'<span class="badge bj">Admin</span>':'<span class="badge bi">Staff</span>'}</td><td class="r">${ur.length||'—'}</td><td class="r mono c-g">${tot?fM(tot):'—'}</td><td class="r">${uc.length||'—'}</td><td class="r" style="color:var(--ok)">${uc.filter(c=>c.status==='WillPay').length||'—'}</td><td class="r" style="color:var(--err)">${uc.filter(c=>c.status==='NoResponse').length||'—'}</td></tr>`;}).join('')}</tbody></table></div></div>`;
    }

  // ── CONTACT LOGS / COMMENTS ──
  } else if(_rt==='contacts'){
    const t=td();let cons=gcons().sort((a,b)=>b.at.localeCompare(a.at));
    if(_rs==='overdue')cons=cons.filter(c=>c.fu&&c.fu<t).sort((a,b)=>a.fu.localeCompare(b.fu));
    else if(_rs==='today')cons=cons.filter(c=>c.fu===t);
    else if(_rs==='upcoming')cons=cons.filter(c=>c.fu&&c.fu>t).sort((a,b)=>a.fu.localeCompare(b.fu));
    else if(_rs==='willpay')cons=cons.filter(c=>c.status==='WillPay');
    html=rptBanner([{ic:'📞',v:cons.length,l:'logs'},{ic:'✅',v:cons.filter(c=>c.status==='WillPay').length,l:'will pay',c:'var(--ok)'},{ic:'⚠',v:cons.filter(c=>c.fu&&c.fu<t).length,l:'follow-up overdue',c:'var(--err)'}])+`<div class="card"><div class="tw"><table class="t">
    <thead><tr><th>Date</th><th>Unit</th><th>Client</th><th>Phone</th><th>Type</th><th>Response</th><th>Notes / What Client Said</th><th>Follow-up</th><th>Logged By</th></tr></thead>
    <tbody>${cons.map(c=>{const u=gunit(c.uid);const fuOv=c.fu&&c.fu<t;const fuTdy=c.fu===t;
      return `<tr class="cr" onclick="openUD('${c.uid}')">
        <td style="white-space:nowrap">${fD(c.date)}</td>
        <td style="font-weight:700">${esc(u?.unitNo||'?')}</td>
        <td>${esc(u?.customerName||'—')}</td>
        <td style="font-size:11px">${esc(u?.phone||'—')}</td>
        <td>${ctic(c.type)} ${c.type}</td>
        <td>${cbadge(c.status)}</td>
        <td style="font-size:11px;color:var(--t2);max-width:200px;word-break:break-word">${esc(c.notes||'—')}</td>
        <td style="font-size:11px;color:${fuOv?'var(--err)':fuTdy?'var(--warn)':'var(--t3)'};font-weight:${fuOv||fuTdy?700:400};white-space:nowrap">${c.fu?fD(c.fu)+(fuOv?' ⚠':fuTdy?' 📅':''):'—'}</td>
        <td style="font-size:11px;color:var(--t3)">${gunm(c.by)}</td>
      </tr>`;}).join('')}</tbody></table></div></div>`;

  // ── FOLLOW-UPS ──
  } else if(_rt==='followup'){
    const t=td();const allCons=gcons().filter(c=>c.fu);
    let cons=allCons;
    if(_rs==='overdue')cons=allCons.filter(c=>c.fu<t).sort((a,b)=>a.fu.localeCompare(b.fu));
    else if(_rs==='today')cons=allCons.filter(c=>c.fu===t);
    else if(_rs==='upcoming')cons=allCons.filter(c=>c.fu>t).sort((a,b)=>a.fu.localeCompare(b.fu));
    html=rptBanner([{ic:'📅',v:cons.length,l:'follow-ups'},{ic:'🔴',v:allCons.filter(c=>c.fu<t).length,l:'overdue',c:'var(--err)'},{ic:'📅',v:allCons.filter(c=>c.fu===t).length,l:'today',c:'var(--warn)'}])+`<div class="card"><div class="tw"><table class="t">
    <thead><tr><th>Unit</th><th>Customer</th><th>Phone</th><th>Type</th><th>Response</th><th>Follow-up Date</th><th>Notes</th><th>Logged By</th></tr></thead>
    <tbody>${cons.map(c=>{const u=gunit(c.uid);const isOv=c.fu<t;const isTo=c.fu===t;
      return `<tr class="cr" onclick="openUD('${c.uid}')"><td style="font-weight:700">${esc(u?.unitNo||'?')}</td><td><b>${esc(u?.customerName||'—')}</b></td><td style="font-size:11px">${esc(u?.phone||'—')}</td><td>${ctic(c.type)} ${c.type}</td><td>${cbadge(c.status)}</td><td style="color:${isOv?'var(--err)':isTo?'var(--warn)':'var(--t3)'};font-weight:${isOv||isTo?700:400}">${fD(c.fu)}${isOv?' ⚠':isTo?' 📅':''}</td><td style="font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.notes||'—')}</td><td style="font-size:11px;color:var(--t3)">${gunm(c.by)}</td></tr>`;}).join('')}</tbody></table></div></div>`;

  // ══ DAILY ACTIVITY REPORT ══════════════════════════════════
  } else if(_rt==='activity'){
    var t2=td();
    var actCons=gcons().sort(function(a,b){return b.date.localeCompare(a.date)||b.at.localeCompare(a.at);});
    if(df.fr)actCons=actCons.filter(function(c){return c.date>=df.fr;});
    if(df.to)actCons=actCons.filter(function(c){return c.date<=df.to;});
    var actStaffVal=ssVal('act-staff-sel');
    if(actStaffVal&&actStaffVal!=='all')actCons=actCons.filter(function(c){return c.by===actStaffVal;});
    if(!actCons.length){
      html='<div class="empty"><div class="ei">📋</div><div class="et">No activity found</div><div class="es">Try a different date range or staff filter</div></div>';
    } else {
      var actByDate={};
      actCons.forEach(function(c){if(!actByDate[c.date])actByDate[c.date]=[];actByDate[c.date].push(c);});
      var actDates=Object.keys(actByDate).sort().reverse();
      var actTot=actCons.length;
      var actWP=actCons.filter(function(c){return c.status==='WillPay';}).length;
      var actNR=actCons.filter(function(c){return c.status==='NoResponse';}).length;
      html=rptBanner([{ic:'📋',v:actTot,l:'total calls'},{ic:'✅',v:actWP,l:'will pay',c:'var(--ok)'},{ic:'❌',v:actNR,l:'no response',c:'var(--err)'},{ic:'📅',v:actDates.length,l:'days'}]);
      var db4=gdb();
      html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">';
      html+='<label style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Filter Staff:</label>';
      html+='<div id="act-staff-wrap" style="min-width:160px"></div>';
      html+='<button class="btn btn-g btn-sm" onclick="runRpt()">Apply</button></div>';
      actDates.forEach(function(date){
        var dl=actByDate[date];
        var dn=new Date(date+'T00:00:00').toLocaleDateString('en-PK',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
        var dwp=dl.filter(function(c){return c.status==='WillPay';}).length;
        var dnr=dl.filter(function(c){return c.status==='NoResponse';}).length;
        html+='<div style="margin-bottom:20px">';
        html+='<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:linear-gradient(135deg,var(--ink),#1E2D47);border-radius:var(--r) 12px 0 0;color:#fff">';
        html+='<span style="font-size:16px">📅</span>';
        html+='<div><div style="font-size:14px;font-weight:700">'+dn+'</div>';
        html+='<div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:2px">'+dl.length+' call'+(dl.length!==1?'s':'')+' &nbsp;·&nbsp; ✅ '+dwp+' will pay &nbsp;·&nbsp; ❌ '+dnr+' no response</div></div></div>';
        html+='<div class="card" style="border-radius:0 0 12px 12px;border-top:none"><div class="tw"><table class="t">';
        html+='<thead><tr><th>Staff</th><th>Unit</th><th>Client</th><th>Phone</th><th>Type</th><th>Response</th><th>Notes / What Client Said</th><th>Follow-up</th></tr></thead><tbody>';
        dl.forEach(function(c){
          var u=gunit(c.uid);
          var fuOv=c.fu&&c.fu<t2;
          var fuTdy=c.fu&&c.fu===t2;
          var rowClr=c.status==='WillPay'?'var(--ok)':c.status==='Dispute'?'var(--err)':c.status==='NoResponse'?'#CBD5E1':'var(--info)';
          html+='<tr style="border-left:3px solid '+rowClr+'">';
          html+='<td style="font-size:12px;font-weight:600;white-space:nowrap">'+gunm(c.by)+'</td>';
          html+='<td style="font-family:\'DM Mono\',monospace;font-size:12px;font-weight:700;cursor:pointer;color:var(--info)" onclick="openUD(\''+c.uid+'\')">'+esc(u?u.unitNo:'?')+'</td>';
          html+='<td style="font-size:12px">'+esc(u&&u.customerName?u.customerName:'—')+'</td>';
          html+='<td style="font-size:11px;color:var(--t3)">'+esc(u&&u.phone?u.phone:'—')+'</td>';
          html+='<td>'+ctic(c.type)+' <span style="font-size:11px">'+c.type+'</span></td>';
          html+='<td>'+cbadge(c.status)+'</td>';
          html+='<td style="font-size:12px;color:var(--t2);max-width:260px;word-break:break-word">'+(c.notes?esc(c.notes):'<i style="color:var(--t4)">No notes</i>')+'</td>';
          html+='<td style="font-size:11px;color:'+(fuOv?'var(--err)':fuTdy?'var(--warn)':'var(--t3)')+';font-weight:'+(fuOv||fuTdy?700:400)+'">'+(c.fu?fD(c.fu)+(fuOv?' ⚠':fuTdy?' 📅':''):'—')+'</td>';
          html+='</tr>';
        });
        html+='</tbody></table></div></div></div>';
      });
    }


  // ══ AGING ANALYSIS ══════════════════════════════════════════
  } else if(_rt==='aging'){
    const od=getOverdueDays();
    let ov=gunits().filter(function(u){return u.status!=='Available'&&u.status!=='Dead'&&actualPending(u)>0;});
    const minDays={'all':0,'30':30,'60':60,'90':90,'180':180}[_rs]||0;
    ov=ov.filter(function(u){var d=daysSincePay(u);return d===null||d>=minDays;}).sort(function(a,b){return actualPending(b)-actualPending(a);});
    var b0=ov.filter(function(u){var d=daysSincePay(u);return d!==null&&d<30;});
    var b30=ov.filter(function(u){var d=daysSincePay(u);return d!==null&&d>=30&&d<60;});
    var b60=ov.filter(function(u){var d=daysSincePay(u);return d!==null&&d>=60&&d<90;});
    var b90=ov.filter(function(u){var d=daysSincePay(u);return d!==null&&d>=90&&d<180;});
    var b180=ov.filter(function(u){var d=daysSincePay(u);return d===null||d>=180;});
    var tot0=b0.reduce(function(s,u){return s+actualPending(u);},0);
    var tot30=b30.reduce(function(s,u){return s+actualPending(u);},0);
    var tot60=b60.reduce(function(s,u){return s+actualPending(u);},0);
    var tot90=b90.reduce(function(s,u){return s+actualPending(u);},0);
    var tot180=b180.reduce(function(s,u){return s+actualPending(u);},0);
    var totAll=ov.reduce(function(s,u){return s+actualPending(u);},0);
    html='<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px">';
    var buckets=[
      {lbl:'0–30 Days',n:b0.length,t:tot0,c:'var(--warn)'},
      {lbl:'31–60 Days',n:b30.length,t:tot30,c:'#EA580C'},
      {lbl:'61–90 Days',n:b60.length,t:tot60,c:'var(--err)'},
      {lbl:'91–180 Days',n:b90.length,t:tot90,c:'#7F1D1D'},
      {lbl:'180+ / Never',n:b180.length,t:tot180,c:'#450A0A'},
    ];
    buckets.forEach(function(bk){
      html+='<div style="background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;border-top:4px solid '+bk.c+'">';
      html+='<div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">'+bk.lbl+'</div>';
      html+='<div style="font-family:DM Mono,monospace;font-size:20px;font-weight:700;color:'+bk.c+'">'+fM(bk.t)+'</div>';
      html+='<div style="font-size:11px;color:var(--t3);margin-top:3px">'+bk.n+' units</div>';
      html+='</div>';
    });
    html+='</div>';
    html+=rptBanner([{ic:'⏰',v:ov.length,l:'overdue units'},{ic:'💰',v:fM(totAll),l:'total pending',c:'var(--err)'}]);
    html+='<div class="card"><div class="tw"><table class="t"><thead><tr>';
    html+='<th>Unit</th><th>Floor</th><th>Client</th><th>Phone</th><th>Total Price</th><th>Paid</th><th>Pending</th><th>Last Payment</th><th>Days Overdue</th><th>Bucket</th><th>Last Contact</th></tr></thead><tbody>';
    ov.forEach(function(u){
      var d=daysSincePay(u);var pd=actualPaid(u);var rm=actualPending(u);
      var bucket=d===null||d>=180?'180+ / Never':d>=90?'91–180 Days':d>=60?'61–90 Days':d>=30?'31–60 Days':'0–30 Days';
      var bcolor=d===null||d>=180?'#450A0A':d>=90?'#7F1D1D':d>=60?'var(--err)':d>=30?'#EA580C':'var(--warn)';
      var lastCons=gcons(u.id).sort(function(a,b){return b.at.localeCompare(a.at);})[0];
      html+='<tr onclick="openUD(\''+u.id+'\')" class="cr" style="cursor:pointer">';
      html+='<td style="font-weight:700">'+esc(u.unitNo)+'</td>';
      html+='<td style="font-size:11px">'+esc(u.floorLabel||u.floor)+'</td>';
      html+='<td>'+esc(u.customerName||'—')+'</td>';
      html+='<td style="font-size:11px">'+esc(u.phone||'—')+'</td>';
      html+='<td class="mono">'+fM(u.totalPrice)+'</td>';
      html+='<td class="mono c-g">'+fM(pd)+'</td>';
      html+='<td class="mono" style="color:var(--err);font-weight:700">'+fM(rm)+'</td>';
      html+='<td style="font-size:11px">'+(u.lastPaymentDate?fD(u.lastPaymentDate):'Never')+'</td>';
      html+='<td style="font-weight:700;color:'+bcolor+'">'+(d===null?'Never paid':d+' days')+'</td>';
      html+='<td><span style="background:'+bcolor+'22;color:'+bcolor+';padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap">'+bucket+'</span></td>';
      html+='<td style="font-size:11px;color:var(--t3)">'+(lastCons?fD(lastCons.date)+' ('+lastCons.status+')':'Never contacted')+'</td>';
      html+='</tr>';
    });
    html+='</tbody></table></div></div>';

  // ══ CLIENT STATEMENT ════════════════════════════════════════
  } else if(_rt==='statement'){
    var stUnits=gunits().filter(function(u){return u.customerName&&u.status!=='Available'&&u.status!=='Dead';});
    if(_rs==='client'){
      var stMap={};
      stUnits.forEach(function(u){var k=u.customerName;if(!stMap[k])stMap[k]=[];stMap[k].push(u);});
      html='<div style="margin-bottom:10px;font-size:12px;color:var(--t3)">'+Object.keys(stMap).length+' clients — click a client to view full statement</div>';
      html+='<div class="card"><div class="tw"><table class="t"><thead><tr><th>Client</th><th>Phone</th><th>Units</th><th>Total Value</th><th>Total Paid</th><th>Pending</th><th>Recovery</th><th></th></tr></thead><tbody>';
      Object.entries(stMap).sort(function(a,b){return a[0].localeCompare(b[0]);}).forEach(function(entry){
        var nm=entry[0],units=entry[1];
        var tv=units.reduce(function(s,u){return s+Number(u.totalPrice||0);},0);
        var tp=units.reduce(function(s,u){return s+actualPaid(u);},0);
        var rm=units.reduce(function(s,u){return s+actualPending(u);},0);
        var p2=tv?Math.round(tp/tv*100):0;
        html+='<tr><td><b>'+esc(nm)+'</b></td><td style="font-size:11px">'+esc(units[0].phone||'—')+'</td>';
        html+='<td>'+units.length+'</td><td class="mono">'+fM(tv)+'</td>';
        html+='<td class="mono c-g">'+fM(tp)+'</td>';
        html+='<td class="mono" style="color:'+(rm>0?'var(--err)':'var(--ok)')+'">'+fM(rm)+'</td>';
        html+='<td><div style="display:flex;align-items:center;gap:5px"><div style="width:50px;height:5px;background:#EEF0F5;border-radius:2px;overflow:hidden"><div style="height:100%;width:'+p2+'%;background:var(--ok);border-radius:2px"></div></div><span style="font-size:10px">'+p2+'%</span></div></td>';
        html+='<td><button class="btn btn-gh btn-xs" onclick="printClientStatement(\''+esc(nm)+'\')">📄 Statement</button></td>';
        html+='</tr>';
      });
      html+='</tbody></table></div></div>';
    } else {
      html=rptBanner([{ic:'📄',v:stUnits.length,l:'units'}]);
      html+='<div class="card"><div class="tw"><table class="t"><thead><tr><th>Unit</th><th>Floor</th><th>Type</th><th>Client</th><th>Phone</th><th>Sale Type</th><th>Total Price</th><th>Paid</th><th>Pending</th><th>Last Pay</th><th>Payments</th><th></th></tr></thead><tbody>';
      stUnits.forEach(function(u){
        var pd=actualPaid(u);var rm=actualPending(u);var d=daysSincePay(u);
        var recs=grecs(u.id);
        html+='<tr class="cr" onclick="openUD(\''+u.id+'\')">';
        html+='<td style="font-weight:700">'+esc(u.unitNo)+'</td>';
        html+='<td style="font-size:11px">'+esc(u.floorLabel||u.floor)+'</td>';
        html+='<td style="font-size:11px">'+esc(u.type)+'</td>';
        html+='<td><b>'+esc(u.customerName)+'</b></td>';
        html+='<td style="font-size:11px">'+esc(u.phone||'—')+'</td>';
        html+='<td>'+sbadge(u.status)+'</td>';
        html+='<td class="mono">'+fM(u.totalPrice)+'</td>';
        html+='<td class="mono c-g">'+fM(pd)+'</td>';
        html+='<td class="mono" style="color:'+(rm>0?'var(--err)':'var(--ok)')+'">'+fM(rm)+'</td>';
        html+='<td style="font-size:11px;color:'+(d!==null&&d>30?'var(--err)':'var(--t3)')+'">'+(d!==null?d+'d ago':'Never')+'</td>';
        html+='<td style="font-size:11px">'+recs.length+' payment'+(recs.length!==1?'s':'')+'</td>';
        html+='<td><button class="btn btn-gh btn-xs" onclick="event.stopPropagation();printUnitStatement(\''+u.id+'\')">📄</button></td>';
        html+='</tr>';
      });
      html+='</tbody></table></div></div>';
    }

  }// end statement

  ct.innerHTML=html||`<div class="empty"><div class="ei">📊</div><div class="et">Select a report type above</div><div class="es">Click Run to generate the report</div></div>`;
  if(_rt==='activity'){
    var actWrap=document.getElementById('act-staff-wrap');
    if(actWrap&&!actWrap.querySelector('input')){
      var db5=gdb();var su=db5.users.filter(function(u){return u.companyIds.includes(S.cid);});
      var aopts=[{v:'all',l:'All Staff'}].concat(su.map(function(u){return {v:u.id,l:u.name};}));
      var csv=ssVal('act-staff-sel')||'all';
      var ass=mkSS('act-staff-sel',aopts,csv,null);
      ass.style.minWidth='160px';
      actWrap.appendChild(ass);
    }
  }
}

// ── EXCEL EXPORT — ALL COLUMNS ──
function expRptExcel(){
  if(typeof XLSX==='undefined'){toast('Excel library not loaded','warn');return;}
  const d=td();let ws,wb,fname;const df=getDF();

  if(_rt==='unit'){
    let u=gunits();
    if(_rs==='sold')u=u.filter(x=>x.status!=='Available'&&x.status!=='Dead');
    else if(_rs==='available')u=u.filter(x=>x.status==='Available');
    else if(_rs==='adjustment')u=u.filter(x=>x.status==='Adjustment');
    else if(_rs==='cashsale')u=u.filter(x=>x.status==='CashSale');
    else if(_rs==='overdue'){const od=getOverdueDays();u=u.filter(x=>isOverdue(x,od)&&actualPending(x)>0);}
    const rows=u.map(x=>{const pd=actualPaid(x),rm=actualPending(x),p2=pct(pd,x.totalPrice),dd=daysSincePay(x);
      return {'Unit No':x.unitNo,'Floor':x.floorLabel||x.floor,'Type':x.type,'Area (sqft)':x.area,'Status':x.status,'Customer Name':x.customerName||'','Phone':x.phone||'','Booking No':x.bookingNo||'','Total Price (PKR)':x.totalPrice||0,'Amount Paid (PKR)':pd,'Pending Amount (PKR)':rm,'Recovery %':p2,'Last Payment Date':x.lastPaymentDate||'Never','Days Since Last Pay':dd!==null?dd:'Never','Sold By':x.soldBy||'','Remarks':x.remarks||''};
    });
    ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_Units_${_rs}_${d}.xlsx`;

  } else if(_rt==='client'){
    let u=gunits().filter(x=>x.customerName);
    if(_rs==='defaulters')u=u.filter(x=>actualPending(x)>0).sort((a,b)=>actualPending(b)-actualPending(a));
    if(_rs==='ledger'){
      const cl={};u.forEach(x=>{const k=x.customerName;if(!cl[k])cl[k]={units:[],phone:x.phone};cl[k].units.push(x);});
      const rows=Object.entries(cl).map(([nm,dd])=>{const tv=dd.units.reduce((s,x)=>s+Number(x.totalPrice||0),0);const tp=dd.units.reduce((s,x)=>s+actualPaid(x),0);const rm=dd.units.reduce((s,x)=>s+actualPending(x),0);return {'Client Name':nm,'Phone':dd.phone||'','Units Count':dd.units.length,'Total Value (PKR)':tv,'Total Paid (PKR)':tp,'Pending (PKR)':rm,'Recovery %':tv?Math.round(tp/tv*100):0};});
      ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_Client_Ledger_${d}.xlsx`;
    } else {
      const rows=u.map(x=>{const pd=actualPaid(x),rm=actualPending(x),dd=daysSincePay(x);return {'Unit No':x.unitNo,'Floor':x.floorLabel||x.floor,'Type':x.type,'Customer Name':x.customerName||'','Phone':x.phone||'','Booking No':x.bookingNo||'','Sale Type':x.status,'Sold By':x.soldBy||'','Total Price (PKR)':x.totalPrice||0,'Amount Paid (PKR)':pd,'Pending (PKR)':rm,'Recovery %':x.totalPrice?Math.round(pd/x.totalPrice*100):0,'Last Payment':x.lastPaymentDate||'Never','Days Since Pay':dd!==null?dd:'Never','Remarks':x.remarks||''};});
      ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_Clients_${_rs}_${d}.xlsx`;
    }

  } else if(_rt==='recovery'){
    let recs=grecs();
    if(df.fr)recs=recs.filter(r=>r.date>=df.fr);if(df.to)recs=recs.filter(r=>r.date<=df.to);
    if(_rs==='daily'){
      const gp={};recs.forEach(r=>{if(!gp[r.date])gp[r.date]={Date:r.date,Payments:0,'Total (PKR)':0};gp[r.date].Payments++;gp[r.date]['Total (PKR)']+=Number(r.amt);});
      ws=XLSX.utils.json_to_sheet(Object.values(gp).sort((a,b)=>b.Date.localeCompare(a.Date)));fname=`Nexunova_Daily_Payments_${d}.xlsx`;
    } else if(_rs==='monthly'){
      const gp={};recs.forEach(r=>{const m=r.date.slice(0,7);if(!gp[m])gp[m]={Month:m,Payments:0,'Total (PKR)':0};gp[m].Payments++;gp[m]['Total (PKR)']+=Number(r.amt);});
      ws=XLSX.utils.json_to_sheet(Object.values(gp).sort((a,b)=>b.Month.localeCompare(a.Month)));fname=`Nexunova_Monthly_Payments_${d}.xlsx`;
    } else if(_rs==='bytype'){
      const rows=['Cash','Bank','Adjustment'].map(tp=>{const tr=recs.filter(r=>r.ptype===tp);return {'Payment Type':tp,'Count':tr.length,'Total (PKR)':tr.reduce((s,r)=>s+Number(r.amt),0)};}).filter(r=>r.Count>0);
      ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_Payments_ByType_${d}.xlsx`;
    } else if(_rs==='bystaff'){
      const um={};recs.forEach(r=>{if(!um[r.by])um[r.by]={Staff:gunm(r.by),Payments:0,'Total (PKR)':0};um[r.by].Payments++;um[r.by]['Total (PKR)']+=Number(r.amt);});
      ws=XLSX.utils.json_to_sheet(Object.values(um));fname=`Nexunova_Payments_ByStaff_${d}.xlsx`;
    } else {
      recs.sort((a,b)=>b.date.localeCompare(a.date));
      const rows=recs.map(r=>{const u=gunit(r.uid);return {'Date':r.date,'Unit No':u?.unitNo||'?','Customer Name':u?.customerName||'','Floor':u?.floorLabel||'','Type':u?.type||'','Amount (PKR)':Number(r.amt),'Payment Type':r.ptype,'Receipt No':r.rcpt||'','Notes':r.notes||'','Recorded By':gunm(r.by)};});
      ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_All_Payments_${d}.xlsx`;
    }

  } else if(_rt==='staff'){
    const db2=gdb();const staffUsers=db2.users.filter(u=>u.companyIds.includes(S.cid));
    const allRecs=grecs();const allCons=gcons();
    if(_rs==='payments'){
      const rows=staffUsers.map(usr=>{const ur=allRecs.filter(r=>r.by===usr.id);const tot=ur.reduce((s,r)=>s+Number(r.amt),0);const cash=ur.filter(r=>r.ptype==='Cash').reduce((s,r)=>s+Number(r.amt),0);const bank=ur.filter(r=>r.ptype==='Bank').reduce((s,r)=>s+Number(r.amt),0);const adj=ur.filter(r=>r.ptype==='Adjustment').reduce((s,r)=>s+Number(r.amt),0);return {'Staff Name':usr.name,'Payments':ur.length,'Cash (PKR)':cash,'Bank (PKR)':bank,'Adjustment (PKR)':adj,'Total (PKR)':tot};}).filter(r=>r.Payments>0);
      ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_Staff_Payments_${d}.xlsx`;
    } else if(_rs==='calls'){
      const rows=staffUsers.map(usr=>{const uc=allCons.filter(c=>c.by===usr.id);return {'Staff Name':usr.name,'Total Calls':uc.length,'Calls':uc.filter(c=>c.type==='Call').length,'WhatsApp':uc.filter(c=>c.type==='WhatsApp').length,'Meetings':uc.filter(c=>c.type==='Meeting').length,'Will Pay':uc.filter(c=>c.status==='WillPay').length,'No Response':uc.filter(c=>c.status==='NoResponse').length,'Interested':uc.filter(c=>c.status==='Interested').length};}).filter(r=>r['Total Calls']>0);
      ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_Staff_Calls_${d}.xlsx`;
    } else {
      const rows=staffUsers.map(usr=>{const ur=allRecs.filter(r=>r.by===usr.id);const uc=allCons.filter(c=>c.by===usr.id);const tot=ur.reduce((s,r)=>s+Number(r.amt),0);return {'Staff Name':usr.name,'Role':usr.role,'Payments':ur.length,'Total Collected (PKR)':tot,'Calls':uc.length,'Will Pay':uc.filter(c=>c.status==='WillPay').length,'No Response':uc.filter(c=>c.status==='NoResponse').length};});
      ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_Staff_Summary_${d}.xlsx`;
    }

  } else if(_rt==='contacts'){
    const t2=td();let cons=gcons().sort((a,b)=>b.at.localeCompare(a.at));
    if(_rs==='overdue')cons=cons.filter(c=>c.fu&&c.fu<t2).sort((a,b)=>a.fu.localeCompare(b.fu));
    else if(_rs==='today')cons=cons.filter(c=>c.fu===t2);
    else if(_rs==='upcoming')cons=cons.filter(c=>c.fu&&c.fu>t2);
    else if(_rs==='willpay')cons=cons.filter(c=>c.status==='WillPay');
    const rows=cons.map(c=>{const u=gunit(c.uid);return {'Date':c.date,'Unit No':u?.unitNo||'?','Customer Name':u?.customerName||'','Phone':u?.phone||'','Contact Type':c.type,'Client Response':c.status,'Notes':c.notes||'','Follow-up Date':c.fu||'','Logged By':gunm(c.by)};});
    ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_CallLogs_${_rs}_${d}.xlsx`;

  } else if(_rt==='followup'){
    const t2=td();const allFU=gcons().filter(c=>c.fu);
    let fuCons=allFU;
    if(_rs==='overdue')fuCons=allFU.filter(c=>c.fu<t2);
    else if(_rs==='today')fuCons=allFU.filter(c=>c.fu===t2);
    else if(_rs==='upcoming')fuCons=allFU.filter(c=>c.fu>t2);
    const rows=fuCons.map(c=>{const u=gunit(c.uid);return {'Unit No':u?.unitNo||'?','Customer Name':u?.customerName||'','Phone':u?.phone||'','Contact Type':c.type,'Response':c.status,'Contact Date':c.date,'Follow-up Date':c.fu||'','Notes':c.notes||'','Logged By':gunm(c.by)};});
    ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_Followups_${_rs}_${d}.xlsx`;

  } else if(_rt==='activity'){
    var adf=getDF();
    var acx=gcons().sort(function(a,b){return b.date.localeCompare(a.date);});
    if(adf.fr)acx=acx.filter(function(c){return c.date>=adf.fr;});
    if(adf.to)acx=acx.filter(function(c){return c.date<=adf.to;});
    var asv=ssVal('act-staff-sel');if(asv&&asv!=='all')acx=acx.filter(function(c){return c.by===asv;});
    var rows=acx.map(function(c){var u=gunit(c.uid);return {'Date':c.date,'Day':new Date(c.date+'T00:00:00').toLocaleDateString('en-PK',{weekday:'long'}),'Staff':gunm(c.by),'Unit No':u?u.unitNo:'?','Floor':u?u.floorLabel||'':'','Client Name':u?u.customerName||'':'','Phone':u?u.phone||'':'','Contact Type':c.type,'Client Response':c.status,'Notes / What Client Said':c.notes||'','Follow-up Date':c.fu||''};});
    ws=XLSX.utils.json_to_sheet(rows);fname='Nexunova_DailyActivity_'+d+'.xlsx';

  } else if(_rt==='aging'){
    var aOD=getOverdueDays();
    var aUnits=gunits().filter(function(u){return u.status!=='Available'&&u.status!=='Dead'&&actualPending(u)>0;});
    var aMinDays={'all':0,'30':30,'60':60,'90':90,'180':180}[_rs]||0;
    aUnits=aUnits.filter(function(u){var dd=daysSincePay(u);return dd===null||dd>=aMinDays;});
    var aRows=aUnits.map(function(u){var d2=daysSincePay(u);var pd=actualPaid(u);var rm=actualPending(u);var bkt=d2===null||d2>=180?'180+ / Never':d2>=90?'91–180 Days':d2>=60?'61–90 Days':d2>=30?'31–60 Days':'0–30 Days';return {'Unit No':u.unitNo,'Floor':u.floorLabel||u.floor,'Client':u.customerName||'','Phone':u.phone||'','Total Price (PKR)':u.totalPrice||0,'Amount Paid (PKR)':pd,'Pending (PKR)':rm,'Last Payment Date':u.lastPaymentDate||'Never','Days Overdue':d2===null?'Never paid':d2,'Bucket':bkt,'Remarks':u.remarks||''};});
    ws=XLSX.utils.json_to_sheet(aRows);fname='Nexunova_AgingReport_'+_rs+'_'+d+'.xlsx';

  } else if(_rt==='statement'){
    var stUnits2=gunits().filter(function(u){return u.customerName&&u.status!=='Available'&&u.status!=='Dead';});
    var stRows=stUnits2.map(function(u){var pd=actualPaid(u);var rm=actualPending(u);var recs2=grecs(u.id);var cons2=gcons(u.id);var lastCon=cons2.sort(function(a,b){return b.at.localeCompare(a.at);})[0];return {'Unit No':u.unitNo,'Floor':u.floorLabel||u.floor,'Type':u.type,'Client Name':u.customerName||'','Phone':u.phone||'','Booking No':u.bookingNo||'','Sale Type':u.status,'Total Price (PKR)':u.totalPrice||0,'Amount Paid (PKR)':pd,'Pending (PKR)':rm,'Recovery %':u.totalPrice?Math.round(pd/u.totalPrice*100):0,'Payments Count':recs2.length,'Contacts Count':cons2.length,'Last Contact Date':lastCon?lastCon.date:'Never','Last Contact Response':lastCon?lastCon.status:'','Sold By':u.soldBy||'','Remarks':u.remarks||''};});
    ws=XLSX.utils.json_to_sheet(stRows);fname='Nexunova_ClientStatement_'+d+'.xlsx';

  } else {
    const tbl=document.querySelector('#r-ct table');
    if(!tbl){toast('No report to export. Click Run first.','warn');return;}
    ws=XLSX.utils.table_to_sheet(tbl);fname=`Nexunova_Report_${_rt}_${d}.xlsx`;
  }

  wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Report');
  XLSX.writeFile(wb,fname);
  toast(`✅ Exported: ${fname}`,'ok');
}

// ── PRINT — opens clean new window, no UI clutter ──
function printRpt(){
  const ct=document.getElementById('r-ct');
  if(!ct||!ct.children.length){toast('Run a report first, then print','warn');return;}
  const rptName=RPT[_rt]?.lbl||'Report';
  const subName=(RPT[_rt]?.subs||[]).find(function(s){return s.id===_rs;})?.lbl||'';
  const df=getDF();
  const frVal=document.getElementById('r-fr')?.value||'';
  const toVal=document.getElementById('r-to')?.value||'';
  let drLabel='All Time';
  if(frVal&&toVal)drLabel=frVal+' to '+toVal;
  else if(frVal)drLabel='From '+frVal;
  else if(toVal)drLabel='Until '+toVal;
  const w=window.open('','_blank','width=1100,height=800');
  if(!w){toast('Please allow pop-ups for this page, then try again','warn');return;}
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8">'+
    '<title>Nexunova '+rptName+' Report</title>'+
    '<style>'+
    'body{font-family:Arial,sans-serif;font-size:11px;color:#111;padding:16px;margin:0}'+
    'h1{font-size:18px;margin:0 0 2px;color:#fff}'+
    '.hdr{background:var(--ink);color:white;padding:14px 18px;border-radius:var(--rs);margin-bottom:12px;display:flex;justify-content:space-between;align-items:flex-start}'+
    '.hdr-r{text-align:right;font-size:10px;color:rgba(255,255,255,.65);white-space:nowrap}'+
    '.sub{color:#C9A84C;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-top:2px}'+
    '.meta{display:flex;gap:16px;flex-wrap:wrap;padding:8px 12px;background:#f5f7fa;border:1px solid #dde;border-radius:4px;margin-bottom:12px;font-size:10px}'+
    '.meta-item{display:flex;flex-direction:column;gap:2px}'+
    '.meta-item b{font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888}'+
    'table{width:100%;border-collapse:collapse;margin:0}'+
    'th{background:var(--ink);color:white;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.4px;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    'td{padding:6px 8px;border-bottom:1px solid #eee;font-size:10px;vertical-align:top;word-break:break-word;max-width:200px}'+
    'tr:nth-child(even) td{background:#f9fafb}'+
    '.badge{padding:2px 7px;border-radius:99px;font-size:9px;font-weight:700;white-space:nowrap}'+
    '.day-hdr{background:#1E2D47;color:white;padding:8px 12px;border-radius:4px 4px 0 0;margin-top:16px;font-weight:700;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.summary{display:flex;gap:12px;flex-wrap:wrap;padding:8px 12px;background:#f0f4f8;border-radius:4px;margin-bottom:8px;font-size:10px}'+
    '@media print{body{padding:8px}@page{margin:1cm;size:A4 landscape}}'+
    '</style></head><body>'+
    '<div class="hdr">'+
      '<div><h1>Nexunova Recovery Management System</h1><div class="sub">'+rptName+' Report'+(subName?' — '+subName:'')+'</div></div>'+
      '<div class="hdr-r">Printed: '+new Date().toLocaleString('en-PK',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+'<br>Company: Nexunova</div>'+
    '</div>'+
    '<div class="meta">'+
      '<div class="meta-item"><b>Report</b>'+rptName+' — '+(subName||'All')+'</div>'+
      '<div class="meta-item"><b>Date Range</b>'+drLabel+'</div>'+
      '<div class="meta-item"><b>Generated By</b>'+(window.S?window.S.name||'—':'—')+'</div>'+
      '<div class="meta-item"><b>Print Date</b>'+new Date().toLocaleDateString('en-PK',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})+'</div>'+
    '</div>'+
    ct.innerHTML+
    '</body></html>');
  w.document.close();
  setTimeout(function(){w.print();},400);
  w.onafterprint=function(){w.close();};
}

// ── PRINT CLIENT STATEMENT ──
function printClientStatement(clientName){
  var units=gunits().filter(function(u){return u.customerName===clientName;});
  if(!units.length){toast('No units found for this client','warn');return;}
  var allRecs=[],allCons=[];
  units.forEach(function(u){allRecs=allRecs.concat(grecs(u.id));allCons=allCons.concat(gcons(u.id));});
  allRecs.sort(function(a,b){return b.date.localeCompare(a.date);});
  allCons.sort(function(a,b){return b.date.localeCompare(a.date);});
  var totPrice=units.reduce(function(s,u){return s+Number(u.totalPrice||0);},0);
  var totPaid=units.reduce(function(s,u){return s+actualPaid(u);},0);
  var totPend=units.reduce(function(s,u){return s+actualPending(u);},0);
  var w=window.open('','_blank','width=900,height=700');
  if(!w){toast('Allow pop-ups for this site','warn');return;}
  var h='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Statement - '+clientName+'</title>';
  h+='<style>body{font-family:Arial,sans-serif;font-size:11px;padding:20px;color:#111}';
  h+='.hdr{background:var(--ink);color:white;padding:14px 18px;border-radius:var(--rs);margin-bottom:12px}h1{color:white;font-size:18px;margin:0 0 2px}.gold{color:#C9A84C;font-size:10px;text-transform:uppercase;letter-spacing:1px}';
  h+='.sum{display:flex;gap:16px;flex-wrap:wrap;padding:10px 14px;background:#f5f7fa;border:1px solid #dde;border-radius:4px;margin-bottom:12px;font-size:10px}';
  h+='.sum-item{display:flex;flex-direction:column;gap:2px}.sum-item b{font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888}';
  h+='table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:10px}th{background:var(--ink);color:white;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact}';
  h+='td{padding:5px 8px;border-bottom:1px solid #eee}tr:nth-child(even) td{background:#f9fafb}';
  h+='h3{font-size:12px;border-bottom:2px solid #C9A84C;padding-bottom:4px;margin:14px 0 8px;color:var(--ink)}';
  h+='@media print{@page{margin:1cm;size:A4}}';
  h+='</style></head><body>';
  h+='<div class="hdr"><h1>Account Statement</h1><div class="gold">'+clientName+' — Nexunova RMS — '+new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'})+'</div></div>';
  h+='<div class="sum">';
  h+='<div class="sum-item"><b>Client</b>'+clientName+'</div>';
  h+='<div class="sum-item"><b>Phone</b>'+(units[0].phone||'—')+'</div>';
  h+='<div class="sum-item"><b>Units</b>'+units.length+'</div>';
  h+='<div class="sum-item"><b>Total Portfolio</b>PKR '+totPrice.toLocaleString('en-PK')+'</div>';
  h+='<div class="sum-item"><b>Total Paid</b><span style="color:green">PKR '+totPaid.toLocaleString('en-PK')+'</span></div>';
  h+='<div class="sum-item"><b>Balance Pending</b><span style="color:'+(totPend>0?'red':'green')+'">PKR '+totPend.toLocaleString('en-PK')+'</span></div>';
  h+='</div>';
  h+='<h3>Units & Financial Summary</h3>';
  h+='<table><thead><tr><th>Unit No</th><th>Floor</th><th>Type</th><th>Sale Type</th><th>Total Price</th><th>Amount Paid</th><th>Balance</th><th>Recovery %</th><th>Sold By</th></tr></thead><tbody>';
  units.forEach(function(u){var pd=actualPaid(u);var rm=actualPending(u);var p2=u.totalPrice?Math.round(pd/u.totalPrice*100):0;h+='<tr><td>'+u.unitNo+'</td><td>'+u.floorLabel+'</td><td>'+u.type+'</td><td>'+u.status+'</td><td>PKR '+Number(u.totalPrice).toLocaleString('en-PK')+'</td><td style="color:green">PKR '+pd.toLocaleString('en-PK')+'</td><td style="color:'+(rm>0?'red':'green')+'">PKR '+rm.toLocaleString('en-PK')+'</td><td>'+p2+'%</td><td>'+esc(u.soldBy||'—')+'</td></tr>';});
  h+='</tbody></table>';
  if(allRecs.length){
    h+='<h3>Payment History ('+allRecs.length+' payments)</h3>';
    h+='<table><thead><tr><th>Date</th><th>Unit</th><th>Amount</th><th>Type</th><th>Receipt No</th><th>Notes</th><th>Recorded By</th></tr></thead><tbody>';
    allRecs.forEach(function(r){var u=gunit(r.uid);h+='<tr><td>'+fD(r.date)+'</td><td>'+esc(u?u.unitNo:'?')+'</td><td style="font-weight:700">PKR '+Number(r.amt).toLocaleString('en-PK')+'</td><td>'+r.ptype+'</td><td>'+(r.rcpt||'—')+'</td><td>'+(r.notes||'—')+'</td><td>'+gunm(r.by)+'</td></tr>';});
    h+='</tbody></table>';
  }
  if(allCons.length){
    h+='<h3>Contact History ('+allCons.length+' logs)</h3>';
    h+='<table><thead><tr><th>Date</th><th>Unit</th><th>Type</th><th>Response</th><th>Notes</th><th>Follow-up</th><th>By</th></tr></thead><tbody>';
    allCons.forEach(function(c){var u=gunit(c.uid);h+='<tr><td>'+fD(c.date)+'</td><td>'+esc(u?u.unitNo:'?')+'</td><td>'+c.type+'</td><td>'+c.status+'</td><td>'+(c.notes||'—')+'</td><td>'+(c.fu?fD(c.fu):'—')+'</td><td>'+gunm(c.by)+'</td></tr>';});
    h+='</tbody></table>';
  }
  h+='</body></html>';
  w.document.write(h);w.document.close();
  setTimeout(function(){w.print();},400);
  w.onafterprint=function(){w.close();};
}

function printUnitStatement(unitId){
  var u=gunit(unitId);if(!u)return;
  printClientStatement(u.customerName);
}

// ── PAYMENT RECEIPT PRINT ──
function printPaymentReceipt(recId){
  var db=gdb();
  var rec=(db.recoveries[S.cid]||[]).find(function(r){return r.id===recId;});
  if(!rec){toast('Payment not found','err');return;}
  var u=gunit(rec.uid);
  var w=window.open('','_blank','width=600,height=500');
  if(!w){toast('Allow pop-ups','warn');return;}
  var h='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt</title>';
  h+='<style>body{font-family:Arial,sans-serif;max-width:520px;margin:30px auto;padding:20px;font-size:12px;color:#111}';
  h+='.hdr{background:var(--ink);color:white;padding:16px 20px;border-radius:var(--rm);margin-bottom:16px;text-align:center}';
  h+='.hdr h1{margin:0;font-size:20px;color:#fff}.hdr p{margin:4px 0 0;color:#C9A84C;font-size:10px;text-transform:uppercase;letter-spacing:1px}';
  h+='.rcpt-no{text-align:center;font-size:24px;font-weight:700;color:var(--ink);margin:10px 0;font-family:monospace}';
  h+='.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f0f0}';
  h+='.lbl{color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.5px}.val{font-weight:700;text-align:right}';
  h+='.amt{text-align:center;background:#f0fdf4;border:2px solid #16a34a;border-radius:var(--rm);padding:16px;margin:14px 0}';
  h+='.amt-v{font-size:28px;font-weight:700;color:#16a34a;font-family:monospace}';
  h+='.footer{text-align:center;font-size:10px;color:#888;margin-top:16px;border-top:1px solid #eee;padding-top:10px}';
  h+='@media print{body{margin:0;padding:10px}@page{size:A5;margin:.5cm}}</style></head><body>';
  h+='<div class="hdr"><h1>Nexunova RMS</h1><p>Official Payment Receipt</p></div>';
  h+='<div class="rcpt-no">Receipt #'+(rec.rcpt||rec.id.toUpperCase().slice(-6))+'</div>';
  h+='<div class="amt"><div style="font-size:11px;color:#16a34a;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Amount Received</div>';
  h+='<div class="amt-v">PKR '+Number(rec.amt).toLocaleString('en-PK')+'</div></div>';
  h+='<div class="row"><span class="lbl">Date</span><span class="val">'+fD(rec.date)+'</span></div>';
  h+='<div class="row"><span class="lbl">Unit No</span><span class="val">'+(u?u.unitNo:'?')+'</span></div>';
  h+='<div class="row"><span class="lbl">Client Name</span><span class="val">'+(u?esc(u.customerName):'—')+'</span></div>';
  h+='<div class="row"><span class="lbl">Floor / Type</span><span class="val">'+(u?(u.floorLabel||u.floor)+' · '+u.type:'—')+'</span></div>';
  h+='<div class="row"><span class="lbl">Payment Type</span><span class="val">'+rec.ptype+'</span></div>';
  h+='<div class="row"><span class="lbl">Notes</span><span class="val" style="max-width:220px;text-align:right">'+(rec.notes||'—')+'</span></div>';
  if(u){h+='<div class="row"><span class="lbl">Balance After Payment</span><span class="val" style="color:'+(actualPending(u)>0?'red':'green')+'">'+(actualPending(u)>0?'PKR '+actualPending(u).toLocaleString('en-PK')+' pending':'✅ Fully Paid')+'</span></div>';}
  h+='<div class="row"><span class="lbl">Recorded By</span><span class="val">'+gunm(rec.by)+'</span></div>';
  h+='<div class="footer">This is a computer-generated receipt. Nexunova RMS<br>Generated: '+new Date().toLocaleString('en-PK')+'</div>';
  h+='</body></html>';
  w.document.write(h);w.document.close();
  setTimeout(function(){w.print();},400);
  w.onafterprint=function(){w.close();};
}

// ── CSV EXPORT ──
function expRpt(){
  const tbl=document.querySelector('#r-ct table');if(!tbl){toast('No report to export','warn');return;}
  const rows=[];tbl.querySelectorAll('tr').forEach(tr=>{const r=[];tr.querySelectorAll('th,td').forEach(td=>r.push(td.innerText.replace(/\n/g,' ').trim()));rows.push(r);});
  const csv=rows.map(r=>r.map(c=>'"'+c.replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));a.download=`Nexunova_${_rt}_${td()}.csv`;a.click();
  toast('Exported to CSV','ok');
}



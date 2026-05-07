// ══ CONTACTS PAGE ════════════════════════════════
let _cf={type:'All',status:'All',fu:'All'};
function rCons(){
  const db=gdb();const users=db.users.filter(u=>u.companyIds.includes(S.cid));
  document.getElementById('pg-contacts').innerHTML=`<div class="ani">
    <div class="ph"><div class="ph-l"><h2>Call Logs</h2></div><div class="ph-r"><button class="btn btn-d btn-sm" onclick="openConModal(null)">+ Log Call</button></div></div>
    <div class="fbar">
      <div class="fg"><label class="fl" style="font-size:10px">Type</label><select class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_cf.type=this.value;rConsF()"><option value="All">All Types</option><option value="Call">Call</option><option value="WhatsApp">WhatsApp</option><option value="Meeting">Meeting</option></select></div>
      <div class="fg"><label class="fl" style="font-size:10px">Response</label><select class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_cf.status=this.value;rConsF()"><option value="All">All Responses</option><option value="NoResponse">No Response</option><option value="Interested">Interested</option><option value="WillPay">Will Pay</option><option value="NotInterested">Not Interested</option><option value="Dispute">Dispute</option></select></div>
      <div class="fg"><label class="fl" style="font-size:10px">Follow-up</label><select class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_cf.fu=this.value;rConsF()"><option value="All">All</option><option value="overdue">Overdue</option><option value="today">Due Today</option><option value="upcoming">Upcoming</option><option value="none">No Follow-up</option></select></div>
      <div style="display:flex;align-items:flex-end"><button class="btn btn-gh btn-sm" onclick="_cf={type:'All',status:'All',fu:'All'};rCons()">Reset</button></div>
    </div>
    <div id="con-sum" style="margin-bottom:10px"></div>
    <div id="con-tbl"></div>
  </div>`;
  rConsF();
}
function rConsF(){
  let cons=gcons().sort((a,b)=>b.at.localeCompare(a.at));
  const t=td();
  if(_cf.type!=='All')cons=cons.filter(c=>c.type===_cf.type);
  if(_cf.status!=='All')cons=cons.filter(c=>c.status===_cf.status);
  if(_cf.fu==='overdue')cons=cons.filter(c=>c.fu&&c.fu<t);
  else if(_cf.fu==='today')cons=cons.filter(c=>c.fu===t);
  else if(_cf.fu==='upcoming')cons=cons.filter(c=>c.fu&&c.fu>t);
  else if(_cf.fu==='none')cons=cons.filter(c=>!c.fu);
  // Summary
  const overdueCt=gcons().filter(c=>c.fu&&c.fu<t).length;
  const todayCt=gcons().filter(c=>c.fu===t).length;
  const sum=document.getElementById('con-sum');
  if(sum)sum.innerHTML=`<div style="display:flex;gap:10px;flex-wrap:wrap;padding:10px 16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);font-size:12px">
    <span style="font-weight:700">${cons.length} shown</span>
    ${overdueCt?`<span style="color:var(--t3)">·</span><span style="color:var(--err);font-weight:700">⚠️ ${overdueCt} overdue follow-ups</span>`:''}
    ${todayCt?`<span style="color:var(--t3)">·</span><span style="color:var(--warn);font-weight:700">📅 ${todayCt} due today</span>`:''}
  </div>`;
  const tbl=document.getElementById('con-tbl');if(!tbl)return;
  if(!cons.length){tbl.innerHTML=`<div class="card"><div class="empty"><div class="ei">📞</div><div class="et">No call logs match filters</div></div></div>`;return;}
  tbl.innerHTML=`<div class="card"><div class="tw"><table class="t">
    <thead><tr><th>Date</th><th>Unit</th><th>Client</th><th>Type</th><th>Response</th><th>Notes</th><th>Follow-up</th><th>By</th></tr></thead>
    <tbody>${cons.map(c=>{const u=gunit(c.uid);const fuOv=c.fu&&c.fu<t;const fuToday=c.fu===t;return `<tr class="cr" onclick="openUD('${c.uid}')"><td>${fD(c.date)}</td><td style="font-weight:700">${u?.unitNo||'?'}</td><td>${u?.customerName||'—'}</td><td>${ctic(c.type)} ${c.type}</td><td>${cbadge(c.status)}</td><td style="font-size:11px;color:var(--t3);max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.notes||'—'}</td><td style="color:${fuOv?'var(--err)':fuToday?'var(--warn)':'var(--t3)'};font-weight:${fuOv||fuToday?700:400}">${c.fu?fD(c.fu)+(fuOv?' ⚠':fuToday?' 📅':''):'—'}</td><td style="font-size:11px;color:var(--t3)">${gunm(c.by)}</td></tr>`;}).join('')}
    </tbody></table></div></div>`;
}


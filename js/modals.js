// ══ MODALS ════════════════════════════════════
function om(id){
  document.getElementById(id).classList.add('open');
  document.body.classList.add('modal-open');
  enhanceModalSelects(id);
}
function cm(id){
  document.getElementById(id).classList.remove('open');
  if(!document.querySelector('.mov.open'))document.body.classList.remove('modal-open');
}
// Backdrop click → close
document.addEventListener('click',e=>{
  if(e.target.classList.contains('mov')){
    e.target.classList.remove('open');
    if(!document.querySelector('.mov.open'))document.body.classList.remove('modal-open');
  }
});
// ESC → close top modal (page step-back handled in ui.js)
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){const m=document.querySelector('.mov.open');if(m){m.classList.remove('open');if(!document.querySelector('.mov.open'))document.body.classList.remove('modal-open');}}
});
// Enter → click primary save button in the open modal
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  if(e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;
  const m=document.querySelector('.mov.open');
  if(!m)return;
  const btn=m.querySelector('.mf .btn-gr:not(:disabled),.mf .btn-g:not(:disabled)');
  if(btn){e.preventDefault();btn.click();}
});

function openSellModal(unitId){
  if(S.role!=='admin'&&S.role!=='owner'){toast('Admin only','warn');return;}
  const u=gunit(unitId);
  document.getElementById('sell-lbl').textContent=`Unit ${u?.unitNo||''}`;
  const sel=document.getElementById('sl-by');
  // Source: real app_users (Supabase), not legacy localStorage seed db.
  // Falls back to a helpful placeholder if cache hasn't hydrated yet.
  const realUsers=(window._appUsersCache||[]).filter(x=>x.is_active!==false);
  if(!realUsers.length){
    sel.innerHTML=`<option value="">No staff yet — add users in Admin → Users & Roles</option>`;
  } else {
    sel.innerHTML=`<option value="">Select staff...</option>`+
      realUsers.map(x=>`<option value="${esc(x.full_name||x.name||x.username||'')}">${esc(x.full_name||x.name||x.username||'')}${x.role?' · '+esc(x.role):''}</option>`).join('');
  }
  if(u&&u.customerName){document.getElementById('sl-n').value=u.customerName||'';document.getElementById('sl-ph').value=u.phone||'';document.getElementById('sl-bk').value=u.bookingNo||'';document.getElementById('sl-by').value=u.soldBy||'';document.getElementById('sl-pr').value=u.totalPrice||'';document.getElementById('sl-pd').value=u.totalPaid||'';document.getElementById('sl-dt').value=u.soldDate||td();document.getElementById('sl-tp').value=u.status||'Installment';document.getElementById('sl-rem').value=u.remarks||'';}
  else{['sl-n','sl-ph','sl-bk','sl-pr','sl-pd','sl-rem'].forEach(id=>document.getElementById(id).value='');document.getElementById('sl-dt').value=td();document.getElementById('sl-tp').value='Installment';}
  _uid=unitId;om('m-sell');
}
function saveSell(){
  const name=document.getElementById('sl-n').value.trim();
  const price=parseFloat(document.getElementById('sl-pr').value)||0;
  const slnEl=document.getElementById('sl-n');const slprEl=document.getElementById('sl-pr');
  if(slnEl)slnEl.classList.toggle('inp-err',!name);
  if(slprEl)slprEl.classList.toggle('inp-err',!price||price<=0);
  if(!name){toast('Customer name required','err');return;}if(!price||price<=0){toast('Total price must be greater than 0','err');return;}
  const db=gdb();const units=db.units[S.cid]||[];const idx=units.findIndex(u=>u.id===_uid);
  if(idx<0){toast('Unit not found','err');return;}
  const pd=parseFloat(document.getElementById('sl-pd').value)||0;
  if(pd<0){toast('Amount paid cannot be negative','err');return;}
  if(pd>price){toast('Amount paid ('+fM(pd)+') cannot exceed total price ('+fM(price)+')','err');return;}
  const recAlready=srecs(_uid);
  if(recAlready>0&&pd<units[idx].totalPaid){toast(`Base paid cannot be reduced below baseline (${fM(units[idx].totalPaid)}) while recovery payments exist`,'err');return;}
  const newStatus=document.getElementById('sl-tp').value;
  units[idx]={...units[idx],status:newStatus,customerName:name,phone:document.getElementById('sl-ph').value.trim(),bookingNo:document.getElementById('sl-bk').value.trim(),soldBy:document.getElementById('sl-by').value,soldDate:document.getElementById('sl-dt').value||td(),totalPrice:price,totalPaid:pd,pendingAmount:Math.max(0,price-pd),remarks:document.getElementById('sl-rem').value.trim()};
  // Task 4B: data integrity guard
  if(units[idx].pendingAmount>units[idx].totalPrice)units[idx].pendingAmount=units[idx].totalPrice;
  // Task 4C: record initial payment in recovery history
  const soldDate=units[idx].soldDate;const bookingNo=units[idx].bookingNo;
  if(pd>0){
    db.recoveries[S.cid]=db.recoveries[S.cid]||[];
    const alreadyHasInitial=(db.recoveries[S.cid]||[]).find(r=>r.uid===_uid&&r.notes==='Initial payment on sale');
    if(!alreadyHasInitial){
      db.recoveries[S.cid].push({id:uid(),cid:S.cid,uid:_uid,amt:pd,date:soldDate||td(),ptype:'Cash',rcpt:bookingNo,notes:'Initial payment on sale',at:new Date().toISOString(),by:S.userId});
    }
  }
  db.units[S.cid]=units;sdb(db);cm('m-sell');logA('sell',`${units[idx].unitNo} → ${name}`);toast(`Unit ${units[idx].unitNo} saved`,'ok');nav('unitdetail');
}

function openRecModal(unitId){
  // Prefer the v4 boolean over the legacy status string; fall back to status
  // for older units that haven't been re-hydrated yet.
  const units=gunits().filter(u=>(u.isAvailable===false)||(u.status&&u.status!=='Available'&&u.status!=='Dead'));
  const sel=document.getElementById('rc-u');
  if(!units.length){
    sel.innerHTML=`<option value="">No sold units yet — record a sale first</option>`;
  } else {
    sel.innerHTML=`<option value="">Select unit...</option>`+units.map(u=>`<option value="${u.id}" ${u.id===unitId?'selected':''}>${u.unitNo}${u.customerName?' — '+u.customerName:''}</option>`).join('');
  }
  document.getElementById('rc-a').value='';document.getElementById('rc-d').value=td();document.getElementById('rc-r').value='';document.getElementById('rc-n').value='';document.getElementById('rc-t').value='Cash';
  if(unitId)sel.value=unitId;
  document.querySelectorAll('#m-rec .inp-err').forEach(el=>el.classList.remove('inp-err'));
  om('m-rec');
}
function saveRec(){
  const unitId=document.getElementById('rc-u').value;
  const amt=parseFloat(document.getElementById('rc-a').value)||0;
  const date=document.getElementById('rc-d').value||td();
  const ptype=document.getElementById('rc-t').value;
  const rcpt=document.getElementById('rc-r').value.trim();
  const notes=document.getElementById('rc-n').value.trim();
  // ── Validation ──
  const rcuEl=document.getElementById('rc-u');const rcaEl=document.getElementById('rc-a');
  if(rcuEl)rcuEl.classList.toggle('inp-err',!unitId);
  if(rcaEl)rcaEl.classList.toggle('inp-err',amt<=0);
  if(!unitId){toast('Please select a unit','err');return;}
  if(amt<=0){toast('Amount must be greater than zero','err');return;}
  if(amt>1000000000){toast('Amount seems unrealistically large — please check','err');return;}
  if(!date){toast('Please enter a valid date','err');return;}
  if(date>td()){if(!confirm('Payment date is in the future. Continue?'))return;}
  const db=gdb();
  const uObj=db.units[S.cid]?.find(u=>u.id===unitId);
  if(!uObj){toast('Unit not found','err');return;}
  const curPending=actualPending(uObj);
  // ── Duplicate detection ──
  const existing=(db.recoveries[S.cid]||[]).find(r=>r.uid===unitId&&r.date===date&&r.amt===amt);
  if(existing&&!confirm(`⚠️ Duplicate detected: same unit, date (${fD(date)}), and amount (${fM(amt)}) already saved.\n\nAdd anyway?`))return;
  // ── Overflow warning ──
  if(curPending===0&&uObj.totalPrice>0){if(!confirm(`${uObj.unitNo} is already fully paid. Add this payment anyway?`))return;}
  else if(amt>curPending&&curPending>0){if(!confirm(`Payment ${fM(amt)} exceeds remaining pending ${fM(curPending)}.\nUnit would be overpaid. Continue?`))return;}
  // ── Save recovery record ──
  db.recoveries[S.cid]=db.recoveries[S.cid]||[];
  const rec={id:uid(),cid:S.cid,uid:unitId,amt,date,ptype,rcpt,notes,at:new Date().toISOString(),by:S.userId};
  db.recoveries[S.cid].push(rec);
  // ── Update unit totals directly (V4: authoritative) ──
  const units=db.units[S.cid]||[];
  const idx=units.findIndex(u=>u.id===unitId);
  if(idx>=0){
    units[idx].totalPaid=Number(units[idx].totalPaid||0)+amt;
    units[idx].pendingAmount=Math.max(0,Number(units[idx].totalPrice||0)-units[idx].totalPaid);
    // Task 4B: data integrity guard
    if(units[idx].pendingAmount>units[idx].totalPrice)units[idx].pendingAmount=units[idx].totalPrice;
    units[idx].lastPaymentDate=date;
  }
  sdb(db);
  cm('m-rec');
  logA('rec',`${fM(amt)} ${ptype} for ${uObj.unitNo} (${uObj.customerName})`);
  toast(`Payment of ${fM(amt)} saved ✅`,'ok');
  buildSB();
  const ap=document.querySelector('.pg.on')?.id?.replace('pg-','');if(ap)nav(ap);
}

function cmWA(){cm('m-wa');}
function copyWAMsg(idx){
  var msgs=window._waMsgs||[];
  if(msgs[idx])navigator.clipboard.writeText(msgs[idx]).then(function(){toast('Message copied! Paste in WhatsApp.','ok');});
}
function openWALink(idx){
  var msgs=window._waMsgs||[];var ph=window._waPhone||'';
  if(msgs[idx]&&ph)window.open('https://wa.me/'+ph+'?text='+encodeURIComponent(msgs[idx]),'_blank');
}
function showWATemplates(unitId){
  var u=gunit(unitId);if(!u)return;
  var rm=actualPending(u);
  var phone='92'+u.phone.replace(/^0/,'').replace(/[^0-9]/g,'');
  window._waPhone=phone;
  window._waMsgs=[
    'Assalam o Alaikum '+u.customerName+', Nexunova ki taraf se yaad dihani k aap ke unit '+u.unitNo+' ka PKR '+rm.toLocaleString('en-PK')+' pending hai. Jald payment karein. Shukriya.',
    'Assalam o Alaikum '+u.customerName+', aap se arz hai k unit '+u.unitNo+' ki payment ka koi update dein. Nexunova haazir hain.',
    'Assalam o Alaikum '+u.customerName+', aap se mulaqat ki guzarish hai, unit '+u.unitNo+' k mutalliq baat karni hai. Convenient waqt batayein. Nexunova.',
    'Jazak Allah Khair '+u.customerName+', aap ki payment haasil ho gayi. Unit '+u.unitNo+' remaining: PKR '+rm.toLocaleString('en-PK')+'. Nexunova.',
  ];
  var labels=['Payment Reminder','Follow-up','Meeting Request','Thank You (After Payment)'];
  var modal=document.getElementById('m-wa');
  if(!modal){
    var d=document.createElement('div');d.id='m-wa';d.className='mov';
    d.innerHTML='<div class="md" style="max-width:500px"><div class="mh"><div><h3>💬 WhatsApp Templates</h3><p id="wa-sub"></p></div><button class="mx" onclick="cmWA()">✕</button></div><div class="mb" id="wa-body"></div><div class="mf"><button class="btn btn-gh" onclick="cmWA()">Close</button></div></div>';
    document.body.appendChild(d);modal=d;
  }
  document.getElementById('wa-sub').textContent=u.unitNo+' — '+u.customerName;
  var bd=document.getElementById('wa-body');bd.innerHTML='';
  window._waMsgs.forEach(function(msg,i){
    var div=document.createElement('div');
    div.style.cssText='margin-bottom:12px;padding:12px;background:var(--canvas);border:1px solid var(--line);border-radius:var(--rm)';
    var lbl=document.createElement('div');lbl.style.cssText='font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px';lbl.textContent=labels[i];
    var txt=document.createElement('div');txt.style.cssText='font-size:12px;color:var(--t2);line-height:1.6;margin-bottom:8px';txt.textContent=msg;
    var btns=document.createElement('div');btns.style.cssText='display:flex;gap:6px';
    var copyBtn=document.createElement('button');copyBtn.className='btn btn-gh btn-xs';copyBtn.textContent='📋 Copy';copyBtn.onclick=(function(idx){return function(){copyWAMsg(idx);};})(i);
    var waBtn=document.createElement('a');waBtn.className='btn btn-gr btn-xs';waBtn.style.textDecoration='none';waBtn.textContent='💬 Open WhatsApp';waBtn.href='https://wa.me/'+phone+'?text='+encodeURIComponent(msg);waBtn.target='_blank';
    btns.appendChild(copyBtn);btns.appendChild(waBtn);
    div.appendChild(lbl);div.appendChild(txt);div.appendChild(btns);
    bd.appendChild(div);
  });
  om('m-wa');
}
// openConModal / saveCon moved to js/modals-log-call.js (8-step wizard)

// openUnitModal / saveUnitForm defined in js/pages/units.js (loads earlier)

function openUserModal(userId){
  if(S.role!=='admin'){toast('Admin only','warn');return;}
  _euid=userId;
  const db=gdb();
  const u=userId?db.users.find(x=>x.id===userId):null;
  const isAdmin=(u?.role==='admin');
  document.getElementById('user-mtl').textContent=userId?(isAdmin?'Edit Admin':'Edit User'):'Add Staff User';
  const subEl=document.getElementById('user-msub');
  if(subEl)subEl.textContent=isAdmin?'Admin account — role cannot be changed':'Recovery or Accounts staff';
  document.getElementById('ur-nm').value=u?.name||'';
  document.getElementById('ur-un').value=u?.username||'';
  document.getElementById('ur-pw').value='';
  // Role select — lock for admin accounts
  const rlSel=document.getElementById('ur-rl');
  if(isAdmin){
    rlSel.innerHTML='<option value="admin">👑 Admin / CFO</option>';
    rlSel.disabled=true;
  }else{
    rlSel.innerHTML='<option value="recovery">🔧 Recovery Staff</option><option value="accounts">💼 Accounts Staff</option>';
    rlSel.disabled=false;
    const curRole=u?.role==='user'?'recovery':(u?.role||'recovery');
    rlSel.value=curRole;
  }
  // For new users auto-assign S.cid; for edits show company checkboxes
  const cosWrap=document.getElementById('ur-cos');
  if(cosWrap){
    if(userId){
      cosWrap.innerHTML=db.companies.map(co=>`<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" value="${co.id}" ${u?.companyIds.includes(co.id)?'checked':''}> ${esc(co.name)}</label>`).join('');
      cosWrap.parentElement.style.display='';
    }else{
      cosWrap.innerHTML='';
      cosWrap.parentElement.style.display='none'; // auto-set to S.cid on save
    }
  }
  om('m-user');
}
function saveUser(){
  const name=document.getElementById('ur-nm').value.trim();
  const uname=document.getElementById('ur-un').value.trim();
  const pass=document.getElementById('ur-pw').value;
  const role=document.getElementById('ur-rl').value;
  if(!name||!uname){toast('Name and username required','err');return;}
  const db=gdb();
  if(_euid){
    // Edit existing user
    const idx=db.users.findIndex(u=>u.id===_euid);
    if(idx<0){toast('User not found','err');return;}
    const cos=[...document.querySelectorAll('#ur-cos input:checked')].map(i=>i.value);
    db.users[idx].name=name;
    db.users[idx].username=uname;
    if(cos.length)db.users[idx].companyIds=cos;
    if(db.users[idx].role!=='admin')db.users[idx].role=role;
    if(pass)db.users[idx].password=pass;
  }else{
    // New user — always assign to current company
    const staffInCo=db.users.filter(u=>u.companyIds.includes(S.cid)&&u.role!=='admin');
    if(staffInCo.length>=2){toast('Maximum 2 staff users per company reached','err');return;}
    if(!pass){toast('Password required for new user','err');return;}
    if(db.users.find(u=>u.username===uname)){toast('Username already taken','err');return;}
    db.users.push({
      id:'u'+uid(),
      name,
      username:uname,
      password:pass,
      role,
      companyIds:[S.cid],
      createdAt:new Date().toISOString()
    });
  }
  sdb(db);cm('m-user');logA('user',(_euid?'Updated':'Added')+' user: '+name);toast('User '+name+' saved','ok');rAdmin();
}
function delUser(id){
  if(id===S.userId){toast('Cannot delete your own account','err');return;}
  const db=gdb();
  const u=db.users.find(x=>x.id===id);
  if(u?.role==='admin'){toast('Cannot delete the admin account','err');return;}
  if(!confirm(`Delete user "${u?.name||'this user'}"? They will lose access immediately.`))return;
  db.users=db.users.filter(x=>x.id!==id);
  sdb(db);
  logA('user','Deleted user: '+(u?.name||id));
  toast('User deleted','ok');
  rAdmin();
}


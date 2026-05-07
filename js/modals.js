// ══ MODALS ════════════════════════════════════
function om(id){document.getElementById(id).classList.add('open');enhanceModalSelects(id);}
function cm(id){document.getElementById(id).classList.remove('open');}
document.addEventListener('click',e=>{if(e.target.classList.contains('mov'))e.target.classList.remove('open');});

function openSellModal(unitId){
  if(S.role!=='admin'){toast('Admin only','warn');return;}
  const u=gunit(unitId);const db=gdb();
  document.getElementById('sell-lbl').textContent=`Unit ${u?.unitNo||''}`;
  const sel=document.getElementById('sl-by');
  sel.innerHTML=`<option value="">Select staff...</option>`+db.users.filter(u=>u.companyIds.includes(S.cid)).map(u=>`<option value="${u.name}">${u.name}</option>`).join('');
  if(u&&u.customerName){document.getElementById('sl-n').value=u.customerName||'';document.getElementById('sl-ph').value=u.phone||'';document.getElementById('sl-bk').value=u.bookingNo||'';document.getElementById('sl-by').value=u.soldBy||'';document.getElementById('sl-pr').value=u.totalPrice||'';document.getElementById('sl-pd').value=u.totalPaid||'';document.getElementById('sl-dt').value=u.soldDate||td();document.getElementById('sl-tp').value=u.status||'Installment';document.getElementById('sl-rem').value=u.remarks||'';}
  else{['sl-n','sl-ph','sl-bk','sl-pr','sl-pd','sl-rem'].forEach(id=>document.getElementById(id).value='');document.getElementById('sl-dt').value=td();document.getElementById('sl-tp').value='Installment';}
  _uid=unitId;om('m-sell');
}
function saveSell(){
  const name=document.getElementById('sl-n').value.trim();
  const price=parseFloat(document.getElementById('sl-pr').value)||0;
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
  const units=gunits().filter(u=>u.status!=='Available'&&u.status!=='Dead');
  const sel=document.getElementById('rc-u');
  sel.innerHTML=`<option value="">Select unit...</option>`+units.map(u=>`<option value="${u.id}" ${u.id===unitId?'selected':''}>${u.unitNo}${u.customerName?' — '+u.customerName:''}</option>`).join('');
  document.getElementById('rc-a').value='';document.getElementById('rc-d').value=td();document.getElementById('rc-r').value='';document.getElementById('rc-n').value='';document.getElementById('rc-t').value='Cash';
  if(unitId)sel.value=unitId;om('m-rec');
}
function saveRec(){
  const unitId=document.getElementById('rc-u').value;
  const amt=parseFloat(document.getElementById('rc-a').value)||0;
  const date=document.getElementById('rc-d').value||td();
  const ptype=document.getElementById('rc-t').value;
  const rcpt=document.getElementById('rc-r').value.trim();
  const notes=document.getElementById('rc-n').value.trim();
  // ── Validation ──
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
function openConModal(unitId){
  const units=gunits().filter(u=>u.status!=='Available'&&u.status!=='Dead');
  const sel=document.getElementById('cn-u');
  sel.innerHTML=`<option value="">Select unit...</option>`+units.map(u=>`<option value="${u.id}" ${u.id===unitId?'selected':''}>${u.unitNo}${u.customerName?' — '+u.customerName:''}</option>`).join('');
  document.getElementById('cn-n').value='';document.getElementById('cn-f').value='';document.getElementById('cn-d').value=td();document.getElementById('cn-t').value='Call';document.getElementById('cn-s').value='NoResponse';
  if(unitId)sel.value=unitId;om('m-con');
}
function saveCon(){
  const unitId=document.getElementById('cn-u').value;const notes=document.getElementById('cn-n').value.trim();
  if(!unitId){toast('Select a unit','err');return;}
  const contactDate=document.getElementById('cn-d').value||td();
  const db=gdb();db.contacts[S.cid]=db.contacts[S.cid]||[];
  const con={id:uid(),cid:S.cid,uid:unitId,date:contactDate,type:document.getElementById('cn-t').value,status:document.getElementById('cn-s').value,notes,fu:document.getElementById('cn-f').value,at:new Date().toISOString(),by:S.userId};
  db.contacts[S.cid].push(con);
  const units=db.units[S.cid]||[];const idx=units.findIndex(u=>u.id===unitId);if(idx>=0)units[idx].lastContactDate=contactDate;
  sdb(db);cm('m-con');const u=gunit(unitId);logA('con',`Contact for ${u?.unitNo||unitId}`);toast('Contact logged','ok');buildSB();
  const ap=document.querySelector('.pg.on')?.id?.replace('pg-','');if(ap)nav(ap);
}

function openUnitModal(unitId){
  if(S.role!=='admin'){toast('Admin only','warn');return;}
  _eunid=unitId;document.getElementById('unit-mtl').textContent=unitId?'Edit Unit':'Add Unit';
  const u=unitId?gunit(unitId):null;
  document.getElementById('un-no').value=u?.unitNo||'';document.getElementById('un-fl').value=u?.floor||'G';document.getElementById('un-tp').value=u?.type||'Shop';document.getElementById('un-ar').value=u?.area||'';document.getElementById('un-st').value=u?.status||'Available';
  document.getElementById('un-rem').value=u?.remarks||'';
  om('m-unit');
}
function saveUnit(){
  const no=document.getElementById('un-no').value.trim();if(!no){toast('Unit number required','err');return;}
  const fl=document.getElementById('un-fl').value;const flM={G:'Ground Floor',UG:'Lower Ground','1':'1st Floor','2':'2nd Floor','3':'3rd Floor','4':'4th Floor','5':'5th Floor','6':'6th Floor','7':'7th Floor','8':'8th Floor','9':'9th Floor'};
  const newType=document.getElementById('un-tp').value;const newArea=parseFloat(document.getElementById('un-ar').value)||0;const newStatus=document.getElementById('un-st').value;
  const db=gdb();const units=db.units[S.cid]=db.units[S.cid]||[];
  if(_eunid){
    const idx=units.findIndex(u=>u.id===_eunid);
    if(idx>=0){
      // Check if unit no conflicts with another unit
      const conflict=units.find(u=>u.id!==_eunid&&u.unitNo.toLowerCase()===no.toLowerCase());
      if(conflict){toast('Another unit already has this number','err');return;}
      units[idx].unitNo=no;units[idx].floor=fl;units[idx].floorLabel=flM[fl]||fl;
      units[idx].type=newType;units[idx].area=newArea;units[idx].remarks=document.getElementById('un-rem')?.value?.trim()||units[idx].remarks||'';
      // Allow status change only to/from Available and Dead for unsold units
      const currentlySold=units[idx].status!=='Available'&&units[idx].status!=='Dead';
      if(!currentlySold)units[idx].status=newStatus;
    }
  } else {
    if(units.find(u=>u.unitNo.toLowerCase()===no.toLowerCase())){toast('Unit already exists','err');return;}
    units.push({id:'u'+uid(),companyId:S.cid,unitNo:no,floor:fl,floorLabel:flM[fl]||fl,type:newType,area:newArea,status:newStatus,customerName:'',phone:'',bookingNo:'',soldBy:'',soldDate:'',totalPrice:0,totalPaid:0,pendingAmount:0,lastPaymentDate:'',lastContactDate:'',remarks:document.getElementById('un-rem')?.value?.trim()||''});
  }
  sdb(db);cm('m-unit');toast(`Unit ${no} saved`,'ok');rUnits();
}

function openUserModal(userId){
  _euid=userId;document.getElementById('user-mtl').textContent=userId?'Edit User':'Add User';
  const db=gdb();const u=userId?db.users.find(x=>x.id===userId):null;
  document.getElementById('ur-nm').value=u?.name||'';document.getElementById('ur-un').value=u?.username||'';document.getElementById('ur-pw').value='';document.getElementById('ur-rl').value=u?.role||'user';
  document.getElementById('ur-cos').innerHTML=db.companies.map(co=>`<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" value="${co.id}" ${(!u||u.companyIds.includes(co.id))?'checked':''}> ${co.name}</label>`).join('');
  om('m-user');
}
function saveUser(){
  const name=document.getElementById('ur-nm').value.trim();const uname=document.getElementById('ur-un').value.trim();const pass=document.getElementById('ur-pw').value;const role=document.getElementById('ur-rl').value;
  if(!name||!uname){toast('Name and username required','err');return;}
  const cos=[...document.querySelectorAll('#ur-cos input:checked')].map(i=>i.value);if(!cos.length){toast('Select a company','err');return;}
  const db=gdb();
  if(_euid){const idx=db.users.findIndex(u=>u.id===_euid);if(idx>=0){db.users[idx].name=name;db.users[idx].username=uname;db.users[idx].role=role;db.users[idx].companyIds=cos;if(pass)db.users[idx].password=pass;}}
  else{if(!pass){toast('Password required','err');return;}if(db.users.find(u=>u.username===uname)){toast('Username taken','err');return;}db.users.push({id:'u'+uid(),username:uname,password:pass,name,role,companyIds:cos,createdAt:td()});}
  sdb(db);cm('m-user');toast(`User ${name} saved`,'ok');rAdmin();
}
function delUser(id){if(!confirm('Delete this user?'))return;const db=gdb();db.users=db.users.filter(u=>u.id!==id);sdb(db);toast('User deleted','ok');rAdmin();}


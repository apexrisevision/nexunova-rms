// ══ DATA HELPERS ══════════════════════════════
function gunits(){const db=gdb();let u=(db.units[S.cid]||[]);return S.role==='admin'?u:u.filter(u=>u.status!=='Dead');}
function gunit(id){return gdb().units[S?.cid]?.find(u=>u.id===id);}
function grecs(uid){const a=gdb().recoveries[S.cid]||[];return uid?a.filter(r=>r.uid===uid):a;}
function gcons(uid){const a=gdb().contacts[S.cid]||[];return uid?a.filter(c=>c.uid===uid):a;}
function srecs(uid){return grecs(uid).reduce((s,r)=>s+Number(r.amt),0);}
// V4: u.totalPaid is AUTHORITATIVE (updated on every saveRec/delRec). No more srecs aggregation needed.
function actualPaid(u){return Number(u.totalPaid||0);}
function actualPending(u){return Math.max(0,Number(u.totalPrice||0)-actualPaid(u));}
// Days since last payment (null = never paid)
function daysSincePay(u){
  const d=u.lastPaymentDate;
  if(!d)return null;
  try{const dt=new Date(d.length===10?d+'T00:00:00':d);if(isNaN(dt))return null;return Math.floor((Date.now()-dt)/86400000);}catch{return null;}
}
// Days since last contact (null = never contacted)
function daysSinceContact(u){
  const d=u.lastContactDate;
  if(!d)return null;
  try{const dt=new Date(d.length===10?d+'T00:00:00':d);if(isNaN(dt))return null;return Math.floor((Date.now()-dt)/86400000);}catch{return null;}
}
// Is unit overdue: pending > 0 and no payment in last X days (default 30)
function isOverdue(u,days=30){
  if(actualPending(u)<=0)return false;
  const d=daysSincePay(u);
  return d===null||d>=days;
}
// Overdue severity: 'critical' > 60d, 'warning' 30-60d, 'ok' < 30d, 'clear' no pending
function overdueSeverity(u){
  if(actualPending(u)<=0)return 'clear';
  const d=daysSincePay(u);
  if(d===null||d>60)return 'critical';
  if(d>=30)return 'warning';
  return 'ok';
}
function gfus(){
  const t=td(),a=gcons().filter(c=>c.fu);
  return{overdue:a.filter(c=>c.fu<t).sort((a,b)=>a.fu.localeCompare(b.fu)),today:a.filter(c=>c.fu===t),upcoming:a.filter(c=>c.fu>t).sort((a,b)=>a.fu.localeCompare(b.fu)).slice(0,10)};
}
function logA(type,msg){const db=gdb();db.log=db.log||[];db.log.unshift({id:uid(),type,msg,user:S?.name||'?',time:new Date().toISOString()});if(db.log.length>200)db.log=db.log.slice(0,200);sdb(db);}

function hasPermission(perm){
  if(!S)return false;
  if(S.role==='admin')return true;
  const role=S.role==='user'?'recovery':S.role;
  const perms={
    recovery:['dashboard','units.view','clients.view','clients.add','payments.view','payments.add','contacts.view','contacts.add'],
    accounts:['dashboard','payments.view','reports','clients.view','agents.view','financial']
  };
  return(perms[role]||[]).includes(perm);
}

function effectiveRole(){return(!S)?'':S.role==='user'?'recovery':S.role;}

function getCoLogo(){
  const db=gdb();
  const co=(db.companies||[]).find(c=>c.id===S?.cid);
  return co?.logo||null;
}


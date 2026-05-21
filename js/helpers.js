// ══ DATA HELPERS ══════════════════════════════
// gunits/gunit now read from Supabase cache (window._unitsCache)
// Cache is loaded by loadUnitsCache() on login. See db.js.
function gunits(){let u=(window._unitsCache||[]);return S?.role==='admin'||S?.role==='owner'?u:u.filter(u=>u.status!=='Dead');}
function gunit(id){return (window._unitsCache||[]).find(u=>u.id===id);}
function gclients(){return window._clientsCache||[];}
function gclient(id){return (window._clientsCache||[]).find(c=>c.id===id);}
function gprojects(){return window._projectsCache||[];}
function gproject(id){return (window._projectsCache||[]).find(p=>p.id===id);}
function gfloors(){return window._floorsCache||[];}
function gfloor(id){return (window._floorsCache||[]).find(f=>f.id===id);}
function gtypes(){return window._typesCache||[];}
function gtype(id){return (window._typesCache||[]).find(t=>t.id===id);}
function gstatuses(){return window._statusesCache||[];}
function gstatus(id){return (window._statusesCache||[]).find(s=>s.id===id);}
function grecs(uid){
  if(uid && window._paymentsByUnit && window._paymentsByUnit[uid]!==undefined)
    return window._paymentsByUnit[uid];
  const a=gdb().recoveries[S.cid]||[];
  return uid?a.filter(r=>r.uid===uid):a;
}
function gcons(uid){const a=window._contactLogsCache||[];return uid?a.filter(c=>c.unit_id===uid):a;}
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
  const t=td(),a=(window._contactLogsCache||[]).filter(c=>c.next_followup_date);
  return{
    overdue:  a.filter(c=>c.next_followup_date<t).sort((a,b)=>a.next_followup_date.localeCompare(b.next_followup_date)),
    today:    a.filter(c=>c.next_followup_date===t),
    upcoming: a.filter(c=>c.next_followup_date>t).sort((a,b)=>a.next_followup_date.localeCompare(b.next_followup_date)).slice(0,10),
  };
}
function logA(type,msg){const db=gdb();db.log=db.log||[];db.log.unshift({id:uid(),type,msg,user:S?.name||'?',time:new Date().toISOString()});if(db.log.length>200)db.log=db.log.slice(0,200);sdb(db);}

// ── Global amount-input behaviour ──────────────────────────────────
// Applies to ALL inputs with class "inp-amt" (type=text, inputmode=numeric)
// and also type=number inputs: clears 0 on focus, restores on blur.

function _amtFmt(raw) {
  // Format a numeric string with commas: 100000 → "100,000"
  const n = parseFloat(String(raw).replace(/,/g, ''));
  if (isNaN(n) || n === 0) return '';
  return n.toLocaleString('en-PK', { maximumFractionDigits: 0 });
}
function parseAmt(v) {
  return parseFloat(String(v).replace(/,/g, '')) || 0;
}

(function _initAmtInputs() {
  // Focus: clear zero; Blur: restore zero if empty, format with commas
  document.addEventListener('focus', e => {
    const el = e.target;
    if (el.tagName !== 'INPUT') return;
    if (el.type === 'number') {
      if (el.value === '0' || el.value === '0.00') el.value = '';
    } else if (el.classList.contains('inp-amt')) {
      if (el.value === '0' || el.value === '0.00') el.value = '';
      else {
        // Remove commas so user can edit raw number
        const raw = parseFloat(el.value.replace(/,/g, ''));
        el.value = isNaN(raw) || raw === 0 ? '' : String(raw);
      }
    }
  }, true);

  document.addEventListener('blur', e => {
    const el = e.target;
    if (el.tagName !== 'INPUT') return;
    if (el.type === 'number') {
      if (el.value === '') el.value = '0';
    } else if (el.classList.contains('inp-amt')) {
      const raw = parseFloat(el.value.replace(/,/g, ''));
      el.value = isNaN(raw) ? '0' : raw.toLocaleString('en-PK', { maximumFractionDigits: 0 });
    }
  }, true);

  // While typing in inp-amt: allow only digits, show commas live
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.tagName !== 'INPUT' || !el.classList.contains('inp-amt')) return;
    const pos   = el.selectionStart;
    const raw   = el.value.replace(/[^0-9]/g, '');
    const fmted = raw ? parseInt(raw, 10).toLocaleString('en-PK') : '';
    const diff  = fmted.length - el.value.length;
    el.value = fmted;
    try { el.setSelectionRange(pos + diff, pos + diff); } catch(e) {}
  }, true);
})();

function hasPermission(perm){
  if(!S)return false;
  if(S.role==='admin'||S.role==='owner')return true;
  const role=S.role==='user'?'recovery':S.role;
  const perms={
    recovery:['dashboard','units.view','clients.view','clients.add','payments.view','payments.add','contacts.view','contacts.add'],
    accounts:['dashboard','payments.view','reports','clients.view','agents.view','financial']
  };
  return(perms[role]||[]).includes(perm);
}

function effectiveRole(){return(!S)?'':S.role==='user'?'recovery':S.role;}

function getCoLogo(){
  if(S?.cid){
    const logo=localStorage.getItem('rms_logo_'+S.cid);
    if(logo)return logo;
  }
  const db=gdb();
  const co=(db.companies||[]).find(c=>c.id===S?.cid);
  return co?.logo||null;
}

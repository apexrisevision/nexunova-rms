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
  // Format a numeric string with Pakistani grouping: 100000 → "1,00,000"
  const n = parseFloat(String(raw).replace(/,/g, ''));
  if (isNaN(n) || n === 0) return '';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function parseAmt(v) {
  return parseFloat(String(v).replace(/,/g, '')) || 0;
}

// ── CNIC mask + validation (Pakistan: xxxxx-xxxxxxx-x, 5-7-1 = 13 digits) ──
// Live mask: wire on a CNIC input's oninput → maskCNIC(this). Strips non-digits,
// caps at 13, and re-inserts the two dashes as the user types.
function maskCNIC(el) {
  if (!el) return;
  const d = String(el.value).replace(/\D/g, '').slice(0, 13);
  let out = d;
  if (d.length > 5)  out = d.slice(0, 5) + '-' + d.slice(5);
  if (d.length > 12) out = d.slice(0, 5) + '-' + d.slice(5, 12) + '-' + d.slice(12);
  el.value = out;
}
// Returns true for a complete, well-formed CNIC. (Empty is handled by the caller —
// CNIC is optional on co-buyer/nominee, required for local clients.)
function isValidCNIC(v) {
  return /^\d{5}-\d{7}-\d$/.test(String(v || '').trim());
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
      el.value = isNaN(raw) ? '0' : raw.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    }
  }, true);

  // While typing in inp-amt: allow only digits, show commas live
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.tagName !== 'INPUT' || !el.classList.contains('inp-amt')) return;
    const pos   = el.selectionStart;
    const raw   = el.value.replace(/[^0-9]/g, '');
    const fmted = raw ? parseInt(raw, 10).toLocaleString('en-IN') : '';
    const diff  = fmted.length - el.value.length;
    el.value = fmted;
    try { el.setSelectionRange(pos + diff, pos + diff); } catch(e) {}
  }, true);
})();

function hasPermission(perm){
  if(!S)return false;
  if(S.role==='admin'||S.role==='owner')return true;

  // Per-user module_permissions take priority when explicitly set.
  // The permission key in the DB uses the module key (e.g. 'projects', 'recovery', 'reports').
  // Map nav page IDs to module keys where they differ.
  const _pageToModule = {
    units:'units', unitdetail:'units', addunit:'units',
    clients:'clients', clientdetail:'clients',
    recovery:'recovery', addpayment:'recovery', receipts:'recovery', pdc:'recovery',
    contacts:'contacts',
    reports:'reports',
    documents:'documents',
    agents:'agents',
    search:'search',
    projects:'projects', projectdetail:'projects',
    sales:'projects', salesdetail:'projects',
    cancelledunits:'units', transferunits:'units',
    ledgers:'reports', 'ledger-client':'reports', 'ledger-unit':'reports',
    'ledger-agent':'reports', 'ledger-project':'reports',
    commissions:'agents',
    reminders:'contacts',
    paylinks:'recovery', 'paylink-detail':'recovery',
    healthcenter:'clients',
    radar:'recovery',
    promises:'contacts',
    officerledger:'reports', receivingledger:'reports',
    audit:'reports',
  };
  const moduleKey = _pageToModule[perm] || perm;

  const userPerms = (S && S.permissions) ? S.permissions : null;
  const hasExplicit = userPerms && Object.keys(userPerms).length > 0;

  // dashboard is always accessible to any authenticated user
  if(perm === 'dashboard') return true;

  const role = S.role === 'user' ? 'recovery' : S.role;

  if(role === 'manager' || role === 'staff'){
    // Fully permissions-driven — no hardcoded fallback
    return hasExplicit ? !!(userPerms[moduleKey]) : false;
  }

  // For recovery / accounts: explicit per-user permissions win when set,
  // otherwise fall back to hardcoded role defaults (backward compatibility).
  if(hasExplicit && moduleKey in userPerms){
    return !!(userPerms[moduleKey]);
  }

  const defaults = {
    recovery:['dashboard','units','clients','recovery','contacts'],
    accounts:['dashboard','recovery','reports','clients','agents']
  };
  return(defaults[role]||[]).includes(moduleKey);
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

// ── Password Strength Validator (Fix 7) ──────────────────────────────
const _PWD_BLOCKLIST = [
  'password','12345678','qwerty123','pakistan1','admin123',
  'nexunova1','00000000','11111111','password1','abc12345',
  'letmein1','welcome1','iloveyou','monkey123','dragon123'
];

function validatePasswordStrength(pwd) {
  if (!pwd || pwd.length < 8)
    return { valid: false, message: 'Password must be at least 8 characters.' };
  if (!/[A-Z]/.test(pwd))
    return { valid: false, message: 'Password must contain at least one uppercase letter.' };
  if (!/[a-z]/.test(pwd))
    return { valid: false, message: 'Password must contain at least one lowercase letter.' };
  if (!/[0-9]/.test(pwd))
    return { valid: false, message: 'Password must contain at least one number.' };
  if (!/[^A-Za-z0-9]/.test(pwd))
    return { valid: false, message: 'Password must contain at least one special character (e.g. @, #, $, !).' };
  if (_PWD_BLOCKLIST.includes(pwd.toLowerCase()))
    return { valid: false, message: 'This password is too common. Please choose a stronger one.' };
  return { valid: true, message: '' };
}

// ── Caps Lock warning (shared across auth password fields) ───────────
// Toggles the `.on` class on a `.lx-caps` element whenever the Caps Lock
// key state is detected on an associated password input.
function wireCapsLockWarning(inputId, warnId) {
  const inp  = document.getElementById(inputId);
  const warn = document.getElementById(warnId);
  if (!inp || !warn || inp._capsWired) return;
  inp._capsWired = true;
  const upd = (e) => {
    let on = false;
    try { on = !!(e.getModifierState && e.getModifierState('CapsLock')); } catch (_) {}
    warn.classList.toggle('on', on);
  };
  inp.addEventListener('keydown', upd);
  inp.addEventListener('keyup',   upd);
  inp.addEventListener('blur', () => warn.classList.remove('on'));
}

document.addEventListener('DOMContentLoaded', function () {
  [['li-p', 'li-caps'], ['rp-pwd', 'rp-caps'], ['sg-pass', 'sg-caps']]
    .forEach(([i, w]) => wireCapsLockWarning(i, w));
});

// ── Lightweight bot detection (honeypot + time-trap) ─────────────────
// Self-contained, no external CAPTCHA service. Returns true if the
// submission looks automated: a hidden honeypot field was filled, or the
// form was submitted implausibly fast. Real users never trip either.
function nxBotCheck(honeypotId, formShownAt, minMs) {
  const hp = document.getElementById(honeypotId);
  if (hp && hp.value && hp.value.trim() !== '') return true;             // honeypot filled
  if (formShownAt && minMs && (Date.now() - formShownAt) < minMs) return true; // too fast
  return false;
}

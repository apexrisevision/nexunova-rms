// ══ SHARED CRYSTAL REPORT STYLE (single source) ══════════════════════════════
// Classic Crystal accounting look used by BOTH the hub reports (reports.js,
// .crystal-rpt markup) and the ledgers module (ledgers.js, .ldg-crystal markup).
// Injected once; scoped to those containers so nothing leaks to other pages.
function _injectCrystalStyle(){
  if(document.getElementById('crystal-rpt-style'))return;
  var s=document.createElement('style');s.id='crystal-rpt-style';
  s.textContent=[
    // ── hub reports (.crystal-rpt) ──
    '.crystal-rpt{font-family:"Times New Roman",Georgia,serif;color:#1a1a1a}',
    '.crystal-rpt .card{border:1px solid #333;border-radius:4px;background:#fff;box-shadow:none}',
    '.crystal-rpt .tw{overflow-x:auto}',
    '.crystal-rpt table.t,.crystal-rpt .tw table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums;background:#fff}',
    '.crystal-rpt .t th,.crystal-rpt .t td{border:1px solid #333;padding:5px 8px;white-space:nowrap;vertical-align:middle}',
    '.crystal-rpt .t thead th{background:#fff;color:#1a1a1a;font-weight:700;text-align:left;text-transform:none;letter-spacing:0;border-bottom:3px double #333}',
    '.crystal-rpt .t th.r,.crystal-rpt .t td.r,.crystal-rpt .t .num{text-align:right;font-variant-numeric:tabular-nums}',
    '.crystal-rpt .t tbody tr:nth-child(even),.crystal-rpt .t tbody tr:nth-child(even) td{background:#fff}',
    '.crystal-rpt .t tbody tr:hover td{background:#f4f4f4}',
    '.crystal-rpt .t tfoot td{background:#E8E8E8;font-weight:700;border-top:3px double #333}',
    '.crystal-rpt .t tr.totals-row td,.crystal-rpt .t tr.total td{background:#E8E8E8;font-weight:700}',
    '.crystal-rpt .crpt-title{text-align:center;font-weight:700;font-size:15px;text-decoration:underline;margin:2px 0 10px}',
    '.crystal-rpt .crpt-infobox{border:1px solid #333;border-radius:4px;padding:9px 13px;margin-bottom:12px;display:grid;grid-template-columns:1fr 1fr;gap:3px 26px}',
    '.crystal-rpt .crpt-infobox .ir{font-size:12px}.crystal-rpt .crpt-infobox .ir b{display:inline-block;min-width:96px}',
    // ── ledgers (.ldg-crystal) — same tokens (serif, #333 ruled, #E8E8E8 totals) ──
    '.ldg-crystal{font-family:"Times New Roman",Georgia,serif;color:#1a1a1a;background:#fff;border:1px solid #333;border-radius:4px;overflow:hidden}',
    '.ldg-crystal.lc-head{border-radius:4px 4px 0 0;border-bottom:0}',
    '.ldg-crystal.lc-body{border-radius:0 0 4px 4px}',
    '.ldg-crystal .lc-title{text-align:center;padding:12px 16px 10px}',
    '.ldg-crystal .lc-co{font-size:17px;font-weight:700;letter-spacing:.3px}',
    '.ldg-crystal .lc-doc{font-size:13px;font-weight:700;letter-spacing:1.5px;margin-top:2px;text-decoration:underline}',
    '.ldg-crystal .lc-info{border-top:1px solid #333;border-bottom:1px solid #333;padding:9px 16px;display:grid;grid-template-columns:1fr 1fr;gap:3px 26px;font-size:12px}',
    '.ldg-crystal .lc-info .ir b{display:inline-block;min-width:96px;font-weight:700}',
    '.ldg-crystal .lc-tw{overflow-x:auto}',
    '.ldg-crystal table.lc-tbl{border-collapse:collapse;width:100%;min-width:760px;font-size:11px;font-variant-numeric:tabular-nums;background:#fff}',
    '.ldg-crystal .lc-tbl th,.ldg-crystal .lc-tbl td{border:1px solid #333;padding:5px 8px;vertical-align:middle}',
    '.ldg-crystal .lc-tbl thead th{background:#fff;color:#1a1a1a;font-weight:700;text-align:left;border-bottom:3px double #333;white-space:nowrap}',
    '.ldg-crystal .lc-tbl th.num,.ldg-crystal .lc-tbl td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.ldg-crystal .lc-tbl tr.lc-mhdr td{background:#dcdcdc;font-weight:700;letter-spacing:.3px}',
    '.ldg-crystal .lc-tbl tr.lc-mtot td{background:#E8E8E8;font-weight:700}',
    '.ldg-crystal .lc-tbl tr.lc-gtot td{background:#cfcfcf;font-weight:700;border-top:3px double #333}',
    '.ldg-crystal .lc-tbl tr.lc-ob td{font-style:italic}',
    '.ldg-crystal .lc-dr{color:#b91c1c;font-weight:600}.ldg-crystal .lc-cr{color:#15803d;font-weight:600}.ldg-crystal .lc-zero{color:#6b7280}',
    // bottom Outstanding Balance Summary box
    '.ldg-crystal .lc-summary{margin:14px 16px 16px;border:1px solid #333;border-radius:5px;padding:10px 14px;max-width:380px}',
    '.ldg-crystal .lc-summary h4{font-size:12px;font-weight:700;text-decoration:underline;text-align:center;margin:0 0 7px}',
    '.ldg-crystal .lc-sum-row{display:flex;justify-content:space-between;gap:14px;padding:3px 0;border-bottom:1px dotted #aaa;font-size:12px}',
    '.ldg-crystal .lc-sum-row:last-child{border-bottom:0}',
    '.ldg-crystal .lc-sum-row .l{font-weight:700}.ldg-crystal .lc-sum-row .v{font-weight:700;text-decoration:underline;font-variant-numeric:tabular-nums}'
  ].join('');
  document.head.appendChild(s);
}

// ══ DATA HELPERS ══════════════════════════════
// gunits/gunit now read from Supabase cache (window._unitsCache)
// Cache is loaded by loadUnitsCache() on login. See db.js.
// gunits/gclients apply the global PROJECT LENS (active project + per-user
// assignment) via projFilter() — see js/ui.js. Singular gunit(id)/gclient(id)
// lookups stay UNSCOPED so a detail page reached by explicit navigation still
// resolves its record even when another project is the active lens.
function gunits(){let u=(window._unitsCache||[]);if(!(S?.role==='admin'||S?.role==='owner'))u=u.filter(x=>x.status!=='Dead');return typeof projFilter==='function'?projFilter(u):u;}
function gunit(id){return (window._unitsCache||[]).find(u=>u.id===id);}
function gclients(){let c=(window._clientsCache||[]);return typeof projFilter==='function'?projFilter(c):c;}
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
  // Format a numeric string with Western thousands grouping: 100000 → "100,000"
  const n = parseFloat(String(raw).replace(/,/g, ''));
  if (isNaN(n) || n === 0) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function parseAmt(v) {
  return parseFloat(String(v).replace(/,/g, '')) || 0;
}

// 20260608 — apply a Western thousands mask (#,##0) to every NUMERIC cell of a
// SheetJS worksheet so Excel shows 12,345,678 (raw numbers, not strings). Call
// right before XLSX.writeFile. No-op if SheetJS / range is missing.
function xlsxWesternNumFmt(ws) {
  if (!ws || !ws['!ref'] || typeof XLSX === 'undefined') return ws;
  const R = XLSX.utils.decode_range(ws['!ref']);
  for (let r = R.s.r; r <= R.e.r; r++) {
    for (let c = R.s.c; c <= R.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'n') cell.z = '#,##0';
    }
  }
  return ws;
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
      el.value = isNaN(raw) ? '0' : raw.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
  }, true);

  // While typing in inp-amt: allow only digits, show commas live
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.tagName !== 'INPUT' || !el.classList.contains('inp-amt')) return;
    const pos   = el.selectionStart;
    const raw   = el.value.replace(/[^0-9]/g, '');
    const fmted = raw ? parseInt(raw, 10).toLocaleString('en-US') : '';
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
    recovery:'recovery', queue:'recovery', addpayment:'recovery', receipts:'recovery', pdc:'recovery',
    callreport:'recovery',
    contacts:'contacts',
    reports:'reports',
    documents:'documents',
    agents:'agents',
    search:'search',
    projects:'projects', projectdetail:'projects',
    sales:'sales', salesdetail:'sales', newsale:'sales', editsale:'sales',
    cancelledunits:'units', transferunits:'units',
    ledgers:'reports', 'ledger-client':'reports', 'ledger-unit':'reports',
    'ledger-agent':'reports', 'ledger-project':'reports',
    commissions:'agents',
    reminders:'contacts',
    paylinks:'recovery', 'paylink-detail':'recovery',
    healthcenter:'clients',
    radar:'recovery',
    promises:'contacts',
    fieldvisits:'recovery', escalations:'recovery', campaigns:'recovery', legalcases:'recovery',
    myrecovery:'recovery',
    agentrecovery:'reports',
    officerledger:'reports', receivingledger:'reports',
    audit:'reports',
  };
  const moduleKey = _pageToModule[perm] || perm;

  const userPerms = (S && S.permissions) ? S.permissions : null;
  const hasExplicit = userPerms && Object.keys(userPerms).length > 0;

  // dashboard is always accessible to any authenticated user
  if(perm === 'dashboard') return true;

  const role = S.role === 'user' ? 'recovery' : S.role;

  if(role === 'staff'){
    // Staff: fully permissions-driven — no hardcoded fallback (admin grants modules explicitly).
    return hasExplicit ? !!(userPerms[moduleKey]) : false;
  }

  // For recovery / accounts / manager: explicit per-user permissions win when set,
  // otherwise fall back to hardcoded role defaults (backward compatibility).
  if(hasExplicit && moduleKey in userPerms){
    return !!(userPerms[moduleKey]);
  }

  const defaults = {
    recovery:['dashboard','units','clients','recovery','contacts','reports','sales'],
    accounts:['dashboard','recovery','reports','clients','agents','units','sales','documents'],   // must cover every module the accounts sidebar advertises, else shown items bounce (units=cancelled/transfer ledgers)
    // Manager = broad READ-ONLY across the app. These grant page/module READ access only;
    // write/edit/delete stay blocked by the `role-readonly` body class + server-side authz
    // (manager write-block batches). Mirrors recovery/accounts so a manager works
    // out-of-the-box even with empty module_permissions {}.
    manager:['dashboard','projects','units','clients','recovery','contacts','reports','documents','agents','sales','search']
  };
  return(defaults[role]||[]).includes(moduleKey);
}

function effectiveRole(){return(!S)?'':S.role==='user'?'recovery':S.role;}

// ── Company branding accessors (Phase 1B) ───────────────────────────────────
// getCoLogo is SERVER-FIRST: the authoritative logo lives at companies.logo_url
// (surfaced on window._cobranding.logo_url). localStorage is a per-browser cache
// / offline fallback only. The in-memory company object is the last resort.
function getCoLogo(){
  const b=window._cobranding;
  if(b&&b.logo_url) return b.logo_url;
  if(S?.cid){
    const logo=localStorage.getItem('rms_logo_'+S.cid);
    if(logo)return logo;
  }
  const db=gdb();
  const co=(db.companies||[]).find(c=>c.id===S?.cid);
  return co?.logo_url||co?.logo||null;
}
// Legal name → financial / buyer-facing documents. Display name → staff chrome.
function coLegalName(){ return (window._cobranding&&window._cobranding.company_name)||(S&&S.coName)||'Nexunova'; }
function coDisplayName(){ var b=window._cobranding||{}; return b.display_name||b.company_name||(S&&S.coName)||'Nexunova'; }

// ── Shared logo upload → company-logos bucket + set_company_logo RPC ─────────
// Accepts PNG/JPG/SVG/WebP ≤2MB. Raster images are canvas-resized to ≤400×160
// (PNG, transparency preserved); SVG uploaded as-is. Returns the public URL
// (cache-busted) and updates window._cobranding + localStorage cache.
function _resizeLogoToBlob(file){
  if(file.type==='image/svg+xml') return Promise.resolve({blob:file,ext:'svg',ct:'image/svg+xml'});
  return new Promise(function(resolve,reject){
    const reader=new FileReader();
    reader.onerror=function(){reject(new Error('Could not read file'));};
    reader.onload=function(e){
      const img=new Image();
      img.onerror=function(){reject(new Error('Could not decode image'));};
      img.onload=function(){
        const maxW=400,maxH=160; let w=img.width,h=img.height;
        if(w>maxW||h>maxH){const sc=Math.min(maxW/w,maxH/h);w=Math.round(w*sc);h=Math.round(h*sc);}
        const cv=document.createElement('canvas');cv.width=w;cv.height=h;
        cv.getContext('2d').drawImage(img,0,0,w,h);
        cv.toBlob(function(b){ b?resolve({blob:b,ext:'png',ct:'image/png'}):reject(new Error('Could not encode image')); },'image/png',0.92);
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
async function uploadCompanyLogo(file){
  if(!S||!S.cid) throw new Error('No active company');
  const ok=['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp'];
  if(!ok.includes(file.type)) throw new Error('Use a PNG, JPG, SVG or WebP file');
  if(file.size>2*1024*1024) throw new Error('Logo must be 2 MB or smaller');
  const r=await _resizeLogoToBlob(file);
  // Unique filename + upsert:false — upsert:true would trigger a SELECT/UPDATE path
  // that INSERT-scoped storage RLS denies (see anon_storage_upsert_rls_denied); the
  // unique name also naturally busts any CDN cache on re-upload.
  const path=S.cid+'/logo_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)+'.'+r.ext;
  const up=await supabase.storage.from('company-logos').upload(path, r.blob, {upsert:false, contentType:r.ct});
  if(up.error) throw up.error;
  let url=supabase.storage.from('company-logos').getPublicUrl(path).data.publicUrl;
  const {error}=await supabase.rpc('set_company_logo',{p_company_id:S.cid, p_url:url});
  if(error) throw error;
  window._cobranding=window._cobranding||{}; window._cobranding.logo_url=url;
  try{ localStorage.setItem('rms_logo_'+S.cid, url); }catch(_){}
  return url;
}
async function clearCompanyLogo(){
  if(!S||!S.cid) return;
  const {error}=await supabase.rpc('set_company_logo',{p_company_id:S.cid, p_url:null});
  if(error) throw error;
  if(window._cobranding) window._cobranding.logo_url=null;
  try{ localStorage.removeItem('rms_logo_'+S.cid); }catch(_){}
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

/* ══════════════════════════════════════════════════════════════════════════
   DX — Enterprise Data Experience (reusable operational table layer)
   Progressive enhancement: opt-in per page, zero effect until called.
   Pairs with the .dx-* CSS in components.css. Dependency-free.
   API:
     DX.enhance(tableEl, opts)   → sticky/sort/search/keyboard, returns {refresh}
     DX.menu(anchorEl, items)    → popover menu, returns {close}
     DX.columns(tableEl, anchor) → column-visibility menu (persisted)
     DX.density(wrapEl, anchor)  → comfortable/compact toggle (persisted)
     DX.drawer(opts)             → slide-over panel, returns {close,setBody,setTab,el}
     DX.timeline(items)          → activity-timeline HTML
     DX.statusChip / agingChip / money / skeleton / empty → render helpers
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.DX) return;
  const esc = (s) => (window.esc ? window.esc(s) : String(s == null ? '' : s)
    .replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])));
  const ic = (path, sz) => '<svg width="' + (sz||15) + '" height="' + (sz||15) + '" viewBox="0 0 24 24" '
    + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';

  const DX = {};

  /* ── enhance: sort + instant search + keyboard nav ──────────────────── */
  DX.enhance = function (table, opts) {
    if (!table) return { refresh() {} };
    opts = opts || {};
    const tbody = table.tBodies[0];
    if (!tbody) return { refresh() {} };
    const ths = Array.from(table.tHead ? table.tHead.rows[0].cells : []);

    function rows() { return Array.from(tbody.rows); }
    function visibleRows() { return rows().filter(r => r.dataset.dxHidden !== '1'); }

    /* sort — opt-in per header via data-sort="text|num|date" */
    if (opts.sortable !== false) {
      ths.forEach((th, idx) => {
        const type = th.dataset.sort;
        if (!type) return;
        th.classList.add('dx-sortable');
        if (!th.querySelector('.dx-sort-ic')) {
          const inner = th.innerHTML;
          th.innerHTML = '<span class="dx-th-in">' + inner
            + ic('<path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/>', 12).replace('<svg', '<svg class="dx-sort-ic"') + '</span>';
        }
        th.addEventListener('click', () => {
          const desc = th.classList.contains('dx-sorted') && !th.classList.contains('desc');
          ths.forEach(t => t.classList.remove('dx-sorted', 'desc'));
          th.classList.add('dx-sorted'); if (desc) th.classList.add('desc');
          const val = (r) => {
            const cell = r.cells[idx]; if (!cell) return '';
            const raw = cell.dataset.v != null ? cell.dataset.v : cell.textContent.trim();
            if (type === 'num') return parseFloat(String(raw).replace(/[^0-9.\-]/g, '')) || 0;
            if (type === 'date') { const t = Date.parse(raw); return isNaN(t) ? 0 : t; }
            return String(raw).toLowerCase();
          };
          rows().sort((a, b) => {
            const x = val(a), y = val(b);
            return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
          }).forEach(r => tbody.appendChild(r));
        });
      });
    }

    /* instant search */
    function applySearch(q) {
      q = (q || '').trim().toLowerCase();
      let shown = 0;
      rows().forEach(r => {
        const hay = (r.dataset.search || r.textContent).toLowerCase();
        const hit = !q || hay.indexOf(q) !== -1;
        r.dataset.dxHidden = hit ? '0' : '1';
        r.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      if (opts.onFilter) opts.onFilter(shown);
      if (opts.emptyEl) opts.emptyEl.style.display = shown ? 'none' : '';
    }
    if (opts.search) {
      let t;
      opts.search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => applySearch(opts.search.value), 90); });
    }

    /* keyboard nav */
    if (opts.keyboard !== false) {
      table.tabIndex = table.tabIndex || 0;
      table.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
        const vis = visibleRows();
        if (!vis.length) return;
        let i = vis.findIndex(r => r.classList.contains('dx-focus'));
        if (e.key === 'Enter') { if (i >= 0) { e.preventDefault(); vis[i].click(); } return; }
        e.preventDefault();
        vis.forEach(r => r.classList.remove('dx-focus'));
        i = e.key === 'ArrowDown' ? Math.min(vis.length - 1, i + 1) : Math.max(0, i - 1);
        vis[i].classList.add('dx-focus');
        vis[i].scrollIntoView({ block: 'nearest' });
      });
    }
    return { refresh: applySearch };
  };

  /* ── menu: popover ──────────────────────────────────────────────────── */
  DX.menu = function (anchor, items, mopts) {
    mopts = mopts || {};
    closeAllMenus();
    const m = document.createElement('div');
    m.className = 'dx-menu'; m.dataset.dxMenu = '1';
    if (mopts.label) m.insertAdjacentHTML('beforeend', '<div class="dx-menu-lbl">' + esc(mopts.label) + '</div>');
    (items || []).forEach(it => {
      if (it.sep) { m.insertAdjacentHTML('beforeend', '<div class="dx-menu-sep"></div>'); return; }
      const b = document.createElement('button');
      b.className = 'dx-menu-item' + (it.danger ? ' danger' : '') + (it.checked ? ' on' : '');
      b.innerHTML = (it.icon ? ic(it.icon) : '') + '<span>' + esc(it.label) + '</span>'
        + (it.toggle ? ic('<polyline points="20 6 9 17 4 12"/>').replace('<svg', '<svg class="dx-menu-check"') : '');
      b.addEventListener('click', (e) => { e.stopPropagation(); if (it.onClick) it.onClick(b); if (!it.keepOpen) close(); });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = (r.bottom + 6) + 'px';
    const left = mopts.align === 'left' ? r.left : (r.right - m.offsetWidth);
    m.style.left = Math.max(8, left) + 'px';
    function close() { m.remove(); document.removeEventListener('click', out, true); document.removeEventListener('keydown', key); }
    function out(e) { if (!m.contains(e.target) && e.target !== anchor) close(); }
    function key(e) { if (e.key === 'Escape') close(); }
    setTimeout(() => { document.addEventListener('click', out, true); document.addEventListener('keydown', key); }, 0);
    return { close };
  };
  function closeAllMenus() { document.querySelectorAll('[data-dx-menu]').forEach(n => n.remove()); }

  /* ── column visibility (persisted by table id) ──────────────────────── */
  DX.columns = function (table, anchor) {
    const ths = Array.from(table.tHead.rows[0].cells);
    const key = 'dx.cols.' + (table.id || 'tbl');
    let hidden = {};
    try { hidden = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) {}
    function apply() {
      ths.forEach((th, i) => {
        const off = !!hidden[i];
        th.style.display = off ? 'none' : '';
        Array.from(table.tBodies[0].rows).forEach(r => { if (r.cells[i]) r.cells[i].style.display = off ? 'none' : ''; });
      });
    }
    apply();
    DX.menu(anchor, ths.map((th, i) => ({
      label: (th.textContent || ('Col ' + (i + 1))).trim() || ('Col ' + (i + 1)),
      toggle: true, checked: !hidden[i], keepOpen: true,
      onClick: (b) => { hidden[i] = hidden[i] ? false : true; if (!hidden[i]) delete hidden[i];
        localStorage.setItem(key, JSON.stringify(hidden)); b.classList.toggle('on', !hidden[i]); apply(); }
    })), { label: 'Columns', align: 'left' });
  };

  /* ── density toggle (persisted) ─────────────────────────────────────── */
  DX.density = function (wrap, anchor) {
    const key = 'dx.density.' + (wrap.id || 'tbl');
    function set(c) { wrap.classList.toggle('dx-compact', c); localStorage.setItem(key, c ? '1' : '0'); }
    if (anchor) {
      DX.menu(anchor, [
        { label: 'Comfortable', toggle: true, checked: !wrap.classList.contains('dx-compact'), onClick: () => set(false) },
        { label: 'Compact', toggle: true, checked: wrap.classList.contains('dx-compact'), onClick: () => set(true) }
      ], { label: 'Density', align: 'left' });
    }
    try { if (localStorage.getItem(key) === '1') wrap.classList.add('dx-compact'); } catch (_) {}
  };

  /* ── drawer: slide-over ─────────────────────────────────────────────── */
  DX.drawer = function (o) {
    o = o || {};
    closeAllMenus();
    const ov = document.createElement('div'); ov.className = 'dx-drawer-ov';
    const dr = document.createElement('div'); dr.className = 'dx-drawer' + (o.wide ? ' wide' : '');
    const tabsHtml = (o.tabs && o.tabs.length)
      ? '<div class="dx-drawer-tabs">' + o.tabs.map((t, i) =>
          '<button class="dx-drawer-tab' + (i === 0 ? ' on' : '') + '" data-tab="' + esc(t.id) + '">' + esc(t.label) + '</button>').join('') + '</div>'
      : '';
    dr.innerHTML =
      '<div class="dx-drawer-hd">'
      +   '<div style="min-width:0">'
      +     (o.eyebrow ? '<div class="dx-drawer-eyebrow">' + esc(o.eyebrow) + '</div>' : '')
      +     '<div class="dx-drawer-title">' + esc(o.title || '') + '</div>'
      +     (o.subtitle ? '<div class="dx-drawer-sub">' + (o.subtitleHtml ? o.subtitle : esc(o.subtitle)) + '</div>' : '')
      +   '</div>'
      +   '<button class="dx-drawer-x" aria-label="Close">' + ic('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>') + '</button>'
      + '</div>'
      + tabsHtml
      + '<div class="dx-drawer-bd"></div>'
      + (o.footer ? '<div class="dx-drawer-ft">' + o.footer + '</div>' : '');
    document.body.appendChild(ov); document.body.appendChild(dr);
    const bd = dr.querySelector('.dx-drawer-bd');
    function setBody(html) { if (typeof html === 'function') { bd.innerHTML = ''; html(bd); } else { bd.innerHTML = html || ''; } }
    if (o.body != null) setBody(o.body);
    requestAnimationFrame(() => { ov.classList.add('on'); dr.classList.add('on'); });
    function close() {
      ov.classList.remove('on'); dr.classList.remove('on');
      document.removeEventListener('keydown', key);
      setTimeout(() => { ov.remove(); dr.remove(); if (o.onClose) o.onClose(); }, 300);
    }
    function key(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', close);
    dr.querySelector('.dx-drawer-x').addEventListener('click', close);
    document.addEventListener('keydown', key);
    function setTab(id) {
      dr.querySelectorAll('.dx-drawer-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === id));
      if (o.onTab) o.onTab(id, bd);
    }
    dr.querySelectorAll('.dx-drawer-tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
    if (o.tabs && o.tabs.length && o.onTab) o.onTab(o.tabs[0].id, bd);
    return { close, setBody, setTab, el: dr, body: bd };
  };

  /* ── render helpers ─────────────────────────────────────────────────── */
  DX.timeline = function (items) {
    return '<div class="dx-timeline">' + (items || []).map(it =>
      '<div class="dx-tl-item ' + (it.type || '') + '"><span class="dx-tl-dot"></span>'
      + '<div class="dx-tl-hd"><span class="dx-tl-t">' + esc(it.title || '') + '</span>'
      + (it.time ? '<span class="dx-tl-time">' + esc(it.time) + '</span>' : '') + '</div>'
      + (it.body ? '<div class="dx-tl-body">' + esc(it.body) + '</div>' : '') + '</div>'
    ).join('') + '</div>';
  };
  DX.statusChip = function (label, kind) { return '<span class="dx-status ' + (kind || 'neutral') + '">' + esc(label) + '</span>'; };
  DX.agingChip = function (days) {
    const d = Number(days) || 0;
    const cls = d >= 90 ? 'a90' : d >= 60 ? 'a60' : d >= 30 ? 'a30' : 'a0';
    return '<span class="dx-aging ' + cls + '">' + (d > 0 ? d + 'd' : 'Current') + '</span>';
  };
  DX.money = function (amount, o) {
    o = o || {}; const n = Number(amount) || 0;
    const cls = o.sign ? (n >= 0 ? ' pos' : ' neg') : '';
    const fmt = window.fM ? window.fM(Math.abs(n)) : Math.abs(n).toLocaleString('en-US');
    return '<span class="dx-money' + cls + '"><span class="cur">' + (o.cur || 'PKR') + '</span>' + fmt + '</span>';
  };
  DX.skeleton = function (rows, cols) {
    rows = rows || 8; cols = cols || 5;
    let h = '';
    for (let r = 0; r < rows; r++) {
      h += '<div class="dx-skel-row">';
      for (let c = 0; c < cols; c++) h += '<div class="dx-skel-bar" style="width:' + (c === 0 ? 38 : 50 + (c * 7) % 40) + '%;flex:' + (c === 0 ? 2 : 1) + '"></div>';
      h += '</div>';
    }
    return h;
  };
  DX.empty = function (o) {
    o = o || {};
    return '<div class="dx-empty"><div class="dx-empty-ic">'
      + ic(o.icon || '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', 22) + '</div>'
      + '<div class="dx-empty-t">' + esc(o.title || 'Nothing here yet') + '</div>'
      + (o.sub ? '<div class="dx-empty-s">' + esc(o.sub) + '</div>' : '')
      + (o.cta ? '<div class="dx-empty-cta">' + o.cta + '</div>' : '') + '</div>';
  };

  window.DX = DX;
})();

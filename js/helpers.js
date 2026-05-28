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
    const fmt = window.fM ? window.fM(Math.abs(n)) : Math.abs(n).toLocaleString('en-IN');
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

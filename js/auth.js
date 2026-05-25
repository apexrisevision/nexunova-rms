// â•â• AUTH â€” LOGIN / LOGOUT (Supabase + Notify) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const SUPPORT_EMAIL = 'support@nexunova.com';

// Page-load timestamp â€” used to ignore auto-triggered logins
let _loginReadyAt = 0;

function initLogin(){
  const coSel=document.getElementById('co-sel');
  if(coSel){coSel.innerHTML='';coSel.style.display='none';}
  const tbD=document.getElementById('tb-d');
  if(tbD)tbD.textContent=new Date().toLocaleDateString('en-PK',{weekday:'short',day:'numeric',month:'short',year:'numeric'});

  const err=document.getElementById('lerr');
  if(err) err.style.display='none';

  // Clear any browser autofill so doLogin() doesn't trigger on stale values
  const u = document.getElementById('li-u');
  const p = document.getElementById('li-p');
  if(u) u.value = '';
  if(p) p.value = '';

  // Strongly discourage browser autofill
  if(u){
    u.setAttribute('autocomplete', 'off');
    u.setAttribute('autocorrect', 'off');
    u.setAttribute('spellcheck', 'false');
    u.setAttribute('readonly', 'readonly');
    // Remove readonly when user actually focuses (allows real typing)
    u.addEventListener('focus', function onFocus(){
      u.removeAttribute('readonly');
      u.removeEventListener('focus', onFocus);
    });
  }
  if(p){
    p.setAttribute('autocomplete', 'new-password');
    p.setAttribute('readonly', 'readonly');
    p.addEventListener('focus', function onFocus(){
      p.removeAttribute('readonly');
      p.removeEventListener('focus', onFocus);
    });
  }

  // Mark when login is actually ready for user input
  // Any doLogin() call within 800ms of init is likely a browser autofill submit, ignore it
  _loginReadyAt = Date.now() + 1500;
}

function toggleLxPwd() {
  const inp = document.getElementById('li-p');
  const btn = document.getElementById('lx-eye');
  if (!inp || !btn) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>'
    : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
}

async function doLogin(){
  if(Date.now() < _loginReadyAt) return;
  // Abort if already logged in AND app screen is visible
  if(S && document.getElementById('s-app')?.classList.contains('on')) return;
  if(!document.getElementById('s-login')?.classList.contains('on')) return;
  S = null; // Clear any stale in-progress session so fresh login can proceed

  const raw  = document.getElementById('li-u').value.trim();
  const pass = document.getElementById('li-p').value;

  const err = document.getElementById('lerr');
  if(err) err.style.display = 'none';

  if(!raw || !pass){
    notify.error('Missing fields', { detail: 'Please enter both username and password.' });
    return;
  }

  // Format: username@COMPANYCODE  or bare COMPANYCODE (legacy)
  let username = '', companyCode = '';
  if(raw.includes('@')){
    const at = raw.lastIndexOf('@');
    username    = raw.slice(0, at).trim();
    companyCode = raw.slice(at + 1).trim();
  } else {
    username    = raw;
    companyCode = raw;
  }

  if(!username || !companyCode){
    notify.error('Invalid credentials', {
      detail: `Username or password is incorrect.<br>Need help? Contact ${SUPPORT_EMAIL}`
    });
    return;
  }

  const _btn = document.getElementById('lx-signin-btn');
  const _sp  = _btn?.querySelector('span');
  const _sv  = _btn?.querySelector('svg');
  const _btnReset = () => {
    if(_btn){ _btn.disabled=false; _btn.classList.remove('lx-loading'); if(_sp) _sp.textContent='Sign In'; if(_sv) _sv.style.opacity=''; }
  };
  if(_btn){ _btn.disabled=true; _btn.classList.add('lx-loading'); if(_sp) _sp.textContent='Signing in...'; if(_sv) _sv.style.opacity='0'; }

  try {
    const { data: res, error: rpcErr } = await supabase.rpc('verify_login', {
      p_company_code: companyCode,
      p_username:     username,
      p_password:     pass
    });

    if(rpcErr){ console.error(rpcErr); _btnReset(); notify.error('Server error', { detail: 'Please try again in a moment.' }); return; }
    if(!res)  { _btnReset(); notify.error('Server error', { detail: 'Empty response - please try again.' }); return; }

    if(!res.success){
      const errMap = {
        invalid_credentials: `Username or password is incorrect.<br>Need help? Contact ${SUPPORT_EMAIL}`,
        company_inactive:    `This company account is inactive. Contact ${SUPPORT_EMAIL}`,
        user_inactive:       'Your account is disabled. Contact your administrator.'
      };
      _btnReset();
      if (res.error === 'email_not_verified') {
        const userEmail = res.email || '';
        notify.error('Email not verified', {
          detail: `Please check <strong>${userEmail}</strong> and click the confirmation link.<br>
            <a href="#" onclick="fpResendConfirm('${userEmail}')" style="color:#38bdf8;text-decoration:underline">Resend confirmation email</a>`
        });
        return;
      }
      // Fix 1: Brute force lockout
      if (res.error === 'account_locked') {
        let detail = 'Too many failed attempts. Account locked for 15 minutes.';
        if (res.locked_until) {
          try {
            const unlockTime = new Date(res.locked_until);
            const mins = Math.max(1, Math.ceil((unlockTime - Date.now()) / 60000));
            detail = `Too many failed attempts. Account locked for ${mins} more minute${mins !== 1 ? 's' : ''}.`;
          } catch(_) {}
        }
        _logAuthEventAnon({ event_type:'login_locked', username, details:{ company_code:companyCode } });
        notify.error('Account locked', { detail });
        return;
      }
      _logAuthEventAnon({ event_type:'login_failed', username, details:{ company_code:companyCode, reason:res.error } });
      notify.error('Sign in failed', { detail: errMap[res.error] || res.message || 'Authentication failed.' });
      return;
    }

    const user    = res.user;
    const company = res.company;

    await _completeLogin(user, company);

  } catch(e){
    console.error(e);
    _btnReset();
    notify.error('Connection error', { detail: 'Check your internet connection and try again.' });
  }
}

// ── Admin / Owner 2FA — OTP gate before session creation ─────────────
async function _triggerAdminOTP(user, company) {
  const email = user.email;
  if (!email) {
    // No email on record — skip OTP and complete login (should not happen)
    console.warn('[auth] admin/owner has no email — skipping OTP gate');
    await _completeLogin(user, company);
    return;
  }

  let sendRes;
  try {
    sendRes = await supabase.functions.invoke('send-auth-otp', {
      body: { email, type: 'admin_login' }
    });
  } catch(_) {
    notify.error('Verification failed', { detail: 'Could not send verification code. Please try again.' });
    return;
  }

  if (sendRes?.data?.error) {
    notify.error('Verification failed', { detail: sendRes.data.error });
    return;
  }

  // OTP overlay appears over the login screen (position:fixed covers it)
  showOTPScreen({
    subtitle: 'A verification code has been sent to your registered email',
    onVerify: async (otpCode) => {
      let verRes;
      try {
        verRes = await supabase.functions.invoke('verify-auth-otp', {
          body: { email, otp: otpCode, type: 'admin_login' }
        });
      } catch(_) {
        return { error: 'Verification failed. Please try again.' };
      }
      const data = verRes?.data || {};
      if (data.success) {
        // OTP verified — NOW create session and complete login
        await _completeLogin(user, company);
      }
      return data;
    },
    onResend: async () => {
      try {
        const res = await supabase.functions.invoke('send-auth-otp', {
          body: { email, type: 'admin_login' }
        });
        return res?.data || {};
      } catch(_) {
        return { error: 'Failed to resend. Please try again.' };
      }
    },
    onExpire: () => {
      // OTP screen shows "Code expired" — user must resend
    },
    onMaxAttempts: () => {
      // 5 wrong attempts — clear everything and send back to login
      document.getElementById('s-login').classList.add('on');
      notify.error('Verification failed', { detail: 'Too many incorrect attempts. Please log in again.', duration: 5000 });
    }
  });
}

// ── Complete login — called after all verification passes ─────────────
async function _completeLogin(user, company) {
  _coid = company.id;
  const subStatus = company.sub_status || 'active';

  S = {
    userId:             user.id,
    name:               user.name,
    username:           user.username || '',
    role:               user.role,
    permissions:        user.module_permissions || {},
    sessionVersion:     user.session_version || 1,
    cid:                company.id,
    coName:             company.name || '',
    coCode:             company.code || '',
    isDemo:             (company.code || '') === 'DEMO',
    onboardingComplete: company.onboarding_complete,
    subStatus:          subStatus,
    planCode:           company.plan_code   || '',
    invoiceId:          company.invoice_id  || null,
    invoiceNumber:      company.invoice_number || null,
    invoiceAmount:      company.invoice_amount || null,
    invoiceCurrency:    company.invoice_currency || 'PKR',
    invoiceDue:         company.invoice_due || null
  };
  sessionStorage.setItem('nxn_sess', JSON.stringify(S));

  const _blockedStatuses = ['pending_payment','payment_under_review','expired','cancelled','past_due'];
  if(_blockedStatuses.includes(subStatus)){
    document.getElementById('s-login').classList.remove('on');
    if(typeof PW !== 'undefined') PW.show(subStatus);
    return;
  }

  await Promise.all([
    typeof loadFloorsCache   === 'function' ? loadFloorsCache(company.id)   : Promise.resolve(),
    typeof loadTypesCache    === 'function' ? loadTypesCache(company.id)    : Promise.resolve(),
    typeof loadStatusesCache === 'function' ? loadStatusesCache(company.id) : Promise.resolve(),
    typeof loadProjectsCache === 'function' ? loadProjectsCache(company.id) : Promise.resolve(),
    typeof loadClientsCache  === 'function' ? loadClientsCache(company.id)  : Promise.resolve(),
  ]);
  if(typeof loadUnitsCache === 'function') await loadUnitsCache(company.id);
  if(typeof loadAppUsersCache === 'function') loadAppUsersCache(company.id).catch(()=>{});
  if(typeof loadContactLogsCache === 'function') loadContactLogsCache(company.id).catch(()=>{});

  document.getElementById('sb-av').textContent = ini(user.name);
  document.getElementById('sb-un').textContent = user.name;
  const roleLabels = { admin:'Admin / CFO', owner:'Owner / Admin', recovery:'Recovery Staff', accounts:'Accounts Staff' };
  document.getElementById('sb-ur').textContent = roleLabels[user.role] || 'Staff';

  document.getElementById('s-login').classList.remove('on');
  document.getElementById('s-app').classList.add('on');
  if(typeof stopLoginAnimations === 'function') stopLoginAnimations();
  if(typeof stopLoginBG         === 'function') stopLoginBG();

  if(typeof updateCoLogo   === 'function') updateCoLogo();
  if(typeof startLeakGuard === 'function') startLeakGuard();
  buildSB();

  if(company.onboarding_complete === false && typeof OB !== 'undefined'){
    OB.show(company.id);
  } else {
    nav(effectiveRole()==='recovery' ? 'recovery-dashboard' : 'dashboard');
    if(typeof TUT !== 'undefined') TUT.maybeShow();
  }

  if(typeof checkAutoBackup === 'function') checkAutoBackup();
  if(typeof initDemoBanner === 'function') initDemoBanner();
  _checkPlatformAnnouncements();
  notify.success(`Welcome, ${user.name}`, { duration: 2500 });
  _startSessionCheck();
  _startIdleTimer();
  _logAuthEvent(company.id, { event_type:'login_success', user_id:user.id, username:user.username });
  if (typeof loadCobranding    === 'function') loadCobranding();
  if (typeof loadFeatureFlags  === 'function') loadFeatureFlags();
  _loadSubscription();
}

async function _loadSubscription() {
  try {
    const { data } = await supabase.rpc('get_subscription_with_plan', { p_company_id: S.cid });
    window._subscription = data || null;
    if (!data) return;
    if (data.status !== 'trialing' || !data.trial_ends_at) return;
    if (sessionStorage.getItem('rms_trial_dismissed')) return;
    const daysLeft = Math.ceil((new Date(data.trial_ends_at) - Date.now()) / 86400000);
    if (daysLeft > 7) return;
    const expired  = daysLeft <= 0;
    const banner   = document.getElementById('trial-banner');
    const inner    = document.getElementById('trial-banner-inner');
    const msg      = document.getElementById('trial-banner-msg');
    if (!banner || !inner || !msg) return;
    if (expired) {
      inner.className = 'trial-banner-inner expired';
      msg.innerHTML   = '<strong>Trial expired</strong> — Your free trial has ended. Upgrade to continue full access.';
    } else if (daysLeft === 0) {
      inner.className = 'trial-banner-inner expiring';
      msg.innerHTML   = '<strong>Trial expires today!</strong> — Upgrade now to avoid losing access.';
    } else {
      inner.className = 'trial-banner-inner expiring';
      msg.innerHTML   = `<strong>Trial expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong> — Go to Admin → Plan to request an upgrade.`;
    }
    banner.style.display = '';
  } catch(_) {}
}

function doLogout(reason){
  if(S && S.cid) _logAuthEvent(S.cid, { event_type: reason || 'logout', user_id: S.userId, username: S.username });
  _stopSessionCheck();
  _stopIdleTimer();
  S=null;_coid=null;_navStack=[];_navBack=false;
  sessionStorage.removeItem('nxn_sess');
  window._featureFlags = null;
  window._cobranding   = null;
  window._subscription = null;
  window._unitsCache = [];
  window._unitsCacheLoaded = false;
  window._projectsCache = [];
  window._projectsCacheLoaded = false;
  window._clientsCache = [];
  window._clientsCacheLoaded = false;
  window._contactLogsCache = [];
  window._appUsersCache = [];
  window._nxnMaxProjects = null;
  document.getElementById('s-app')?.classList.remove('on');
  document.getElementById('s-payment-wall')?.classList.remove('on');
  document.getElementById('s-login').classList.add('on');
  document.getElementById('li-u').value='';
  document.getElementById('li-p').value='';
  const err=document.getElementById('lerr');
  if(err){err.style.display='none';}
  initLogin();
}

// ── Fix 6: Session validity polling ──────────────────────────────────
let _sessionCheckTimer = null;

function _startSessionCheck() {
  _stopSessionCheck();
  // First check after 5 min, then every 5 min
  _sessionCheckTimer = setInterval(_checkSessionValidity, 5 * 60 * 1000);
}

function _stopSessionCheck() {
  if (_sessionCheckTimer) { clearInterval(_sessionCheckTimer); _sessionCheckTimer = null; }
}

async function _checkSessionValidity() {
  if (!S) return;
  try {
    const { data, error } = await supabase.rpc('check_session_valid', {
      p_user_id:        S.userId,
      p_session_version: S.sessionVersion
    });
    if (error || !data?.valid) {
      _stopSessionCheck();
      notify.warning('Session expired', { detail: 'Your password was changed. Please sign in again.', duration: 5000 });
      setTimeout(() => doLogout(), 1500);
    }
  } catch(_) {}
}

async function _checkPlatformAnnouncements() {
  try {
    const { data } = await supabase.rpc('get_active_announcements');
    const list = Array.isArray(data) ? data : [];
    if (list.length === 0) return;
    const seen = JSON.parse(sessionStorage.getItem('nxn_ann_seen') || '[]');
    list.filter(a => !seen.includes(a.id)).forEach(a => {
      const typeMap = { info:'info', warning:'warn', success:'ok', error:'err' };
      const msg = a.title + (a.body ? ' — ' + a.body : '');
      if (typeof toast === 'function') toast(msg, typeMap[a.type] || 'info', 8000);
      seen.push(a.id);
    });
    sessionStorage.setItem('nxn_ann_seen', JSON.stringify(seen));
  } catch(_) {}
}

// ══ MODULE 12 — SESSION INACTIVITY TIMEOUT ════════════════════════

let _idleTimer     = null;
let _idleWarnTimer = null;
let _idleActive    = false;
const _IDLE_WARN_SEC = 60; // warn 60 s before logout

function _startIdleTimer() {
  _stopIdleTimer();
  const timeoutMin = _getIdleTimeoutMin();
  if (!timeoutMin || timeoutMin <= 0) return;
  _idleActive = true;
  const activityEvents = ['mousemove','mousedown','keydown','touchstart','scroll','click'];
  activityEvents.forEach(ev => window.addEventListener(ev, _resetIdleTimer, { passive:true }));
  _scheduleIdleLogout(timeoutMin);
}

function _stopIdleTimer() {
  clearTimeout(_idleTimer);
  clearTimeout(_idleWarnTimer);
  _idleTimer = _idleWarnTimer = null;
  _idleActive = false;
  const activityEvents = ['mousemove','mousedown','keydown','touchstart','scroll','click'];
  activityEvents.forEach(ev => window.removeEventListener(ev, _resetIdleTimer));
  const warn = document.getElementById('_idle-warn-bar');
  if (warn) warn.remove();
}

function _resetIdleTimer() {
  if (!_idleActive || !S) return;
  clearTimeout(_idleTimer);
  clearTimeout(_idleWarnTimer);
  const warn = document.getElementById('_idle-warn-bar');
  if (warn) warn.remove();
  const timeoutMin = _getIdleTimeoutMin();
  if (!timeoutMin || timeoutMin <= 0) return;
  _scheduleIdleLogout(timeoutMin);
}

function _scheduleIdleLogout(timeoutMin) {
  const totalMs  = timeoutMin * 60 * 1000;
  const warnMs   = Math.max(totalMs - _IDLE_WARN_SEC * 1000, 1000);
  _idleWarnTimer = setTimeout(_showIdleWarning, warnMs);
  _idleTimer     = setTimeout(_onIdleExpire,    totalMs);
}

function _showIdleWarning() {
  if (!S) return;
  let bar = document.getElementById('_idle-warn-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = '_idle-warn-bar';
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#1e293b;border-top:2px solid #f59e0b;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:#f1f5f9';
    document.body.appendChild(bar);
  }
  let secs = _IDLE_WARN_SEC;
  const update = () => {
    if (!document.getElementById('_idle-warn-bar')) return;
    bar.innerHTML = `
      <span>⚠️ No activity detected — you'll be logged out in <b style="color:#f59e0b">${secs}s</b></span>
      <button onclick="_resetIdleTimer()" style="background:#6366f1;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">Stay logged in</button>`;
    if (secs > 0) { secs--; setTimeout(update, 1000); }
  };
  update();
}

function _onIdleExpire() {
  _stopIdleTimer();
  if (!S) return;
  if (typeof notify !== 'undefined' && notify.warning) {
    notify.warning('Session timed out', { detail: 'You were logged out due to inactivity.', duration: 4000 });
  }
  setTimeout(() => doLogout('session_expired'), 800);
}

function _getIdleTimeoutMin() {
  if (!S || !S.cid) return 120;
  try {
    const stored = localStorage.getItem('rms.sec.timeout.' + S.cid);
    if (stored !== null) return parseInt(stored, 10);
  } catch(_) {}
  return 120;
}

function _setIdleTimeoutMin(min) {
  if (!S || !S.cid) return;
  try { localStorage.setItem('rms.sec.timeout.' + S.cid, String(parseInt(min, 10) || 0)); } catch(_) {}
  if (min > 0) { _stopIdleTimer(); _startIdleTimer(); }
  else { _stopIdleTimer(); }
}

// ══ MODULE 12 — AUTH EVENT LOGGING ════════════════════════════════

async function _logAuthEvent(companyId, payload) {
  if (!companyId) return;
  try {
    await supabase.rpc('log_auth_event', {
      p_company_id: companyId,
      p_data: {
        ...payload,
        user_agent: navigator.userAgent.slice(0, 200),
      }
    });
  } catch(_) {}
}

function _logAuthEventAnon(payload) {
  try {
    supabase.rpc('log_auth_event', {
      p_company_id: null,
      p_data: { ...payload, user_agent: navigator.userAgent.slice(0, 200) }
    }).catch(() => {});
  } catch(_) {}
}

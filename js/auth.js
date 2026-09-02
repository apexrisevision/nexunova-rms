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

  // Re-arm the Sign In button. On a SUCCESSFUL login doLogin() leaves the button
  // disabled + "Signing in..." (it only resets on failure); the success path just
  // hides the login screen. After logout the screen is shown again, so without this
  // the button stays disabled/"Signing in..." and re-login is impossible until a
  // full page refresh rebuilds it. Mirrors doLogin()'s _btnReset.
  const _sb = document.getElementById('lx-signin-btn');
  if(_sb){
    _sb.disabled = false;
    _sb.classList.remove('lx-loading');
    const _sbSpan = _sb.querySelector('span'); if(_sbSpan) _sbSpan.textContent = 'Sign In';
    const _sbSvg = _sb.querySelector('svg'); if(_sbSvg) _sbSvg.style.opacity = '';
  }

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
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
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
          detail: userEmail
            ? `Please check ${userEmail} and click the confirmation link to activate your account.`
            : 'Please check your inbox and click the confirmation link to activate your account.',
          onMount: (dialog, close) => {
            if (!userEmail) return;
            const footer = dialog.querySelector('.nx-dialog-ok')?.parentNode;
            if (!footer) return;
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = 'Resend confirmation email';
            b.style.cssText = 'background:transparent !important;color:#a5b4fc !important;border:1px solid rgba(165,180,252,0.3) !important;padding:6px 16px !important;border-radius:6px !important;font-weight:500 !important;font-size:13px !important;cursor:pointer !important;font-family:inherit !important;';
            b.addEventListener('click', () => { close(); fpResendConfirm(userEmail); });
            footer.insertBefore(b, footer.firstChild);   // sits left of OK
          }
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

    // Establish a real Supabase auth session so auth.uid() works app-wide (Phase-1 RPCs).
    // verify_login has just re-synced auth.users (bcrypt cost 10), so this should match.
    // HARD-BLOCK: never allow a half-authenticated state — without a JWT, every RPC
    // call goes out as anon and (post-anon-revoke) returns 401. Better to fail loud
    // at the door than render a broken app where Client Ledger / Units / Sales all
    // 401 silently.
    if (!user.email) {
      _btnReset();
      notify.error('Sign in failed', { detail: `This account has no email on file. Contact ${SUPPORT_EMAIL} to set one.` });
      _logAuthEventAnon({ event_type:'session_bridge_failed', username, details:{ reason:'no_email' } });
      return;
    }
    const { error: _authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: pass });
    if (_authErr) {
      console.error('[auth] session bridge failed:', _authErr.message);
      _btnReset();
      notify.error('Sign in failed', { detail: `Your session could not be established. Please try again in a moment — if it persists, contact ${SUPPORT_EMAIL}.` });
      _logAuthEventAnon({ event_type:'session_bridge_failed', username, details:{ reason: _authErr.message } });
      return;
    }

    // Force password change: first login (needs_password_reset) OR expired password.
    const _pwExpired = user.password_expires_at && new Date(user.password_expires_at) < new Date();
    if (user.needs_password_reset === true || _pwExpired) {
      _btnReset();
      _showForcePasswordChange(user, company, _pwExpired ? 'expired' : 'first_login');
      return;
    }

    // Admin/Owner 2FA — gate on the company's require_2fa_admin setting.
    // Off by default; when the admin opts in, an email OTP is required before
    // the session is created. _triggerAdminOTP fails open if the OTP service
    // is unreachable, so a misconfigured mailer can never lock an admin out.
    const _isAdminLike = (user.role === 'admin' || user.role === 'owner');
    if (_isAdminLike && company.require_2fa_admin === true && user.email) {
      _btnReset();
      await _triggerAdminOTP(user, company);
      return;
    }

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
    // OTP service unreachable (edge function not deployed / network) — fail
    // OPEN so the admin is never locked out of their own ERP. The password
    // has already been verified at this point.
    console.warn('[auth] admin OTP send unreachable — proceeding without 2FA');
    await _completeLogin(user, company);
    return;
  }

  if (sendRes?.data?.error) {
    // OTP service returned an error (e.g. RESEND_API_KEY not configured) —
    // fail open for the same reason.
    console.warn('[auth] admin OTP send error — proceeding without 2FA:', sendRes.data.error);
    await _completeLogin(user, company);
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
  // Record WHICH Supabase auth user this tab is bound to, so the cross-tab guard
  // can detect if the shared (localStorage) token gets swapped by another tab.
  try { const { data: { session: _sbSess } } = await supabase.auth.getSession(); S.authUid = (_sbSess && _sbSess.user && _sbSess.user.id) || null; } catch(_) { S.authUid = null; }
  sessionStorage.setItem('nxn_sess', JSON.stringify(S));
  _installAuthGuard();

  const _blockedStatuses = ['pending_payment','payment_under_review','expired','cancelled','past_due'];
  if(_blockedStatuses.includes(subStatus)){
    document.getElementById('s-login').classList.remove('on');
    if(typeof PW !== 'undefined') PW.show(subStatus);
    return;
  }

  // Each loader returns false on failure (and console.errors). Record failures in
  // window._cacheLoadFailed so a failed fetch is distinguishable from a genuinely
  // empty tenant — banner + retry shown once the app screen is up (below).
  const _cacheNames = ['floors','types','statuses','saletypes','projects','clients'];
  const _cacheResults = await Promise.all([
    typeof loadFloorsCache   === 'function' ? loadFloorsCache(company.id)   : Promise.resolve(),
    typeof loadTypesCache    === 'function' ? loadTypesCache(company.id)    : Promise.resolve(),
    typeof loadStatusesCache === 'function' ? loadStatusesCache(company.id) : Promise.resolve(),
    typeof loadSaleTypesCache === 'function' ? loadSaleTypesCache(company.id) : Promise.resolve(),
    typeof loadProjectsCache === 'function' ? loadProjectsCache(company.id) : Promise.resolve(),
    typeof loadClientsCache  === 'function' ? loadClientsCache(company.id)  : Promise.resolve(),
  ]);
  window._cacheLoadFailed = {};
  _cacheResults.forEach((ok, i) => { if (ok === false) window._cacheLoadFailed[_cacheNames[i]] = true; });
  if(typeof loadUnitsCache === 'function') {
    const _unitsOk = await loadUnitsCache(company.id);
    if (_unitsOk === false) window._cacheLoadFailed.units = true;
  }
  if(typeof loadAppUsersCache === 'function') loadAppUsersCache(company.id).catch(()=>{});
  if(typeof loadContactLogsCache === 'function') loadContactLogsCache(company.id).catch(()=>{});

  document.getElementById('sb-av').textContent = ini(user.name);
  document.getElementById('sb-un').textContent = user.name;
  const roleLabels = { admin:'Admin / CFO', owner:'Owner / Admin', recovery:'Recovery Staff', accounts:'Accounts Staff', manager:'Manager' };
  document.getElementById('sb-ur').textContent = roleLabels[user.role] || 'Staff';

  document.getElementById('s-login').classList.remove('on');
  document.getElementById('s-app').classList.add('on');
  if(typeof stopLoginAnimations === 'function') stopLoginAnimations();
  if(typeof stopLoginBG         === 'function') stopLoginBG();

  if(typeof updateCoLogo   === 'function') updateCoLogo();
  if(typeof startLeakGuard === 'function') startLeakGuard();
  await _loadRoleContext(company.id, user.id, user.role);   // hasFinanceUser + assignedProjectIds for buildSB / data filters
  buildSB();
  if(typeof buildProjectSwitcher === 'function') buildProjectSwitcher();   // topbar active-project lens

  if(company.onboarding_complete === false && typeof OB !== 'undefined'){
    OB.show(company.id);
  } else {
    nav(effectiveRole()==='recovery' ? 'recovery-dashboard' : 'dashboard');
    if(typeof TUT !== 'undefined') TUT.maybeShow();
  }

  // FIX 4: surface any login-time cache-load failures (toast + retry banner)
  if (Object.keys(window._cacheLoadFailed || {}).length) {
    if (typeof toast === 'function') toast('Some data failed to load — not all records are shown', 'err');
    if (typeof showCacheLoadFailureBanner === 'function') showCacheLoadFailureBanner();
  }
  // FIX 3: detect legacy unsynced 'local_' client records stranded in this browser
  if (typeof checkStrandedLocalClients === 'function') checkStrandedLocalClients();

  if(typeof initDemoBanner === 'function') initDemoBanner();
  _checkPlatformAnnouncements();
  _checkPaymentThankYou();
  notify.success(`Welcome, ${user.name}`, { duration: 2500 });
  _startSessionCheck();
  _startIdleTimer();
  _registerSession();   // record this device/session in user_sessions (create_session RPC)
  _startSessionHeartbeat();   // keep last_seen_at fresh → powers "time on system"
  _logAuthEvent(company.id, { event_type:'login_success', user_id:user.id, username:user.username });
  if (typeof loadCobranding    === 'function') loadCobranding();
  if (typeof loadFeatureFlags  === 'function') loadFeatureFlags();
  _loadSubscription();
}

// ── Role context loader (called from _completeLogin before buildSB) ──────────
// Populates S.hasFinanceUser (drives Finance-group "sleep" in the sidebar) and
// S.assignedProjectIds (for non-admin client-side data filtering by site). Helper
// hasProjectAccess(pid) below is a global filter for caches/lists.
async function _loadRoleContext(companyId, userId, role) {
  // (a) Is there an ACTIVE finance user in the company? (Finance role sleeps until true.)
  try {
    const { data: lu } = await supabase.rpc('list_app_users', { p_company_id: companyId });
    const users = Array.isArray(lu) ? lu : (Array.isArray(lu?.rows) ? lu.rows : []);
    S.hasFinanceUser = users.some(u => (u.role === 'finance' || u.role === 'accounts') && (u.status || 'active') === 'active');
  } catch(_) { S.hasFinanceUser = false; }

  // (b) For non-admin users, load assigned project IDs so pages can filter caches client-side.
  // Admin / owner see everything (null = no filter).
  const isAdminLike = role === 'admin' || role === 'owner';
  if (isAdminLike) {
    S.assignedProjectIds = null;
    S.isProjectAdmin = true;
  } else {
    try {
      const { data: gp } = await supabase.rpc('get_user_projects', { p_user_id: userId });
      const rows = Array.isArray(gp?.rows) ? gp.rows : (Array.isArray(gp) ? gp : []);
      S.assignedProjectIds = rows.map(r => r.project_id).filter(Boolean);
      S.isProjectAdmin = !!gp?.is_admin;
    } catch(_) { S.assignedProjectIds = []; S.isProjectAdmin = false; }
  }
  // Persist updated S
  try { sessionStorage.setItem('nxn_sess', JSON.stringify(S)); } catch(_){}
}

// Global helper: does the caller currently have access to a given project_id?
// Returns true for admin/owner (no scoping), or if the project is in S.assignedProjectIds.
function hasProjectAccess(pid) {
  if (!pid) return true;
  if (!S) return false;
  if (S.assignedProjectIds === null) return true;          // admin / owner
  return Array.isArray(S.assignedProjectIds) && S.assignedProjectIds.includes(pid);
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

// ── Device / session tracking ────────────────────────────────────────
async function _registerSession() {
  try {
    let tokenHash = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token;
      if (tok && window.crypto?.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tok));
        tokenHash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
      }
    } catch(_) {}
    if (!tokenHash) tokenHash = (window.crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

    const dev = _detectDevice();
    const { data } = await supabase.rpc('create_session', { p_data: {
      session_token_hash: tokenHash,
      device_label: dev.label,
      device_type:  dev.type,
      user_agent:   (navigator.userAgent || '').slice(0, 500)
    }});
    if (data?.success && data.id && S) {
      S.sessionRowId = data.id;
      sessionStorage.setItem('nxn_sess', JSON.stringify(S));
    }
  } catch(_) {}
}

// ── Session heartbeat ────────────────────────────────────────────────
// Refreshes user_sessions.last_seen_at every 90s while the tab is visible by
// re-running _registerSession() (create_session upserts on the token hash). This
// is what makes "time on system" accrue in the admin Command Center / Team Activity.
let _ccHbTimer = null;
function _startSessionHeartbeat() {
  if (_ccHbTimer) clearInterval(_ccHbTimer);
  _ccHbTimer = setInterval(() => {
    if (document.visibilityState !== 'hidden' && S && S.userId) { try { _registerSession(); } catch(_) {} }
  }, 90000);
}
function _stopSessionHeartbeat() { if (_ccHbTimer) { clearInterval(_ccHbTimer); _ccHbTimer = null; } }

// Bootstrap for RESTORED sessions (page reload without a fresh credential login):
// once a Supabase session is present, register it + start the heartbeat.
(function () {
  function _ccHbBoot() {
    try {
      if (typeof supabase === 'undefined' || !supabase.auth) return;
      supabase.auth.getSession().then(({ data }) => {
        if (data && data.session) { try { _registerSession(); } catch(_) {} _startSessionHeartbeat(); }
      }).catch(() => {});
    } catch(_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(_ccHbBoot, 1800));
  else setTimeout(_ccHbBoot, 1800);
})();

function _detectDevice() {
  const ua = navigator.userAgent || '';
  const type = /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : /iPad|Tablet/i.test(ua) ? 'tablet' : 'desktop';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS|Macintosh/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return { label: browser + ' on ' + os, type };
}

// ── Forced password change (first login or expired password) ─────────
function _showForcePasswordChange(user, company, reason) {
  const old = document.getElementById('_fpc-overlay');
  if (old) old.remove();
  const subtitle = reason === 'expired'
    ? 'Your password has expired. Set a new password to continue.'
    : 'For security, please set a new password before continuing.';
  const ov = document.createElement('div');
  ov.id = '_fpc-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.92);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML =
    '<div style="background:var(--bg-modal);border-radius:14px;max-width:420px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.4)">' +
      '<h2 style="margin:0 0 6px;font-size:18px;color:var(--text)">Set a new password</h2>' +
      '<p style="margin:0 0 18px;font-size:13px;color:var(--text-muted)">' + subtitle + '</p>' +
      '<input id="_fpc-new" type="password" placeholder="New password" autocomplete="new-password" style="width:100%;padding:11px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:10px;box-sizing:border-box;color:var(--text)">' +
      '<input id="_fpc-conf" type="password" placeholder="Confirm new password" autocomplete="new-password" style="width:100%;padding:11px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:6px;box-sizing:border-box;color:var(--text)">' +
      '<div id="_fpc-msg" style="font-size:12px;color:#dc2626;min-height:16px;margin-bottom:10px"></div>' +
      '<button id="_fpc-go" style="width:100%;padding:11px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Update password &amp; continue</button>' +
    '</div>';
  document.body.appendChild(ov);
  const $new = ov.querySelector('#_fpc-new'), $conf = ov.querySelector('#_fpc-conf'),
        $msg = ov.querySelector('#_fpc-msg'), $go = ov.querySelector('#_fpc-go');
  $new.focus();

  async function _fpcSubmit() {
    const np = $new.value, cp = $conf.value;
    $msg.textContent = '';
    if (!np || np !== cp) { $msg.textContent = 'Passwords do not match.'; return; }
    $go.disabled = true; $go.textContent = 'Updating…';
    const { data, error } = await supabase.rpc('change_password', { p_new_password: np });
    if (error || !data?.success) {
      const map = {
        password_reused:   'You cannot reuse one of your last 3 passwords.',
        policy_violation:  data?.message || 'Password does not meet the policy.',
        password_required: 'Please enter a password.',
        no_session:        'Session error — please sign in again.'
      };
      $msg.textContent = map[data?.error] || data?.message || 'Could not update password.';
      $go.disabled = false; $go.textContent = 'Update password & continue';
      return;
    }
    // Password changed → session_version bumped + auth.users synced. Re-establish the session.
    if (user.email) await supabase.auth.signInWithPassword({ email: user.email, password: np }).catch(()=>{});
    user.session_version = data.session_version;
    ov.remove();
    if (typeof notify !== 'undefined') notify.success('Password updated');
    await _completeLogin(user, company);
  }
  $go.addEventListener('click', _fpcSubmit);
  $conf.addEventListener('keydown', e => { if (e.key === 'Enter') _fpcSubmit(); });
}

// ── Cross-tab auth guard ──────────────────────────────────────────────────────
// Supabase persists its auth token in localStorage (shared across ALL tabs), while
// this app keeps its own session (S) in sessionStorage (per-tab). Logging into a
// different company in another tab silently overwrites the shared token — leaving
// THIS tab showing company A while every RPC authenticates as company B (writes
// then fail 'wrong_tenant', reads may cross tenants). Detect the swap and sign out.
let _authGuardBusy = false;
async function _verifyAuthSession(){
  if(_authGuardBusy || !S || !S.authUid) return;      // no baseline (older session) → skip
  _authGuardBusy = true;
  try{
    const { data: { session } } = await supabase.auth.getSession();
    const cur = (session && session.user && session.user.id) || null;
    if(cur && cur !== S.authUid){
      try { if(typeof notify!=='undefined') notify.error('Signed out', { detail:'You signed in to a different account in another tab, so this tab was signed out. Please log in again.', duration: 8000 }); } catch(_){}
      doLogout('session_switched');
    }
  }catch(_){}
  finally{ _authGuardBusy = false; }
}
function _installAuthGuard(){
  if(window._authGuardInstalled) return;
  window._authGuardInstalled = true;
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState==='visible') _verifyAuthSession(); });
  window.addEventListener('focus', _verifyAuthSession);
  try { supabase.auth.onAuthStateChange(function(){ _verifyAuthSession(); }); } catch(_){}  // fires cross-tab on token change
}

function doLogout(reason){
  if(S && S.cid) _logAuthEvent(S.cid, { event_type: reason || 'logout', user_id: S.userId, username: S.username });
  if(S && S.sessionRowId){ try { supabase.rpc('revoke_session', { p_session_id: S.sessionRowId }).catch(()=>{}); } catch(_){} }
  try { supabase.auth.signOut().catch(()=>{}); } catch(_){}
  _stopSessionCheck();
  _stopIdleTimer();
  _stopSessionHeartbeat();
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

  /* A DELIBERATE sign-out is the one moment the choice of app is open again,
     so the hub forgets and asks. An expiry or a session taken over elsewhere is
     not that — the person did not choose to leave, and throwing them at a menu
     instead of the login they were about to use would be an obstacle, not a
     courtesy. Hence the reason check. */
  /* NOT inside the desktop app. "Nexunova RMS" on Windows is an Electron shell
     around this page: it asks for the company code, username and password in a
     native window and hands them straight here. Sending it to a hub offering the
     Self Service Portal and Attendance would answer a question its user never
     asked — that app IS the RMS door. It signs out to its own login screen, the
     way it always has. */
  const _isDesktop = /Electron/i.test(navigator.userAgent || '');
  if((!reason || reason === 'logout') && !_isDesktop){
    setTimeout(()=>{ location.href = '/app.html?logout=1'; }, 120);
  }
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
      return;
    }
    // Live permission refresh — S.permissions is snapshotted at login, so a module
    // granted in Users & Roles used to stay invisible until the user logged out and
    // back in. The RPC returns the caller's own role/permissions, so pick them up
    // here and rebuild the sidebar when they actually changed.
    _applyLivePermissions(data);
  } catch(_) {}
}

// Adopt role/module_permissions handed back by check_session_valid. No-op on older
// backends that don't return them.
function _applyLivePermissions(data) {
  if (!S || !data || typeof data !== 'object') return;
  if (!('permissions' in data) && !('role' in data)) return;

  const nextPerms = data.permissions && typeof data.permissions === 'object' ? data.permissions : {};
  const nextRole  = data.role || S.role;
  const changed   = JSON.stringify(nextPerms) !== JSON.stringify(S.permissions || {}) || nextRole !== S.role;
  if (!changed) return;

  S.permissions = nextPerms;
  S.role        = nextRole;
  try { sessionStorage.setItem('nxn_sess', JSON.stringify(S)); } catch(_) {}
  if (typeof buildSB === 'function') buildSB();
  if (typeof notify !== 'undefined' && notify.info) {
    notify.info('Your access was updated', { detail: 'New modules now appear in the menu.', duration: 4000 });
  }
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

// ── One-off "payment received" thank-you (per-tenant) ────────────────
// Shows a dismissible English modal on login, at most ONCE per calendar
// day, for up to 5 distinct days — then never again. TEMPORARY: remove
// on owner's word (delete the relevant entry + this fn's call).
function _checkPaymentThankYou() {
  try {
    if (!S) return;
    const code = String(S.coCode || '').toLowerCase();
    // Registry of active thank-you notices, keyed by company_code.
    const NOTICES = {
      '14groupofcompanies': {
        key:    'nxn_pay_ty_14g_v2',
        detail: 'We have received your payment successfully. Thank you for choosing Nexunova — your account is active.<br><br>Your next payment is due on 23 August 2026. Please pay on or before this date to avoid any interruption in access.'
      },
      'fmh': {
        key:    'nxn_pay_ty_fmh_v1',
        detail: 'We have received your payment successfully. Thank you for choosing Nexunova — your account is active.<br><br>Your next payment is due on 24 August 2026. Please pay on or before this date to avoid any interruption in access.'
      }
    };
    const cfg = NOTICES[code];
    if (!cfg) return;
    const MAX_SHOWS = 5;
    let st = {};
    try { st = JSON.parse(localStorage.getItem(cfg.key) || '{}'); } catch(_) { st = {}; }
    const count = st.count || 0;
    if (count >= MAX_SHOWS) return;
    const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD (local-ish)
    if (st.lastDay === today) return;                        // already shown today
    if (typeof notify === 'undefined' || !notify.alert) return;
    notify.alert({
      type:   'success',
      title:  'Thank you for your payment',
      detail: cfg.detail,
      okText: 'OK'
    });
    st.count = count + 1;
    st.lastDay = today;
    localStorage.setItem(cfg.key, JSON.stringify(st));
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
  return 30;
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

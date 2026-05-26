// ══ FORGOT PASSWORD / RESET PASSWORD ════════════════════════════════

// ── Forgot Password ──────────────────────────────────────────────────

let _fpShownAt = 0;   // bot time-trap baseline

function showForgotPassword() {
  document.querySelectorAll('.scr.on').forEach(s => s.classList.remove('on'));
  document.getElementById('s-forgot').classList.add('on');
  _fpShownAt = Date.now();
  const emailEl = document.getElementById('fp-email');
  if (emailEl) emailEl.value = '';
  const hpEl = document.getElementById('fp-hp');
  if (hpEl) hpEl.value = '';
  fpSetState('form');
  fpHideErr();
  const btn     = document.getElementById('fp-btn');
  const btnSpan = btn ? btn.querySelector('span') : null;
  if (btn)     btn.disabled = false;
  if (btnSpan) btnSpan.textContent = 'Send Reset Link';
}

function hideForgotPassword() {
  document.getElementById('s-forgot').classList.remove('on');
  document.getElementById('s-login').classList.add('on');
}

function fpSetState(state) {
  const formEl    = document.getElementById('fp-form');
  const successEl = document.getElementById('fp-success');
  if (formEl)    formEl.style.display    = (state === 'form')    ? '' : 'none';
  if (successEl) successEl.style.display = (state === 'success') ? '' : 'none';
}

function fpShowErr(msg) {
  const el = document.getElementById('fp-err');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function fpHideErr() {
  const el = document.getElementById('fp-err');
  if (el) el.style.display = 'none';
}

async function fpSubmit() {
  const emailEl = document.getElementById('fp-email');
  const email   = emailEl ? emailEl.value.trim() : '';

  if (!email) { fpShowErr('Please enter your email address.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fpShowErr('Please enter a valid email address.'); return;
  }

  // Bot trap — honeypot filled or submitted implausibly fast. Show the same
  // neutral success so an automated client can't distinguish it from a real
  // request (consistent with the anti-enumeration behaviour below).
  if (typeof nxBotCheck === 'function' && nxBotCheck('fp-hp', _fpShownAt, 1500)) {
    _fpShowAlwaysSuccess(email);
    return;
  }

  const btn     = document.getElementById('fp-btn');
  const btnSpan = btn ? btn.querySelector('span') : null;
  if (btn)     btn.disabled = true;
  if (btnSpan) btnSpan.textContent = 'Sending…';
  fpHideErr();

  // ── Anti-enumeration (OWASP ASVS V2.5 / NIST 800-63B) ──────────────
  // NEVER reveal whether an account exists. On every outcome — account
  // present, absent, rate-limited, or a swallowed transport hiccup — we
  // show the SAME neutral "if an account exists, a link was sent" screen.
  try {
    // Rate limit (max 3 per email per hour). If exceeded, still show success.
    const { data: rateCheck } = await supabase
      .rpc('check_reset_rate_limit', { p_email: email })
      .catch(() => ({ data: null }));

    if (rateCheck && rateCheck.allowed === false) {
      _fpShowAlwaysSuccess(email);
      return;
    }

    // Fire the reset email. Supabase returns 200 even for unknown emails;
    // any error is intentionally swallowed so existence cannot be inferred.
    const isElectron = typeof window.electronWindow !== 'undefined';
    const redirectTo = isElectron
      ? 'nexunovarms://auth/callback?flow=reset'
      : window.location.origin + '/login.html?flow=reset';

    await supabase.auth.resetPasswordForEmail(email, { redirectTo }).catch(() => {});

  } catch (e) {
    // Genuine client-side failure — surface a neutral, existence-agnostic error.
    if (btn)     btn.disabled = false;
    if (btnSpan) btnSpan.textContent = 'Send Reset Link';
    notify.error('Something went wrong. Please try again in a moment.');
    return;
  }

  _fpShowAlwaysSuccess(email);
}

function _fpShowAlwaysSuccess(email) {
  const sentEl = document.getElementById('fp-sent-email');
  if (sentEl) sentEl.textContent = email;
  fpSetState('success');
}

// ── Reset Password ────────────────────────────────────────────────────

function rpSetState(state) {
  ['exchanging', 'form', 'success', 'error'].forEach(s => {
    const el = document.getElementById('rp-' + s);
    if (el) el.style.display = (s === state) ? '' : 'none';
  });
  rpHideFormErr();
}

function rpShowFormErr(msg) {
  const el = document.getElementById('rp-form-err');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function rpHideFormErr() {
  const el = document.getElementById('rp-form-err');
  if (el) el.style.display = 'none';
}

function rpToggleEye(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

async function rpSubmit() {
  const pwd  = document.getElementById('rp-pwd')?.value  || '';
  const conf = document.getElementById('rp-conf')?.value || '';

  // FIX 7: Use shared strength validator if available, otherwise minimum length check
  if (typeof validatePasswordStrength === 'function') {
    const check = validatePasswordStrength(pwd);
    if (!check.valid) { rpShowFormErr(check.message); return; }
  } else {
    if (pwd.length < 8) { rpShowFormErr('Password must be at least 8 characters.'); return; }
  }
  if (pwd !== conf) { rpShowFormErr('Passwords do not match.'); return; }

  const btn     = document.getElementById('rp-btn');
  const btnSpan = btn ? btn.querySelector('span') : null;
  if (btn)     btn.disabled = true;
  if (btnSpan) btnSpan.textContent = 'Updating…';
  rpHideFormErr();

  try {
    const { error } = await supabase.auth.updateUser({ password: pwd });
    if (error) throw error;

    // FIX 5: Handle sync failure explicitly — do not silently swallow
    const { data: syncRes, error: syncErr } = await supabase.rpc('sync_reset_password', { p_new_password: pwd });
    if (syncErr || !syncRes?.success) {
      console.error('[rpSubmit] sync_reset_password failed:', syncErr?.message || syncRes?.error);
      rpShowFormErr(
        'Password updated but sync failed — please try resetting again or contact support@nexunova.com'
      );
      if (btn)     btn.disabled = false;
      if (btnSpan) btnSpan.textContent = 'Update Password';
      return;
    }

    // Sign out the PKCE reset session so it can't be reused
    await supabase.auth.signOut().catch(() => {});

    rpSetState('success');
    setTimeout(() => {
      try { window.history.replaceState({}, '', window.location.pathname); } catch(_) {}
      document.getElementById('s-reset').classList.remove('on');
      document.getElementById('s-login').classList.add('on');
      if (typeof initLogin === 'function') initLogin();
    }, 2500);
  } catch (e) {
    rpShowFormErr(e.message || 'Failed to update password. Please try again.');
    if (btn)     btn.disabled = false;
    if (btnSpan) btnSpan.textContent = 'Update Password';
  }
}

// ── Resend confirmation email — FIX 4: 60-second cooldown ─────────────
let _lastResendAt = 0;
let _resendTimer  = null;

async function fpResendConfirm(email) {
  if (!email) return;

  const COOLDOWN = 60000;
  const elapsed  = Date.now() - _lastResendAt;

  if (_lastResendAt > 0 && elapsed < COOLDOWN) {
    const remaining = Math.ceil((COOLDOWN - elapsed) / 1000);
    if (typeof notify !== 'undefined') {
      notify.error('Please wait', { detail: `Wait ${remaining}s before requesting another confirmation email.` });
    }
    return;
  }

  try {
    const redirectTo = window.location.origin + '/login.html?flow=confirm';
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: redirectTo }
    });
    if (error) throw error;

    _lastResendAt = Date.now();
    _startResendCooldown();

    if (typeof notify !== 'undefined') {
      notify.success('Confirmation email sent — check your inbox.', { duration: 4000 });
    }
  } catch(e) {
    if (typeof notify !== 'undefined') {
      notify.error('Could not resend', { detail: e.message || 'Please try again.' });
    }
  }
}

function _startResendCooldown() {
  if (_resendTimer) clearInterval(_resendTimer);
  let remaining = 60;
  _resendTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(_resendTimer);
      _resendTimer = null;
    }
  }, 1000);
}

// ── Shared: exchange a PKCE code, gate on OTP, then show reset form ───
function _handleResetCode(code) {
  sessionStorage.removeItem('nxn_sess');

  document.querySelectorAll('.scr.on').forEach(s => s.classList.remove('on'));
  const resetEl = document.getElementById('s-reset');
  if (!resetEl) return;
  resetEl.classList.add('on');
  rpSetState('exchanging');

  supabase.auth.exchangeCodeForSession(code).then(async ({ error }) => {
    if (error) {
      rpSetState('error');
      const errEl = document.getElementById('rp-err-msg');
      if (errEl) errEl.textContent = error.message || 'This reset link is invalid or has expired.';
      return;
    }

    try { window.history.replaceState({}, '', window.location.pathname); } catch(_) {}

    // Get the authenticated user's email from the PKCE session
    let userEmail = '';
    try {
      const { data: { user } } = await supabase.auth.getUser();
      userEmail = user?.email || '';
    } catch(_) {}

    if (!userEmail) {
      // No email available — skip OTP gate and show form directly
      rpSetState('form');
      return;
    }

    // Send OTP to email
    let sendRes;
    try {
      sendRes = await supabase.functions.invoke('send-auth-otp', {
        body: { email: userEmail, type: 'password_reset' }
      });
    } catch(_) {
      rpSetState('error');
      const errEl = document.getElementById('rp-err-msg');
      if (errEl) errEl.textContent = 'Failed to send verification code. Please try again.';
      return;
    }

    if (sendRes?.data?.error) {
      rpSetState('error');
      const errEl = document.getElementById('rp-err-msg');
      if (errEl) errEl.textContent = sendRes.data.error || 'Failed to send verification code.';
      return;
    }

    // s-reset stays in 'exchanging' (spinner) while OTP overlay is shown on top
    showOTPScreen({
      subtitle: `Enter the 6-digit code sent to ${userEmail}`,
      onVerify: async (otpCode) => {
        let verRes;
        try {
          verRes = await supabase.functions.invoke('verify-auth-otp', {
            body: { email: userEmail, otp: otpCode, type: 'password_reset' }
          });
        } catch(_) {
          return { error: 'Verification failed. Please try again.' };
        }
        const data = verRes?.data || {};
        if (data.success) {
          rpSetState('form');
        }
        return data;
      },
      onResend: async () => {
        try {
          const res = await supabase.functions.invoke('send-auth-otp', {
            body: { email: userEmail, type: 'password_reset' }
          });
          return res?.data || {};
        } catch(_) {
          return { error: 'Failed to resend. Please try again.' };
        }
      },
      onExpire: () => {
        // OTP screen already shows "Code expired" — user must resend
      }
    });
  });
}

// ── Email confirmation after signup ──────────────────────────────────
async function _handleEmailConfirm(code) {
  sessionStorage.removeItem('nxn_sess');

  document.querySelectorAll('.scr.on').forEach(s => s.classList.remove('on'));
  const el = document.getElementById('s-email-confirm');
  if (!el) { _handleResetCode(code); return; }
  el.classList.add('on');

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const loadEl = document.getElementById('ec-loading');
    const errEl  = document.getElementById('ec-error');
    const msgEl  = document.getElementById('ec-msg');
    if (loadEl) loadEl.style.display = 'none';
    if (errEl)  errEl.style.display  = '';
    if (msgEl)  msgEl.textContent = error.message || 'This confirmation link is invalid or has expired. Please request a new one.';
    return;
  }

  // Mark email verified in app_users
  await supabase.rpc('confirm_user_email').catch(() => {});
  // Sign out the one-time confirmation session
  await supabase.auth.signOut().catch(() => {});

  try { window.history.replaceState({}, '', window.location.pathname); } catch(_) {}

  const loadEl = document.getElementById('ec-loading');
  const okEl   = document.getElementById('ec-success');
  if (loadEl) loadEl.style.display = 'none';
  if (okEl)   okEl.style.display   = '';

  setTimeout(() => {
    el.classList.remove('on');
    document.getElementById('s-login')?.classList.add('on');
    if (typeof initLogin === 'function') initLogin();
  }, 3000);
}

// ── Browser: ?code= in URL on page load ──────────────────────────────
(function () {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  if (!code) return;
  const flow = params.get('flow') || 'reset';
  if (flow === 'confirm') _handleEmailConfirm(code);
  else                    _handleResetCode(code);
})();

// ── Electron: receive nexunovarms://auth/callback?code= via IPC ────────
// main.js sends 'auth-deep-link' after catching the OS deep-link event.
// electronAuth is exposed by preload-titlebar.js via contextBridge.
if (typeof window.electronAuth?.onDeepLink === 'function') {
  window.electronAuth.onDeepLink(function (url) {
    try {
      const urlParams = new URL(url).searchParams;
      const code = urlParams.get('code');
      const flow = urlParams.get('flow') || 'reset';
      if (!code) return;
      if (flow === 'confirm') _handleEmailConfirm(code);
      else                    _handleResetCode(code);
    } catch (e) {
      console.error('[auth-deep-link parse error]', e);
    }
  });
}

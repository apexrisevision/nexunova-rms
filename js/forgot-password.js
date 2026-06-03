// ══ FORGOT PASSWORD / RESET PASSWORD ════════════════════════════════

// ── Forgot Password — OTP-based flow ─────────────────────────────────
// Flow 2 (admin/owner):  Code+Email → send_admin_reset_otp → showOTPScreen → new password form → verify_admin_reset_otp
// Flow 3 (sub-user):     Code+Email → send_admin_reset_otp (fails) → notify_admin_subuser_reset → "sent to admin" screen

let _fpShownAt = 0;
let _fpCode    = '';   // company code entered
let _fpEmail   = '';   // email entered
let _fpOtp     = '';   // OTP digits stored after OTP screen (sent to verify_admin_reset_otp with new password)

// ── Mutual-exclusion: show exactly ONE auth screen, kill any lingering overlays ──
// Prevents the email-confirm screen from stacking on top of the forgot/reset
// screen (or vice-versa). Also dismisses the OTP + new-password overlays.
function _showOnlyAuthScreen(id) {
  document.getElementById('_fp-newpwd-overlay')?.remove();
  document.getElementById('otp-overlay')?.remove();
  document.querySelectorAll('.scr.on').forEach(s => s.classList.remove('on'));
  const el = document.getElementById(id);
  if (el) el.classList.add('on');
  return el;
}

// ── BUG 4: inject a Username field into the forgot form (UX/recall only) ──
// Done in JS so login.html is not touched. Not sent to the reset RPC (which
// matches on company_code + email); it just reminds the user of their login id.
function _fpEnsureUsernameField() {
  if (document.getElementById('fp-username')) return;
  const emailField = document.getElementById('fp-email')?.closest('.lx-field');
  if (!emailField) return;
  const wrap = document.createElement('div');
  wrap.className = 'lx-field';
  wrap.innerHTML =
    '<label class="lx-label">Username</label>' +
    '<input id="fp-username" class="lx-input" type="text" placeholder="Your login username" ' +
    'autocomplete="username" onkeydown="if(event.key===\'Enter\')document.getElementById(\'fp-email\').focus()">';
  emailField.parentNode.insertBefore(wrap, emailField);
}

function showForgotPassword() {
  if (window.__nxnEmailConfirm) return;   // never overlay an email-confirm landing
  document.querySelectorAll('.scr.on').forEach(s => s.classList.remove('on'));
  document.getElementById('s-forgot').classList.add('on');
  _fpShownAt = Date.now();
  _fpCode = ''; _fpEmail = ''; _fpOtp = '';
  _fpEnsureUsernameField();
  const codeEl  = document.getElementById('fp-code');
  const emailEl = document.getElementById('fp-email');
  const userEl  = document.getElementById('fp-username');
  const hpEl    = document.getElementById('fp-hp');
  if (codeEl)  codeEl.value  = '';
  if (emailEl) emailEl.value = '';
  if (userEl)  userEl.value  = '';
  if (hpEl)    hpEl.value    = '';
  fpSetState('form');
  fpHideErr();
  const btn     = document.getElementById('fp-btn');
  const btnSpan = btn ? btn.querySelector('span') : null;
  if (btn)     btn.disabled = false;
  if (btnSpan) btnSpan.textContent = 'Continue';
}

function hideForgotPassword() {
  const typedUser = (document.getElementById('fp-username')?.value || '').trim();
  document.getElementById('s-forgot').classList.remove('on');
  document.getElementById('s-login').classList.add('on');
  const u = document.getElementById('li-u');
  if (u && typedUser) u.value = typedUser;   // recall: carry username to the login form
}

function fpSetState(state) {
  ['form', 'success', 'notified'].forEach(s => {
    const id = s === 'form' ? 'fp-form' : s === 'success' ? 'fp-success' : 'fp-notified';
    const el = document.getElementById(id);
    if (el) el.style.display = (s === state) ? '' : 'none';
  });
  fpHideErr();
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
  _fpCode  = (document.getElementById('fp-code')?.value  || '').trim().toUpperCase();
  _fpEmail = (document.getElementById('fp-email')?.value || '').trim().toLowerCase();

  if (!_fpCode) { fpShowErr('Please enter your Company Code.'); return; }
  if (!_fpEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(_fpEmail)) {
    fpShowErr('Please enter a valid email address.'); return;
  }

  // Bot trap — honeypot or too-fast submit
  if (typeof nxBotCheck === 'function' && nxBotCheck('fp-hp', _fpShownAt, 1500)) {
    fpSetState('notified'); return;
  }

  const btn     = document.getElementById('fp-btn');
  const btnSpan = btn?.querySelector('span');
  if (btn)     btn.disabled = true;
  if (btnSpan) btnSpan.textContent = 'Checking…';
  fpHideErr();

  try {
    // Try admin/owner OTP flow first
    const { data: adminRes, error: adminErr } = await supabase.rpc('send_admin_reset_otp', {
      p_company_code: _fpCode,
      p_email:        _fpEmail,
      p_ip:           null
    });

    // A real RPC/transport failure surfaces a genuine error instead of silently
    // falling through to the sub-user "request sent to admin" screen. A logical
    // not_found arrives in `data` (not `error`), so anti-enumeration is preserved.
    if (adminErr) {
      console.error('send_admin_reset_otp failed:', adminErr);
      fpShowErr('Something went wrong. Please try again in a moment.');
      if (btn)     btn.disabled = false;
      if (btnSpan) btnSpan.textContent = 'Continue';
      return;
    }

    if (adminRes?.sent) {
      // Admin/owner path: show OTP overlay
      const channels = Array.isArray(adminRes.channels) ? adminRes.channels : ['email'];
      const subtitle = channels.includes('whatsapp')
        ? 'A 6-digit code was sent to your email and WhatsApp'
        : `A 6-digit code was sent to ${_fpEmail}`;

      showOTPScreen({
        subtitle,
        onVerify: async (otp) => {
          // Store OTP — actual verification happens together with password submit
          _fpOtp = otp;
          // Dismiss OTP overlay, then show password form
          setTimeout(() => _fpShowNewPasswordForm(), 60);
          return { success: true };
        },
        onResend: async () => {
          try {
            const { data: r } = await supabase.rpc('send_admin_reset_otp', {
              p_company_code: _fpCode,
              p_email: _fpEmail, p_ip: null
            });
            if (r?.sent) return {};
            if (r?.error === 'rate_limited') return { error: 'Too many requests. Please wait before resending.' };
            return { error: 'Could not resend. Please try again.' };
          } catch(_) { return { error: 'Could not resend. Please try again.' }; }
        }
      });
      return; // OTP overlay is now showing — leave btn disabled (screen switch coming)
    }

    // Not admin/owner — try sub-user notify path (or unknown email — anti-enum: always show same screen)
    try {
      await supabase.rpc('notify_admin_subuser_reset', {
        p_company_code: _fpCode,
        p_email:        _fpEmail
      });
    } catch(_) { /* swallow — show same screen regardless */ }

    fpSetState('notified');

  } catch(e) {
    // Network error — anti-enumeration: always show notified (never leak existence)
    fpSetState('notified');
  } finally {
    if (btn)     btn.disabled = false;
    if (btnSpan) btnSpan.textContent = 'Continue';
  }
}

// ── New password overlay (shown after OTP screen auto-dismisses) ──────
function _fpShowNewPasswordForm() {
  const existing = document.getElementById('_fp-newpwd-overlay');
  if (existing) existing.remove();

  const ov = document.createElement('div');
  ov.id = '_fp-newpwd-overlay';
  ov.style.cssText = [
    'position:fixed;inset:0;z-index:10001',
    'background:rgba(0,0,0,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)',
    'display:flex;align-items:center;justify-content:center;padding:20px',
    'animation:_otpFadeIn .22s ease both'
  ].join(';');

  ov.innerHTML = `
    <div style="background:var(--bg-modal);border:1px solid var(--border);border-radius:16px;
                padding:32px 28px 24px;width:100%;max-width:400px;
                box-shadow:0 24px 80px rgba(0,0,0,.65)">
      <h2 style="margin:0 0 8px;font-size:17px;font-weight:600;color:var(--text)">Set New Password</h2>
      <p style="margin:0 0 20px;font-size:13px;color:var(--text-muted);line-height:1.55">
        Your identity is verified. Choose a strong new password.
      </p>
      <div style="margin-bottom:10px">
        <input id="_fp-pwd1" type="password" autocomplete="new-password"
          placeholder="New password (min 8 characters)"
          style="width:100%;padding:10px 12px;background:var(--bg-input);
                 border:1.5px solid var(--border);border-radius:8px;
                 color:var(--text);font-size:14px;box-sizing:border-box;outline:none;font-family:inherit"
          onfocus="this.style.borderColor='#4F46E5'" onblur="this.style.borderColor='var(--border)'"
          onkeydown="if(event.key==='Enter')document.getElementById('_fp-pwd2').focus()">
      </div>
      <div style="margin-bottom:8px">
        <input id="_fp-pwd2" type="password" autocomplete="new-password"
          placeholder="Confirm new password"
          style="width:100%;padding:10px 12px;background:var(--bg-input);
                 border:1.5px solid var(--border);border-radius:8px;
                 color:var(--text);font-size:14px;box-sizing:border-box;outline:none;font-family:inherit"
          onfocus="this.style.borderColor='#4F46E5'" onblur="this.style.borderColor='var(--border)'"
          onkeydown="if(event.key==='Enter')_fpSubmitNewPassword()">
      </div>
      <div id="_fp-pwd-err" style="font-size:12px;color:#f43f5e;min-height:16px;margin-bottom:12px;line-height:1.4"></div>
      <button id="_fp-pwd-btn" onclick="_fpSubmitNewPassword()"
        style="width:100%;padding:11px;background:#4F46E5;color:#fff;border:none;
               border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;
               transition:background .15s"
        onmouseenter="this.style.background='#4338CA'" onmouseleave="this.style.background='#4F46E5'">
        Update Password
      </button>
      <div style="text-align:center;margin-top:14px">
        <a onclick="document.getElementById('_fp-newpwd-overlay').remove();fpSetState('form')"
          style="font-size:12px;color:var(--text-muted);cursor:pointer;text-decoration:underline">
          ← Start over
        </a>
      </div>
    </div>`;

  document.body.appendChild(ov);
  setTimeout(() => document.getElementById('_fp-pwd1')?.focus(), 60);
}

async function _fpSubmitNewPassword() {
  const pwd1  = document.getElementById('_fp-pwd1')?.value  || '';
  const pwd2  = document.getElementById('_fp-pwd2')?.value  || '';
  const errEl = document.getElementById('_fp-pwd-err');
  const btn   = document.getElementById('_fp-pwd-btn');

  if (errEl) errEl.textContent = '';

  if (!pwd1 || pwd1.length < 8) {
    if (errEl) errEl.textContent = 'Password must be at least 8 characters.';
    return;
  }
  if (pwd1 !== pwd2) {
    if (errEl) errEl.textContent = 'Passwords do not match.';
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }

  try {
    const { data: res, error: rpcErr } = await supabase.rpc('verify_admin_reset_otp', {
      p_email:        _fpEmail,
      p_otp:          _fpOtp,
      p_new_password: pwd1
    });

    if (rpcErr) throw new Error(rpcErr.message);

    if (res?.reset) {
      document.getElementById('_fp-newpwd-overlay')?.remove();
      fpSetState('success');
      return;
    }

    const errMap = {
      invalid_otp:      'Verification code was incorrect. Please start the process again.',
      expired:          'The code has expired. Please request a new one.',
      max_attempts:     'Too many incorrect attempts. Please request a new code.',
      policy_violation: res?.message || 'Password does not meet the requirements.',
      user_not_found:   'Account not found. Please try again.',
      not_found:        'Session expired. Please start again.'
    };
    const msg = errMap[res?.error] || res?.message || 'Update failed. Please try again.';
    if (errEl) errEl.textContent = msg;

    // OTP-related errors → close overlay, back to form
    if (['invalid_otp','expired','max_attempts','not_found'].includes(res?.error)) {
      setTimeout(() => {
        document.getElementById('_fp-newpwd-overlay')?.remove();
        fpSetState('form');
        fpShowErr(msg);
      }, 2000);
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Update Password'; }

  } catch(e) {
    if (errEl) errEl.textContent = e.message || 'Network error. Please try again.';
    if (btn) { btn.disabled = false; btn.textContent = 'Update Password'; }
  }
}

// ── Reset Password screen (legacy PKCE magic-link flow — kept for
//    backward compat with any outstanding reset emails) ─────────────────

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

    const { data: syncRes, error: syncErr } = await supabase.rpc('sync_reset_password', { p_new_password: pwd });
    if (syncErr || !syncRes?.success) {
      console.error('[rpSubmit] sync_reset_password failed:', syncErr?.message || syncRes?.error);
      rpShowFormErr('Password updated but sync failed — please try resetting again or contact support@nexunova.com');
      if (btn)     btn.disabled = false;
      if (btnSpan) btnSpan.textContent = 'Update Password';
      return;
    }

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

// ── Resend confirmation email ──────────────────────────────────────────
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
    const redirectTo = window.location.origin + window.location.pathname + '?flow=confirm';
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } });
    if (error) throw error;
    _lastResendAt = Date.now();
    _startResendCooldown();
    if (typeof notify !== 'undefined') notify.success('Confirmation email sent — check your inbox.', { duration: 4000 });
  } catch(e) {
    if (typeof notify !== 'undefined') notify.error('Could not resend', { detail: e.message || 'Please try again.' });
  }
}

function _startResendCooldown() {
  if (_resendTimer) clearInterval(_resendTimer);
  let remaining = 60;
  _resendTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(_resendTimer); _resendTimer = null; }
  }, 1000);
}

// ── Shared: exchange PKCE code from magic-link reset email ────────────
function _handleResetCode(code) {
  if (window.__nxnEmailConfirm) return;   // confirm landing is authoritative — never show reset over it
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

    let userEmail = '';
    try { const { data: { user } } = await supabase.auth.getUser(); userEmail = user?.email || ''; } catch(_) {}

    if (!userEmail) { rpSetState('form'); return; }

    let sendRes;
    try {
      sendRes = await supabase.functions.invoke('send-auth-otp', { body: { email: userEmail, type: 'password_reset' } });
    } catch(_) { rpSetState('form'); return; }

    if (sendRes?.data?.error) { rpSetState('form'); return; }

    showOTPScreen({
      subtitle: `Enter the 6-digit code sent to ${userEmail}`,
      onVerify: async (otpCode) => {
        let verRes;
        try { verRes = await supabase.functions.invoke('verify-auth-otp', { body: { email: userEmail, otp: otpCode, type: 'password_reset' } }); }
        catch(_) { return { error: 'Verification failed. Please try again.' }; }
        const data = verRes?.data || {};
        if (data.success) rpSetState('form');
        return data;
      },
      onResend: async () => {
        try { const res = await supabase.functions.invoke('send-auth-otp', { body: { email: userEmail, type: 'password_reset' } }); return res?.data || {}; }
        catch(_) { return { error: 'Failed to resend. Please try again.' }; }
      }
    });
  });
}

// ── Email confirmation after signup ──────────────────────────────────
async function _handleEmailConfirm(code) {
  window.__nxnEmailConfirm = true;
  sessionStorage.removeItem('nxn_sess');
  const el = _showOnlyAuthScreen('s-email-confirm');
  if (!el) { window.__nxnEmailConfirm = false; _handleResetCode(code); return; }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const loadEl = document.getElementById('ec-loading');
    const errEl  = document.getElementById('ec-error');
    const msgEl  = document.getElementById('ec-msg');
    if (loadEl) loadEl.style.display = 'none';
    if (errEl)  errEl.style.display  = '';
    if (msgEl)  msgEl.textContent = error.message || 'This confirmation link is invalid or has expired.';
    return;
  }

  await supabase.rpc('confirm_user_email').catch(() => {});
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

// ── Email confirmation landing — IMPLICIT #hash case (type=signup, no ?code) ──
// GoTrue's signup-confirm link returns an implicit #access_token...&type=signup hash (not ?code).
// The server-side auth.users→app_users trigger already flips email_verified, so we don't call
// confirm_user_email — just show a clean success screen and drop the auto-detected session so
// init.js can't flash the app shell / attempt an auto-login.
async function _showEmailConfirmed() {
  window.__nxnEmailConfirm = true;
  sessionStorage.removeItem('nxn_sess');
  const el = _showOnlyAuthScreen('s-email-confirm');
  if (!el) { document.getElementById('s-login')?.classList.add('on'); return; }
  const loadEl = document.getElementById('ec-loading');
  const errEl  = document.getElementById('ec-error');
  const okEl   = document.getElementById('ec-success');
  if (loadEl) loadEl.style.display = 'none';
  if (errEl)  errEl.style.display  = 'none';
  if (okEl)   okEl.style.display   = '';
  await supabase.auth.signOut().catch(() => {});
  try { window.history.replaceState({}, '', window.location.pathname); } catch (_) {}
  setTimeout(() => {
    el.classList.remove('on');
    document.getElementById('s-login')?.classList.add('on');
    if (typeof initLogin === 'function') initLogin();
  }, 3000);
}

// ── Expired / invalid auth link ───────────────────────────────────────
function _handleAuthLinkError(flow, errCode, errDesc) {
  try { window.history.replaceState({}, '', window.location.pathname); } catch (_) {}
  const decoded  = errDesc ? decodeURIComponent(String(errDesc).replace(/\+/g, ' ')) : '';
  const friendly = (errCode === 'otp_expired')
    ? 'This link has expired or was already used. Please request a new one.'
    : (decoded || 'This link is invalid or has expired. Please request a new one.');

  document.querySelectorAll('.scr.on').forEach(s => s.classList.remove('on'));

  if (flow === 'confirm') {
    const el = document.getElementById('s-email-confirm');
    if (el) {
      el.classList.add('on');
      const loadEl = document.getElementById('ec-loading');
      const errEl  = document.getElementById('ec-error');
      const msgEl  = document.getElementById('ec-msg');
      if (loadEl) loadEl.style.display = 'none';
      if (errEl)  errEl.style.display  = '';
      if (msgEl)  msgEl.textContent    = friendly;
      return;
    }
  }

  const resetEl = document.getElementById('s-reset');
  if (resetEl) {
    resetEl.classList.add('on');
    rpSetState('error');
    const errEl = document.getElementById('rp-err-msg');
    if (errEl) errEl.textContent = friendly;
  } else {
    document.getElementById('s-login')?.classList.add('on');
    if (typeof notify !== 'undefined') notify.error('Link expired', { detail: friendly });
  }
}

// ── On page load: ?code= / ?error= handling ──────────────────────────
(function () {
  const params     = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  const code    = params.get('code');
  const error   = params.get('error')      || hashParams.get('error');
  const errCode = params.get('error_code') || hashParams.get('error_code');
  const errDesc = params.get('error_description') || hashParams.get('error_description');
  const flow    = params.get('flow') || hashParams.get('flow') || 'reset';

  const isConfirm = (flow === 'confirm') || (hashParams.get('type') === 'signup');
  if (isConfirm) window.__nxnEmailConfirm = true;   // set synchronously, before init.js tryRestoreSession runs

  if (!code && (error || errCode)) { _handleAuthLinkError(flow, errCode, errDesc); return; }
  if (code) {
    if (flow === 'confirm') _handleEmailConfirm(code);
    else                    _handleResetCode(code);
    return;
  }
  // No ?code — implicit #hash signup confirm (or bare flow=confirm) → show success screen cleanly.
  if (isConfirm) { _showEmailConfirmed(); return; }
})();

// ── Electron deep-link ────────────────────────────────────────────────
if (typeof window.electronAuth?.onDeepLink === 'function') {
  window.electronAuth.onDeepLink(function (url) {
    try {
      const urlParams = new URL(url).searchParams;
      const code = urlParams.get('code');
      const flow = urlParams.get('flow') || 'reset';
      if (!code) return;
      if (flow === 'confirm') _handleEmailConfirm(code);
      else                    _handleResetCode(code);
    } catch (e) { console.error('[auth-deep-link parse error]', e); }
  });
}

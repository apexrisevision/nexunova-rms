// ══ FORGOT PASSWORD / RESET PASSWORD ════════════════════════════════

// ── Forgot Password ──────────────────────────────────────────────────

function showForgotPassword() {
  document.querySelectorAll('.scr.on').forEach(s => s.classList.remove('on'));
  document.getElementById('s-forgot').classList.add('on');
  const emailEl = document.getElementById('fp-email');
  if (emailEl) emailEl.value = '';
  fpSetState('form');
  fpHideErr();
  // Reset button — previous successful send leaves it disabled
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

  const btn     = document.getElementById('fp-btn');
  const btnSpan = btn ? btn.querySelector('span') : null;
  if (btn)     btn.disabled = true;
  if (btnSpan) btnSpan.textContent = 'Sending…';
  fpHideErr();

  try {
    // In Electron, loadFile() gives file:// origin → window.location.origin = "null".
    // Detect Electron via the contextBridge exposure and use the deep-link scheme instead.
    // IMPORTANT: add nexunovarms://auth/callback to Supabase dashboard →
    //   Authentication → URL Configuration → Redirect URLs
    const isElectron = typeof window.electronWindow !== 'undefined';
    const redirectTo = isElectron
      ? 'nexunovarms://auth/callback'
      : window.location.origin + '/login.html';

    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;

    const sentEl = document.getElementById('fp-sent-email');
    if (sentEl) sentEl.textContent = email;
    fpSetState('success');
  } catch (e) {
    fpShowErr(e.message || 'Something went wrong. Please try again.');
    if (btn)     btn.disabled = false;
    if (btnSpan) btnSpan.textContent = 'Send Reset Link';
  }
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

  if (pwd.length < 8) { rpShowFormErr('Password must be at least 8 characters.'); return; }
  if (pwd !== conf)   { rpShowFormErr('Passwords do not match.'); return; }

  const btn     = document.getElementById('rp-btn');
  const btnSpan = btn ? btn.querySelector('span') : null;
  if (btn)     btn.disabled = true;
  if (btnSpan) btnSpan.textContent = 'Updating…';
  rpHideFormErr();

  try {
    const { error } = await supabase.auth.updateUser({ password: pwd });
    if (error) throw error;

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

// ── Shared: exchange a PKCE code and show the reset form ─────────────
function _handleResetCode(code) {
  sessionStorage.removeItem('nxn_sess');

  document.querySelectorAll('.scr.on').forEach(s => s.classList.remove('on'));
  const resetEl = document.getElementById('s-reset');
  if (!resetEl) return;
  resetEl.classList.add('on');
  rpSetState('exchanging');

  supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
    if (error) {
      rpSetState('error');
      const errEl = document.getElementById('rp-err-msg');
      if (errEl) errEl.textContent = error.message || 'This reset link is invalid or has expired.';
    } else {
      rpSetState('form');
      try { window.history.replaceState({}, '', window.location.pathname); } catch(_) {}
    }
  });
}

// ── Browser: ?code= in URL on page load (web / direct browser access) ─
(function () {
  const code = new URLSearchParams(window.location.search).get('code');
  if (!code) return;
  _handleResetCode(code);
})();

// ── Electron: receive nexunovarms://auth/callback?code= via IPC ────────
// main.js sends 'auth-deep-link' after catching the OS deep-link event.
// electronAuth is exposed by preload-titlebar.js via contextBridge.
if (typeof window.electronAuth?.onDeepLink === 'function') {
  window.electronAuth.onDeepLink(function (url) {
    try {
      const code = new URL(url).searchParams.get('code');
      if (code) _handleResetCode(code);
    } catch (e) {
      console.error('[auth-deep-link parse error]', e);
    }
  });
}

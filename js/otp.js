// ══ OTP SCREEN — Reusable verification overlay ═══════════════════════
//
// showOTPScreen({ subtitle, onVerify, onResend, onExpire, onMaxAttempts })
//
// onVerify(code)      — async fn — receives 6-digit string
//                       must return { success?, error?, attempts_left?, max_attempts?, expired? }
// onResend()          — async fn — must return { success?, error?, cooldown? }
// onExpire()          — fn — called when 5-min timer hits zero (optional)
// onMaxAttempts()     — fn — called when attempt limit reached (optional, for admin login back-to-login)
//
// Returns a cleanup fn you can call to dismiss the overlay programmatically.
// The overlay also auto-dismisses itself when onVerify returns { success: true }.

function showOTPScreen({ subtitle, onVerify, onResend, onExpire, onMaxAttempts, onClose }) {
  const OTP_TTL_MS     = 5 * 60 * 1000;
  const RESEND_COOL_MS = 30 * 1000;

  // ── Inject CSS (once) ──────────────────────────────────────────────
  if (!document.getElementById('otp-ov-css')) {
    const css = document.createElement('style');
    css.id = 'otp-ov-css';
    css.textContent = `
#otp-overlay {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  animation: _otpFadeIn .22s ease both;
}
@keyframes _otpFadeIn  { from { opacity:0 } to { opacity:1 } }
@keyframes _otpFadeOut { from { opacity:1 } to { opacity:0 } }
.otp-ov-bd {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.52);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
}
.otp-ov-card {
  position: relative; z-index: 1;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(99,102,241,0.18);
  border-radius: 16px;
  padding: 32px 36px 28px;
  width: 100%; max-width: 400px;
  backdrop-filter: blur(30px);
  -webkit-backdrop-filter: blur(30px);
  box-shadow: 0 24px 80px rgba(0,0,0,0.55);
  animation: _otpCardIn .28s cubic-bezier(0.16,1,0.3,1) both;
}
@keyframes _otpCardIn {
  from { transform: translateY(18px) scale(0.97); opacity:0 }
  to   { transform: none; opacity:1 }
}
.otp-ov-icon {
  width: 44px; height: 44px;
  background: rgba(99,102,241,0.12);
  border: 1px solid rgba(99,102,241,0.3);
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: var(--brand, #6366f1);
  margin-bottom: 14px;
}
.otp-ov-title {
  font-size: 18px; font-weight: 600;
  color: var(--text, rgba(255,255,255,0.92));
  margin: 0 0 7px; letter-spacing: -0.3px;
}
.otp-ov-sub {
  font-size: 13px;
  color: var(--t2, rgba(255,255,255,0.60));
  margin: 0 0 24px; line-height: 1.55;
}
.otp-ov-boxes {
  display: flex; gap: 8px; justify-content: center;
  margin-bottom: 14px;
}
.otp-ov-box {
  width: 44px; height: 52px;
  background: rgba(255,255,255,0.04);
  border: 1.5px solid var(--glass-border, rgba(255,255,255,0.1));
  border-radius: 8px;
  text-align: center;
  font-size: 22px; font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text, rgba(255,255,255,0.92));
  outline: none;
  transition: border-color .18s, box-shadow .18s, background .18s;
  caret-color: transparent;
}
.otp-ov-box:focus {
  border-color: #4F46E5;
  background: rgba(79,70,229,0.08);
  box-shadow: 0 0 0 3px rgba(79,70,229,0.18);
}
.otp-ov-box.filled {
  border-color: rgba(79,70,229,0.45);
}
.otp-ov-box:disabled {
  opacity: 0.45; cursor: not-allowed;
}
.otp-ov-err {
  font-size: 13px;
  color: var(--err, #f43f5e);
  margin-bottom: 12px;
  text-align: center; line-height: 1.45;
  display: none;
}
.otp-ov-btn {
  width: 100%; height: 40px;
  background: #4F46E5; color: #fff;
  border: none; border-radius: 8px;
  font-size: 14px; font-weight: 500;
  font-family: var(--font, Inter, sans-serif);
  cursor: pointer; margin-bottom: 16px;
  transition: background .18s, opacity .18s;
}
.otp-ov-btn:hover:not(:disabled) { background: #4338CA; }
.otp-ov-btn:disabled { opacity: .5; cursor: not-allowed; }
.otp-ov-footer {
  display: flex; align-items: center; justify-content: center;
  gap: 8px; font-size: 13px;
  color: var(--t3, rgba(255,255,255,0.45));
  flex-wrap: wrap;
}
.otp-ov-sep { opacity: 0.4; }
.otp-ov-timer {
  font-family: var(--mono, monospace);
  font-size: 12px;
  color: var(--t3, rgba(255,255,255,0.45));
  transition: color .2s;
}
.otp-ov-timer.expired { color: var(--err, #f43f5e); }
.otp-ov-resend {
  background: none; border: none; padding: 0;
  font-size: 13px; font-family: inherit;
  color: var(--t2, rgba(255,255,255,0.60));
  cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px;
  transition: color .18s;
}
.otp-ov-resend:hover:not(:disabled) { color: var(--text, rgba(255,255,255,0.92)); }
.otp-ov-resend:disabled { opacity: .45; cursor: default; text-decoration: none; }
.otp-ov-close {
  position: absolute; top: 12px; right: 12px;
  width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  color: var(--t2, rgba(255,255,255,0.6));
  font-size: 16px; line-height: 1; cursor: pointer;
  transition: color .18s, background .18s, border-color .18s;
}
.otp-ov-close:hover { color: var(--text, #fff); background: rgba(255,255,255,0.08); }
@media (max-width: 480px) {
  .otp-ov-card { padding: 24px 20px 20px; }
  .otp-ov-box  { width: 40px; height: 48px; font-size: 19px; }
  .otp-ov-boxes { gap: 6px; }
}`;
    document.head.appendChild(css);
  }

  // ── Build DOM ──────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'otp-overlay';
  overlay.innerHTML = `
    <div class="otp-ov-bd"></div>
    <div class="otp-ov-card" role="dialog" aria-modal="true" aria-label="Identity verification">
      ${typeof onClose === 'function' ? '<button class="otp-ov-close" id="otp-ov-close" type="button" aria-label="Close and go back">✕</button>' : ''}
      <div class="otp-ov-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <h2 class="otp-ov-title">Verify your identity</h2>
      <p class="otp-ov-sub" id="otp-ov-sub">${subtitle || 'Enter the 6-digit code sent to your email'}</p>
      <div class="otp-ov-boxes" id="otp-boxes" role="group" aria-label="6-digit verification code">
        <input class="otp-ov-box" type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code" data-idx="0">
        <input class="otp-ov-box" type="text" inputmode="numeric" maxlength="1" autocomplete="off" data-idx="1">
        <input class="otp-ov-box" type="text" inputmode="numeric" maxlength="1" autocomplete="off" data-idx="2">
        <input class="otp-ov-box" type="text" inputmode="numeric" maxlength="1" autocomplete="off" data-idx="3">
        <input class="otp-ov-box" type="text" inputmode="numeric" maxlength="1" autocomplete="off" data-idx="4">
        <input class="otp-ov-box" type="text" inputmode="numeric" maxlength="1" autocomplete="off" data-idx="5">
      </div>
      <div class="otp-ov-err" id="otp-ov-err"></div>
      <button class="otp-ov-btn" id="otp-ov-btn" type="button">Verify</button>
      <div class="otp-ov-footer">
        <span class="otp-ov-timer" id="otp-ov-timer">5:00 remaining</span>
        <span class="otp-ov-sep">·</span>
        <button class="otp-ov-resend" id="otp-ov-resend" type="button">Resend code</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // ── Refs ───────────────────────────────────────────────────────────
  const boxes     = Array.from(overlay.querySelectorAll('.otp-ov-box'));
  const verifyBtn = overlay.querySelector('#otp-ov-btn');
  const resendBtn = overlay.querySelector('#otp-ov-resend');
  const timerEl   = overlay.querySelector('#otp-ov-timer');
  const errEl     = overlay.querySelector('#otp-ov-err');

  let countdownId  = null;
  let resendId     = null;
  let expiresAt    = Date.now() + OTP_TTL_MS;
  let isExpired    = false;
  let isMaxAttempt = false;

  // ── Helpers ────────────────────────────────────────────────────────
  function _showErr(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
  function _hideErr()     { errEl.style.display = 'none'; }

  function _getCode()     { return boxes.map(b => b.value).join(''); }

  // ── Countdown ──────────────────────────────────────────────────────
  function _startCountdown() {
    if (countdownId) clearInterval(countdownId);
    countdownId = setInterval(() => {
      const ms = expiresAt - Date.now();
      if (ms <= 0) {
        clearInterval(countdownId);
        timerEl.textContent = 'Code expired — request a new one';
        timerEl.classList.add('expired');
        isExpired = true;
        verifyBtn.disabled = true;
        boxes.forEach(b => b.disabled = true);
        _showErr('Code has expired. Please request a new one.');
        if (typeof onExpire === 'function') onExpire();
      } else {
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        timerEl.textContent = `${m}:${String(s).padStart(2, '0')} remaining`;
        timerEl.classList.remove('expired');
      }
    }, 500);
  }

  // ── Resend cooldown display ────────────────────────────────────────
  function _startResendCooldown(secs) {
    let end = Date.now() + secs * 1000;
    resendBtn.disabled = true;
    if (resendId) clearInterval(resendId);
    resendId = setInterval(() => {
      const left = Math.ceil((end - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(resendId);
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend code';
      } else {
        resendBtn.textContent = `Resend in ${left}s`;
      }
    }, 400);
  }

  // ── Digit input ────────────────────────────────────────────────────
  boxes.forEach((box, i) => {
    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (box.value) {
          box.value = '';
          box.classList.remove('filled');
        } else if (i > 0) {
          boxes[i - 1].value = '';
          boxes[i - 1].classList.remove('filled');
          boxes[i - 1].focus();
        }
        return;
      }
      if (e.key === 'ArrowLeft'  && i > 0) { boxes[i - 1].focus(); e.preventDefault(); }
      if (e.key === 'ArrowRight' && i < 5) { boxes[i + 1].focus(); e.preventDefault(); }
      if (e.key === 'Enter') { verifyBtn.click(); e.preventDefault(); }
    });

    box.addEventListener('input', e => {
      const val = box.value.replace(/\D/g, '').slice(-1);
      box.value = val;
      box.classList.toggle('filled', !!val);
      if (val && i < 5) boxes[i + 1].focus();
      _hideErr();
    });

    // Paste anywhere distributes across all boxes
    box.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData)
        .getData('text').replace(/\D/g, '').slice(0, 6);
      text.split('').forEach((ch, idx) => {
        if (idx < 6) { boxes[idx].value = ch; boxes[idx].classList.add('filled'); }
      });
      boxes[Math.min(text.length, 5)].focus();
      _hideErr();
    });

    box.addEventListener('focus', () => box.select());
  });

  // ── Verify ─────────────────────────────────────────────────────────
  verifyBtn.addEventListener('click', async () => {
    if (isExpired || isMaxAttempt) return;
    const code = _getCode();
    if (code.length < 6) { _showErr('Please enter all 6 digits.'); return; }

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying…';
    _hideErr();

    try {
      const result = await onVerify(code);
      if (result && result.success) {
        // showOTPScreen auto-cleans up — caller's onVerify already ran _completeLogin
        _cleanup();
        return;
      }
      if (result && result.max_attempts) {
        isMaxAttempt = true;
        verifyBtn.disabled = true;
        boxes.forEach(b => { b.disabled = true; b.value = ''; b.classList.remove('filled'); });
        _showErr('Too many incorrect attempts. Please request a new code.');
        if (typeof onMaxAttempts === 'function') onMaxAttempts();
      } else if (result && result.expired) {
        isExpired = true;
        verifyBtn.disabled = true;
        boxes.forEach(b => { b.disabled = true; b.value = ''; b.classList.remove('filled'); });
        _showErr('Code has expired. Please request a new one.');
      } else {
        _showErr(result?.error || 'Verification failed. Please try again.');
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify';
        boxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
        boxes[0].focus();
      }
    } catch (_) {
      _showErr('Verification failed. Please try again.');
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify';
    }
  });

  // ── Resend ─────────────────────────────────────────────────────────
  resendBtn.addEventListener('click', async () => {
    if (resendBtn.disabled) return;
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending…';
    _hideErr();

    try {
      const result = await onResend();
      if (result && result.error) {
        const match    = (result.error || '').match(/(\d+) second/);
        const cooldown = result.cooldown || (match ? parseInt(match[1]) : 30);
        _showErr(result.error);
        _startResendCooldown(cooldown);
        return;
      }
      // Success: reset timer, start fresh cooldown, re-enable inputs
      expiresAt    = Date.now() + OTP_TTL_MS;
      isExpired    = false;
      isMaxAttempt = false;
      clearInterval(countdownId);
      _startCountdown();
      _startResendCooldown(30);
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify';
      boxes.forEach(b => { b.disabled = false; b.value = ''; b.classList.remove('filled'); });
      boxes[0].focus();
      timerEl.classList.remove('expired');
      _hideErr();
      if (typeof notify !== 'undefined') {
        notify.success('New code sent to your email.', { duration: 3000 });
      }
    } catch (_) {
      _showErr('Failed to resend. Please try again.');
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend code';
    }
  });

  // ── Cleanup ────────────────────────────────────────────────────────
  function _cleanup() {
    if (countdownId) clearInterval(countdownId);
    if (resendId)    clearInterval(resendId);
    overlay.style.animation = '_otpFadeOut .18s ease both';
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 180);
  }

  // Opt-in close/back (only when caller provided onClose) — e.g. signup "fix my email"
  if (typeof onClose === 'function') {
    const closeBtn = overlay.querySelector('#otp-ov-close');
    const _close = () => { _cleanup(); onClose(); };
    if (closeBtn) closeBtn.addEventListener('click', _close);
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); _close(); } });
  }

  // ── Kick off ───────────────────────────────────────────────────────
  _startCountdown();
  _startResendCooldown(30); // cooldown from the send that opened this screen
  setTimeout(() => boxes[0].focus(), 60);

  return _cleanup;
}

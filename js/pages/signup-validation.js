// ══ SIGNUP VALIDATION ════════════════════════════════════════════════

const SV = {

  // Debounce timers
  _emailTimer: null,
  _unameTimer: null,

  // Track async check results
  emailAvailable: null,
  emailVerified:  false,   // true after OTP verified
  usernameAvailable: null,

  // ── Field helpers ──────────────────────────────────────────────────
  setHint(fieldId, msg, type) {
    const h = document.getElementById('sh-' + fieldId);
    if (!h) return;
    h.textContent = msg;
    h.className = 'sg-hint ' + (type || '');
  },

  setValid(inputId, valid) {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.classList.remove('valid', 'invalid');
    if (valid === true)  el.classList.add('valid');
    if (valid === false) el.classList.add('invalid');
  },

  val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  },

  // ── Step 1: Personal info ──────────────────────────────────────────
  step1() {
    let ok = true;

    const name = this.val('sg-fname');
    if (!name || name.length < 2) {
      this.setHint('fname', 'Full name is required (min 2 chars)', 'err');
      this.setValid('sg-fname', false);
      ok = false;
    } else {
      this.setHint('fname', '', '');
      this.setValid('sg-fname', true);
    }

    const email = this.val('sg-email');
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRx.test(email)) {
      this.setHint('email', 'Enter a valid email address', 'err');
      this.setValid('sg-email', false);
      ok = false;
    } else if (this.emailAvailable === false) {
      this.setHint('email', 'This email is already registered', 'err');
      this.setValid('sg-email', false);
      ok = false;
    } else if (this.emailAvailable === null) {
      this.setHint('email', 'Checking availability…', 'warn');
      ok = false;
    } else if (!this.emailVerified) {
      this.setHint('email', 'Please verify your email with the OTP', 'err');
      this.setValid('sg-email', false);
      ok = false;
    }

    const phone = this.val('sg-phone');
    if (!phone || phone.length < 7) {
      this.setHint('phone', 'Phone number is required', 'err');
      this.setValid('sg-phone', false);
      ok = false;
    } else {
      this.setHint('phone', '', '');
      this.setValid('sg-phone', true);
    }

    return ok;
  },

  // ── Step 2: Company info ───────────────────────────────────────────
  step2() {
    let ok = true;

    const cname = this.val('sg-cname');
    if (!cname || cname.length < 2) {
      this.setHint('cname', 'Company name is required (min 2 chars)', 'err');
      this.setValid('sg-cname', false);
      ok = false;
    } else if (this.companyAvailable === false) {
      this.setHint('cname', 'Already taken — choose a different company name', 'err');
      this.setValid('sg-cname', false);
      ok = false;
    } else if (this.companyAvailable === null && cname.length >= 2) {
      // Check in flight — trigger it and block
      this.triggerCompanyCheck(cname);
      this.setHint('cname', 'Checking availability…', 'warn');
      ok = false;
    } else {
      this.setHint('cname', '', '');
      this.setValid('sg-cname', true);
    }

    const address = this.val('sg-address');
    if (!address || address.length < 5) {
      this.setHint('address', 'Business address is required', 'err');
      this.setValid('sg-address', false);
      ok = false;
    } else {
      this.setHint('address', '', '');
      this.setValid('sg-address', true);
    }

    return ok;
  },

  // ── Step 3: Security ──────────────────────────────────────────────
  step3() {
    let ok = true;

    const pass = this.val('sg-pass');
    // Use the app-wide canonical policy (upper+lower+number+special+blocklist)
    // so a signup password can never be weaker than what every other flow
    // (force-change, reset, admin-created users) enforces.
    if (typeof validatePasswordStrength === 'function') {
      const chk = validatePasswordStrength(pass);
      if (!chk.valid) {
        this.setHint('pass', chk.message, 'err');
        this.setValid('sg-pass', false);
        ok = false;
      } else {
        this.setHint('pass', '', '');
        this.setValid('sg-pass', true);
      }
    } else {
      const strength = this.passwordStrength(pass);
      if (!pass || pass.length < 8) {
        this.setHint('pass', 'Password must be at least 8 characters', 'err');
        this.setValid('sg-pass', false);
        ok = false;
      } else if (strength < 2) {
        this.setHint('pass', 'Password is too weak', 'err');
        this.setValid('sg-pass', false);
        ok = false;
      }
    }

    const conf = this.val('sg-conf');
    if (pass && conf !== pass) {
      this.setHint('conf', 'Passwords do not match', 'err');
      this.setValid('sg-conf', false);
      ok = false;
    } else if (conf) {
      this.setHint('conf', 'Passwords match', 'ok');
      this.setValid('sg-conf', true);
    }

    return ok;
  },

  // ── Step 4: Plan ──────────────────────────────────────────────────
  step4() {
    const sel = document.querySelector('.sg-pcard.sg-pcard-sel');
    if (!sel) {
      const h = document.getElementById('sh-plan');
      if (h) { h.textContent = 'Please select a plan'; h.className = 'sg-hint err'; }
      return false;
    }
    return true;
  },

  // ── Step 5: Agreement ─────────────────────────────────────────────
  step5() {
    const cb = document.getElementById('sg-agree');
    if (!cb || !cb.checked) {
      this.setHint('agree', 'You must accept the terms to continue', 'err');
      return false;
    }
    this.setHint('agree', '', '');
    return true;
  },

  // ── Password strength ─────────────────────────────────────────────
  passwordStrength(pass) {
    if (!pass) return 0;
    let score = 0;
    if (pass.length >= 8)  score++;
    if (pass.length >= 12) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;
    return Math.min(4, score);
  },

  updateStrengthMeter(pass) {
    const bar   = document.getElementById('sg-str-fill');
    const label = document.getElementById('sg-str-label');
    if (!bar || !label) return;
    const score = this.passwordStrength(pass);
    bar.className = 'sg-strength-fill' + (score > 0 ? ' s' + score : '');
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    label.textContent = pass ? (labels[score] || '') : '';
    label.className = 'sg-strength-label' + (score > 0 ? ' s' + score : '');
  },

  // ── Live company name / slug availability check ───────────────────
  _companyTimer: null,
  companyAvailable: null,

  triggerCompanyCheck(rawName) {
    clearTimeout(this._companyTimer);
    this.companyAvailable = null;
    const slug = rawName ? rawName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) : '';
    if (!slug || slug.length < 2) return;
    this.setHint('cname', 'Checking…', 'warn');
    this._companyTimer = setTimeout(async () => {
      try {
        // Try dedicated RPC first; fall back to direct table query if it doesn't exist
        let taken = null;
        try {
          const { data, error } = await supabase.rpc('check_company_available', { p_company_code: slug });
          if (!error && data !== null) {
            taken = data?.available === false || data === false;
          }
        } catch(_) { /* RPC may not exist yet — fall through */ }

        // No fallback to direct table query — RPC is authoritative
        // (was: .from('companies') head-count check, removed for security lockdown)

        if (taken === null) {
          // Could not determine — clear hint and allow progression
          this.companyAvailable = null;
          this.setHint('cname', '', '');
          return;
        }

        this.companyAvailable = !taken;
        if (!taken) {
          this.setHint('cname', 'Company name available', 'ok');
          this.setValid('sg-cname', true);
        } else {
          this.setHint('cname', 'Already taken — choose a different company name', 'err');
          this.setValid('sg-cname', false);
        }
      } catch(e) {
        // Network error — clear check, allow progression (fail-open)
        this.companyAvailable = null;
        this.setHint('cname', '', '');
      }
    }, 600);
  },

  // ── Live email check ──────────────────────────────────────────────
  triggerEmailCheck(email) {
    clearTimeout(this._emailTimer);
    this.emailAvailable = null;
    this.emailVerified  = false;
    svHideVerifyBtn();
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRx.test(email)) return;
    this.setHint('email', 'Checking…', 'warn');
    this._emailTimer = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('check_company_email', { p_email: email });
        if (data?.exists) {
          this.emailAvailable = false;
          this.setHint('email', 'This email is already registered', 'err');
          this.setValid('sg-email', false);
          svHideVerifyBtn();
        } else {
          this.emailAvailable = true;
          this.setHint('email', 'Email available — please verify', 'warn');
          this.setValid('sg-email', null);
          svShowVerifyBtn();
        }
      } catch(e) {
        this.emailAvailable = null;
        this.setHint('email', '', '');
        svHideVerifyBtn();
      }
    }, 500);
  },

};

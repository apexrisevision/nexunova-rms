// ══ SIGNUP PAGE CONTROLLER ══════════════════════════════════════════

// Global state for signup flow
window._sgState = {
  step: 1,
  totalSteps: 5,
  billing: 'monthly',
  selectedPlan: 'free_trial',
  companyCode: '',  // preview (not set until after signup)
  data: {}
};

const PLANS = {
  monthly: [
    {
      code: 'free_trial',
      name: '7-Day Free Trial',
      price: 'Free',
      priceSub: '7 days, no card required',
      limits: ['1 Project', '10 Units', '10 Clients', '1 User'],
      popular: false
    },
    {
      code: 'basic_monthly',
      name: 'Basic',
      price: 'PKR 10,000',
      priceSub: '/ month',
      limits: ['1 Project', '500 Units', '500 Clients', '3 Users'],
      popular: false
    },
    {
      code: 'pro_monthly',
      name: 'Pro',
      price: 'PKR 25,000',
      priceSub: '/ month',
      limits: ['3 Projects', '1,500 Units', '1,500 Clients', '4 Users'],
      popular: true
    },
    {
      code: 'ultimate_monthly',
      name: 'Ultimate',
      price: 'PKR 50,000',
      priceSub: '/ month',
      limits: ['10 Projects', '10,000 Units', '10,000 Clients', '16 Users'],
      popular: false
    }
  ],
  yearly: [
    {
      code: 'free_trial',
      name: '7-Day Free Trial',
      price: 'Free',
      priceSub: '7 days, no card required',
      limits: ['1 Project', '10 Units', '10 Clients', '1 User'],
      popular: false
    },
    {
      code: 'basic_yearly',
      name: 'Basic',
      price: 'PKR 108,000',
      priceSub: '/ year  (save 10%)',
      limits: ['1 Project', '500 Units', '500 Clients', '3 Users'],
      popular: false
    },
    {
      code: 'pro_yearly',
      name: 'Pro',
      price: 'PKR 270,000',
      priceSub: '/ year  (save 10%)',
      limits: ['3 Projects', '1,500 Units', '1,500 Clients', '4 Users'],
      popular: true
    },
    {
      code: 'ultimate_yearly',
      name: 'Ultimate',
      price: 'PKR 540,000',
      priceSub: '/ year  (save 10%)',
      limits: ['10 Projects', '10,000 Units', '10,000 Clients', '16 Users'],
      popular: false
    }
  ]
};

const STEP_META = [
  { label: 'You',     title: 'Personal Info',    sub: 'Tell us about yourself' },
  { label: 'Company', title: 'Your Company',      sub: 'Set up your workspace' },
  { label: 'Security',title: 'Set Password',      sub: 'Secure your account' },
  { label: 'Plan',    title: 'Choose a Plan',     sub: 'Start free, upgrade anytime' },
  { label: 'Done',    title: 'Review & Confirm',  sub: 'Almost there!' }
];

// ── Show signup screen ───────────────────────────────────────────────
function showSignup() {
  document.getElementById('s-login').classList.remove('on');
  document.getElementById('s-signup').classList.add('on');
  // Pick up plan pre-selection from landing-page link (?plan=basic|pro|ultimate)
  let initialPlan = 'free_trial';
  try {
    const preset = sessionStorage.getItem('preselectedPlan');
    if (preset && ['basic','pro','ultimate','free_trial'].includes(preset)) {
      initialPlan = preset;
      sessionStorage.removeItem('preselectedPlan');
    }
  } catch(e){}
  window._sgState = {
    step: 1, totalSteps: 5, billing: 'monthly',
    selectedPlan: initialPlan, companyCode: '', data: {}
  };
  SV.emailAvailable = null;

  // Reset result screen if previously shown
  const resultDiv = document.getElementById('sg-result-screen');
  if (resultDiv) { resultDiv.innerHTML = ''; resultDiv.style.display = 'none'; }
  const sgNavEl = document.querySelector('.sg-nav');
  if (sgNavEl) sgNavEl.style.display = '';
  document.querySelectorAll('.sg-step-panel').forEach(p => p.style.display = '');

  sgRender();
}

function hideSignup() {
  document.getElementById('s-signup').classList.remove('on');
  document.getElementById('s-login').classList.add('on');
}

// ── City suggestions per country (datalist-driven searchable dropdown) ──
const SG_CITIES = {
  Pakistan: [
    'Karachi','Lahore','Islamabad','Rawalpindi','Faisalabad','Multan','Peshawar',
    'Quetta','Hyderabad','Sialkot','Gujranwala','Bahawalpur','Sargodha','Sukkur',
    'Larkana','Mardan','Mingora','Sheikhupura','Jhang','Dera Ghazi Khan','Gujrat',
    'Kasur','Rahim Yar Khan','Sahiwal','Okara','Wah Cantt','Mirpur','Nawabshah',
    'Chiniot','Kotri','Kamoke','Hafizabad','Sadiqabad','Khanewal','Mianwali'
  ],
  UAE: [
    'Dubai','Abu Dhabi','Sharjah','Ajman','Al Ain','Ras Al Khaimah','Fujairah',
    'Umm Al Quwain','Khor Fakkan','Dibba Al-Fujairah','Kalba','Madinat Zayed','Ruwais'
  ]
};

function sgUpdateCityList() {
  const countryEl = document.getElementById('sg-country');
  const listEl    = document.getElementById('sg-city-list');
  const cityEl    = document.getElementById('sg-city');
  if (!countryEl || !listEl) return;
  const cities = SG_CITIES[countryEl.value] || [];
  listEl.innerHTML = cities.map(c => `<option value="${c}"></option>`).join('');
  // Reset placeholder hint to a sensible city for the country
  if (cityEl && cities.length) cityEl.placeholder = cities[0];
}

// Wire it up — fires on country change and once on page load
document.addEventListener('DOMContentLoaded', function () {
  const countryEl = document.getElementById('sg-country');
  if (countryEl) {
    countryEl.addEventListener('change', sgUpdateCityList);
    sgUpdateCityList();
  }
});

// ── Render current step ──────────────────────────────────────────────
function sgRender() {
  const st = window._sgState;

  // Progress dots
  document.querySelectorAll('.sg-step-dot').forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i + 1 === st.step) dot.classList.add('active');
    else if (i + 1 < st.step) dot.classList.add('done');
    const circle = dot.querySelector('.sg-dot-circle');
    if (circle) circle.textContent = (i + 1 < st.step) ? '✓' : (i + 1);
  });

  // Step header
  const meta = STEP_META[st.step - 1];
  const title = document.getElementById('sg-step-title');
  const sub   = document.getElementById('sg-step-sub');
  if (title) title.textContent = meta.title;
  if (sub)   sub.textContent   = meta.sub;

  // Show correct panel
  document.querySelectorAll('.sg-step-panel').forEach((p, i) => {
    p.classList.toggle('sg-active', i + 1 === st.step);
  });

  // Back button
  const back = document.getElementById('sg-back');
  if (back) back.style.display = st.step > 1 ? '' : 'none';

  // Next button label
  const next = document.getElementById('sg-next');
  if (next) {
    if (st.step === st.totalSteps) {
      next.innerHTML = '<div class="sg-btn-shimmer"></div><span>Create Account</span>';
    } else {
      next.innerHTML = '<div class="sg-btn-shimmer"></div><span>Continue</span><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
    }
  }

  // Step 3: update username preview
  if (st.step === 3) {
    const prev = document.getElementById('sg-uname-preview');
    if (prev) {
      const un = sgUsernamePreview(st.data.companyName);
      prev.textContent = un || '(enter company name first)';
    }
  }

  // Step 4: render plan cards + sync toggle state
  if (st.step === 4) {
    const track = document.getElementById('sg-billing-toggle');
    const lbM   = document.getElementById('sg-lbl-monthly');
    const lbY   = document.getElementById('sg-lbl-yearly');
    if (track) track.classList.toggle('on', st.billing === 'yearly');
    if (lbM)   lbM.classList.toggle('active', st.billing === 'monthly');
    if (lbY)   lbY.classList.toggle('active', st.billing === 'yearly');
    sgRenderPlans();
  }

  // Step 5: render summary
  if (st.step === 5) sgRenderSummary();

  // Hide error banner
  const err = document.getElementById('sg-err');
  if (err) err.style.display = 'none';
}

// ── Plan cards ───────────────────────────────────────────────────────
function sgRenderPlans() {
  const st = window._sgState;
  const container = document.getElementById('sg-plan-list');
  if (!container) return;

  const plans = PLANS[st.billing] || PLANS.monthly;
  container.innerHTML = plans.map(p => {
    const sel = st.selectedPlan === p.code;
    return `<div class="sg-pcard${sel ? ' sg-pcard-sel' : ''}${p.popular ? ' sg-pcard-pop' : ''}"
         onclick="sgSelectPlan('${p.code}')" data-plan="${p.code}">
      ${p.popular ? '<div class="sg-pop-badge">POPULAR</div>' : ''}
      <div class="sg-pc-name">${p.name}</div>
      <div class="sg-pc-price">${p.price}</div>
      <div class="sg-pc-sub">${p.priceSub}</div>
      <div class="sg-pc-sep"></div>
      <div class="sg-pc-feats">
        ${p.limits.map(l => `<div class="sg-pc-feat">${l}</div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function sgSelectPlan(code) {
  window._sgState.selectedPlan = code;
  document.querySelectorAll('.sg-pcard').forEach(c => {
    c.classList.toggle('sg-pcard-sel', c.dataset.plan === code);
  });
  const h = document.getElementById('sh-plan');
  if (h) { h.textContent = ''; h.className = 'sg-hint'; }
}

function sgToggleBilling() {
  const st = window._sgState;
  sgSetBilling(st.billing === 'monthly' ? 'yearly' : 'monthly');
}

function sgSetBilling(cycle) {
  window._sgState.billing = cycle;

  // Sync toggle-track UI
  const track = document.getElementById('sg-billing-toggle');
  const lbM   = document.getElementById('sg-lbl-monthly');
  const lbY   = document.getElementById('sg-lbl-yearly');
  if (track) track.classList.toggle('on', cycle === 'yearly');
  if (lbM)   lbM.classList.toggle('active', cycle === 'monthly');
  if (lbY)   lbY.classList.toggle('active', cycle === 'yearly');

  // Reset plan selection if current plan doesn't exist in new cycle
  const plans = PLANS[cycle] || PLANS.monthly;
  const codes = plans.map(p => p.code);
  if (!codes.includes(window._sgState.selectedPlan)) {
    window._sgState.selectedPlan = 'free_trial';
  }
  sgRenderPlans();
}

// ── Username preview helper ───────────────────────────────────────────
function sgUsernamePreview(cname) {
  if (!cname) return '';
  return cname.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || '';
}

// ── Summary (step 5) ─────────────────────────────────────────────────
function sgRenderSummary() {
  const st = window._sgState;
  const d  = st.data;
  const el = document.getElementById('sg-summary-body');
  if (!el) return;

  const allPlans  = [...PLANS.monthly, ...PLANS.yearly];
  const planInfo  = allPlans.find(p => p.code === st.selectedPlan);
  const planLabel = planInfo ? `${planInfo.name} — ${planInfo.price}` : st.selectedPlan;
  const preview   = sgUsernamePreview(d.companyName);

  el.innerHTML = [
    ['Full Name',    d.fullName    || '—'],
    ['Email',        d.email       || '—'],
    ['Company',      d.companyName || '—'],
    ['Type',         (d.companyType || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())],
    ['Admin Username', preview ? `~${preview}` : '(auto-generated)'],
    ['Plan',         planLabel     || '—'],
  ].map(([k, v]) => `
    <div class="sg-summary-row">
      <span class="sg-summary-key">${k}</span>
      <span class="sg-summary-val">${v}</span>
    </div>
  `).join('');
}

// ── Collect step data ─────────────────────────────────────────────────
function sgCollectStep() {
  const st = window._sgState;
  const d  = st.data;
  const v  = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

  if (st.step === 1) {
    d.fullName = v('sg-fname');
    d.email    = v('sg-email');
    d.phone    = v('sg-phone');
  }
  if (st.step === 2) {
    d.companyName = v('sg-cname');
    d.companyType = v('sg-ctype') || 'real_estate';
    d.country     = v('sg-country') || 'Pakistan';
    d.city        = v('sg-city');
    d.address     = v('sg-address');
  }
  if (st.step === 3) {
    d.password = document.getElementById('sg-pass') ? document.getElementById('sg-pass').value : '';
  }
  if (st.step === 4) {
    d.planCode    = st.selectedPlan;
    d.billingCycle = st.billing;
  }
}

// ── Navigation ────────────────────────────────────────────────────────
async function sgNext() {
  const st  = window._sgState;
  const err = document.getElementById('sg-err');
  if (err) err.style.display = 'none';

  // Validate
  const validators = [null, SV.step1.bind(SV), SV.step2.bind(SV), SV.step3.bind(SV), SV.step4.bind(SV), SV.step5.bind(SV)];
  const valid = validators[st.step] ? validators[st.step]() : true;
  if (!valid) return;

  sgCollectStep();

  if (st.step < st.totalSteps) {
    st.step++;
    sgRender();
    return;
  }

  // Submit
  await sgSubmit();
}

function sgBack() {
  const st = window._sgState;
  if (st.step > 1) { st.step--; sgRender(); }
}

// ── Submit ────────────────────────────────────────────────────────────
async function sgSubmit() {
  const st  = window._sgState;
  const d   = st.data;
  const btn = document.getElementById('sg-next');
  const err = document.getElementById('sg-err');

  if (btn) { btn.disabled = true; btn.classList.add('loading'); }

  try {
    const { data: res, error } = await supabase.rpc('signup_new_company', {
      p_full_name:     d.fullName,
      p_email:         d.email,
      p_phone:         d.phone,
      p_company_name:  d.companyName,
      p_password:      d.password,
      p_company_type:  d.companyType  || 'real_estate',
      p_country:       d.country      || 'Pakistan',
      p_city:          d.city         || '',
      p_address:       d.address      || '',
      p_plan_code:     d.planCode     || 'free_trial',
      p_billing_cycle: d.billingCycle || 'monthly'
    });

    if (error || !res) throw new Error(error?.message || 'Signup failed');
    if (res.error) throw new Error(res.message || res.error);

    // Clear password from memory
    d.password = null;

    st.companyCode = res.company_code;
    st.signupResult = res;

    sgShowResult(res);

  } catch(e) {
    if (err) {
      err.textContent = e.message || 'Signup failed. Please try again.';
      err.style.display = 'block';
    }
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

// ── Result screen ─────────────────────────────────────────────────────
function sgShowResult(res) {
  const container = document.getElementById('sg-form-body');
  if (!container) return;

  // Hide step panels and nav buttons
  container.querySelectorAll('.sg-step-panel').forEach(p => p.style.display = 'none');
  const sgNavEl = document.querySelector('.sg-nav');
  if (sgNavEl) sgNavEl.style.display = 'none';

  let resultDiv = document.getElementById('sg-result-screen');
  if (!resultDiv) {
    resultDiv = document.createElement('div');
    resultDiv.id = 'sg-result-screen';
    container.appendChild(resultDiv);
  }

  const isTrial   = res.status === 'trialing';
  const isPending = res.status === 'pending_payment';

  if (isTrial) {
    resultDiv.innerHTML = `
      <div class="sg-success">
        <div class="sg-success-icon"><svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
        <div class="sg-success-title">Account Created!</div>
        <p class="sg-success-msg">Your 7-day free trial is active. Sign in using:</p>
        <div class="sg-code-box">
          <div>
            <div class="sg-code-label">Your Username</div>
            <div class="sg-code-value">${res.username}</div>
          </div>
        </div>
        <p class="sg-success-msg" style="font-size:11px;margin-bottom:16px">
          Admin username = your company name (simplified). Staff usernames follow <strong style="color:rgba(255,255,255,0.55)">role@${res.username}</strong>.
        </p>
        <button class="sg-btn-next" style="max-width:280px;margin:0 auto" onclick="sgGoToLogin()">
          <div class="sg-btn-shimmer"></div>
          <span>Sign In Now</span>
        </button>
      </div>
    `;
  } else if (isPending) {
    resultDiv.innerHTML = `
      <div class="sg-pending">
        <div class="sg-pending-icon">⏳</div>
        <div class="sg-success-title">Account Registered!</div>
        <p class="sg-success-msg">
          Your account is pending payment confirmation. Once your payment is received and verified,
          your account will be activated.<br><br>
          Contact us at <strong style="color:rgba(255,255,255,0.6)">sales@nexunova.com</strong>
          or reference your username below.
        </p>
        <div class="sg-code-box">
          <div>
            <div class="sg-code-label">Your Username</div>
            <div class="sg-code-value">${res.username}</div>
          </div>
        </div>
        <button class="sg-btn-next" style="max-width:280px;margin:0 auto" onclick="sgGoToLogin()">
          <div class="sg-btn-shimmer"></div>
          <span>Back to Login</span>
        </button>
      </div>
    `;
  }
}

function sgGoToLogin() {
  document.getElementById('s-signup').classList.remove('on');
  document.getElementById('s-login').classList.add('on');
  const uField = document.getElementById('li-u');
  const res = window._sgState.signupResult;
  if (uField && res?.username) {
    uField.value = res.username;
  }
}

// ── Enter key advances signup steps ───────────────────────────────────
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  const sg = document.getElementById('s-signup');
  if (!sg || !sg.classList.contains('on')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' && document.activeElement.type !== 'checkbox') sgNext();
});

// ── Password visibility toggle ────────────────────────────────────────
function sgTogglePass(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

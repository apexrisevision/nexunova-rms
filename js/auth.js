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
  // Abort if already logged in or login screen is not visible (e.g. autofill race with session restore)
  if(S) return;
  if(!document.getElementById('s-login')?.classList.contains('on')) return;

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
  if(_btn){ _btn.disabled=true; _btn.classList.add('lx-loading'); if(_sp) _sp.textContent='Signing inâ€¦'; if(_sv) _sv.style.opacity='0'; }

  try {
    const { data: res, error: rpcErr } = await supabase.rpc('verify_login', {
      p_company_code: companyCode,
      p_username:     username,
      p_password:     pass
    });

    if(rpcErr){ console.error(rpcErr); _btnReset(); notify.error('Server error', { detail: 'Please try again in a moment.' }); return; }
    if(!res)  { _btnReset(); notify.error('Server error', { detail: 'Empty response â€” please try again.' }); return; }

    if(!res.success){
      const errMap = {
        invalid_credentials: `Username or password is incorrect.<br>Need help? Contact ${SUPPORT_EMAIL}`,
        company_inactive:    `This company account is inactive. Contact ${SUPPORT_EMAIL}`,
        user_inactive:       'Your account is disabled. Contact your administrator.'
      };
      _btnReset();
      notify.error('Sign in failed', { detail: errMap[res.error] || res.message || 'Authentication failed.' });
      return;
    }

    const user    = res.user;
    const company = res.company;

    _coid = company.id;
    const subStatus = company.sub_status || 'active';

    S = {
      userId:             user.id,
      name:               user.name,
      role:               user.role,
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

    // â”€â”€ Route based on subscription status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if(subStatus === 'pending_payment' || subStatus === 'payment_under_review'){
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

    // New company: show onboarding wizard
    if(company.onboarding_complete === false && typeof OB !== 'undefined'){
      OB.show(company.id);
    } else {
      nav('dashboard');
      if(typeof TUT !== 'undefined') TUT.maybeShow();
    }

    if(typeof checkAutoBackup === 'function') checkAutoBackup();
    if(typeof initDemoBanner === 'function') initDemoBanner();
    notify.success(`Welcome, ${user.name}`, { duration: 2500 });

  } catch(e){
    console.error(e);
    _btnReset();
    notify.error('Connection error', { detail: 'Check your internet connection and try again.' });
  }
}

function doLogout(){
  S=null;_coid=null;_navStack=[];_navBack=false;
  sessionStorage.removeItem('nxn_sess');
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


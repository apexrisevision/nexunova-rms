// â•â• TOAST â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function toast(msg,type='ok'){
  const t=document.getElementById('toast');const ic={ok:'âœ…',err:'âŒ',warn:'âš ï¸',info:'â„¹ï¸'};
  document.getElementById('t-ic').textContent=ic[type]||'âœ…';document.getElementById('t-m').textContent=msg;
  t.className='toast show '+type;clearTimeout(_tmr);_tmr=setTimeout(()=>t.classList.remove('show'),3000);
}

// â•â• INIT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// URL param handler — links from index.html marketing page
// Supports: ?signup=1 (open signup) · ?demo=true (auto-login as demo) · ?plan=basic|pro|ultimate (pre-select plan)
function handleLandingParams(){
  try{
    const p = new URLSearchParams(window.location.search);
    if (p.get('demo') === 'true' || p.get('demo') === '1') {
      sessionStorage.setItem('autoDemo','1');
    }
    if (p.get('plan')) {
      sessionStorage.setItem('preselectedPlan', p.get('plan'));
    }
    if (p.get('signup') === '1') {
      setTimeout(function(){ if(typeof showSignup==='function') showSignup(); }, 80);
    }
  }catch(e){console.warn('[landing params]',e);}
}

window.addEventListener('DOMContentLoaded',()=>{
  try{gdb();initLogin();startLeakGuard();console.log('NXRMS build:',APP_BUILD);const ft=document.querySelector('.co-btn');if(ft){ft.classList.add('on');_coid=ft.dataset.id;}}
  catch(e){document.body.innerHTML=`<div style="padding:40px;font-family:monospace;color:#c00"><h2>Error</h2><pre>${e.message}</pre></div>`;}
  handleLandingParams();
  tryRestoreSession();
});

async function tryRestoreSession(){
  if(window.location.search.includes('super-admin'))return;
  if(window.__nxnEmailConfirm)return;       // email-confirm landing renders its own screen; don't flash app/login
  try{
    // #2 — validate a real Supabase session before rendering from storage.
    // Forged/stale nxn_sess must not render the app shell on its own.
    const { data: { session: _sess } } = await supabase.auth.getSession();
    if(!_sess){ localStorage.removeItem('nxn_sess'); document.getElementById('s-login').classList.add('on'); return; }
    /* The week. A timer cannot see time that passed while the app was closed,
       so the last moment of use was written down; if that was longer ago than
       the timeout allows, this is where the session ends. Signing out here
       rather than rendering first means nothing of the account is ever shown
       to somebody the rule says should be asked again. */
    if(typeof _idleTooLong==='function' && _idleTooLong()){
      localStorage.removeItem('nxn_sess');
      try{ localStorage.removeItem('nxn_active'); }catch(_){}
      try{ await supabase.auth.signOut(); }catch(_){}
      document.getElementById('s-login').classList.add('on');
      return;
    }
    const raw=localStorage.getItem('nxn_sess');
    if(!raw)return;
    const sess=JSON.parse(raw);
    if(!sess?.cid)return;
    // Cross-tab guard: the live (shared localStorage) auth token must belong to the
    // same user this tab's saved session was created for. If another tab logged in
    // as a different account, the token was swapped — force a clean login here so we
    // never render company A while authenticating as company B.
    if(sess.authUid && _sess.user && _sess.user.id !== sess.authUid){
      localStorage.removeItem('nxn_sess');
      document.getElementById('s-login').classList.add('on');
      return;
    }
    S=sess;_coid=sess.cid;
    if(typeof _installAuthGuard==='function')_installAuthGuard();

    /* ── THE SHELL CONTEXT — the same one the login path loads ──────────────
       This is the path almost everybody actually takes: any page load with a
       valid session comes through here, including every hard refresh. It used
       to call buildSB() below WITHOUT ever loading the feature flags or the
       cobranding, so on a returning visit window._featureFlags stayed
       undefined for the whole session — which made Daily Closing invisible on
       the pilot, and made the company chip show the legal name instead of the
       brand. A developer never sees it, because a developer has just logged in.

       Started here so it overlaps the cache loads below; awaited with a bound
       just before buildSB(). See startShellContext() in
       js/pages/company-branding.js. */
    if(typeof startShellContext==='function')startShellContext();

    // Route to payment wall if subscription not active
    const subStatus=sess.subStatus||'active';
    if(subStatus==='pending_payment'||subStatus==='payment_under_review'){
      document.getElementById('s-login').classList.remove('on');
      if(typeof PW!=='undefined')PW.show(subStatus);
      return;
    }

    await Promise.all([
      typeof loadFloorsCache==='function'?loadFloorsCache(sess.cid):Promise.resolve(),
      typeof loadTypesCache==='function'?loadTypesCache(sess.cid):Promise.resolve(),
      typeof loadStatusesCache==='function'?loadStatusesCache(sess.cid):Promise.resolve(),
      typeof loadSaleTypesCache==='function'?loadSaleTypesCache(sess.cid):Promise.resolve(),
      typeof loadProjectsCache==='function'?loadProjectsCache(sess.cid):Promise.resolve(),
      typeof loadClientsCache==='function'?loadClientsCache(sess.cid):Promise.resolve(),
    ]);
    if(typeof loadUnitsCache==='function')await loadUnitsCache(sess.cid);
    if(typeof loadAppUsersCache==='function')loadAppUsersCache(sess.cid).catch(()=>{});
    if(typeof loadContactLogsCache==='function')loadContactLogsCache(sess.cid).catch(()=>{});
    const av=document.getElementById('sb-av');if(av)av.textContent=ini(sess.name);
    const un=document.getElementById('sb-un');if(un)un.textContent=sess.name;
    const roleLabels={admin:'Admin / CFO',owner:'Owner / Admin',recovery:'Recovery Staff',accounts:'Accounts Staff'};
    const ur=document.getElementById('sb-ur');if(ur)ur.textContent=roleLabels[sess.role]||'Staff';
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
    if(typeof stopLoginAnimations==='function')stopLoginAnimations();
    if(typeof stopLoginBG        ==='function')stopLoginBG();
    if(typeof updateCoLogo==='function')updateCoLogo();
    if(typeof startLeakGuard==='function')startLeakGuard();
    if(typeof _loadRoleContext==='function'){ try{ await _loadRoleContext(sess.cid, sess.userId, sess.role); }catch(_){} }  // refresh hasFinanceUser + assignedProjectIds on reload
    // Bounded, exactly as on the login path: never let a slow fetch hold the
    // shell. If the bound is lost, _reapplyFeatureGatedUI() repairs the sidebar
    // and the company chip when the answer lands.
    if(typeof awaitShellContext==='function'){ try{ await awaitShellContext(1200); }catch(_){} }
    buildSB();
    if(typeof initDemoBanner==='function')initDemoBanner();
    if(sess.onboardingComplete===false&&typeof OB!=='undefined'){OB.show(sess.cid);}
    else{nav(effectiveRole()==='recovery'?'recovery-dashboard':'dashboard');if(typeof TUT!=='undefined')TUT.maybeShow();}
  }catch(e){
    console.warn('[tryRestoreSession]',e);
    localStorage.removeItem('nxn_sess');
    document.getElementById('s-login').classList.add('on');
    document.getElementById('s-app')?.classList.remove('on');
    document.getElementById('s-payment-wall')?.classList.remove('on');
  }
}

// â”€â”€ Nexus: Populate login stats â”€â”€
function populateLoginStats(){
  try {
    const units = (typeof gunits === 'function') ? gunits() : [];
    const sold = units.filter(u => u.status !== 'Available' && u.status !== 'Dead');
    const pending = sold.filter(u => u.pendingAmount > 0 || (u.totalPrice > u.totalPaid));
    const el1 = document.getElementById('ls-units');
    const el2 = document.getElementById('ls-sold');
    const el3 = document.getElementById('ls-pending');
    if(el1) el1.textContent = units.length;
    if(el2) el2.textContent = sold.length;
    if(el3) el3.textContent = pending.length;
  } catch(e) {}
}


// â”€â”€ Patch initLogin to populate login stats â”€â”€
const _origInitLogin = initLogin;
initLogin = function() {
  _origInitLogin();
  populateLoginStats();
};

// â”€â”€ Global back navigation: Mouse Button 4 (browser back) + ESC key â”€â”€
document.addEventListener('mouseup', function(e) {
  if (e.button === 3) { e.preventDefault(); if (typeof navBack === 'function') navBack(); }
});
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (typeof navBack === 'function') navBack();
});


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
  try{
    const raw=sessionStorage.getItem('nxn_sess');
    if(!raw)return;
    const sess=JSON.parse(raw);
    if(!sess?.cid)return;
    S=sess;_coid=sess.cid;

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
    buildSB();
    if(typeof initDemoBanner==='function')initDemoBanner();
    if(sess.onboardingComplete===false&&typeof OB!=='undefined'){OB.show(sess.cid);}
    else{nav('dashboard');if(typeof TUT!=='undefined')TUT.maybeShow();}
  }catch(e){
    console.warn('[tryRestoreSession]',e);
    sessionStorage.removeItem('nxn_sess');
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


// ══ TOAST ═════════════════════════════════════
function toast(msg,type='ok'){
  const t=document.getElementById('toast');const ic={ok:'✅',err:'❌',warn:'⚠️',info:'ℹ️'};
  document.getElementById('t-ic').textContent=ic[type]||'✅';document.getElementById('t-m').textContent=msg;
  t.className='toast show '+type;clearTimeout(_tmr);_tmr=setTimeout(()=>t.classList.remove('show'),3000);
}

// ══ INIT ══════════════════════════════════════
window.addEventListener('DOMContentLoaded',()=>{
  try{gdb();initLogin();startLeakGuard();console.log('NXRMS build:',APP_BUILD);const ft=document.querySelector('.co-btn');if(ft){ft.classList.add('on');_coid=ft.dataset.id;}}
  catch(e){document.body.innerHTML=`<div style="padding:40px;font-family:monospace;color:#c00"><h2>Error</h2><pre>${e.message}</pre></div>`;}
});

// ── Nexus: Populate login stats ──
function populateLoginStats(){
  try {
    const db = gdb();
    const units = db.units['co_kbh'] || [];
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


// ── Patch initLogin to populate login stats ──
const _origInitLogin = initLogin;
initLogin = function() {
  _origInitLogin();
  populateLoginStats();
};


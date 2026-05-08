// ══ SEARCHABLE SELECT ════════════════════════
function mkSS(id,opts,val,onChange){
  var wrap=document.createElement('div');wrap.className='ss-wrap';wrap.style.width='100%';
  var inp=document.createElement('input');inp.className='ss-inp';inp.style.width='100%';inp.id=id;
  var drop=document.createElement('div');drop.className='ss-drop';
  var curOpt=opts.find(function(o){return (typeof o==='object'?o.v:o)===(val||'');});
  inp.value=curOpt?(typeof curOpt==='object'?curOpt.l:curOpt):(val||'');
  inp.setAttribute('data-val',val||'');
  opts.forEach(function(o){
    var v=typeof o==='object'?o.v:o,l=typeof o==='object'?o.l:o;
    var d=document.createElement('div');d.className='ss-opt'+(v===(val||'')?' sel':'');
    d.textContent=l;d.setAttribute('data-v',v);
    d.onmousedown=function(e){e.preventDefault();inp.value=l;inp.setAttribute('data-val',v);
      drop.querySelectorAll('.ss-opt').forEach(function(x){x.classList.remove('sel');});
      d.classList.add('sel');drop.classList.remove('open');if(onChange)onChange(v);};
    drop.appendChild(d);
  });
  inp.oninput=function(){var q=inp.value.toLowerCase();drop.querySelectorAll('.ss-opt').forEach(function(o){o.classList.toggle('hide',!o.textContent.toLowerCase().includes(q));});};
  inp.onfocus=function(){drop.classList.add('open');};
  inp.onblur=function(){setTimeout(function(){drop.classList.remove('open');},200);};
  wrap.appendChild(inp);wrap.appendChild(drop);
  return wrap;
}
function ssVal(id){var el=document.getElementById(id);return el?el.getAttribute('data-val')||'':'';}

function makeSearchable(selId){
  var sel=document.getElementById(selId);
  if(!sel||sel.dataset.enhanced)return;
  sel.dataset.enhanced='1';
  var wrap=document.createElement('div');wrap.className='ss-wrap';wrap.style.width='100%';
  var inp=document.createElement('input');inp.className='ss-inp';inp.style.width='100%';
  var drop=document.createElement('div');drop.className='ss-drop';
  function syncInput(){var co=Array.from(sel.options).find(function(o){return o.value===sel.value;});if(co)inp.value=co.text;}
  function buildDrop(){
    drop.innerHTML='';
    Array.from(sel.options).forEach(function(o){
      var d=document.createElement('div');d.className='ss-opt'+(o.value===sel.value?' sel':'');
      d.textContent=o.text;d.setAttribute('data-v',o.value);
      d.onmousedown=function(e){e.preventDefault();sel.value=o.value;inp.value=o.text;
        drop.querySelectorAll('.ss-opt').forEach(function(x){x.classList.remove('sel');});
        d.classList.add('sel');drop.classList.remove('open');sel.dispatchEvent(new Event('change'));};
      drop.appendChild(d);
    });
    syncInput();
  }
  buildDrop();
  new MutationObserver(buildDrop).observe(sel,{childList:true});
  inp.oninput=function(){var q=inp.value.toLowerCase();drop.querySelectorAll('.ss-opt').forEach(function(o){o.classList.toggle('hide',!o.textContent.toLowerCase().includes(q));});};
  inp.onfocus=function(){buildDrop();drop.classList.add('open');};
  inp.onblur=function(){setTimeout(function(){drop.classList.remove('open');},200);};
  sel.style.display='none';sel.parentNode.insertBefore(wrap,sel);
  wrap.appendChild(inp);wrap.appendChild(drop);wrap.appendChild(sel);
}
function enhanceModalSelects(modalId){
  setTimeout(function(){
    var modal=document.getElementById(modalId);if(!modal)return;
    modal.querySelectorAll('select:not([data-enhanced])').forEach(function(sel){if(sel.id)makeSearchable(sel.id);});
  },50);
}

// ══ SIDEBAR COLLAPSE ══════════════════════════
(function initSidebarCollapse(){
  document.addEventListener('DOMContentLoaded',function(){
    var sb=document.querySelector('.sb');
    if(!sb)return;

    // Desktop toggle button
    var brand=sb.querySelector('.sb-brand');
    if(brand){
      var toggleBtn=document.createElement('button');
      toggleBtn.className='sb-toggle';
      toggleBtn.title='Toggle sidebar';
      toggleBtn.innerHTML='<span class="toggle-icon">‹</span>';
      toggleBtn.onclick=function(){ toggleSidebar(); };
      brand.appendChild(toggleBtn);
    }

    // Restore collapse state from localStorage (desktop only)
    try{
      if(window.innerWidth>768&&localStorage.getItem('nxn_sb_collapsed')==='1'){
        sb.classList.add('collapsed');
      }
    }catch(e){}

    // ── Mobile: Hamburger button in topbar ──
    var topbar=document.querySelector('.topbar');
    if(topbar){
      var ham=document.createElement('button');
      ham.className='tb-hamburger';
      ham.title='Open menu';
      ham.innerHTML='☰';
      ham.onclick=function(){ openMobileSidebar(); };
      // Insert as first child of topbar
      topbar.insertBefore(ham,topbar.firstChild);
    }

    // ── Mobile: Overlay backdrop ──
    var overlay=document.createElement('div');
    overlay.className='sb-overlay';
    overlay.onclick=function(){ closeMobileSidebar(); };
    document.body.appendChild(overlay);

    // Close sidebar on resize to desktop
    window.addEventListener('resize',function(){
      if(window.innerWidth>768){
        closeMobileSidebar();
      }
    });
  });
})();

function openMobileSidebar(){
  var sb=document.querySelector('.sb');
  var ov=document.querySelector('.sb-overlay');
  if(sb)sb.classList.add('mobile-open');
  if(ov)ov.classList.add('visible');
  document.body.style.overflow='hidden';
}

function closeMobileSidebar(){
  var sb=document.querySelector('.sb');
  var ov=document.querySelector('.sb-overlay');
  if(sb)sb.classList.remove('mobile-open');
  if(ov)ov.classList.remove('visible');
  document.body.style.overflow='';
}

function toggleSidebar(){
  if(window.innerWidth<=768){
    // Mobile: toggle overlay
    var sb=document.querySelector('.sb');
    if(sb&&sb.classList.contains('mobile-open')){
      closeMobileSidebar();
    }else{
      openMobileSidebar();
    }
    return;
  }
  // Desktop: collapse
  var sb=document.querySelector('.sb');
  if(!sb)return;
  sb.classList.toggle('collapsed');
  var collapsed=sb.classList.contains('collapsed');
  try{ localStorage.setItem('nxn_sb_collapsed',collapsed?'1':'0'); }catch(e){}
}

// ══ LOGIN ══════════════════════════════════════
function initLogin(){
  const db=gdb();
  document.getElementById('co-sel').innerHTML=db.companies.map(c=>`<button class="co-btn${!_coid||_coid===c.id?' on':''}" data-id="${c.id}" onclick="selCo(this,'${c.id}')">${c.name}</button>`).join('');
  if(!_coid&&db.companies[0])_coid=db.companies[0].id;
  document.getElementById('tb-d').textContent=new Date().toLocaleDateString('en-PK',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
}
function selCo(el,id){_coid=id;document.querySelectorAll('.co-btn').forEach(b=>b.classList.remove('on'));el.classList.add('on');}
function doLogin(){
  const u=document.getElementById('li-u').value.trim(),p=document.getElementById('li-p').value;
  const db=gdb();const usr=db.users.find(x=>x.username===u&&x.password===p&&x.companyIds.includes(_coid));
  const err=document.getElementById('lerr');
  if(!usr){err.style.display='block';return;}
  err.style.display='none';
  const co=db.companies.find(c=>c.id===_coid);
  S={userId:usr.id,name:usr.name,role:usr.role,cid:_coid,coName:co?.name||'',coCode:co?.code||''};
  document.getElementById('sb-av').textContent=ini(usr.name);
  document.getElementById('sb-un').textContent=usr.name;
  const _rl={admin:'Admin / CFO',recovery:'Recovery Staff',accounts:'Accounts Staff',user:'Recovery Staff'};
  document.getElementById('sb-ur').textContent=_rl[usr.role]||'Staff';
  document.getElementById('s-login').classList.remove('on');
  document.getElementById('s-app').classList.add('on');
  updateCoLogo();
  startLeakGuard();
  buildSB();nav('dashboard');checkAutoBackup();
}

function updateCoLogo(){
  var logo=typeof getCoLogo==='function'?getCoLogo():null;
  var coName=S?S.coName||'Nexunova':'Nexunova';
  var ini_=coName.charAt(0).toUpperCase();
  // ── Sidebar logo ──
  var sbImg=document.getElementById('sb-logo-img');
  if(sbImg){
    if(logo){
      sbImg.src=logo;
      sbImg.style.cssText='height:36px;width:auto;max-width:120px;object-fit:contain;background:transparent;display:block';
    }else{
      sbImg.src='';
      sbImg.style.display='none';
    }
  }
  // ── Topbar company chip ──
  var tbC=document.getElementById('tb-c');
  if(tbC){
    if(logo){
      tbC.innerHTML='<img src="'+logo+'" style="height:32px;max-width:110px;object-fit:contain;background:transparent;vertical-align:middle;display:inline-block" alt="'+coName+'">';
    }else{
      tbC.innerHTML='<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#C9A84C;color:#1E2D47;font-size:11px;font-weight:700;margin-right:5px;vertical-align:middle;flex-shrink:0">'+ini_+'</span>'+coName;
    }
  }
}
function doLogout(){S=null;document.getElementById('s-app').classList.remove('on');document.getElementById('s-login').classList.add('on');document.getElementById('li-p').value='';}

// ══ SIDEBAR & NAV ══════════════════════════════
function buildSB(){
  const fus=gfus(),alrt=fus.overdue.length+fus.today.length;
  const role=effectiveRole(),isA=role==='admin',isR=role==='recovery',isAc=role==='accounts';

  // ── Backup reminder ──
  const lastTs=localStorage.getItem(STORE+'_ts');
  const bkEl=document.getElementById('bk-reminder');
  if(bkEl){
    const daysSinceSave=lastTs?Math.floor((Date.now()-new Date(lastTs))/86400000):999;
    bkEl.style.display=daysSinceSave>7?'block':'none';
  }

  // ── Quick Actions (Admin + Recovery) ──
  let actionsHTML='';
  if(isA||isR){
    actionsHTML=`
    <div class="sb-act-section-label">⚡ Quick Actions</div>
    <div class="sb-actions">
      <button class="sb-act-btn sb-act-pay" data-label="Add Payment" onclick="openRecModal(null)">
        <span class="sb-act-icon">💰</span><span class="sb-act-lbl">Add Payment</span>
      </button>
      <button class="sb-act-btn sb-act-call" data-label="Log a Call" onclick="openConModal(null)">
        <span class="sb-act-icon">📞</span><span class="sb-act-lbl">Log a Call</span>
      </button>
      ${isA?`<button class="sb-act-btn sb-act-sell" data-label="Sell a Unit" onclick="nav('units')">
        <span class="sb-act-icon">🏷️</span><span class="sb-act-lbl">Sell a Unit</span>
      </button>`:''}
    </div>`;
  }

  // ── Navigation items ──
  let navItems=[];
  if(isA){
    navItems=[
      {s:'WORKSPACE'},
      {id:'dashboard',  ic:'🏢', lb:'Dashboard'},
      {s:'INVENTORY'},
      {id:'projects',   ic:'🏗️', lb:'Projects'},
      {id:'units',      ic:'📋', lb:'All Units'},
      {id:'search',     ic:'🔍', lb:'Find Unit'},
      {s:'SALES'},
      {id:'clients',    ic:'👥', lb:'Clients'},
      {id:'agents',     ic:'👨‍💼', lb:'Agents'},
      {s:'RECOVERY'},
      {id:'recovery',   ic:'💳', lb:'Payments'},
      {id:'contacts',   ic:'📞', lb:'Call Logs', bdg:alrt||0},
      {s:'REPORTS'},
      {id:'reports',    ic:'📊', lb:'Reports & Export'},
      {id:'documents',  ic:'🖨️', lb:'Documents & Print'},
      {s:'SYSTEM'},
      {id:'admin',      ic:'⚙️', lb:'Admin Panel'},
      {id:'backup',     ic:'💾', lb:'Data Backup'},
    ];
  }else if(isR){
    navItems=[
      {s:'WORKSPACE'},
      {id:'dashboard',  ic:'🏢', lb:'Dashboard'},
      {s:'INVENTORY'},
      {id:'units',      ic:'📋', lb:'All Units'},
      {id:'search',     ic:'🔍', lb:'Find Unit'},
      {s:'SALES'},
      {id:'clients',    ic:'👥', lb:'Clients'},
      {s:'RECOVERY'},
      {id:'recovery',   ic:'💳', lb:'Payments'},
      {id:'contacts',   ic:'📞', lb:'Call Logs', bdg:alrt||0},
    ];
  }else if(isAc){
    navItems=[
      {s:'WORKSPACE'},
      {id:'dashboard',  ic:'🏢', lb:'Dashboard'},
      {s:'RECOVERY'},
      {id:'recovery',   ic:'💳', lb:'Payments'},
      {s:'REPORTS'},
      {id:'reports',    ic:'📊', lb:'Reports & Export'},
      {id:'documents',  ic:'🖨️', lb:'Documents & Print'},
      {s:'SALES'},
      {id:'agents',     ic:'👨‍💼', lb:'Agents'},
    ];
  }

  const navHTML=navItems.map(x=>{
    if(x.s)return `<div class="nav-sec">${x.s}</div>`;
    const b=x.bdg>0?`<span class="ni-bdg">${x.bdg}</span>`:'';
    return `<div class="ni" data-pg="${x.id}" data-label="${x.lb}" onclick="nav('${x.id}')"><span class="ni-ic">${x.ic}</span><span>${x.lb}</span>${b}</div>`;
  }).join('');

  document.getElementById('sb-nav').innerHTML=actionsHTML+navHTML;
}

function nav(pg,x){
  // ── Permission guard ──
  if(S&&S.role!=='admin'){
    const r=effectiveRole();
    const allow={
      recovery:['dashboard','units','unitdetail','search','clients','clientdetail','recovery','contacts'],
      accounts:['dashboard','recovery','reports','documents','clients','clientdetail','agents','agentdetail'],
    };
    if(!(allow[r]||[]).includes(pg))pg='dashboard';
  }
  const curActive=document.querySelector('.pg.on')?.id?.replace('pg-','');
  if(curActive&&curActive!==pg)_prevPg=curActive;
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('on'));
  const pel=document.getElementById('pg-'+pg);if(pel)pel.classList.add('on');
  const nel=document.querySelector(`.ni[data-pg="${pg}"]`);if(nel)nel.classList.add('on');
  const ts={dashboard:'Dashboard',projects:'Projects',projectdetail:'Project Detail',units:'All Units',unitdetail:'Unit Detail',clients:'All Clients',clientdetail:'Client Detail',agents:'Sales Agents',agentdetail:'Agent Detail',recovery:'Payments',contacts:'Call Logs',search:'Find Unit',reports:'Reports & Export',documents:'Documents & Print',backup:'Data Backup',admin:'Admin Panel'};
  const tbTitle=document.getElementById('tb-t');
  if(tbTitle)tbTitle.textContent=ts[pg]||pg;
  const na=document.getElementById('nav-actions');
  const backBtn=document.getElementById('nav-back');
  if(na){
    if(pg==='dashboard'){na.classList.add('hidden');}
    else{
      na.classList.remove('hidden');
      if(backBtn){backBtn.disabled=!_prevPg;}
    }
  }
  // Close mobile sidebar on navigation
  closeMobileSidebar();
  const fns={dashboard:rDash,projects:rProjects,projectdetail:rProjectDetail,units:rUnits,unitdetail:()=>rUD(_uid),clients:rClients,clientdetail:rClientDetail,agents:rAgents,agentdetail:rAgentDetail,recovery:rRec,contacts:rCons,search:rSearch,reports:rReports,documents:rDocs,backup:rBackup,admin:rAdmin};
  const fn = fns[pg];
  if(fn) {
    const result = fn(x);
    if(result && typeof result.then === 'function') {
      result.catch(err => console.error('Navigation error:', err));
    }
  }
  setTimeout(cleanLeakedCodeText,0);
}
function navBack(){if(_prevPg)nav(_prevPg);}
function openUD(id){_uid=id;nav('unitdetail');}

function rDocs(){
  const el=document.getElementById('pg-documents');
  if(!el)return;
  const isA=effectiveRole()==='admin';
  el.innerHTML=`
  <div class="ph"><div><h2>🖨️ Documents & Print</h2><p>Generate professional documents — receipts, agreements, statements, demand letters</p></div></div>
  <div class="dash-kpi-row" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));margin-bottom:28px">
    <div class="dash-kpi blue" style="cursor:default">
      <div class="dkpi-top"><span class="dkpi-icon">🧾</span></div>
      <div class="dkpi-lbl" style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">Payment Receipt</div>
      <div style="font-size:11px;color:var(--t3)">Open a payment record and click Print Receipt</div>
    </div>
    <div class="dash-kpi green" style="cursor:default">
      <div class="dkpi-top"><span class="dkpi-icon">📋</span></div>
      <div class="dkpi-lbl" style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">Sale Agreement</div>
      <div style="font-size:11px;color:var(--t3)">Open a sold unit and click Agreement</div>
    </div>
    <div class="dash-kpi orange" style="cursor:default">
      <div class="dkpi-top"><span class="dkpi-icon">📄</span></div>
      <div class="dkpi-lbl" style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">Client Statement</div>
      <div style="font-size:11px;color:var(--t3)">Open a client profile and click Statement</div>
    </div>
    <div class="dash-kpi" style="cursor:default;--ka:var(--err)">
      <div class="dkpi-top"><span class="dkpi-icon">⚠️</span></div>
      <div class="dkpi-lbl" style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">Demand Letter</div>
      <div style="font-size:11px;color:var(--t3)">Open an overdue unit and click Demand</div>
    </div>
    ${isA?`<div class="dash-kpi" style="cursor:default;--ka:var(--purple)">
      <div class="dkpi-top"><span class="dkpi-icon">📊</span></div>
      <div class="dkpi-lbl" style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">Unit Report</div>
      <div style="font-size:11px;color:var(--t3)">Open any unit and click Report</div>
    </div>`:''}
  </div>
  <div class="card"><div class="ch"><h3>Quick Access</h3></div>
    <div class="cb" style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-gh" onclick="nav('recovery')">💳 Go to Payments</button>
      <button class="btn btn-gh" onclick="nav('clients')">👥 Go to Clients</button>
      <button class="btn btn-gh" onclick="nav('units')">📋 Go to Units</button>
      ${isA?`<button class="btn btn-gh" onclick="nav('reports')">📊 Go to Reports</button>`:''}
    </div>
  </div>`;
}

function cleanLeakedCodeText(){
  const root=document.querySelector('.pw');
  if(!root)return;
  const bad=['function rRec','function rRecF',"document.getElementById('pg-recovery')",'w.document.close();setTimeout','let _rf={fr:','// ══ RECOVERY PAGE'];
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const toRemove=[];
  while(walker.nextNode()){
    const n=walker.currentNode,tx=(n.nodeValue||'').trim();
    if(!tx)continue;
    if(tx.length>28&&bad.some(k=>tx.includes(k)))toRemove.push(n);
  }
  toRemove.forEach(n=>n.parentNode&&n.parentNode.removeChild(n));
}
function startLeakGuard(){
  if(_leakGuardOn)return;
  const root=document.querySelector('.pw');
  if(!root)return;
  _leakGuardOn=true;
  const run=()=>cleanLeakedCodeText();
  const mo=new MutationObserver(run);
  mo.observe(root,{childList:true,subtree:true,characterData:true});
  setInterval(run,700);
}

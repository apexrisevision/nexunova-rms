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
  // Run after DOM is ready
  document.addEventListener('DOMContentLoaded',function(){
    var sb=document.querySelector('.sb');
    if(!sb)return;

    // Inject toggle button into brand area
    var brand=sb.querySelector('.sb-brand');
    if(brand){
      var toggleBtn=document.createElement('button');
      toggleBtn.className='sb-toggle';
      toggleBtn.title='Toggle sidebar';
      toggleBtn.innerHTML='<span class="toggle-icon">‹</span>';
      toggleBtn.onclick=function(){ toggleSidebar(); };
      brand.appendChild(toggleBtn);
    }

    // Restore collapse state from localStorage
    try{
      if(localStorage.getItem('nxn_sb_collapsed')==='1'){
        sb.classList.add('collapsed');
      }
    }catch(e){}
  });
})();

function toggleSidebar(){
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
  document.getElementById('sb-ur').textContent=usr.role==='admin'?'Admin / CFO':'Recovery Staff';
  document.getElementById('tb-c').textContent=co?.name||'';
  document.getElementById('s-login').classList.remove('on');
  document.getElementById('s-app').classList.add('on');
  startLeakGuard();
  buildSB();nav('dashboard');checkAutoBackup();
}
function doLogout(){S=null;document.getElementById('s-app').classList.remove('on');document.getElementById('s-login').classList.add('on');document.getElementById('li-p').value='';}

// ══ SIDEBAR & NAV ══════════════════════════════
function buildSB(){
  const fus=gfus(),alrt=fus.overdue.length+fus.today.length,isA=S.role==='admin';
  const items=[
    {s:'Main'},{id:'dashboard',ic:'🏠',lb:'Dashboard'},
    {id:'search',ic:'🔍',lb:'Find Unit'},
    {s:'Work'},{id:'units',ic:'🏢',lb:'All Units'},
    {id:'recovery',ic:'💰',lb:'Payments'},
    {id:'contacts',ic:'📞',lb:'Call Logs',bdg:alrt||0},
    {s:'Reports'},{id:'reports',ic:'📊',lb:'Reports &amp; Export'},
    {s:'Backup'},{id:'backup',ic:'💾',lb:'Data Backup'},
  ];
  if(isA){items.push({s:'Admin'});items.push({id:'admin',ic:'⚙️',lb:'Admin Panel'});}

  // Show backup reminder
  const lastTs=localStorage.getItem(STORE+'_ts');
  const bkEl=document.getElementById('bk-reminder');
  if(bkEl){
    const daysSinceSave=lastTs?Math.floor((Date.now()-new Date(lastTs))/86400000):999;
    bkEl.style.display=daysSinceSave>7?'block':'none';
  }

  document.getElementById('sb-nav').innerHTML=items.map(x=>{
    if(x.s)return `<div class="nav-sec">${x.s}</div>`;
    const b=x.bdg>0?`<span class="ni-bdg">${x.bdg}</span>`:'';
    // data-label used by CSS tooltip on collapsed sidebar
    const plainLabel=x.lb.replace(/&amp;/g,'&');
    return `<div class="ni" data-pg="${x.id}" data-label="${plainLabel}" onclick="nav('${x.id}')"><span class="ni-ic">${x.ic}</span><span>${x.lb}</span>${b}</div>`;
  }).join('');
}

function nav(pg,x){
  const curActive=document.querySelector('.pg.on')?.id?.replace('pg-','');
  if(curActive&&curActive!==pg)_prevPg=curActive;
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('on'));
  const pel=document.getElementById('pg-'+pg);if(pel)pel.classList.add('on');
  const nel=document.querySelector(`.ni[data-pg="${pg}"]`);if(nel)nel.classList.add('on');
  const ts={dashboard:'Dashboard',units:'All Units',unitdetail:'Unit Detail',recovery:'Payments',contacts:'Call Logs',search:'Find Unit',reports:'Reports & Export',backup:'Data Backup',admin:'Admin Panel'};
  // Update topbar title
  const tbTitle=document.getElementById('tb-t');
  if(tbTitle)tbTitle.textContent=ts[pg]||pg;
  // Show/hide nav-actions bar
  const na=document.getElementById('nav-actions');
  const backBtn=document.getElementById('nav-back');
  if(na){
    if(pg==='dashboard'){na.classList.add('hidden');}
    else{
      na.classList.remove('hidden');
      if(backBtn){backBtn.disabled=!_prevPg;}
    }
  }
  const fns={dashboard:rDash,units:rUnits,unitdetail:()=>rUD(_uid),recovery:rRec,contacts:rCons,search:rSearch,reports:rReports,backup:rBackup,admin:rAdmin};
  if(fns[pg])fns[pg](x);
  setTimeout(cleanLeakedCodeText,0);
}
function navBack(){if(_prevPg)nav(_prevPg);}
function openUD(id){_uid=id;nav('unitdetail');}

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

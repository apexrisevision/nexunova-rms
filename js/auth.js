// ══ AUTH — LOGIN / LOGOUT ══════════════════════

function initLogin(){
  const coSel=document.getElementById('co-sel');
  if(coSel){coSel.innerHTML='';coSel.style.display='none';}
  const tbD=document.getElementById('tb-d');
  if(tbD)tbD.textContent=new Date().toLocaleDateString('en-PK',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
}

function doLogin(){
  const uname=document.getElementById('li-u').value.trim();
  const pass=document.getElementById('li-p').value;
  const db=gdb();
  const err=document.getElementById('lerr');
  const FAIL=()=>{err.textContent='Invalid username or password';err.style.color='';err.style.display='block';};

  let usr=null,coid=null;

  if(!uname.includes('@')){
    // ── RULE 1: ADMIN — username = company code ──
    const co=(db.companies||[]).find(c=>c.code.toLowerCase()===uname.toLowerCase());
    if(!co){FAIL();return;}
    usr=(db.users||[]).find(u=>(u.companyIds||[]).includes(co.id)&&u.role==='admin'&&u.password===pass);
    if(!usr){FAIL();return;}
    coid=co.id;

  }else{
    // ── RULE 2: STAFF — name@companycode ──
    const at=uname.lastIndexOf('@');
    const name=uname.slice(0,at).trim();
    const code=uname.slice(at+1).trim();
    if(!name||!code){FAIL();return;}
    const co=(db.companies||[]).find(c=>c.code.toLowerCase()===code.toLowerCase());
    if(!co){FAIL();return;}
    usr=(db.users||[]).find(u=>
      (u.companyIds||[]).includes(co.id)&&
      u.username===name&&
      u.password===pass&&
      (u.role==='recovery'||u.role==='accounts')
    );
    if(!usr){FAIL();return;}
    coid=co.id;
  }

  // ── Complete login ──
  err.style.display='none';err.style.color='';
  _coid=coid;
  const co=(db.companies||[]).find(c=>c.id===_coid);
  S={userId:usr.id,name:usr.name,role:usr.role,cid:_coid,coName:co?.name||'',coCode:co?.code||''};

  document.getElementById('sb-av').textContent=ini(usr.name);
  document.getElementById('sb-un').textContent=usr.name;
  const roleLabels={admin:'Admin / CFO',recovery:'Recovery Staff',accounts:'Accounts Staff'};
  document.getElementById('sb-ur').textContent=roleLabels[usr.role]||'Staff';

  document.getElementById('s-login').classList.remove('on');
  document.getElementById('s-app').classList.add('on');

  if(typeof updateCoLogo==='function')updateCoLogo();
  startLeakGuard();
  buildSB();nav('dashboard');checkAutoBackup();
}

function doLogout(){
  S=null;_coid=null;
  document.getElementById('s-app').classList.remove('on');
  document.getElementById('s-login').classList.add('on');
  document.getElementById('li-u').value='';
  document.getElementById('li-p').value='';
  const err=document.getElementById('lerr');
  if(err){err.style.display='none';err.style.color='';}
  initLogin();
}

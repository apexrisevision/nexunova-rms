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


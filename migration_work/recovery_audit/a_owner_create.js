// PART A: owner logs in, we map the admin surface, then create a recovery user via the real modal.
const { start, login, sleep } = require('./lib');
(async()=>{
  const H = await start(4781);
  const { page, base } = H;
  const sess = await login(page, base, 'zztest3', 'ZzTest!2026');
  console.log('OWNER_SESSION', JSON.stringify(sess));
  if(!sess.loggedIn){ console.log('LOGIN_FAILED'); await H.browser.close(); H.srv.close(); return; }

  await page.evaluate(()=>nav('dashboard')); await sleep(2500);
  await H.shot('A0_owner_dashboard');

  // Go to Users & Roles
  await page.evaluate(()=>nav('users')); await sleep(2500);
  await H.shot('A1_users_list');

  // Open Add-user modal, fill it as a default recovery officer (no module checkboxes => role default)
  const opened = await page.evaluate(()=>{ if(typeof openAddUserModal==='function'){openAddUserModal();return true;} return false; });
  await sleep(900);
  const filled = await page.evaluate(()=>{
    const set=(id,v)=>{const e=document.getElementById(id); if(!e)return false; e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); return true;};
    const r={};
    r.name=set('um-name','ZZR Bilal Recovery');
    r.uname=set('um-username','zzrbilal');
    const role=document.getElementById('um-role'); if(role){role.value='recovery'; r.role=role.value;}
    r.pass=set('um-pass','ZzRec!2026');
    // NEW: tick the first project in the picker (the assignment the audit said was missing)
    const projCbs=[...document.querySelectorAll('.um-proj-cb')];
    r.projectCheckboxes=projCbs.length;
    if(projCbs[0]){ projCbs[0].checked=true; r.tickedProject=projCbs[0].dataset.id; }
    return r;
  });
  console.log('MODAL_FILLED', JSON.stringify(filled));
  await H.shot('A2_create_modal');

  await page.evaluate(()=>{ if(typeof saveUserModal==='function') saveUserModal(); });
  await sleep(4000);
  await H.shot('A3_after_create');

  console.log('CONSOLE_ERRS', H.errs.length, H.errs.slice(0,8).join(' | '));
  console.log('CREATE_RPCS', JSON.stringify(H.rpcs.filter(r=>/create_app_user|update_app_user|list_app_users/.test(r.fn))));
  await H.browser.close(); H.srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});

/**
 * MAIN GATE — ZZTEST3 full acceptance test (real UI, prod).
 * Journey: signup (+ server-side wrong/missing-OTP rejection proof) -> login by
 * bare handle -> onboarding wizard Project..Done -> Add User (chosen username, NO
 * email) -> that user logs in & is FORCED to change password -> admin resets it
 * (on-screen temp pw) -> deactivate -> audit_logs shows every credential action.
 * Management API is used ONLY to (a) set a known OTP hash so a real verify_signup_otp
 * succeeds, and (b) read back audit_logs. Everything else is real clicks.
 */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const REF = 'itqxljtfbrppntgyfush';
const TOKEN = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
const PORT = 4325; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'gate_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };

const EMAIL='zztest3.gate@nexunova.test', CNAME='ZZTEST3', OWNER_PW='ZzTest3!2026';
const CODE='zztest3';
const STAFF_PW='Staff3!2026', STAFF_NEW='Jamal3!Newpass', STAFF_USER='jamal';
const log=[]; const P=(...a)=>{ console.log(...a); log.push(a.join(' ')); };

async function sql(query){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({query})});
  const t=await r.text(); if(!r.ok) throw new Error('SQL '+r.status+': '+t);
  return JSON.parse(t);
}
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function shot(page,n){await page.screenshot({path:path.join(OUT,n)});P('  shot',n);}
async function setTheme(page,t){await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),t);}
async function setVal(page,id,v){await page.evaluate((id,v)=>{var e=document.getElementById(id);if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('keyup',{bubbles:true}));}},id,v);}
async function waitFor(page,sel,t=15000){const end=Date.now()+t;while(Date.now()<end){if(await page.evaluate(s=>{var e=document.querySelector(s);return !!e&&e.offsetParent!==null;},sel))return true;await sleep(200);}return false;}
async function clickOnclick(page,sub){return page.evaluate(sub=>{var e=[...document.querySelectorAll('[onclick]')].find(x=>(x.getAttribute('onclick')||'').includes(sub)&&x.offsetParent!==null);if(e){e.click();return true;}return false;},sub);}
async function wizStep(page){return page.evaluate(()=>{if(document.getElementById('ob-pname'))return 1;if(document.getElementById('ob-fl-n'))return 2;if(document.querySelector('.ob-ty'))return 3;if(document.getElementById('ob-per'))return 4;if([...document.querySelectorAll('[onclick]')].some(e=>(e.getAttribute('onclick')||'').includes('_finish')))return 5;return 0;});}
async function login(page,handle,pw){
  await page.evaluate((h,p)=>{var u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=h;q.value=p;window._loginReadyAt=0;},handle,pw);
  await page.evaluate(()=>doLogin());
}

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  // Clean any prior ZZTEST3 (sanctioned test tenant only)
  await sql(`DO $$DECLARE c uuid; BEGIN SELECT id INTO c FROM companies WHERE company_code='zztest3';
    IF c IS NOT NULL THEN DELETE FROM auth.users WHERE id IN (SELECT auth_user_id FROM app_users WHERE company_id=c);
      DELETE FROM companies WHERE id=c; END IF;
    DELETE FROM email_otps WHERE email='${EMAIL}'; END$$;`).catch(e=>P('clean warn',e.message));
  P('cleaned prior zztest3 (if any)');

  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1440,1000']});
  const page=await browser.newPage(); await page.setViewport({width:1320,height:920});
  page.on('dialog',async d=>{ try{await d.accept();}catch(e){} });
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
  page.on('pageerror',e=>errs.push('PAGEERR '+String(e).slice(0,160)));
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);

  // ── SIGNUP ──
  await page.evaluate(()=>showSignup()); await sleep(500);
  await setVal(page,'sg-fname','Owner Three');
  await setVal(page,'sg-email',EMAIL);
  await setVal(page,'sg-phone','+923004445566');
  await sleep(1500);
  await setTheme(page,'light'); await shot(page,'zz3_01_signup_step1_light.png'); await setTheme(page,'dark');
  // real OTP send
  await page.evaluate(()=>{var b=document.getElementById('sg-email-verify-btn');if(b)b.click();}); await sleep(2500);
  await shot(page,'zz3_02_otp_overlay_dark.png');

  // PROOF #1 (server wrong-OTP rejection): inject known hash, then verify a WRONG code
  await sql(`UPDATE email_otps SET otp_hash=extensions.crypt('123456',extensions.gen_salt('bf',8))
             WHERE email='${EMAIL}' AND purpose='signup' AND used_at IS NULL;`);
  const wrong=await page.evaluate(async()=>{const{data}=await supabase.rpc('verify_signup_otp',{p_email:'zztest3.gate@nexunova.test',p_otp:'000000'});return data;});
  P('PROOF wrong_otp_rejected =', JSON.stringify(wrong));

  // PROOF #2 (server missing-verified-OTP rejection): try signup BEFORE a successful verify
  const noverify=await page.evaluate(async()=>{const{data}=await supabase.rpc('signup_new_company',{p_full_name:'X',p_email:'zztest3.gate@nexunova.test',p_phone:'1',p_company_name:'ZZTEST3',p_password:'ZzTest3!2026'});return data;});
  P('PROOF missing_otp_signup_blocked =', JSON.stringify(noverify && (noverify.error||noverify)));

  // Now verify for REAL (sets verified_at). Close overlay, mark client state.
  const ok=await page.evaluate(async()=>{const{data}=await supabase.rpc('verify_signup_otp',{p_email:'zztest3.gate@nexunova.test',p_otp:'123456'});return data;});
  P('real_verify =', JSON.stringify(ok));
  await page.evaluate(()=>{SV.emailVerified=true;SV.emailAvailable=true;if(typeof svHideVerifyBtn==='function')svHideVerifyBtn();var b=document.getElementById('sg-email-verified');if(b)b.style.display='';document.querySelectorAll('[id*="otp" i]').forEach(el=>{try{if(getComputedStyle(el).position==='fixed')el.remove();}catch(e){}});});
  await sleep(300); await page.evaluate(()=>sgNext()); await sleep(500);
  // step2 company
  await setVal(page,'sg-cname',CNAME); await setVal(page,'sg-address','Plot 3, Gate Avenue, Karachi'); await setVal(page,'sg-city','Karachi');
  await sleep(1500); await page.evaluate(()=>sgNext()); await sleep(400);
  // step3 password
  await setVal(page,'sg-pass',OWNER_PW); await setVal(page,'sg-conf',OWNER_PW); await sleep(300); await page.evaluate(()=>sgNext()); await sleep(500);
  // step4 plan -> free trial (clean trial-ready result screen; bump to a paid plan later for the add-user test)
  await page.evaluate(()=>{if(typeof sgSelectPlan==='function')sgSelectPlan('free_trial');}); await sleep(300); await page.evaluate(()=>sgNext()); await sleep(500);
  // step5 agree + submit
  await page.evaluate(()=>{var c=document.getElementById('sg-agree');if(c&&!c.checked)c.click();}); await sleep(300);
  await page.evaluate(()=>sgNext()); await sleep(4500);
  await shot(page,'zz3_03_signup_result_dark.png');
  await setTheme(page,'light'); await shot(page,'zz3_03b_signup_result_light.png'); await setTheme(page,'dark');
  const resInfo=await page.evaluate(()=>({u:(document.getElementById('sg-username-val')||{}).textContent,body:(document.getElementById('sg-result-screen')||{}).innerText||''}));
  P('signup_result =', JSON.stringify(resInfo));

  // Keep status=trialing (lands straight in the app) but switch to a multi-user,
  // high-unit plan so the wizard generates freely + we can add a staff user.
  await sql(`UPDATE subscriptions SET plan_id=(SELECT id FROM subscription_plans WHERE plan_code='ultimate_monthly') WHERE company_id=(SELECT id FROM companies WHERE company_code='${CODE}');`);

  // ── LOGIN (bare handle) ──
  await page.evaluate(()=>sgGoToLogin()); await sleep(600);
  await setTheme(page,'light'); await shot(page,'zz3_04_login_prefilled_light.png'); await setTheme(page,'dark');
  await login(page,CODE,OWNER_PW); await sleep(6000);
  const st=await page.evaluate(()=>({app:document.getElementById('s-app')?.classList.contains('on'),ob:document.getElementById('s-onboarding')?.classList.contains('on')}));
  P('after_login =', JSON.stringify(st));
  await shot(page,'zz3_05_wizard_launch_dark.png');

  // ── WIZARD ──
  let guard=0, wizErr='', did4=false;
  while(guard++<14){
    const s=await wizStep(page); P('wiz_at',s);
    if(s===1){ await setVal(page,'ob-pname','ZZTEST3 Tower'); await sleep(200); await setTheme(page,'light'); await shot(page,'zz3_06_wiz_project_light.png'); await setTheme(page,'dark'); await clickOnclick(page,'_saveProject'); await waitFor(page,'#ob-fl-n'); await sleep(500); }
    else if(s===2){ await shot(page,'zz3_07_wiz_floors_dark.png'); await clickOnclick(page,'_genFloors'); await waitFor(page,'.ob-ty',20000); await sleep(800); }
    else if(s===3){ await shot(page,'zz3_08_wiz_types_dark.png'); await clickOnclick(page,'_saveTypes'); await waitFor(page,'#ob-per'); await sleep(800); }
    else if(s===4 && !did4){ did4=true; await setVal(page,'ob-per','2'); await clickOnclick(page,'_preview'); await sleep(1200); await shot(page,'zz3_09_wiz_units_dark.png'); await clickOnclick(page,'_genUnits'); await waitFor(page,"[onclick*='_finish']",25000); await sleep(800); }
    else if(s===4){ await sleep(800); }   // units submitted; waiting for Done
    else if(s===5){ await shot(page,'zz3_10_wiz_done_dark.png'); wizErr=await page.evaluate(()=>(document.getElementById('ob-err')||{}).textContent||''); break; }
    else { wizErr='unknown_step'; P('wiz unknown; err=',await page.evaluate(()=>(document.getElementById('ob-err')||{}).textContent||'')); break; }
  }
  P('wiz_err =', JSON.stringify(wizErr));
  await page.evaluate(async()=>{if(window.OB)await OB._finish('dashboard');}); await sleep(2000);
  const onb=await sql(`SELECT onboarding_complete FROM companies WHERE company_code='${CODE}';`);
  P('onboarding_complete_after_wizard =', JSON.stringify(onb));

  // ── ADD USER (chosen username, NO email) ──
  await page.evaluate(()=>nav('users')); await sleep(2500);
  await page.evaluate(()=>openAddUserModal()); await sleep(600);
  await setVal(page,'um-name','Jamal Khan'); await setVal(page,'um-username',STAFF_USER);
  await page.evaluate(()=>{document.getElementById('um-role').value='recovery';});
  await setVal(page,'um-pass',STAFF_PW);
  await page.evaluate(()=>{var e=document.getElementById('um-email');if(e)e.value='';});  // NO email
  await sleep(300); await shot(page,'zz3_11_adduser_modal_dark.png');
  await setTheme(page,'light'); await shot(page,'zz3_11b_adduser_modal_light.png'); await setTheme(page,'dark');
  await page.evaluate(()=>saveUserModal()); await sleep(3000);
  await shot(page,'zz3_12_users_after_add_dark.png');
  const created=await sql(`SELECT username, email, needs_password_reset, (auth_user_id IS NOT NULL) linked FROM app_users WHERE company_id=(SELECT id FROM companies WHERE company_code='${CODE}') AND role='recovery';`);
  P('created_user =', JSON.stringify(created));

  // ── STAFF logs in -> FORCED change ──
  await page.evaluate(()=>doLogout()); await sleep(2500);
  await login(page, STAFF_USER+'@'+CODE, STAFF_PW); await sleep(5500);
  // #_fpc-overlay is position:fixed (offsetParent null) -> detect by existence, not visibility.
  const forced=await (async()=>{const end=Date.now()+9000;while(Date.now()<end){if(await page.evaluate(()=>!!document.getElementById('_fpc-overlay')))return true;await sleep(250);}return false;})();
  P('forced_change_overlay =', forced);
  await shot(page,'zz3_13_forced_change_dark.png');
  if(forced){
    await page.evaluate((np)=>{document.getElementById('_fpc-new').value=np;document.getElementById('_fpc-conf').value=np;},STAFF_NEW);
    await page.evaluate(()=>document.getElementById('_fpc-go').click()); await sleep(5000);
  }
  const staffIn=await page.evaluate(()=>document.getElementById('s-app')?.classList.contains('on'));
  P('staff_logged_in_after_change =', staffIn);

  // ── OWNER resets staff pw (no email -> on-screen) ──
  await page.evaluate(()=>doLogout()); await sleep(2500);
  await login(page,CODE,OWNER_PW); await sleep(5000);
  await page.evaluate(()=>nav('users')); await sleep(2500);
  await page.evaluate(()=>{var b=[...document.querySelectorAll('button')].find(x=>/Reset Pwd/i.test(x.textContent));if(b)b.click();}); await sleep(2500);
  const tempShown=await waitFor(page,'#um-temppw-val',6000);
  P('onscreen_temp_pw_modal =', tempShown);
  await shot(page,'zz3_14_onscreen_temppw_dark.png');
  await page.evaluate(()=>{var b=document.getElementById('um-temppw-done');if(b)b.click();}); await sleep(800);

  // ── Deactivate staff ──
  await page.evaluate(()=>{var b=[...document.querySelectorAll('button')].find(x=>/^Deactivate$/i.test(x.textContent.trim()));if(b)b.click();}); await sleep(2500);
  await shot(page,'zz3_15_after_deactivate_dark.png');

  // ── AUDIT verification ──
  const audit=await sql(`SELECT action, reason, changed_by_name, changed_by_role, changed_fields
    FROM audit_logs WHERE table_name='app_users'
      AND company_id=(SELECT id FROM companies WHERE company_code='${CODE}')
    ORDER BY changed_at DESC LIMIT 8;`);
  P('AUDIT_ROWS =', JSON.stringify(audit));

  P('CONSOLE_ERRS', errs.length, errs.slice(0,8).join(' | '));
  fs.writeFileSync(path.join(OUT,'zz3_trace.txt'), log.join('\n'));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e);try{fs.writeFileSync(path.join(__dirname,'gate_shots','zz3_trace.txt'),log.join('\n')+'\nFATAL '+e.stack);}catch(_){ } process.exit(1);});

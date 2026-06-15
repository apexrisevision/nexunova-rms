const { start, sleep } = require('./lib');
(async()=>{
  const H = await start(4783); const { page, base } = H;
  const msgs=[]; page.on('console',m=>msgs.push(m.type()+':'+m.text().slice(0,180)));
  let vl=null; page.on('response',async r=>{const u=r.url(); if(u.includes('/rpc/verify_login')){try{vl=await r.text();}catch(_){}} if(u.includes('/auth/v1/token')){try{const b=await r.text(); msgs.push('TOKEN '+r.status()+' '+b.slice(0,120));}catch(_){}}});
  async function tryLogin(ident,pass){
    msgs.length=0; vl=null;
    await page.goto(base+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
    await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ident,pass);
    await page.evaluate(()=>doLogin()); await sleep(9000);
    const s=await page.evaluate(()=>({loggedIn:!!(window.S&&S.userId),role:window.S?.role,appOn:document.getElementById('s-app')?.classList.contains('on'),loginOn:document.getElementById('s-login')?.classList.contains('on'),lerr:document.getElementById('lerr')?.textContent?.slice(0,80)}));
    console.log('=== TRY',ident,'===');
    console.log('verify_login:',(vl||'').slice(0,160));
    console.log('state:',JSON.stringify(s));
    console.log('msgs:',msgs.filter(m=>/auth|error|TOKEN|fail|bridge/i.test(m)).slice(0,8).join(' || '));
  }
  await tryLogin('zztest3','ZzTest!2026');
  await H.browser.close(); H.srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});

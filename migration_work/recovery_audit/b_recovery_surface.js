// PART B: recovery user logs in. Map the visible nav surface, then probe every
// recovery page to see if nav() actually lands there or bounces to dashboard.
const { start, login, sleep } = require('./lib');
(async()=>{
  const H = await start(4784); const { page, base } = H;
  const sess = await login(page, base, 'zzrbilal@zztest3', 'ZzRec!2026');
  console.log('REC_SESSION', JSON.stringify(sess));
  if(!sess.loggedIn){ console.log('LOGIN_FAILED'); await H.browser.close(); H.srv.close(); return; }

  await page.evaluate(()=>nav('dashboard')); await sleep(2500);
  await H.shot('B0_rec_dashboard');

  // Visible sidebar items (what the recovery officer actually sees)
  const nav_surface = await page.evaluate(()=>{
    const items=[...document.querySelectorAll('.sb .ni[data-pg]')].map(n=>({pg:n.dataset.pg, label:n.textContent.trim().replace(/\s+/g,' ').slice(0,30), hidden:n.offsetParent===null}));
    const groups=[...document.querySelectorAll('.sb .nav-group')].map(g=>g.querySelector('.nav-grp-label,.nav-group-label')?.textContent?.trim()||null);
    return { items, groups };
  });
  console.log('NAV_SURFACE', JSON.stringify(nav_surface));

  // Probe: for each recovery-relevant page, nav() and see where we land.
  const targets=['recovery','pdc','reminders','contacts','promises','fieldvisits','escalations','campaigns','legalcases','receipts','ledgers','clients','units','sales','team','users','admin','reports'];
  const landings={};
  for(const t of targets){
    await page.evaluate((p)=>nav(p), t); await sleep(700);
    const landed = await page.evaluate(()=>document.querySelector('.pg.on')?.id?.replace('pg-','')||null);
    landings[t]=landed;
  }
  console.log('NAV_LANDINGS', JSON.stringify(landings));

  // Screenshot key reachable pages
  await page.evaluate(()=>nav('recovery')); await sleep(2500); await H.shot('B1_payments_queue');
  await page.evaluate(()=>nav('contacts')); await sleep(2500); await H.shot('B2_inbox');
  await page.evaluate(()=>nav('fieldvisits')); await sleep(1500); await H.shot('B3_fieldvisits_attempt');

  console.log('CONSOLE_ERRS', H.errs.length, H.errs.slice(0,6).join(' | '));
  await H.browser.close(); H.srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});

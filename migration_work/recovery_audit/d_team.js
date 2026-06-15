// PART D: attribution proof. Owner opens Team Performance; we screenshot it and
// pull the raw get_team_performance numbers for the recovery officer.
const { start, login, sleep } = require('./lib');
(async()=>{
  const H = await start(4786); const { page, base } = H;
  const sess = await login(page, base, 'zztest3', 'ZzTest!2026');
  if(!sess.loggedIn){ console.log('LOGIN_FAILED'); await H.browser.close(); H.srv.close(); return; }

  await page.evaluate(()=>nav('team')); await sleep(3500);
  await H.shot('D1_team_performance');
  const teamProbe = await page.evaluate(()=>({
    rows: document.querySelectorAll('#team-body .nx-table tbody tr, #team-body tbody tr').length,
    text: (document.getElementById('pg-team')?.innerText||'').replace(/\s+/g,' ').slice(0,400)
  }));
  console.log('TEAM_PAGE', JSON.stringify(teamProbe));

  // Raw RPC for the proof (default period = this month, all projects)
  const raw = await page.evaluate(async ()=>{
    const {data,error}=await supabase.rpc('get_team_performance',{p_company_id:S.cid});
    return {error: error?.message||null, data};
  });
  const rows = Array.isArray(raw.data)? raw.data : (raw.data||[]);
  const bilal = rows.find(r=>/zzr bilal/i.test(r.full_name||''));
  console.log('TEAM_RPC_ERR', raw.error);
  console.log('BILAL_ROW', JSON.stringify(bilal,null,1));

  await H.browser.close(); H.srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});

/** Reskin Batch 4 — Agents / Commissions / Agent Transactions verification.
 *  Company-scoped RPCs (S lexical, can't repoint) → verify on the live ZZTEST
 *  tenant with REAL round-trips (admin-batch precedent):
 *    create agent (lean form) → appears → edit persists · record commission
 *    payment · add agent transaction · add commission structure.
 *  Then screenshot list / detail / form(±more) / commissions(payouts+structures)
 *  / transactions at 1366+1920 light+dark. MCP cleans up the ZZTEST rows after.
 */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4733; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'ag_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
const ZCID='a2915ce7-c01c-463b-ba50-b144b2240337';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SIZES=[[1366,768,'1366'],[1920,1080,'1920']];

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1936,1200']});
  const page=await browser.newPage(); await page.setViewport({width:1920,height:1080});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  // Agent name validation rejects digits → letter-only names (cleaned up via MCP after).
  const A1 = 'ZZ Agent Alpha', A2 = 'ZZ Agent Bravo';
  const rt = {};

  // warm the projects cache (agent form needs a project on create)
  await page.evaluate(()=>nav('projects')); await sleep(2000);

  // ── create agent 1 via the lean form ──
  await page.evaluate(()=>nav('agents')); await sleep(2200);
  await page.evaluate(()=>openAgentModal(null)); await sleep(1100);
  rt.form = await page.evaluate(()=>({
    kit_modal: !!document.querySelector('#m-agent.nx-modal-overlay'),
    name_field: !!document.getElementById('af-name'),
    project_field: !!document.getElementById('af-project'),
    more_collapsed: document.getElementById('af-more') ? document.getElementById('af-more').style.display==='none' : null
  }));
  await page.evaluate((nm)=>{ document.getElementById('af-name').value=nm; document.getElementById('af-phone').value='03001234567'; document.getElementById('af-commission').value='3'; }, A1);
  await page.evaluate(()=>saveAgentForm()); await sleep(3500);

  // create agent 2
  await page.evaluate(()=>nav('agents')); await sleep(1600);
  await page.evaluate(()=>openAgentModal(null)); await sleep(1100);
  await page.evaluate((nm)=>{ document.getElementById('af-name').value=nm; document.getElementById('af-phone').value='03007654321'; document.getElementById('af-commission').value='5'; }, A2);
  await page.evaluate(()=>saveAgentForm()); await sleep(3500);

  // fetch ids
  const ids = await page.evaluate(async(cid)=>{ const {data}=await supabase.rpc('list_agents',{p_company_id:cid,p_search:null,p_status:null,p_sort:'name'}); return (data||[]).map(a=>({id:a.id,name:a.full_name,comm:a.commission_percent})); }, ZCID);
  const a1 = ids.find(x=>x.name===A1), a2 = ids.find(x=>x.name===A2);
  rt.created = { count: ids.filter(x=>x.name.startsWith('ZZ Agent')).length, a1:!!a1, a2:!!a2 };

  // ── edit agent 1 → commission 7 → persists ──
  if (a1){
    await page.evaluate(()=>nav('agents')); await sleep(1400);
    await page.evaluate((id)=>openAgentModal(id), a1.id); await sleep(900);
    rt.edit_prefill = await page.evaluate(()=>document.getElementById('af-name').value);
    await page.evaluate(()=>{ document.getElementById('af-commission').value='7'; });
    await page.evaluate(()=>saveAgentForm()); await sleep(3000);
    const chk = await page.evaluate(async(cid,id)=>{ const {data}=await supabase.rpc('list_agents',{p_company_id:cid,p_sort:'name'}); const a=(data||[]).find(x=>x.id===id); return a?Number(a.commission_percent):null; }, ZCID, a1.id);
    rt.edit_persisted = chk;
  }

  // ── record a commission payment (round-trip B) ──
  if (a1){
    await page.evaluate(()=>nav('agents')); await sleep(1200);
    await page.evaluate((id,nm)=>openCommPayModal(id,nm,0), a1.id, A1); await sleep(600);
    await page.evaluate(()=>{ const v=document.getElementById('cp-print-voucher'); if(v) v.checked=false; document.getElementById('cp-amount').value='50000'; });
    await page.evaluate(()=>saveCommPayForm()); await sleep(3000);
    rt.comm_pay = await page.evaluate(async(cid,id)=>{ const {data}=await supabase.rpc('list_agent_commission_payments',{p_company_id:cid,p_agent_id:id}); return (data||[]).length; }, ZCID, a1.id);
  }

  // ── add an agent transaction (round-trip C) ──
  if (a1){
    await page.evaluate(()=>nav('agenttransactions')); await sleep(2200);
    await page.evaluate(()=>_atOpenModal()); await sleep(800);
    await page.evaluate((id)=>{ document.getElementById('at-agent_id').value=id; document.getElementById('at-transaction_type').value='adjustment_credit'; document.getElementById('at-amount').value='15000'; }, a1.id);
    await page.evaluate(()=>_atSave()); await sleep(2500);
    rt.txn = await page.evaluate(async(cid)=>{ const {data}=await supabase.rpc('list_agent_transactions',{p_company_id:cid,p_filters:{}}); return (data||[]).length; }, ZCID);
  }

  // ── add a commission structure ──
  await page.evaluate(()=>nav('commissions')); await sleep(2000);
  await page.evaluate(()=>_commSwitchTab('structures')); await sleep(1500);
  await page.evaluate(()=>_csOpenForm(null)); await sleep(800);
  await page.evaluate(()=>{ document.getElementById('cs-rate').value='2.5'; });
  await page.evaluate(()=>_csSave()); await sleep(2500);
  rt.structure = await page.evaluate(async(cid)=>{ const {data}=await supabase.rpc('list_commission_structures',{p_company_id:cid}); return (data||[]).length; }, ZCID);

  console.log('ROUNDTRIP', JSON.stringify(rt));

  // clear any body-level modal hosts left open by the round-trips
  await page.evaluate(()=>['ag-modal-host','cp-modal-host','cs-modal-host','at-modal-host'].forEach(id=>{const h=document.getElementById(id);if(h)h.innerHTML='';}));

  async function shoot(name, prep){
    for (const [w,h,tag] of SIZES){
      await page.setViewport({width:w,height:h}); await sleep(250);
      for (const theme of ['dark','light']){
        await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(200);
        if (prep) await prep();
        await page.mouse.move(0,0); await sleep(60);
        await page.screenshot({path:path.join(OUT,`${name}_${tag}_${theme}.png`), fullPage:true});
      }
    }
    console.log('  shot', name);
  }

  // list
  await page.evaluate(()=>nav('agents')); await sleep(2000);
  await shoot('list');
  // form collapsed + expanded
  await shoot('form', async()=>{ await page.evaluate(()=>{ document.getElementById('ag-modal-host')&&(document.getElementById('ag-modal-host').innerHTML=''); openAgentModal(null); }); await sleep(500); });
  await shoot('form_more', async()=>{ await page.evaluate(()=>{ const m=document.getElementById('af-more'); if(m&&m.style.display==='none') agToggleMore(); }); await sleep(250); });
  await page.evaluate(()=>{ const h=document.getElementById('ag-modal-host'); if(h) h.innerHTML=''; });
  // detail
  if (a1){ await page.evaluate((id)=>openAgentDetail(id), a1.id); await sleep(3000); await shoot('detail');
    const dp = await page.evaluate(()=>({ tabs:document.querySelectorAll('#ag-tabs .nx-tab').length, stats:document.querySelectorAll('#pg-agentdetail .agd-stats .nx-kpi-value').length }));
    console.log('DETAIL', JSON.stringify(dp)); }
  // commissions
  await page.evaluate(()=>nav('commissions')); await sleep(2500); await shoot('comm_payouts');
  await shoot('comm_structures', async()=>{ await page.evaluate(()=>_commSwitchTab('structures')); await sleep(800); });
  // transactions
  await page.evaluate(()=>nav('agenttransactions')); await sleep(2500); await shoot('transactions');

  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,12).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});

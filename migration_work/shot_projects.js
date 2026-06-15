/** Reskin Batch 3 — Projects + NOC verification.
 *  1) REAL round-trip on ZZTEST: lean create form → code auto-suggested + editable
 *     → save → appears in list → edit → persists → cleanup.
 *  2) FG-inject KBH (261/183/78, real-derived) → assert card numbers, shoot
 *     list / create-form (collapsed+expanded) / detail / NOC at 1366+1920 light+dark.
 */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4719; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'prj_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
const KBH = { id:'7f70ba90-130e-42b5-801b-4c9bafa82975', code:'PRJ-2026-0001', name:'KHUSHAL BAGH HEIGHTS', city:'Peshawar', location:'Babu Gahri Stop, near Khushal Park, Warsak Road' };
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

  // ─────────────────────────  REAL ROUND-TRIP (ZZTEST)  ─────────────────────────
  await page.evaluate(()=>nav('projects')); await sleep(2500);
  const probeName = 'ZZ Reskin Probe ' + Date.now();
  const rt = { steps:{} };

  // open lean create form, inspect the code field
  await page.evaluate(()=>openProjectModal(null)); await sleep(500);
  Object.assign(rt.steps, await page.evaluate(()=>{
    const code = document.getElementById('pf-code');
    const more = document.getElementById('pf-more');
    const moreBtn = document.getElementById('pf-more-btn');
    const name = document.getElementById('pf-name');
    return {
      form_code_value: code ? code.value : null,
      form_code_editable: code ? !code.readOnly : null,
      form_more_collapsed: more ? (more.style.display === 'none') : null,
      form_more_btn: !!moreBtn,
      form_name_field: !!name,
      form_is_kit_modal: !!document.querySelector('#m-project.nx-modal-overlay')
    };
  }));

  // fill + save
  await page.evaluate((nm)=>{ document.getElementById('pf-name').value = nm; }, probeName);
  const codeSuggested = rt.steps.form_code_value;
  await page.evaluate(()=>saveProjectForm()); await sleep(3500);
  rt.steps.after_save = await page.evaluate((nm)=>{
    const list = (window._projectsCache||[]).map(p=>p.projectName||p.name);
    const found = (window._projectsCache||[]).find(p=>(p.projectName||p.name)===nm);
    const cardNames = Array.from(document.querySelectorAll('#prj-ct .prjc-name')).map(n=>n.textContent.trim());
    return { in_cache: !!found, new_id: found?found.id:null, saved_code: found?found.projectCode:null, in_grid: cardNames.includes(nm), card_count: cardNames.length };
  }, probeName);

  // edit it → change name → save → confirm persisted
  if (rt.steps.after_save.new_id){
    const nid = rt.steps.after_save.new_id; const edited = probeName + ' EDITED';
    await page.evaluate((id)=>openProjectModal(id), nid); await sleep(500);
    rt.steps.edit_prefilled = await page.evaluate((nm)=>document.getElementById('pf-name').value===nm, probeName);
    await page.evaluate((nm)=>{ document.getElementById('pf-name').value = nm; }, edited);
    await page.evaluate(()=>saveProjectForm()); await sleep(3000);
    rt.steps.edit_persisted = await page.evaluate((id,nm)=>{ const p=(window._projectsCache||[]).find(x=>x.id===id); return !!p && (p.projectName||p.name)===nm; }, nid, edited);
    // cleanup
    rt.steps.cleanup = await page.evaluate(async(id)=>{ try{ if(typeof deleteProjectDB==='function'){ const ok=await deleteProjectDB(id); await loadProjectsCache(S.cid); return ok; } }catch(e){ return 'err:'+e.message; } return 'no-fn'; }, nid);
    await sleep(1500);
  }
  console.log('ROUNDTRIP', JSON.stringify(rt.steps,null,0));
  console.log('CODE_AUTOSUGGEST =', codeSuggested);

  // ─────────────────────────  FG INJECT (KBH 261/183/78)  ─────────────────────────
  await page.evaluate((KBH)=>{
    const N=261, AVAIL=78, price=Math.round(2248700000/N);
    const units=[];
    for(let i=0;i<N;i++){
      const avail = i<AVAIL;
      units.push({ id:'ku'+i, projectId:KBH.id, status: avail?'Available':'Sold', isAvailable:avail,
        totalPrice:price, basePrice:price, totalPaid: avail?0:Math.round(price*0.62),
        unitNo:'K-'+(i+1), customerName: avail?'':'Buyer '+(i+1), floorLabel:'Floor', type:'Apt', area:850, areaUnit:'sqft' });
    }
    window._unitsCache=units; window.gunits=()=>units; window.gunit=(id)=>units.find(u=>u.id===id)||null;
    const proj={ id:KBH.id, projectCode:KBH.code, projectName:KBH.name, name:KBH.name, status:'active',
      city:KBH.city, location:KBH.location, country:'Pakistan', constructionProgress:45, totalArea:210000, areaUnit:'sqft',
      builderName:'Fourteen Group', expectedCompletion:'2027-12-31', amenities:['Parking','Security 24/7','Elevator / Lift','Mosque'] };
    window._projectsCache=[proj]; window.gprojects=()=>[proj]; window.gproject=(id)=>[proj].find(p=>p.id===id);
    if(window.S){ S.assignedProjectIds=null; S.isProjectAdmin=true; }
    nav('projects');
  }, KBH); await sleep(1800);

  const cardNums = await page.evaluate(()=>{
    const card = document.querySelector('#prj-ct .prjcard');
    if(!card) return null;
    const vals = Array.from(card.querySelectorAll('.prjc-sv')).map(n=>n.textContent.trim());
    const name = card.querySelector('.prjc-name')?.textContent.trim();
    const code = card.querySelector('.prjc-code')?.textContent.trim();
    return { name, code, units:vals[0], sold:vals[1], avail:vals[2] };
  });
  console.log('KBH_CARD', JSON.stringify(cardNums), '→ expect units=261 sold=183 avail=78');

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
  await shoot('list');
  // create form — collapsed then expanded
  await shoot('form', async()=>{ await page.evaluate(()=>{ document.getElementById('prj-modal-host')&&(document.getElementById('prj-modal-host').innerHTML=''); openProjectModal(null); }); await sleep(350); });
  await shoot('form_more', async()=>{ await page.evaluate(()=>{ if(document.getElementById('pf-more')&&document.getElementById('pf-more').style.display==='none') prjToggleMore(); }); await sleep(250); });
  await page.evaluate(()=>{ const h=document.getElementById('prj-modal-host'); if(h) h.innerHTML=''; });
  // detail
  await page.evaluate((id)=>openProjectDetail(id), KBH.id); await sleep(3200);
  await shoot('detail');
  const detailProbe = await page.evaluate(()=>{
    const stats = Array.from(document.querySelectorAll('#pg-projectdetail .pd-stats .nx-kpi-value')).map(n=>n.textContent.trim());
    const tabs = document.querySelectorAll('#pd-tabs .nx-tab').length;
    return { hero_stats: stats.slice(0,3), tab_count: tabs };
  });
  console.log('DETAIL', JSON.stringify(detailProbe));
  // noc
  await page.evaluate(()=>nav('noc')); await sleep(3000);
  await shoot('noc');

  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,10).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});

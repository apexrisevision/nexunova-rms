/** CHANGE UNIT — the untested branch: non-admin → approval → admin approves → applied.
 *  This is the exact class of path that killed Transfer (it only died when an agent was set),
 *  so it is driven for real: a real non-admin logs in, submits, and a real admin approves.
 */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4782; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };

const CID   = 'a2915ce7-c01c-463b-ba50-b144b2240337';
const PROJ  = '6b56d5ec-6141-4440-9465-ed2a9acbbd97';
const SALE  = '3b1895df-c042-44f4-a881-28e99de55e8a';
const CLIENT= '9b921760-b385-4a56-883b-57db3f1646de';
// login id is username@COMPANYCODE (the owner's username happens to equal the company code)
const STAFF = ['qareskin094076@zztestinternalsafeto', 'ZzStaff!2026'];
const OWNER = ['zztestinternalsafeto', 'ZzTest!2026'];

function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function login(page, [user, pw]) {
  // Kill any previous session first — otherwise the second login silently keeps the first user
  // and every "admin" assertion below would be testing the wrong account.
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(500);
  await page.evaluate(async ()=>{ try{ await supabase.auth.signOut(); }catch(e){} localStorage.clear(); sessionStorage.clear(); });
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},user,pw);
  await page.evaluate(()=>doLogin()); await sleep(7000);
  // S is a module-level binding, not on window
  return page.evaluate(()=>{ try { return { role: S.role, user: S.uname || S.username || null }; } catch(e){ return { role: null }; } });
}

(async()=>{
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});
  const page=await browser.newPage(); await page.setViewport({width:1500,height:1000});
  const R={};

  // ── 1. non-admin submits a change ──
  R.staff_session = await login(page, STAFF);

  // Resolve the sale's CURRENT unit and a genuinely free target at runtime, so this script stays
  // re-runnable — a hardcoded pair goes stale the moment it applies once.
  const live = await page.evaluate(async (cid, proj, sale)=>{
    const { data: su } = await supabase.rpc('get_sale_unit_id', { p_id: sale, p_company_id: cid });
    const { data: av } = await supabase.rpc('list_available_units_for_change', { p_company_id: cid, p_project_id: proj });
    return { old_unit: su?.unit_id, target: (av||[])[0] };
  }, CID, PROJ, SALE);
  R.resolved = { old_unit: live.old_unit, new_unit: live.target?.unit_no };
  const OLD_U = live.old_unit, NEW_U = live.target?.id;

  R.staff_submit = await page.evaluate(async (cid,proj,sale,client,oldU,newU)=>{
    const { data, error } = await supabase.rpc('execute_unit_change', {
      p_company_id: cid, p_change_date: '2026-07-14', p_project_id: proj,
      p_sale_id: sale, p_client_id: client, p_old_unit_id: oldU, p_new_unit_id: newU,
      p_price_per_sqft: 500, p_area_sqft: 1000, p_discount: 0,
      p_installments: [
        {installment_number:1, installment_type:'installment', due_date:'2026-09-01', amount_due:100000},
        {installment_number:2, installment_type:'installment', due_date:'2026-10-01', amount_due:100000}
      ],
      p_reason: 'APPROVAL PATH TEST — submitted by a non-admin'
    });
    return { data, error: error ? String(error.message||error) : null };
  }, CID, PROJ, SALE, CLIENT, OLD_U, NEW_U);

  // did it stay a REQUEST and not silently apply?
  R.unit_untouched_while_pending = await page.evaluate(async (cid, sale)=>{
    const { data } = await supabase.rpc('get_sale_received', { p_sale_id: sale, p_company_id: cid });
    return data;   // net_amount must still be the OLD 200,000 — not 500,000
  }, CID, SALE);

  const reqId = R.staff_submit?.data?.request_id;

  // ── 2. admin sees it on the REAL approvals page, then approves ──
  R.owner_session = await login(page, OWNER);

  // get_pending_approvals takes p_filters only — no p_company_id (it reads the caller's company)
  R.pending_seen = await page.evaluate(async ()=>{
    const { data } = await supabase.rpc('get_pending_approvals', { p_filters: {} });
    return (data?.rows || []).filter(r=>r.request_type==='unit_change')
      .map(r=>({id:r.id, type:r.request_type, title:r.title, desc:r.description}));
  });

  // open the Approvals page and read what the Admin actually SEES for this request
  await page.evaluate(()=>nav('approvals')); await sleep(3000);
  R.on_screen = await page.evaluate((id)=>{
    const badges=[...document.querySelectorAll('#pg-approvals .nx-badge')].map(b=>b.textContent.trim());
    return { shows_change_unit_badge: badges.includes('Change Unit'), raw_type_leaked: badges.includes('unit_change') };
  }, reqId);
  R.drawer_lines = await page.evaluate(async (id)=>{
    if (typeof _apOpenDrawer === 'function') { _apOpenDrawer(id); }
    await new Promise(r=>setTimeout(r,1200));
    const host=document.getElementById('ap-modal');
    return host ? [...host.querySelectorAll('li,div')].map(n=>n.textContent.trim())
      .filter(t=>/moves from unit|New unit price|carries forward|New schedule|Available/.test(t)).slice(0,5) : null;
  }, reqId);

  R.approve = await page.evaluate(async (id)=>{
    const { data, error } = await supabase.rpc('approve_request', { p_request_id: id, p_comment: 'Approved — verifying the unit_change replay branch.' });
    return { data, error: error ? String(error.message||error) : null };
  }, reqId);

  // ── 3. did the approval actually APPLY the change? ──
  R.after_approval = await page.evaluate(async (cid, sale)=>{
    const { data } = await supabase.rpc('get_sale_received', { p_sale_id: sale, p_company_id: cid });
    return data;   // net_amount must now be 500,000
  }, CID, SALE);

  console.log(JSON.stringify(R,null,2));
  await browser.close(); srv.close();
})();

/** CHANGE UNIT — the trail, RENDERED, in the real app.
 *  The owner's actual requirement: after a change, BOTH units must remember it. The first pass put
 *  the event into get_unit_history — which nothing in the app calls. The screen a human opens is
 *  the Ownership Chain (get_unit_ownership_chain), so this asserts the event is RENDERED there for
 *  the unit he left AND the unit he entered.
 */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4793; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'uc_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const CID='a2915ce7-c01c-463b-ba50-b144b2240337';
const SALE='3b1895df-c042-44f4-a881-28e99de55e8a';
const LEFT_UNIT='5e5a16c1-b595-41d2-8807-cade9938f5e4';   // 1-02 — released by the last change
const OWNER=['zztestinternalsafeto','ZzTest!2026'];

function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});
  const page=await browser.newPage(); await page.setViewport({width:1500,height:1150});
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.slice(0,160)));
  const R={};

  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},...OWNER);
  await page.evaluate(()=>doLogin()); await sleep(7000);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
  await page.evaluate(()=>nav('units')); await sleep(2500);

  const ENTERED_UNIT = await page.evaluate(async (cid, sale)=>{
    const { data } = await supabase.rpc('get_sale_unit_id', { p_id: sale, p_company_id: cid });
    return data?.unit_id;
  }, CID, SALE);

  async function chainOf(uid) {
    return page.evaluate(async (cid, id)=>{
      const { data } = await supabase.rpc('get_unit_ownership_chain', { p_unit_id: id, p_company_id: cid });
      return (data?.chain||[]).filter(e=>e.event_type==='unit_change')
        .map(e=>({voucher:e.voucher_no, who:e.client_name, what:e.reason, price:e.amount_a, carried:e.amount_b}));
    }, CID, uid);
  }
  R.chain_unit_he_LEFT    = await chainOf(LEFT_UNIT);
  R.chain_unit_he_ENTERED = await chainOf(ENTERED_UNIT);

  // now the screen itself — is it actually drawn?
  async function renderCheck(uid, shot) {
    await page.evaluate(()=>nav('unitchain')); await sleep(1500);
    await page.evaluate((id)=>rUnitChain(id), uid);   // the page takes the unit id directly
    await sleep(2500);
    const txt = await page.evaluate(()=>document.body.innerText);
    await page.screenshot({path:path.join(OUT,shot)});
    return {
      shows_unit_changed_badge: /Unit Changed/.test(txt),
      shows_move_line: (txt.match(/Client moved (OUT to|IN from) unit [^\n]*/g)||[]).slice(0,2),
      raw_type_leaked: /unit_change\b/.test(txt)
    };
  }
  R.rendered_unit_he_LEFT    = await renderCheck(LEFT_UNIT, '06_chain_left_unit.png');
  R.rendered_unit_he_ENTERED = await renderCheck(ENTERED_UNIT, '07_chain_entered_unit.png');

  R.page_errors = errs;
  console.log(JSON.stringify(R,null,2));
  await browser.close(); srv.close();
})();

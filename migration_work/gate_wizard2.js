/**
 * MAIN GATE AUDIT — Stage C2: wizard floors→types→units→done (project pre-seeded
 * to bypass the project_code blocker) + real user-management create flow.
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4323;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'gate_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const CODE = 'zztest2gateaudit', PASS = 'ZzTest!2026';

function serve() { return new Promise(res => { const srv = http.createServer((req, resp) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(ROOT, p === '/' ? 'login.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); return resp.end(); }
  resp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(resp);
}).listen(PORT, '127.0.0.1', () => res(srv)); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function shot(page, name) { await page.screenshot({ path: path.join(OUT, name) }); console.log('  shot', name); }
async function clickOnclick(page, sub) { return page.evaluate((sub) => {
  const el = [...document.querySelectorAll('[onclick]')].find(e => (e.getAttribute('onclick')||'').includes(sub) && e.offsetParent !== null);
  if (el) { el.click(); return true; } return false; }, sub); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--window-size=1440,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1320, height: 920 });
  const errs = []; page.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,160)); });
  page.on('pageerror', e => errs.push('PAGEERR '+String(e).slice(0,160)));

  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle2' });
  await sleep(1000);
  await page.evaluate((code, pass) => { const u=document.getElementById('li-u'),p=document.getElementById('li-p');
    u.removeAttribute('readonly');p.removeAttribute('readonly');u.value=code;p.value=pass;window._loginReadyAt=0; }, CODE, PASS);
  await page.evaluate(() => doLogin());
  await sleep(6000);
  console.log('STATE', JSON.stringify(await page.evaluate(() => ({ ob: document.getElementById('s-onboarding')?.classList.contains('on') }))));

  // Wizard now auto-picks the seeded project → Continue advances to Floors
  await clickOnclick(page, '_saveProject');
  await sleep(2000);
  await shot(page, 'C4b_wiz2_floors.png');
  console.log('STEP2_ERR', JSON.stringify(await page.evaluate(()=> (document.getElementById('ob-err')||{}).textContent||'')));
  await clickOnclick(page, '_genFloors');
  await sleep(3500);
  await shot(page, 'C5b_wiz3_types.png');
  await clickOnclick(page, '_saveTypes');
  await sleep(2500);
  await page.evaluate(() => { const e=document.getElementById('ob-per'); if(e){e.value='1';e.dispatchEvent(new Event('input',{bubbles:true}));} });
  await clickOnclick(page, '_preview');
  await sleep(1000);
  await shot(page, 'C6b_wiz4_units.png');
  await clickOnclick(page, '_genUnits');
  await sleep(3500);
  await shot(page, 'C7b_wiz5_done.png');
  console.log('WIZ_ERR', JSON.stringify(await page.evaluate(()=> (document.getElementById('ob-err')||{}).textContent||'')));
  await page.evaluate(() => { if (window.OB) OB._finish('dashboard'); });
  await sleep(2500);

  // ── Users & Roles — now ultimate plan, Add enabled ──
  await page.evaluate(() => { if (typeof nav === 'function') nav('users'); });
  await sleep(2500);
  await shot(page, 'D1_users_page.png');
  console.log('ADD_BTN', JSON.stringify(await page.evaluate(()=>{const b=document.getElementById('um-add-btn');return b?{disabled:b.disabled,text:b.textContent}:null;})));

  // (1) Try create WITHOUT email → expose UI(optional)/server(required) mismatch
  await page.evaluate(() => openAddUserModal());
  await sleep(600);
  await page.evaluate(() => { document.getElementById('um-name').value='Bilal Recovery';
    document.getElementById('um-role').value='recovery';
    document.getElementById('um-pass').value='Staff!2026x'; });
  await shot(page, 'D2_adduser_modal.png');
  await page.evaluate(() => saveUserModal());
  await sleep(2500);
  await shot(page, 'D3_adduser_noemail_result.png');
  console.log('NOEMAIL_ERR', JSON.stringify(await page.evaluate(()=>{const e=document.getElementById('um-err');return e?{disp:e.style.display,txt:e.textContent}:null;})));

  // (2) Create WITH email → success, observe generated username
  await page.evaluate(() => { document.getElementById('um-email').value='bilal.zztest2@nexunova.test'; });
  await sleep(300);
  await page.evaluate(() => saveUserModal());
  await sleep(3000);
  await shot(page, 'D4_adduser_success.png');

  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,10).join(' | '));
  await browser.close(); srv.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

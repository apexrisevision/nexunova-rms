/**
 * MAIN GATE AUDIT — Stage C: real login (bare company code) + onboarding wizard.
 * Logs into the freshly-created ZZTEST2 tenant via the real login form, captures
 * the wizard auto-launch, runs Project→Floors→Types→Units→Done, screenshots each,
 * then opens Users & Roles to capture the trial-plan limit state.
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4322;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'gate_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };

const CODE = 'zztest2gateaudit';
const PASS = 'ZzTest!2026';

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      let f = path.join(ROOT, p === '/' ? 'login.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); return resp.end(); }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(resp);
    }).listen(PORT, '127.0.0.1', () => res(srv));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function shot(page, name) { await page.screenshot({ path: path.join(OUT, name) }); console.log('  shot', name); }
async function clickOnclick(page, sub) {
  return page.evaluate((sub) => {
    const els = [...document.querySelectorAll('[onclick]')];
    const el = els.find(e => (e.getAttribute('onclick')||'').includes(sub) && e.offsetParent !== null);
    if (el) { el.click(); return true; } return false;
  }, sub);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--window-size=1440,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1320, height: 920 });
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,200)); });
  page.on('pageerror', e => errs.push('PAGEERR '+String(e).slice(0,200)));

  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle2' });
  await sleep(1200);
  await shot(page, 'C1_login_screen.png');

  // Type bare company code + password, sign in (bypass readonly/autofill guards)
  await page.evaluate((code, pass) => {
    const u = document.getElementById('li-u'), p = document.getElementById('li-p');
    u.removeAttribute('readonly'); p.removeAttribute('readonly');
    u.value = code; p.value = pass;
    window._loginReadyAt = 0;
  }, CODE, PASS);
  await sleep(200);
  await page.evaluate(() => doLogin());
  await sleep(6000); // verify_login + signInWithPassword + cache loads + wizard

  await shot(page, 'C2_after_login_wizard.png');
  const appOn = await page.evaluate(() => ({
    appOn: document.getElementById('s-app')?.classList.contains('on'),
    obOn: document.getElementById('s-onboarding')?.classList.contains('on'),
    loginOn: document.getElementById('s-login')?.classList.contains('on')
  }));
  console.log('STATE', JSON.stringify(appOn));

  // ── Wizard Step 1: Project ──
  await page.evaluate(() => { const e = document.getElementById('ob-pname'); if (e){ e.value='ZZTEST2 Tower A'; e.dispatchEvent(new Event('input',{bubbles:true})); } });
  await sleep(300);
  await shot(page, 'C3_wiz1_project.png');
  await clickOnclick(page, '_saveProject');
  await sleep(2500);

  // ── Step 2: Floors ──
  await shot(page, 'C4_wiz2_floors.png');
  await clickOnclick(page, '_genFloors');
  await sleep(3000);

  // ── Step 3: Types ──
  await shot(page, 'C5_wiz3_types.png');
  await clickOnclick(page, '_saveTypes');
  await sleep(2500);

  // ── Step 4: Units ── keep small to stay under trial cap; preview then generate
  await page.evaluate(() => { const e=document.getElementById('ob-per'); if(e){ e.value='1'; e.dispatchEvent(new Event('input',{bubbles:true})); } });
  await sleep(300);
  await clickOnclick(page, '_preview');
  await sleep(1200);
  await shot(page, 'C6_wiz4_units_preview.png');
  await clickOnclick(page, '_genUnits');
  await sleep(3500);

  // ── Step 5: Done ──
  await shot(page, 'C7_wiz5_done.png');
  const wizErr = await page.evaluate(() => (document.getElementById('ob-err')||{}).textContent || '');
  console.log('WIZ_ERR', JSON.stringify(wizErr));
  await clickOnclick(page, "_finish('dashboard'") || await page.evaluate(() => { if (window.OB) OB._finish('dashboard'); });
  await sleep(3000);
  await shot(page, 'C8_dashboard.png');

  // ── Users & Roles (trial state) ──
  await page.evaluate(() => { if (typeof nav === 'function') nav('users'); });
  await sleep(2500);
  await shot(page, 'C9_users_trial.png');
  const addBtn = await page.evaluate(() => {
    const b = document.getElementById('um-add-btn');
    return b ? { disabled: b.disabled, text: b.textContent, title: b.title } : null;
  });
  console.log('ADD_BTN', JSON.stringify(addBtn));

  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,10).join(' | '));
  await browser.close(); srv.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

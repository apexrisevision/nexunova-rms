/**
 * MAIN GATE AUDIT — Stage A: real signup walkthrough (puppeteer, prod Supabase).
 * Serves the repo and drives login.html's #s-signup 5-step wizard exactly as a
 * user would, screenshotting every step + the live OTP overlay + result screen.
 * Creates a REAL prod tenant "ZZTEST2 Gate Audit". OTP send is real (Resend);
 * the code-entry gate is bypassed in-page (SV.emailVerified) because the plaintext
 * is only delivered by email — verify_signup_otp is proven separately server-side.
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'gate_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };

const EMAIL = 'zztest2.gate@nexunova.test';
const CNAME = 'ZZTEST2 Gate Audit';
const PASS  = 'ZzTest!2026';

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

async function setVal(page, id, val) {
  await page.evaluate((id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('keyup', { bubbles: true }));
  }, id, val);
}
async function shot(page, name) { await page.screenshot({ path: path.join(OUT, name) }); console.log('  shot', name); }

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
  await sleep(800);

  // Land on signup
  await page.evaluate(() => { if (typeof showSignup === 'function') showSignup(); });
  await sleep(600);
  await shot(page, 'A1_signup_step1_empty.png');

  // ── Step 1: personal ──
  await setVal(page, 'sg-fname', 'Rashid Audit');
  await setVal(page, 'sg-email', EMAIL);
  await setVal(page, 'sg-phone', '+923009998877');
  await sleep(1500); // let check_company_email debounce + RPC resolve (shows Verify btn)
  await shot(page, 'A2_step1_email_checked.png');

  // Click the real "Verify Email" → send_signup_otp (real Resend send), capture overlay
  await page.evaluate(() => { const b = document.getElementById('sg-email-verify-btn'); if (b) b.click(); });
  await sleep(2500);
  await shot(page, 'A3_otp_overlay.png');

  // Bypass code entry (plaintext only via email). Close overlay + mark verified in-page.
  await page.evaluate(() => {
    SV.emailVerified = true; SV.emailAvailable = true;
    if (typeof svHideVerifyBtn === 'function') svHideVerifyBtn();
    const badge = document.getElementById('sg-email-verified'); if (badge) badge.style.display = '';
    // dismiss any OTP overlay
    document.querySelectorAll('[id*="otp" i],[class*="otp" i]').forEach(el => {
      if (el.style && (el.style.position === 'fixed' || getComputedStyle(el).position === 'fixed')) el.remove();
    });
  });
  await sleep(400);
  await page.evaluate(() => sgNext());  // → step 2
  await sleep(600);
  await shot(page, 'A4_step2_company_empty.png');

  // ── Step 2: company ──
  await setVal(page, 'sg-cname', CNAME);
  await setVal(page, 'sg-address', 'Plot 14, Gate Audit Avenue, Karachi');
  await setVal(page, 'sg-city', 'Karachi');
  await sleep(1600); // company availability debounce + RPC
  await shot(page, 'A5_step2_company_filled.png');
  await page.evaluate(() => sgNext());  // → step 3
  await sleep(500);

  // ── Step 3: password — first capture a WEAK password rejection ──
  await setVal(page, 'sg-pass', '123456');
  await setVal(page, 'sg-conf', '123456');
  await page.evaluate(() => { if (SV.updateStrengthMeter) SV.updateStrengthMeter('123456'); });
  await sleep(300);
  await page.evaluate(() => sgNext());  // should be blocked
  await sleep(400);
  await shot(page, 'A6_step3_weak_pw_rejected.png');
  // now strong
  await setVal(page, 'sg-pass', PASS);
  await setVal(page, 'sg-conf', PASS);
  await page.evaluate(() => { if (SV.updateStrengthMeter) SV.updateStrengthMeter('ZzTest!2026'); });
  await sleep(300);
  await shot(page, 'A7_step3_strong_pw.png');
  await page.evaluate(() => sgNext());  // → step 4
  await sleep(600);

  // ── Step 4: plan ──
  await shot(page, 'A8_step4_plans.png');
  await page.evaluate(() => { if (typeof sgSelectPlan === 'function') sgSelectPlan('free_trial'); });
  await sleep(300);
  await page.evaluate(() => sgNext());  // → step 5
  await sleep(600);

  // ── Step 5: review + agree ──
  await page.evaluate(() => { const cb = document.getElementById('sg-agree'); if (cb && !cb.checked) cb.click(); });
  await sleep(300);
  await shot(page, 'A9_step5_review.png');

  // ── Submit ──
  await page.evaluate(() => sgNext());  // → signup_new_company
  await sleep(4000);
  await shot(page, 'A10_result_screen.png');

  // Pull the generated username/code from the result DOM
  const result = await page.evaluate(() => {
    const u = document.getElementById('sg-username-val');
    return { username: u ? u.textContent.trim() : null,
             bodyText: (document.getElementById('sg-result-screen')||{}).innerText || '' };
  });
  console.log('RESULT', JSON.stringify(result));
  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,8).join(' | '));

  await browser.close(); srv.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

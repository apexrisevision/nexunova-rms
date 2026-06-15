const puppeteer = require('puppeteer-core');
const path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'sales-portal.html').replace(/\\/g, '/');
const MAGIC = '81a287ec60ee1a8d19126200fddea6a021c863ac9b0fcb55022838ed1445dcc5'; // Ahmad (scratch), ZZTEST Tower
const OUT = path.resolve(__dirname, 'salesportal_shots');
const fs = require('fs');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  async function newPage(w, h) {
    const p = await browser.newPage();
    await p.setViewport({ width: w, height: h });
    p.on('console', m => { if (m.type() === 'error') errors.push('[' + w + 'x' + h + '] ' + m.text()); });
    p.on('pageerror', e => errors.push('[PAGEERROR ' + w + 'x' + h + '] ' + e.message));
    return p;
  }

  // 1) LOGIN screen (desktop, light)
  let p = await newPage(1366, 900);
  await p.goto(FILE, { waitUntil: 'networkidle0' });
  await sleep(800);
  await p.screenshot({ path: path.join(OUT, '1_login_light.png') });

  // 2) Magic-link login -> board (desktop, light)
  await p.goto(FILE + '?t=' + MAGIC, { waitUntil: 'networkidle0' });
  await sleep(2500);
  const onApp = await p.$eval('#screen-app', el => el.classList.contains('active')).catch(() => false);
  await p.screenshot({ path: path.join(OUT, '2_board_light.png'), fullPage: true });

  // 3) Reserve modal (click first available unit)
  const reserved = await p.evaluate(() => {
    const u = document.querySelector('.unit.avail');
    if (u) { u.click(); return true; } return false;
  });
  await sleep(500);
  await p.screenshot({ path: path.join(OUT, '3_reserve_modal_light.png') });
  // close modal
  await p.evaluate(() => { if (typeof closeModal === 'function') closeModal(); });

  // 4) My Reservations tab
  await p.evaluate(() => setTab('mine'));
  await sleep(1500);
  await p.screenshot({ path: path.join(OUT, '4_my_reservations_light.png'), fullPage: true });

  // 5) Dark theme board
  await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); setTab('board'); });
  await sleep(1800);
  await p.screenshot({ path: path.join(OUT, '5_board_dark.png'), fullPage: true });
  await p.close();

  // 6) Mobile (390x844) magic login -> board, light + reserve
  let pm = await newPage(390, 844);
  await pm.goto(FILE + '?t=' + MAGIC, { waitUntil: 'networkidle0' });
  await sleep(2500);
  await pm.screenshot({ path: path.join(OUT, '6_board_mobile.png'), fullPage: true });
  await pm.evaluate(() => { const u = document.querySelector('.unit.avail'); if (u) u.click(); });
  await sleep(500);
  await pm.screenshot({ path: path.join(OUT, '7_reserve_mobile.png') });
  await pm.close();

  await browser.close();
  console.log('ON_APP_AFTER_MAGIC:', onApp);
  console.log('RESERVE_UNIT_CLICKED:', reserved);
  console.log('CONSOLE_ERRORS:', errors.length);
  errors.slice(0, 20).forEach(e => console.log('  ' + e));
  console.log('SHOTS:', fs.readdirSync(OUT).join(', '));
})().catch(e => { console.error('FATAL', e); process.exit(1); });

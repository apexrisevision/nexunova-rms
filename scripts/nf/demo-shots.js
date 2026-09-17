#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path');
const { REF, TOKEN } = require('../_sbq');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'screens');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const puppeteer = require('puppeteer-core');

async function http_(method, p, body) {
  const r = await fetch(`https://${REF}.supabase.co${p}`, { method, headers: { apikey: process.env.ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

(async () => {
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  process.env.ANON = keys.find(k => k.name === 'anon').api_key;
  const login = await http_('POST', '/auth/v1/token?grant_type=password', { email: 'nfdemo@zztest-nf.invalid', password: 'NfDemo!2026' });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((ref, jwt, uid) => {
    localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify({
      access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
      user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'nfdemo@zztest-nf.invalid', app_metadata: {}, user_metadata: {} },
    }));
  }, REF, login.access_token, login.user.id);
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto('http://127.0.0.1:4490/nexufinance.html', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.pos-grid', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 400));

  await page.screenshot({ path: path.join(OUT, 'closing-sheet-light.png'), fullPage: true });

  await page.click('#nf-theme');
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: path.join(OUT, 'closing-sheet-dark.png'), fullPage: true });
  await page.click('#nf-theme');

  // refused payment: try to pay more than Bank holds
  const tmpId = await page.evaluate(() => document.querySelector('.row.draft[data-side="OUT"]').getAttribute('data-draft'));
  const sel = k => `.row.draft[data-draft="${tmpId}"] [data-k="${k}"]`;
  await page.click(sel('v')); await page.type(sel('v'), 'CPV-999');
  await page.click(sel('d')); await page.type(sel('d'), 'Demo: more than the bank holds');
  await page.select(sel('h'), '85100');
  await page.select(sel('f'), 'P-W');
  await page.select(sel('m'), 'Bank');
  await page.click(sel('a')); await page.type(sel('a'), '99999999');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.row.draft[data-side="OUT"] .row-err'), { timeout: 8000 });
  await new Promise(r => setTimeout(r, 200));
  await page.screenshot({ path: path.join(OUT, 'closing-sheet-refused-payment.png'), fullPage: true });

  await browser.close();
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });

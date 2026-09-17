#!/usr/bin/env node
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto('http://127.0.0.1:4490/nexufinance.html', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#nf-li-form', { timeout: 8000 });
  console.log('login form shown: yes');
  await page.type('#nf-li-u', 'nfdemo@ZZNFDEMO');
  await page.type('#nf-li-p', 'NfDemo!2026');
  await page.click('#nf-li-btn');
  await page.waitForSelector('.pos-grid', { timeout: 12000 });
  const closing = await page.evaluate(() => document.querySelector('.kpis b').textContent);
  console.log('signed in, closing sheet shows:', closing);
  console.log('console/page errors:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

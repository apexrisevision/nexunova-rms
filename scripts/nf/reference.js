/**
 * NexuFinance v1 — reads the approved reference, so nothing in the seed or the
 * tests is retyped from it.
 *
 *   docs/reference/awami-daily-closing.html   HEADS, FLOORS, ACCTS, DENOMS, BIG,
 *                                             sample, catIn, catOut, the 7-day PDC window
 *   docs/reference/Awami_Market_COA.xlsx      the chart and the class list
 *
 * Every extraction is checked for shape. A reference that has changed under us
 * fails loudly here instead of producing a quietly different seed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = path.join(ROOT, 'docs', 'reference', 'awami-daily-closing.html');
const XLSX = path.join(ROOT, 'docs', 'reference', 'Awami_Market_COA.xlsx');

function must(cond, msg) {
  if (!cond) throw new Error('reference.js: ' + msg);
}

function grab(src, re, what) {
  const m = src.match(re);
  must(m, `could not find ${what} in awami-daily-closing.html`);
  return m[1];
}

function readHtml() {
  const src = fs.readFileSync(HTML, 'utf8');
  const script = grab(src, /<script>\s*(const HEADS[\s\S]*?)<\/script>/, 'the main script');
  const evalExpr = (expr, extra = {}) => vm.runInNewContext(`(${expr})`, { ...extra });

  const HEADS = evalExpr(grab(script, /const HEADS = (\[[\s\S]*?\]\]);/, 'HEADS'));
  must(HEADS[0][0] === 'Account #', 'HEADS no longer starts with its header row');
  const heads = HEADS.slice(1).map(([code, name]) => ({ code, name }));

  const FLOORS = evalExpr(grab(script, /const FLOORS = (\[[^\]]*\]);/, 'FLOORS'));
  const ACCTS = evalExpr(grab(script, /const ACCTS = (\[\[[\s\S]*?\]\]);/, 'ACCTS'));
  const DENOMS = evalExpr(grab(script, /const DENOMS = (\[[^\]]*\]);/, 'DENOMS'));
  const BIG = Number(grab(script, /const BIG = (\d+);/, 'BIG'));
  const pdcDays = Number(grab(script, /lim\.setDate\(lim\.getDate\(\)\+(\d+)\)/, 'the PDC due window'));

  const blankRow = () => ({ v: '', d: '', h: '', f: '', m: '', a: '' });
  const sample = evalExpr(grab(script, /const sample = (\{[\s\S]*?\n\});/, 'sample'), { blankRow });

  // catIn / catOut are pure functions of a head code; run them as written.
  const catInSrc = grab(script, /(function catIn\(h\)\{[\s\S]*?\n\})/, 'catIn');
  const catOutSrc = grab(script, /(function catOut\(h\)\{[\s\S]*?\n\})/, 'catOut');
  const ctx = {};
  vm.runInNewContext(`${catInSrc}\n${catOutSrc}\nthis.catIn = catIn; this.catOut = catOut;`, ctx);

  const coLine = grab(src, /<div class="co">([^<]*Awami Market, Karkhano[^<]*)<\/div>/, 'the company line')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const reportTitle = grab(src, /<h1>(Awami Market, daily report)<\/h1>/, 'the report title');
  const mark = grab(src, /<div class="mark" aria-hidden="true">([^<]+)<\/div>/, 'the mark');

  return { heads, FLOORS, ACCTS, DENOMS, BIG, pdcDays, sample, catIn: ctx.catIn, catOut: ctx.catOut,
           coLine, reportTitle, mark };
}

function readCoa() {
  const X = require(path.join(ROOT, 'node_modules', 'xlsx'));
  const wb = X.readFile(XLSX);
  must(wb.SheetNames.includes('Chart of Accounts') && wb.SheetNames.includes('Classes'), 'sheet names changed');

  const rows = X.utils.sheet_to_json(wb.Sheets['Chart of Accounts'], { header: 1, defval: '' });
  const hdr = rows.findIndex(r => r[0] === 'Account #');
  must(hdr >= 0, 'no "Account #" header row');
  const accounts = rows.slice(hdr + 1)
    .filter(r => /^\d{5}$/.test(String(r[0]).trim()))
    .map(r => ({
      code: String(r[0]).trim(),
      name: String(r[1]).trim(),
      qb_type: String(r[2]).trim(),
      parent_path: String(r[3]).trim(),
      description: String(r[4]).trim() || null,
    }));

  const crow = X.utils.sheet_to_json(wb.Sheets['Classes'], { header: 1, defval: '' });
  const chdr = crow.findIndex(r => r[0] === 'Class');
  must(chdr >= 0, 'no "Class" header row');
  const classes = crow.slice(chdr + 1).map(r => String(r[0]).trim()).filter(Boolean);

  return { accounts, classes };
}

module.exports = { readHtml, readCoa, HTML, XLSX, ROOT };

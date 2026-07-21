#!/usr/bin/env node
/* ============================================================================
   NEXUNOVA RMS — PRE-DEPLOY CHECK  (the permanent safety-net)
   ----------------------------------------------------------------------------
   Run BEFORE every deploy:   node scripts/predeploy-check.js
   Exits non-zero if any hard check fails (so it can gate a push/CI).

   Catches the recurring bug-CLASS that kept reaching the client:
     • Duplicate element IDs in login.html            (Add Unit "required" bug)
     • Dead static modals in login.html               (shadow-source + dead code)
     • Shadow IDs (static id ALSO built by a JS modal) (Payment Methods / PDC / WhatsApp)
     • Dead onclick handlers (fn not defined anywhere) (WARN)
     • Broken getElementById reads (id exists nowhere) (WARN)
     • JS syntax errors in every js/**.js file

   This is STATIC analysis — no browser, no deps, fast. It is the gate.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8');
const HTML_LINES = HTML.split('\n');

// collect every js file we ship
function listJs() {
  const dirs = ['js', 'js/pages', 'js/components', 'js/store', 'js/foundation'];
  const out = [];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) if (f.endsWith('.js')) out.push(path.join(d, f));
  }
  return out;
}
const JS_FILES = listJs();
const JS = JS_FILES.map(f => ({ f, t: fs.readFileSync(path.join(ROOT, f), 'utf8') }));
const JS_TEXT = JS.map(x => x.t).join('\n');

const results = [];               // { name, status:'PASS'|'FAIL'|'WARN', detail }
const add = (name, status, detail) => results.push({ name, status, detail: detail || '' });

// ---- helpers ---------------------------------------------------------------
const idAttr = /\bid="([a-zA-Z][\w-]*)"/g;
function idsWithLines(text) {           // Map id -> [lineNumbers]
  const m = new Map();
  text.split('\n').forEach((ln, i) => {
    for (const mm of ln.matchAll(idAttr)) {
      if (!m.has(mm[1])) m.set(mm[1], []);
      m.get(mm[1]).push(i + 1);
    }
  });
  return m;
}
// ids the JS builds at runtime: literal id="X" AND NX.field({name:'X'}) (kit maps name->id)
function jsBuiltIds() {
  const s = new Set();
  for (const m of JS_TEXT.matchAll(idAttr)) s.add(m[1]);              // id="X"
  for (const m of JS_TEXT.matchAll(/id="([\w-]+)"/g)) s.add(m[1]);    // (same, safety)
  for (const m of JS_TEXT.matchAll(/name:\s*['"]([\w-]+)['"]/g)) s.add(m[1]);   // NX.field name -> id
  for (const m of JS_TEXT.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)) s.add(m[1]); // el.id = 'X'
  for (const m of JS_TEXT.matchAll(/\bid:\s*['"]([\w-]+)['"]/g)) s.add(m[1]);    // {id:'X'} (NX.modal etc.)
  return s;
}
function fnDefined(fn) {
  const corpus = JS_TEXT + '\n' + HTML;
  return corpus.includes('function ' + fn + '(') ||
    new RegExp('\\b' + fn + '\\s*[=:]\\s*(async\\s*)?(function|\\()').test(corpus) ||
    new RegExp('(window|global)\\.' + fn + '\\s*=').test(corpus);
}

// ---- 1) JS syntax ----------------------------------------------------------
{
  const bad = [];
  for (const f of JS_FILES) {
    try { cp.execSync('node --check "' + path.join(ROOT, f) + '"', { stdio: 'pipe' }); }
    catch (e) { bad.push(f + ' — ' + String(e.stderr || e).split('\n')[0].slice(0, 120)); }
  }
  add('JS syntax (' + JS_FILES.length + ' files)', bad.length ? 'FAIL' : 'PASS', bad.join('\n   '));
}

// ---- 2) duplicate IDs within login.html ------------------------------------
{
  const m = idsWithLines(HTML);
  const dups = [...m].filter(([, lns]) => lns.length > 1);
  add('No duplicate IDs in login.html', dups.length ? 'FAIL' : 'PASS',
    dups.map(([id, lns]) => id + '  (lines ' + lns.join(', ') + ')').join('\n   '));
}

// ---- 3) dead static modals in login.html -----------------------------------
{
  const modals = [...HTML.matchAll(/<div id="(m-[\w-]+)"[^>]*class="[^"]*\bmov\b/g)].map(x => x[1]);
  const dead = modals.filter(id => {
    const q = new RegExp('[\'"]' + id + '[\'"]');
    const openedByJs = q.test(JS_TEXT);
    const openedByHtml = new RegExp('(onclick|onchange)="[^"]*' + id).test(HTML);
    return !openedByJs && !openedByHtml;
  });
  add('No dead static modals', dead.length ? 'FAIL' : 'PASS', dead.join(', '));
}

// ---- 4) shadow IDs (static in login.html AND built by a JS modal) -----------
{
  const staticIds = idsWithLines(HTML);
  const built = jsBuiltIds();
  const geRead = new Set([...JS_TEXT.matchAll(/getElementById\(['"]([\w-]+)['"]\)/g)].map(m => m[1]));
  const shadow = [...staticIds.keys()].filter(id => built.has(id) && geRead.has(id));
  add('No shadow IDs (static vs dynamic collision)', shadow.length ? 'FAIL' : 'PASS',
    shadow.map(id => id + '  (login.html:' + staticIds.get(id).join(',') + ')').join('\n   '));
}

// ---- 5) dead onclick handlers in login.html (WARN) -------------------------
{
  const handlers = new Set();
  for (const m of HTML.matchAll(/on(?:click|change|input|submit)="([a-zA-Z_$][\w$]*)\s*\(/g)) handlers.add(m[1]);
  const dead = [...handlers].filter(fn => fn !== 'if' && !fnDefined(fn)).sort();
  add('onclick handlers all defined', dead.length ? 'WARN' : 'PASS', dead.map(f => f + '()').join(', '));
}

// ---- 6) broken getElementById reads (id exists nowhere) (WARN) -------------
{
  const staticIds = new Set([...HTML.matchAll(idAttr)].map(m => m[1]));
  const built = jsBuiltIds();
  const targets = new Set([...JS_TEXT.matchAll(/getElementById\(['"]([\w-]+)['"]\)/g)].map(m => m[1]));
  const missing = [...targets].filter(id => !staticIds.has(id) && !built.has(id)).sort();
  add('getElementById targets resolve', missing.length ? 'WARN' : 'PASS',
    missing.length + ' unresolved (may be string-built): ' + missing.slice(0, 30).join(', '));
}

// ---- report ----------------------------------------------------------------
const icon = s => s === 'PASS' ? '✅' : s === 'FAIL' ? '❌' : '⚠️ ';
console.log('\n════════════ PRE-DEPLOY CHECK ════════════');
for (const r of results) {
  console.log(icon(r.status) + ' ' + r.name);
  if (r.detail && r.status !== 'PASS') r.detail.split('\n').forEach(d => d && console.log('     ' + d));
}
const failed = results.filter(r => r.status === 'FAIL');
const warned = results.filter(r => r.status === 'WARN');
console.log('──────────────────────────────────────────');
if (failed.length) { console.log('RESULT: ❌ FAIL — ' + failed.length + ' blocking issue(s). DO NOT DEPLOY.'); process.exit(1); }
console.log('RESULT: ✅ PASS' + (warned.length ? '  (' + warned.length + ' warning(s) to review)' : '') + ' — safe to deploy.');
process.exit(0);

// ══ NEXUNOVA RMS — AUTOMATED BUG AUDIT ════════════════════════════
// Scans all JS files for:
// 1. onclick/event handler function calls that have no definition
// 2. nav() calls with no matching render function
// 3. CSS background shorthand on select elements
// 4. Common missing patterns

const fs   = require('fs');
const path = require('path');

const ROOT    = __dirname;
const JS_DIR  = path.join(ROOT, 'js');
const CSS_DIR = path.join(ROOT, 'css');

// ── Helpers ──────────────────────────────────────────────────────
function readAll(dir, ext) {
  const out = [];
  function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const fp = path.join(d, f);
      if (fs.statSync(fp).isDirectory()) { walk(fp); continue; }
      if (f.endsWith(ext)) out.push(fp);
    }
  }
  walk(dir);
  return out;
}

function readFile(fp) { return fs.readFileSync(fp, 'utf8'); }

// ── 1. Collect ALL defined function names across all JS files ─────
const jsFiles  = readAll(JS_DIR, '.js');
const htmlFile = path.join(ROOT, 'login.html');
const allJS    = [...jsFiles.map(readFile), readFile(htmlFile)].join('\n');

const definedFns = new Set();
// function foo(  |  foo = function(  |  foo: function(  |  const/let/var foo =
const defRx = /(?:^|\s)(?:async\s+)?function\s+(\w+)\s*\(|(?:^|[^.\w])(\w+)\s*[:=]\s*(?:async\s+)?function\s*\(/gm;
let m;
while ((m = defRx.exec(allJS)) !== null) {
  const name = m[1] || m[2];
  if (name) definedFns.add(name);
}
// Also arrow functions  const foo = (...) =>
const arrowRx = /(?:^|[^.\w])(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(.*?\)\s*=>/gm;
while ((m = arrowRx.exec(allJS)) !== null) definedFns.add(m[1]);
// window.foo =
const winRx = /window\.(\w+)\s*=/gm;
while ((m = winRx.exec(allJS)) !== null) definedFns.add(m[1]);
// g.foo = (exposed via (function(g){...})(window) pattern)
const gRx = /\bg\.(\w+)\s*=/gm;
while ((m = gRx.exec(allJS)) !== null) definedFns.add(m[1]);

// ── 2. Collect ALL function calls from onclick/oninput/etc ────────
const issues = [];

// Extract calls from event handlers in JS template literals and HTML
const handlerRx = /on(?:click|change|input|submit|keydown|mouseenter|mouseleave|focus|blur)\s*=\s*["'`]([^"'`]+)["'`]/g;
const callExtract = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;

// Track which (fn, file) pairs we've already reported
const reported = new Set();

for (const fp of [...jsFiles, htmlFile]) {
  const src  = readFile(fp);
  const rel  = fp.replace(ROOT + path.sep, '');
  const lines = src.split('\n');

  let hm;
  while ((hm = handlerRx.exec(src)) !== null) {
    const handler = hm[1];
    // Find line number
    const pos  = hm.index;
    let lineNo = 1, char = 0;
    for (const l of lines) { char += l.length + 1; if (char > pos) break; lineNo++; }

    let cm;
    while ((cm = callExtract.exec(handler)) !== null) {
      const fn = cm[1];
      // Skip known globals / keywords / very short names
      if (['if','for','while','return','typeof','instanceof','void',
           'null','true','false','undefined','new','this','event',
           'console','window','document','Math','JSON','parseInt',
           'parseFloat','String','Number','Boolean','Array','Object',
           'setTimeout','clearTimeout','setInterval','clearInterval',
           'alert','confirm','prompt','nav','esc','fM','fN','fD',
           'fMH','fLakhCr','gunit','gunits','gproject','gprojects',
           'gfloor','gfloors','gtype','gtypes','gstatus','gstatuses',
           'gfus','toast','DX','S','supabase'].includes(fn)) continue;
      if (fn.length < 3) continue;
      if (definedFns.has(fn)) continue;
      const key = fn + '|' + rel;
      if (reported.has(key)) continue;
      reported.add(key);
      issues.push({ type: 'UNDEFINED_FN', fn, file: rel, line: lineNo });
    }
  }
}

// ── 3. nav() calls — check if render function exists ─────────────
const navRx   = /\bnav\s*\(\s*['"`](\w+)['"`]\s*\)/g;
const routeMap = {}; // page -> defined render fn
// Collect rXxx functions
const renderRx = /function\s+r([A-Z][a-zA-Z0-9]*)\s*\(/g;
while ((m = renderRx.exec(allJS)) !== null) routeMap['r' + m[1]] = true;

const navIssues = [];
const navSeen = new Set();
for (const fp of [...jsFiles, htmlFile]) {
  const src = readFile(fp);
  const rel = fp.replace(ROOT + path.sep, '');
  while ((m = navRx.exec(src)) !== null) {
    const page = m[1];
    // Build possible render fn names
    const candidates = [
      'r' + page.charAt(0).toUpperCase() + page.slice(1),
      'r' + page.toUpperCase(),
      'r' + page,
    ];
    const found = candidates.some(c => definedFns.has(c) || routeMap[c]);
    if (!found && !navSeen.has(page)) {
      navSeen.add(page);
      navIssues.push({ page, file: rel });
    }
  }
}

// ── 4. CSS background shorthand on inputs ────────────────────────
const cssFiles = readAll(CSS_DIR, '.css');
const cssIssues = [];
for (const fp of cssFiles) {
  const src   = readFile(fp);
  const rel   = fp.replace(ROOT + path.sep, '');
  const lines2 = src.split('\n');
  lines2.forEach((l, i) => {
    // background: shorthand (not background-color/-image/-size etc)
    if (/^\s*background\s*:/.test(l) && !/background-/.test(l)) {
      // Check if this rule selector contains select / inp-light / .fi / input
      // Look backwards for selector
      let sel = '';
      for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
        if (lines2[j].includes('{')) { sel = lines2[j]; break; }
      }
      if (/select|inp-light|\.fi\b|\.inp\b|\.fbar/.test(sel)) {
        cssIssues.push({ file: rel, line: i + 1, selector: sel.trim(), rule: l.trim() });
      }
    }
  });
}

// ── Print Report ──────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log('  NEXUNOVA RMS — AUTOMATED BUG AUDIT REPORT');
console.log('═'.repeat(60));

console.log('\n▌ UNDEFINED ONCLICK FUNCTIONS (' + issues.length + ' found)');
console.log('─'.repeat(60));
if (!issues.length) {
  console.log('  ✅  None found — all onclick handlers are wired correctly.');
} else {
  issues.slice(0, 40).forEach(i =>
    console.log(`  ❌  ${i.fn}()  →  ${i.file}:${i.line}`)
  );
  if (issues.length > 40) console.log(`  ... and ${issues.length - 40} more`);
}

console.log('\n▌ NAV() CALLS WITH NO RENDER FUNCTION (' + navIssues.length + ' found)');
console.log('─'.repeat(60));
if (!navIssues.length) {
  console.log('  ✅  All nav() routes have matching render functions.');
} else {
  navIssues.forEach(i =>
    console.log(`  ⚠️   nav('${i.page}')  →  no render fn found  (${i.file})`)
  );
}

console.log('\n▌ CSS background: SHORTHAND ON SELECT/INPUT ELEMENTS (' + cssIssues.length + ' found)');
console.log('─'.repeat(60));
if (!cssIssues.length) {
  console.log('  ✅  No background shorthand issues found.');
} else {
  cssIssues.forEach(i =>
    console.log(`  ⚠️   ${i.file}:${i.line}  →  selector: ${i.selector}`)
  );
}

console.log('\n' + '═'.repeat(60));
console.log('  Total issues: ' + (issues.length + navIssues.length + cssIssues.length));
console.log('═'.repeat(60) + '\n');

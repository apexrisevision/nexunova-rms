const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js/pages/reports.js'), 'utf8');
const lines = src.split('\n');

// find RP block start: a comment line containing the marker
let idx = -1;
for (let i = 0; i < lines.length; i++) {
  if (/RECOVERY POSITION \(GRAND SUMMARY\)/.test(lines[i]) && /^\s*\/\//.test(lines[i])) { idx = i; break; }
}
if (idx < 0) { console.log('MARKER NOT FOUND'); process.exit(1); }
const tail = lines.slice(idx).join('\n');
console.log('RP block starts at line', idx + 1, '->', lines[idx].slice(0, 64).trim());
console.log('tail lines:', lines.length - idx);

// scan tail for head-only deps that would break post-splice
const deps = ['rptBanner', '_rptPeriodBar', 'getDF', '_injectCrystalStyle', 'setRng(', 'setRS(', '_rhRunExcel', 'RPT[', '_DEPTS', '_rptRenderCard', '_rptLoadKPIs', '_rptCardMetric', '_rptDoSearch'];
let problems = 0;
deps.forEach(d => { const n = tail.split(d).length - 1; if (n) { console.log('  TAIL USES', d, 'x' + n); problems += n; } });
console.log(problems ? '!!! tail has ' + problems + ' head-dep refs — review before splice' : 'CLEAN: tail self-contained');

if (process.argv[2] === '--write') {
  const head = fs.readFileSync(path.join(__dirname, '_reports_head.js'), 'utf8');
  const out = head.replace(/\s+$/, '') + '\n\n' + tail;
  fs.writeFileSync(path.join(ROOT, 'js/pages/reports.js'), out);
  console.log('WROTE reports.js (' + out.split('\n').length + ' lines)');
}

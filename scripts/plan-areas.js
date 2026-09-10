/* ══ THE AREA THE DRAUGHTSMAN PRINTED ══════════════════════════════════════
   Rashid's rule, and he has had to say it twice: the size that counts is the
   one WRITTEN ON THE MAP, not the one the register happens to hold. On the
   Fourth Floor the register carries 342.40 against twenty-eight different
   shops; the sheet writes AREA=492.40SFT on one of them. The register is a
   placeholder, the sheet is the drawing's own answer, and the link must say
   what the sheet says.

   The residential sheets write that line in purple (#bf00ff), one per unit,
   in the same traced outlines as everything else — no text, no font, nothing
   to search. plan-read.js turns the outlines into pictures and clusters them;
   this reads the clusters, names them, and comes back with a number per unit.

   NAMING WITHOUT AN EYE. The Fourth Floor was read once by hand and its named
   shapes kept as purple-alphabet.json. Every other sheet is matched against
   that alphabet picture by picture, so no sheet after the first needs a human.
   The reading is then CHECKED rather than trusted: every line on a residential
   sheet reads AREA=<digits>.<digits>SFT, and one that does not is reported
   instead of being guessed at.

   node scripts/plan-areas.js <dir> <pageN>
*/
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const DIR = process.argv[2] || 'marketing_shots/plan';
const PAGE = process.argv[3] || 'page6';
/* THE COMMERCIAL SHEETS WRITE IN BLACK. Lower Ground through Second Floor put
   the area in with everything else the draughtsman noted — the type, the
   dimensions, a buyer's name — all in black, all in the same outlines. The
   AREA line is picked out of that by its shape alone, so the rest can be
   ignored without having to be understood. */
const COLOUR = (process.argv[4] || '#bf00ff').toLowerCase();
const READ = path.join(__dirname, 'plan-read.js');

const run = (...a) => execFileSync(process.execPath, [READ, DIR, PAGE, ...a], { encoding: 'utf8' });

/* the contact sheet is where plan-read puts the pictures it found */
function pictures() {
  run('', '', COLOUR);
  const h = fs.readFileSync(path.join(DIR, PAGE + '-text-chars.html'), 'utf8');
  return h.split('<div class="c">').slice(1).map(c =>
    c.split('<div class="r">').slice(1)
     .map(r => (r.split('</div>')[0].match(/<i[^>]*>/g) || []).map(x => /on/.test(x) ? '1' : '0'))
     .flat().join(''));
}

/* the alphabet lives with the scripts, not with the generated sheets: it was
   read by eye once and must survive anything that clears the working folder */
const alphabet = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan-alphabet.json'), 'utf8'));
const apart = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };

const pics = pictures();
let worst = 0;
const map = pics.map(p => {
  let ch = '?', best = 1e9;
  for (const g of alphabet) { const d = apart(p, g.b); if (d < best) { best = d; ch = g.ch; } }
  if (best > worst) worst = best;
  return ch;
}).join('');
console.log(PAGE + ': ' + pics.length + ' shapes named off the alphabet, worst fit ' + worst + ' cells of 192');

run(map, '', COLOUR);
const text = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-text.json'), 'utf8'));
const good = /^AREA=[0-9]+\.[0-9]+SFT$/;
const odd = text.filter(t => !good.test(t.raw));
console.log('  ' + (text.length - odd.length) + ' of ' + text.length + ' lines read as an area');
/* A STRAY MARK IS NOT A FAILED READING. The Third Floor carries one lone dot
   in purple that belongs to no line — a full stop the draughtsman left behind.
   It is dropped rather than allowed to claim a unit and overwrite the area
   that unit really has. Anything longer than a mark is a real line that failed
   to read, and that still stops the run. */
const stray = odd.filter(o => o.raw.length <= 2);
const broke = COLOUR === '#bf00ff' ? odd.filter(o => o.raw.length > 2) : [];
if (stray.length) console.log('  ' + stray.length + ' stray mark(s) ignored');
if (broke.length) {
  console.log('  DID NOT READ (' + broke.length + '): ' + broke.slice(0, 8).map(o => o.raw).join('  '));
  process.exitCode = 1;
}

/* WHICH UNIT EACH LINE BELONGS TO. The number and its area are printed as a
   pair, the area a line below, so the nearest unit number is the owner — and
   the check that it worked is that every unit gets exactly one. */
const units = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-read.json'), 'utf8'));
const out = {};
let taken = 0;
text.filter(t => good.test(t.raw)).forEach(t => {
  let best = null, bd = 1e9;
  units.forEach(u => { const d = Math.hypot(u.cx - t.cx, u.cy - t.cy); if (d < bd) { bd = d; best = u; } });
  if (out[best.u]) taken++;
  out[best.u] = { area: Number(t.raw.replace(/[^0-9.]/g, '')), away: +bd.toFixed(1) };
});
const file = path.join(DIR, PAGE + '-area.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log('  ' + Object.keys(out).length + ' units carry an area' +
            (taken ? '  — ' + taken + ' UNIT(S) CLAIMED TWICE' : '') + '  → ' + file);
if (taken) process.exitCode = 1;

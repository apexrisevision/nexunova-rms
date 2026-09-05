#!/usr/bin/env node
/**
 * Daily Closing — THE MUTATION RUNNER (standing rule SR-10).
 *
 *   node scripts/mutate-daily-closing.js                 # a sample, reported
 *   node scripts/mutate-daily-closing.js --all           # every mutant
 *   node scripts/mutate-daily-closing.js --n=40          # a bigger sample
 *   node scripts/mutate-daily-closing.js --seed=7        # a different sample
 *   node scripts/mutate-daily-closing.js --suites=screen # fewer suites, faster
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Every red proof in this repo is ONE mutation, hand-picked after the cause was
 * already known. That shows the assertion fires. It can never show the assertion
 * nobody wrote — and four times now a green suite has failed to see the very bug
 * it was written to catch (the P4 NULL-trap, absent-detectors that had never
 * fired, a fix verified on one boot path, and a stub that only supplied
 * responses). SR-2, SR-5, SR-6, SR-7, SR-8 and SR-9 were each written afterwards
 * and each is correct; they share a shape that guarantees a fifth, because an
 * assertion written after a bug is shaped like that bug.
 *
 * So: break the product in ways NOBODY CHOSE, mechanically, and require the
 * suites to notice. A surviving mutant is a blind spot, named before production
 * finds it.
 *
 * ── THE PROPERTY THAT MATTERS, AND HOW IT IS PROTECTED ──────────────────────
 * The mutants are GENERATED FROM THE SOURCE by mechanical operators applied at
 * EVERY site they match. There is no list of interesting cases, and there must
 * never be one: the moment someone curates the list, this becomes another
 * backward-looking rule and stops finding what nobody thought of.
 *
 * If a mutant is uninteresting, that is a fact about the suites, not a reason to
 * delete the mutant. Sampling is deterministic (`--seed`) so a run is
 * reproducible, and `--all` is always available.
 *
 * ── THE SPLIT: unasserted vs undriven ───────────────────────────────────────
 * "3 survived" sends you looking in the wrong place. A survivor means one of two
 * quite different things:
 *
 *   UNASSERTED (SR-9)  the code ran and nothing checked the difference
 *                      → write an assertion
 *   UNDRIVEN   (SR-6)  the code never ran at all
 *                      → drive the path, or record it as knowingly uncovered
 *
 * They are separated mechanically, not by reading. For each function that
 * contains a survivor, the runner builds a REACHABILITY PROBE — the same file
 * with `throw` as that function's first statement — and runs the suites again.
 * If the probe is killed the function is driven, so its survivors are
 * unasserted. If the probe also survives, the function is never executed and its
 * survivors are undriven. That is how the loadAudit case separated itself by
 * accident on 2026-09-05; this does it on purpose.
 *
 * ── SCOPE, DELIBERATELY NARROW ──────────────────────────────────────────────
 * The daily-closing module only. It will refuse to mutate anything else. KBH and
 * FMH code paths are out of scope on the owner's instruction: findings there
 * surface in live tenant paths that would then have to be triaged under time
 * pressure, and the point of this is to harden the cash book BEFORE it holds
 * money.
 *
 * ── IT REPORTS. IT DOES NOT GATE. ───────────────────────────────────────────
 * Exit 0 whatever survives; exit 2 only if it could not run. A mutation score
 * wired into the push gate on day one gets tuned down to whatever passes, and
 * then it is worse than nothing because it looks like a control.
 *
 * ── WHAT MUTATION TESTING WILL NOT CATCH ────────────────────────────────────
 * Stated here because it is the honest summary of this module's first week.
 *
 * The cash book has never held a real transaction. Every bug found so far has
 * been in the WIRING between the RMS shell and the module — a feature flag read
 * before it was loaded, a client read off the wrong object, a session read off
 * the wrong object, a boot path nobody drove, a failure rendered as a
 * permissions message. The schema, the services, the eight invariants and the
 * tenant isolation have held up under real testing, including a real foreign JWT
 * over real HTTPS.
 *
 * And the wiring is precisely what this runner is WORST at reaching:
 *
 *   · It mutates the module's own source. `global.supabase` vs `supabase` and
 *     `global.S` vs `S` are one-token differences that a mutation operator could
 *     generate in principle, but the bug was in which of two globals EXISTS at
 *     runtime — a property of js/data.js and js/supabase.js, not of this module.
 *   · It cannot mutate load ORDER, which is where the feature-flag bug lived.
 *   · It cannot mutate the ABSENCE of a call. tryRestoreSession never called
 *     loadFeatureFlags; there was no line to change.
 *   · It cannot mutate the harness. A suite that stubs away the thing under test
 *     kills mutants happily and proves nothing — SR-5 and SR-7 are still the
 *     only defence there.
 *   · It says nothing about whether the module's RULES are right. A mutant that
 *     survives because both behaviours are wrong is invisible to it.
 *
 * What it does reach is logic: predicates, arguments, branches, arithmetic,
 * returned shapes. That is most of the cash book and almost none of this week's
 * bugs. Both facts belong in the same sentence.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

/* The module, and nothing else. A path not on this list is not mutable, and the
   check is by resolved path so a symlink or a `..` cannot widen it. */
const TARGETS = [
  'js/pages/daily-closing.js',
  'js/pages/daily-closing-tile.js',
  'js/foundation/dc-format.js',
  'js/foundation/dc-kit.js',
];

const ALL_SUITES = ['screen', 'shell-adapter'];

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const hit = argv.find(a => a.startsWith('--' + k + '='));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const RUN_ALL = argv.includes('--all');
const N = parseInt(arg('n', '24'), 10);
const SEED = arg('seed', '1');
const SUITES = arg('suites', ALL_SUITES.join(',')).split(',').filter(Boolean);
const SKIP_PROBES = argv.includes('--no-probes');

for (const s of SUITES) {
  if (!fs.existsSync(path.join(ROOT, 'scripts', `verify-daily-closing-${s}.js`))) {
    console.log(`✖ no such suite: ${s}`);
    process.exit(2);
  }
}

/* ── the operators ─────────────────────────────────────────────────────────
   Mechanical, and applied at EVERY site each one matches. Nothing here knows
   about any bug. Adding an operator is welcome; adding a filter that skips
   "uninteresting" sites is the thing this file exists to prevent. */
const OPERATORS = [
  // an RPC argument becomes null — the shape that produced PGRST202
  { id: 'ARG_NULL', re: /(\bp_[a-z_]+:\s*)(?!null\b)([A-Za-z_$][\w.$]*(?:\([^()]*\))?)/g,
    to: (m, a) => a + 'null' },
  // a condition is forced either way
  { id: 'IF_TRUE',  re: /\bif\s*\(([^()]{1,120})\)/g, to: () => 'if (true)' },
  { id: 'IF_FALSE', re: /\bif\s*\(([^()]{1,120})\)/g, to: () => 'if (false)' },
  // equality and ordering are inverted
  { id: 'EQ_FLIP',  re: /\s===\s/g,  to: () => ' !== ' },
  { id: 'NEQ_FLIP', re: /\s!==\s/g,  to: () => ' === ' },
  { id: 'GT_FLIP',  re: /\s>\s(?!=)/g, to: () => ' <= ' },
  { id: 'LT_FLIP',  re: /\s<\s(?!=)/g, to: () => ' >= ' },
  { id: 'GTE_FLIP', re: /\s>=\s/g,   to: () => ' < ' },
  // boolean connectives are swapped
  { id: 'AND_OR',   re: /\s&&\s/g,   to: () => ' || ' },
  { id: 'OR_AND',   re: /\s\|\|\s/g, to: () => ' && ' },
  // literals
  { id: 'TRUE_FALSE', re: /\btrue\b/g,  to: () => 'false' },
  { id: 'FALSE_TRUE', re: /\bfalse\b/g, to: () => 'true' },
  { id: 'NUM_ZERO',   re: /(?<![\w.$])([1-9]\d{0,6})(?![\w.])/g, to: () => '0' },
  // a negation is dropped
  { id: 'DROP_NOT',   re: /(\(|\s)!(?!=)([A-Za-z_$])/g, to: (m, a, b) => a + b },
  // a returned string becomes empty — a body builder that draws nothing
  { id: 'RET_EMPTY',  re: /\breturn\s+'(?:[^'\\]|\\.){2,}'/g, to: () => "return ''" },
];

/* ── generate ──────────────────────────────────────────────────────────────── */
function lineOf(src, index) { return src.slice(0, index).split('\n').length; }

// The nearest enclosing `function name(` above an offset. Textual on purpose:
// the module is one IIFE of plain function declarations, and a parser is a
// dependency ARCHITECTURE_NOTES says this repo does not have.
const FN_RE = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
function enclosingFn(src, index) {
  let name = '(top level)', m;
  FN_RE.lastIndex = 0;
  while ((m = FN_RE.exec(src)) && m.index < index) name = m[1];
  return name;
}

function generate() {
  const out = [];
  for (const rel of TARGETS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    for (const op of OPERATORS) {
      const re = new RegExp(op.re.source, op.re.flags);
      let m;
      while ((m = re.exec(src)) !== null) {
        if (m.index === re.lastIndex) re.lastIndex++;          // zero-width guard
        const before = src.slice(0, m.index);
        const after = src.slice(m.index + m[0].length);
        const replaced = op.to(...m);
        if (replaced === m[0]) continue;
        const mutated = before + replaced + after;
        if (mutated === src) continue;
        out.push({
          file: rel, op: op.id, index: m.index,
          line: lineOf(src, m.index), fn: enclosingFn(src, m.index),
          was: m[0].trim().slice(0, 44), now: replaced.trim().slice(0, 44),
          apply: () => mutated,
        });
      }
    }
  }
  return out;
}

/* Deterministic shuffle, so --seed reproduces a run exactly. */
function shuffle(list, seed) {
  const keyed = list.map((x, i) => [
    crypto.createHash('sha1').update(seed + ':' + i).digest('hex'), x,
  ]);
  keyed.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return keyed.map(k => k[1]);
}

/* ── run ───────────────────────────────────────────────────────────────────── */
const originals = new Map();
function snapshot() {
  for (const rel of TARGETS) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) originals.set(rel, fs.readFileSync(abs, 'utf8'));
  }
}
function restore() {
  let bad = [];
  for (const [rel, src] of originals) {
    const abs = path.join(ROOT, rel);
    try {
      if (fs.readFileSync(abs, 'utf8') !== src) fs.writeFileSync(abs, src);
      if (fs.readFileSync(abs, 'utf8') !== src) bad.push(rel);
    } catch (e) { bad.push(rel); }
  }
  return bad;
}

// A mutant is KILLED the moment any suite goes red, so the cheap kill short-
// circuits the expensive one. Survivors are the only mutants that pay for every
// suite, which is the right way round.
function suitesKill(label) {
  for (const s of SUITES) {
    try {
      execFileSync('node', [path.join('scripts', `verify-daily-closing-${s}.js`)],
        { cwd: ROOT, stdio: 'pipe', timeout: 600000 });
    } catch (e) {
      return s;                       // this suite noticed
    }
  }
  return null;                        // nobody noticed
}

(function main() {
  // A dirty tree turns a crash into lost work, because this writes to real files.
  try {
    const dirty = execFileSync('git', ['status', '--porcelain', '--', ...TARGETS],
      { cwd: ROOT, encoding: 'utf8' }).trim();
    if (dirty && !argv.includes('--force-dirty')) {
      console.log('✖ the module files have uncommitted changes:\n' + dirty);
      console.log('  This rewrites them in place. Commit or stash first, or pass --force-dirty.');
      process.exit(2);
    }
  } catch (e) { /* not a git tree — carry on */ }

  const all = generate();
  const chosen = RUN_ALL ? all : shuffle(all, SEED).slice(0, N);

  console.log('\n════════ DAILY CLOSING · MUTATION RUN ════════');
  console.log(`  ${all.length} mutants generated from ${TARGETS.length} files by ` +
              `${OPERATORS.length} operators`);
  console.log(`  running ${chosen.length}${RUN_ALL ? ' (all)' : ` (seed ${SEED})`} ` +
              `against: ${SUITES.join(', ')}`);
  console.log('  this reports; it does not gate.\n');

  snapshot();
  const survivors = [];
  let killed = 0;

  try {
    chosen.forEach((mu, i) => {
      const abs = path.join(ROOT, mu.file);
      fs.writeFileSync(abs, mu.apply());
      const by = suitesKill();
      fs.writeFileSync(abs, originals.get(mu.file));
      const tag = `${String(i + 1).padStart(3)}/${chosen.length}  ${mu.op.padEnd(10)} ` +
                  `${path.basename(mu.file)}:${mu.line} ${mu.fn}()`;
      if (by) { killed++; console.log(`  killed   ${tag}  [${by}]`); }
      else { survivors.push(mu); console.log(`  SURVIVED ${tag}`); }
    });

    /* ── the split ────────────────────────────────────────────────────────── */
    const byFn = new Map();
    survivors.forEach(mu => {
      const key = mu.file + '::' + mu.fn;
      if (!byFn.has(key)) byFn.set(key, []);
      byFn.get(key).push(mu);
    });

    const driven = new Map();
    if (!SKIP_PROBES && byFn.size) {
      console.log(`\n── reachability probes (${byFn.size} function(s) with survivors)`);
      for (const key of byFn.keys()) {
        const [rel, fnName] = key.split('::');
        const src = originals.get(rel);
        let probed = null;
        if (fnName !== '(top level)') {
          const re = new RegExp('(\\bfunction\\s+' + fnName.replace(/[$]/g, '\\$') + '\\s*\\([^)]*\\)\\s*\\{)');
          if (re.test(src)) {
            probed = src.replace(re, '$1 throw new Error("MUTATION_PROBE");');
          }
        }
        if (!probed) { driven.set(key, null); console.log(`  ?        ${fnName}() — could not probe`); continue; }
        fs.writeFileSync(path.join(ROOT, rel), probed);
        const by = suitesKill();
        fs.writeFileSync(path.join(ROOT, rel), src);
        driven.set(key, !!by);
        console.log(`  ${by ? 'driven  ' : 'UNDRIVEN'} ${fnName}()${by ? `  [${by}]` : ''}`);
      }
    }

    /* ── report ───────────────────────────────────────────────────────────── */
    console.log('\n' + '─'.repeat(60));
    console.log(`killed ${killed} · survived ${survivors.length} of ${chosen.length}`);

    const unasserted = [], undrivenList = [], unknown = [];
    survivors.forEach(mu => {
      const d = driven.get(mu.file + '::' + mu.fn);
      (d === true ? unasserted : d === false ? undrivenList : unknown).push(mu);
    });

    const show = (title, list, advice) => {
      if (!list.length) return;
      console.log(`\n${title}  (${list.length})`);
      console.log(`  ${advice}`);
      list.forEach(mu => console.log(
        `    ${path.basename(mu.file)}:${mu.line}  ${mu.fn}()  ${mu.op}` +
        `\n        ${mu.was}   →   ${mu.now}`));
    };
    show('UNASSERTED — the code ran and nothing checked the difference (SR-9)',
      unasserted, 'Write an assertion. These are the ones that can bite in production.');
    show('UNDRIVEN — the code never ran at all (SR-6)',
      undrivenList, 'Drive the path, or record it as knowingly uncovered. Not the same problem.');
    show('UNCLASSIFIED — the reachability probe could not be built',
      unknown, 'Look by hand; the function shape defeated the textual probe.');

    if (!survivors.length) console.log('\nNothing survived. That is a real result, not a formality.');
  } finally {
    const bad = restore();
    if (bad.length) {
      console.log('\n⚠️  COULD NOT RESTORE: ' + bad.join(', '));
      console.log('   Run: git checkout -- ' + bad.join(' '));
      process.exitCode = 2;
    } else {
      console.log('\n✓ all module files restored to their committed state');
    }
  }
})();

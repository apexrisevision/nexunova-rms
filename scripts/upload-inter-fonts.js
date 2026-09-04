#!/usr/bin/env node
/**
 * Daily Closing — put Inter into the private `daily-closing` bucket.
 *
 *   node scripts/upload-inter-fonts.js            # download, upload, verify
 *   node scripts/upload-inter-fonts.js --check    # just say what is there now
 *
 * WHY THIS EXISTS. supabase/functions/daily-closing-pdf embeds Inter if it can
 * read `_assets/Inter-Regular.ttf` and `_assets/Inter-SemiBold.ttf` from the
 * bucket, and falls back to Helvetica if it cannot. Nothing had ever been put
 * there, so every sheet rendered in Helvetica. This puts the two files in
 * place; no code changes, no redeploy — the next render picks them up.
 *
 * WHERE THE FONT COMES FROM. github.com/rsms/inter, release v4.1, the official
 * Inter-4.1.zip, static desktop TTFs at `extras/ttf/`. Inter is SIL OFL 1.1, so
 * embedding it in a generated PDF is fine; the licence file is uploaded beside
 * the fonts so the bucket carries its own provenance.
 *
 * NO NEW DEPENDENCY. The zip is read with a ~40-line central-directory reader
 * on top of `zlib`, which node already has. ARCHITECTURE_NOTES records that
 * this repo has no archive library and does not want one for a single use.
 *
 * The bucket is private and has no storage policy, so this uses the service key
 * — read at run time from .mcp.json, exactly like scripts/_sbq.js, and never
 * written anywhere.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { REF, TOKEN } = require('./_sbq');

const BUCKET = 'daily-closing';
const RELEASE = 'https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip';
const WANT = [
  { zip: 'extras/ttf/Inter-Regular.ttf',  key: '_assets/Inter-Regular.ttf',  mime: 'font/ttf' },
  { zip: 'extras/ttf/Inter-SemiBold.ttf', key: '_assets/Inter-SemiBold.ttf', mime: 'font/ttf' },
  { zip: 'LICENSE.txt',                   key: '_assets/Inter-LICENSE.txt',  mime: 'text/plain' },
];

const URL_BASE = `https://${REF}.supabase.co`;
let fail = 0;
const ok  = m => console.log('  ✅ ' + m);
const bad = m => { fail++; console.log('  ❌ ' + m); };
const head = t => console.log('\n── ' + t);

async function serviceKey() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${TOKEN}` } });
  const keys = await r.json();
  const k = (keys || []).find(x => x.name === 'service_role' || x.type === 'secret');
  if (!k || !k.api_key) throw new Error('could not read the service key');
  return k.api_key;
}

/* ── the smallest zip reader that can do this job ───────────────────────────
   Read the End Of Central Directory record from the tail, walk the central
   directory, and inflate the one member we want. Stored (0) and deflated (8)
   are the only methods a font zip uses. */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('central directory is corrupt');
    const nameLen  = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen   = buf.readUInt16LE(p + 32);
    entries.set(buf.toString('utf8', p + 46, p + 46 + nameLen), {
      method: buf.readUInt16LE(p + 10),
      csize:  buf.readUInt32LE(p + 20),
      offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + cmtLen;
  }

  return function extract(name) {
    const e = entries.get(name);
    if (!e) throw new Error(`the zip has no member "${name}"`);
    let q = e.offset;
    if (buf.readUInt32LE(q) !== 0x04034b50) throw new Error('local header is corrupt');
    q += 30 + buf.readUInt16LE(q + 26) + buf.readUInt16LE(q + 28);
    const raw = buf.subarray(q, q + e.csize);
    return e.method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
  };
}

/* A TTF starts with 0x00010000 or "true"; an OTF with "OTTO". Checked so a
   404 page saved as a .ttf cannot be uploaded as a font. */
function looksLikeTTF(b) {
  if (b.length < 4) return false;
  const tag = b.readUInt32BE(0);
  return tag === 0x00010000 || tag === 0x74727565;
}

async function list(SERVICE) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '_assets', limit: 100 }),
  });
  return r.ok ? await r.json() : [];
}

(async () => {
  const SERVICE = await serviceKey();
  const checkOnly = process.argv.includes('--check');

  head(`what is in ${BUCKET}/_assets right now`);
  const before = await list(SERVICE);
  if (!before.length) console.log('  (empty — the renderer is falling back to Helvetica)');
  before.forEach(f => console.log(`  · ${f.name}  ${Math.round((f.metadata?.size || 0) / 1024)} KB`));
  if (checkOnly) return;

  // The zip is 33 MB, so it is cached in the OS temp dir between runs.
  const cache = path.join(os.tmpdir(), 'Inter-4.1.zip');
  head('the font');
  let zipBuf;
  if (fs.existsSync(cache) && fs.statSync(cache).size > 30e6) {
    zipBuf = fs.readFileSync(cache);
    ok(`using the cached release (${Math.round(zipBuf.length / 1e6)} MB) — delete ${cache} to re-fetch`);
  } else {
    const r = await fetch(RELEASE);
    if (!r.ok) throw new Error(`could not download Inter: HTTP ${r.status}`);
    zipBuf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(cache, zipBuf);
    ok(`downloaded rsms/inter v4.1 (${Math.round(zipBuf.length / 1e6)} MB)`);
  }

  const extract = readZip(zipBuf);

  head('upload');
  for (const w of WANT) {
    const bytes = extract(w.zip);
    if (w.mime === 'font/ttf' && !looksLikeTTF(bytes)) {
      bad(`${w.zip} does not look like a TrueType font — not uploaded`);
      continue;
    }
    const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${w.key}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
        'Content-Type': w.mime, 'x-upsert': 'true',
      },
      body: bytes,
    });
    r.ok ? ok(`${w.key.padEnd(30)} ${String(Math.round(bytes.length / 1024)).padStart(4)} KB`)
         : bad(`${w.key} — HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  }

  head('verify — read each one back the way the renderer does');
  for (const w of WANT) {
    const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${w.key}`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    if (!r.ok) { bad(`${w.key} could not be read back — HTTP ${r.status}`); continue; }
    const b = Buffer.from(await r.arrayBuffer());
    if (w.mime === 'font/ttf' && !looksLikeTTF(b)) {
      bad(`${w.key} came back as ${b.length} bytes that are not a font`);
    } else {
      ok(`${w.key} reads back as ${Math.round(b.length / 1024)} KB${w.mime === 'font/ttf' ? ', a real TrueType font' : ''}`);
    }
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(fail === 0
    ? '✅ Inter is in the bucket. The next Director PDF renders in Inter — no redeploy needed.\n' +
      '   Prove it:  node scripts/verify-daily-closing-pdf.js   (it prints the typeface)'
    : `❌ ${fail} step(s) failed — the renderer will keep falling back to Helvetica.`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error('\n❌ ' + e.message); process.exitCode = 1; });

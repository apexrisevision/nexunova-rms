// Shared helper: run SQL against the RMS Supabase project via the Management API.
// Token + project ref are read from .mcp.json at run time (never copied elsewhere).
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, '..', '.mcp.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const server = cfg.mcpServers.supabase;
const TOKEN = server.env.SUPABASE_ACCESS_TOKEN;
const REF = (server.args.find(a => a.startsWith('--project-ref=')) || '').split('=')[1];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Retries transient network/5xx failures so a long backup run survives a DNS
// blip or a rate limit. 4xx (bad SQL, payload too large) is raised immediately.
async function q(sql, tries = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql })
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      const err = new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
      err.status = res.status;
      if (res.status < 500 && res.status !== 429) throw err;   // real error, not transient
      lastErr = err;
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
    }
    if (attempt < tries) await sleep(1500 * attempt);
  }
  throw lastErr;
}

module.exports = { q, REF, TOKEN };

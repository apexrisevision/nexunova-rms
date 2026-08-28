// ══ UTILS ═════════════════════════════════════
const td=()=>new Date().toISOString().slice(0,10);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const ini=n=>(n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
const pct=(p,t)=>t?Math.min(100,Math.round(p/t*100)):0;

// International number formatting — Western thousands grouping (1,000,000 / 10,000,000).
// 20260608: standardized away from lakh/crore. 'en-US' gives Western grouping in
// Node/browser ICU (verified); 'en-IN' was the old lakh/crore locale — do NOT use it.
const _PK_LOCALE = 'en-US';
function fM(n){
  if(!n&&n!==0)return '—';
  return Number(n).toLocaleString(_PK_LOCALE,{maximumFractionDigits:0});
}
function fMF(n){
  if(!n&&n!==0)return '—';
  return 'PKR '+Number(n).toLocaleString(_PK_LOCALE,{maximumFractionDigits:0});
}
function fMH(n){
  if(!n&&n!==0)return '—';
  return Number(n).toLocaleString(_PK_LOCALE,{maximumFractionDigits:0});
}
// fN — plain number formatter (no currency, no em-dash for empty). Alias of fM for legacy callers.
function fN(n){
  if(!n&&n!==0)return '';
  return Number(n).toLocaleString(_PK_LOCALE,{maximumFractionDigits:0});
}
// fLakhCr — compact INTERNATIONAL abbreviation for DASHBOARD KPI CARDS ONLY (do not
// use elsewhere; it loses precision). 20260608: switched from lakh/crore (L/Cr) to
// international K/M/B — ≥1B → "1.2B", ≥1M → "2.5M", ≥100K → "250K", else grouped.
// Name kept for back-compat. Returns number + suffix with NO currency prefix.
function fLakhCr(n){
  if(!n&&n!==0)return '—';
  const v=Number(n), a=Math.abs(v);
  const t=x=>x.toFixed(1).replace(/\.0$/,'');
  if(a>=1e9) return t(v/1e9)+'B';
  if(a>=1e6) return t(v/1e6)+'M';
  if(a>=1e5) return Math.round(v/1e3)+'K';
  return v.toLocaleString(_PK_LOCALE,{maximumFractionDigits:0});
}
function fD(d){if(!d)return '—';try{return new Date(d+'T00:00:00').toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'});}catch{return d;}}

function sbadge(st){
  const m={Available:['ba','● Available'],Installment:['bi','● Installment'],Adjustment:['bj','● Adjustment'],CashSale:['bc','● Cash Sale'],Dead:['bd','● Dead'],Sold:['bi','● Sold']};
  const[c,l]=m[st]||['bd',st];
  return `<span class="badge ${c}"><span class="b-dot"></span>${l}</span>`;
}
function cbadge(s){
  const m={NoResponse:['bnr','No Response'],Interested:['bin','Interested'],WillPay:['bwp','Will Pay'],NotInterested:['bni','Not Interested'],Dispute:['bdi','Dispute']};
  const[c,l]=m[s]||['bnr',s];
  return `<span class="badge ${c}">${l}</span>`;
}
function ctic(t){return{Call:'📞',WhatsApp:'💬',Meeting:'🤝'}[t]||'📋';}
function pbadge(t){const m={Cash:'<span class="badge bwp">Cash</span>',Bank:'<span class="badge bin">Bank</span>',Adjustment:'<span class="badge bj">Adj</span>',cash:'<span class="badge bwp">Cash</span>',bank_transfer:'<span class="badge bin">Bank Transfer</span>',cheque:'<span class="badge bin">Cheque</span>',online:'<span class="badge bj">Online</span>',other:'<span class="badge bd">Other</span>'};return m[t]||`<span class="badge bd">${esc(t)||'—'}</span>`;}
function gunm(id){const au=(window._appUsersCache||[]).find(u=>u.id===id);if(au)return au.name||'—';return gdb().users.find(u=>u.id===id)?.name||'—';}
// XSS escape
function esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// Configurable overdue days
function getOverdueDays(){
  if(S?.cid){const v=parseInt(localStorage.getItem('rms_od_'+S.cid));if(v>0)return v;}
  return gdb().settings?.overdueDays||30;
}

// ── Demo mode guard — call at top of any write operation ──
// Returns true and shows a warning if in demo mode (caller should return early).
function demoGuard(action) {
  if (!S?.isDemo) return false;
  if (typeof notify !== 'undefined') {
    notify.warning('Demo Mode', { detail: (action ? `"${action}" is` : 'This action is') + ' disabled in the demo. <a href="./signup.html" style="color:#a78bfa">Sign up free</a> to use the full system.' });
  }
  return true;
}

// Show demo banner once session is active
function initDemoBanner() {
  const banner = document.getElementById('demo-banner');
  if (banner && S?.isDemo) banner.style.display = '';
}

// ── Live comma formatting for PKR amount inputs (.inp-amt) ──
document.addEventListener('input',function(e){
  if(!e.target.classList.contains('inp-amt'))return;
  const el=e.target;
  const raw=el.value.replace(/[^0-9]/g,'');
  el.value=raw?Number(raw).toLocaleString('en-US'):'';
});

/* ── documents that belong to a person ────────────────────────────────────────
   A CNIC scan is not a picture on a page. It lives in a bucket that answers
   nobody — no address, public or guessed, opens it — so a screen cannot put a
   src on an <img> and be done. It renders the frame with the PATH on it, and
   asks here for a link that works for five minutes and then stops.

   One request for the whole screen, not one per picture: an application panel
   opens with a photograph and two sides of a card, and three round trips would
   be three times the wait for nothing.

   Records that have not been moved yet still carry a plain URL. Those are shown
   as they were — a half-finished migration must not blank out a document that
   an administrator can still legitimately see. */
function docSrc(path, url) {                       // what to render the frame with
  return path ? { path } : (url ? { url } : null);
}
function docImg(d, attr) {                         // an <img> that fills itself in
  if (!d) return '';
  return d.path
    ? `<img data-doc="${esc(d.path)}" ${attr || ''}>`
    : `<img src="${esc(d.url)}" ${attr || ''}>`;
}
function docHref(d) {                              // an <a> that resolves on demand
  if (!d) return '';
  return d.path ? `data-doc-open="${esc(d.path)}" href="#"` : `href="${esc(d.url)}" target="_blank" rel="noopener"`;
}

// One document, one link — for the places that hold on to a fixed element (a
// form preview, a page about to be printed) and cannot have it replaced.
async function docResolve(d) {
  if (!d) return null;
  if (d.url) return d.url;
  try {
    const { data } = await supabase.storage.from('employee-private').createSignedUrl(d.path, 300);
    return (data && data.signedUrl) || null;
  } catch (e) { return null; }
}

async function docHydrate(root) {
  root = root || document;
  const els = Array.from(root.querySelectorAll('[data-doc],[data-doc-open]'));
  if (!els.length) return;
  const paths = Array.from(new Set(els.map(e => e.dataset.doc || e.dataset.docOpen).filter(Boolean)));
  let map = {};
  try {
    const { data } = await supabase.storage.from('employee-private').createSignedUrls(paths, 300);
    (data || []).forEach(d => { if (d && d.signedUrl) map[d.path] = d.signedUrl; });
  } catch (e) { /* falls through to the "cannot open" state below */ }

  els.forEach(el => {
    const p = el.dataset.doc || el.dataset.docOpen;
    const u = map[p];
    if (el.hasAttribute('data-doc')) {
      if (u) { el.src = u; el.removeAttribute('data-doc'); }
      else { el.replaceWith(Object.assign(document.createElement('div'), {
        style: 'width:100%;height:100%;display:grid;place-items:center;font-size:11px;color:var(--fk-text-muted)',
        textContent: 'Cannot open' })); }
    } else if (u) {
      // opened through the same short-lived link, in a new tab, on the click
      el.dataset.docUrl = u;
      el.onclick = ev => { ev.preventDefault(); window.open(el.dataset.docUrl, '_blank', 'noopener'); };
    } else {
      el.onclick = ev => ev.preventDefault();
    }
  });
}

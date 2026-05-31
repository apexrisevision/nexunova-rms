// ══ UTILS ═════════════════════════════════════
const td=()=>new Date().toISOString().slice(0,10);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const ini=n=>(n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
const pct=(p,t)=>t?Math.min(100,Math.round(p/t*100)):0;

// Pakistani number formatting — lakh/crore digit grouping (1,00,000 / 1,00,00,000).
// NOTE: use 'en-IN' for the grouping. 'en-PK' (and 'en-US') produce WESTERN
// grouping (1,000,000) in Node/browser ICU — verified — so it is NOT correct here.
const _PK_LOCALE = 'en-IN';
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
// fLakhCr — compact lakh/crore for DASHBOARD KPI CARDS ONLY (do not use elsewhere;
// it loses precision). ≥1 crore → "1.20 Cr", ≥1 lakh → "12.50 L", else grouped.
// Returns the number + suffix with NO currency prefix (callers add their own PKR).
function fLakhCr(n){
  if(!n&&n!==0)return '—';
  const v=Number(n), a=Math.abs(v);
  if(a>=1e7) return (v/1e7).toLocaleString(_PK_LOCALE,{minimumFractionDigits:2,maximumFractionDigits:2})+' Cr';
  if(a>=1e5) return (v/1e5).toLocaleString(_PK_LOCALE,{minimumFractionDigits:2,maximumFractionDigits:2})+' L';
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

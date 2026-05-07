// ══ UTILS ═════════════════════════════════════
const td=()=>new Date().toISOString().slice(0,10);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const ini=n=>(n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
const pct=(p,t)=>t?Math.min(100,Math.round(p/t*100)):0;

function fM(n){
  if(!n&&n!==0)return '—';
  const neg=n<0,v=Math.abs(Number(n));
  let s;
  if(v>=10000000)s=(v/10000000).toFixed(2)+' Cr';
  else if(v>=100000)s=(v/100000).toFixed(2)+' L';
  else s=v.toLocaleString('en-PK');
  return (neg?'-':'')+s;
}
function fMF(n){if(!n&&n!==0)return '—';return 'PKR '+Number(n).toLocaleString('en-PK');}
function fD(d){if(!d)return '—';try{return new Date(d+'T00:00:00').toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'});}catch{return d;}}

function sbadge(st){
  const m={Available:['ba','🟢 Available'],Installment:['bi','📅 Installment'],Adjustment:['bj','⚖ Adjustment'],CashSale:['bc','💵 Cash Sale'],Dead:['bd','⛔ Dead'],Sold:['bi','✅ Sold']};
  const[c,l]=m[st]||['bd',st];
  return `<span class="badge ${c}"><span class="b-dot"></span>${l}</span>`;
}
function cbadge(s){
  const m={NoResponse:['bnr','📵 No Response'],Interested:['bin','👍 Interested'],WillPay:['bwp','✅ Will Pay'],NotInterested:['bni','❌ Not Interested'],Dispute:['bdi','⚠ Dispute']};
  const[c,l]=m[s]||['bnr',s];
  return `<span class="badge ${c}">${l}</span>`;
}
function ctic(t){return{Call:'📞',WhatsApp:'💬',Meeting:'🤝'}[t]||'📋';}
function pbadge(t){const m={Cash:'<span class="badge bwp">💵 Cash</span>',Bank:'<span class="badge bin">🏦 Bank</span>',Adjustment:'<span class="badge bj">⚖ Adj</span>'};return m[t]||`<span class="badge bd">${t}</span>`;}
function gunm(id){return gdb().users.find(u=>u.id===id)?.name||'—';}
// Task 6A: XSS escape helper
function esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// Task 6C: Get configurable overdue days
function getOverdueDays(){return gdb().settings?.overdueDays||30;}


// ══ SEARCH PAGE ══════════════════════════════════
function rSearch(){
  document.getElementById('pg-search').innerHTML=`<div class="ani">
    <div class="sh"><h2>Find a Unit</h2><p>Type unit number, client name, booking number, or phone</p><input class="sbig" id="main-s" placeholder="e.g. UG 5, Zahid Khan, Booking 225..." oninput="doSearch(this.value)"></div>
    <div id="sr-ct" class="sr"></div>
  </div>`;
  setTimeout(()=>{const el=document.getElementById('main-s');if(el)el.focus();},80);
}
function doSearch(q){
  const el=document.getElementById('sr-ct');if(!el)return;
  if(!q){el.innerHTML='';return;}
  const ql=q.toLowerCase();
  const units=gunits().filter(u=>u.unitNo.toLowerCase().includes(ql)||(u.customerName||'').toLowerCase().includes(ql)||(u.bookingNo||'').toLowerCase().includes(ql)||(u.phone||'').includes(ql)||(u.soldBy||'').toLowerCase().includes(ql));
  if(!units.length){el.innerHTML=`<div class="card"><div class="empty"><div class="ei">🔍</div><div class="et">No results for "${q}"</div></div></div>`;return;}
  el.innerHTML=`<div class="ul">`+units.map(u=>{
    const rem=Number(u.pendingAmount||0),paid=Number(u.totalPaid||0),p2=pct(paid,u.totalPrice);
    const cons=gcons(u.id);const lc=cons.sort((a,b)=>b.at.localeCompare(a.at))[0];
    return `<div class="ur" onclick="openUD('${u.id}')">
      <div class="ur-no">${u.unitNo}</div>
      <div style="flex-shrink:0">${sbadge(u.status)}</div>
      <div class="ur-meta">
        <div class="ur-name">${u.customerName||'<span style="color:var(--t3)">Available</span>'}</div>
        <div class="ur-sub">${u.floorLabel||u.floor} · ${u.type} · ${u.area} sqft${u.bookingNo?' · Bk#'+u.bookingNo:''}${u.phone?' · '+u.phone:''}${lc?' · Last contact: '+fD(lc.date):''}</div>
      </div>
      ${u.totalPrice>0?`<div class="ur-bal"><div class="ur-v" style="color:${rem>0?'var(--err)':'var(--ok)'}">${fM(rem>0?rem:paid)}</div><div class="ur-vs">${rem>0?'pending':'paid'}</div></div>`:''}
      <div class="arr">›</div>
    </div>`;
  }).join('')+`</div>`;
}


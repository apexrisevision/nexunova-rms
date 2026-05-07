// ══ UNITS PAGE ══════════════════════════════════
function rUnits(){
  const units=gunits();
  const cts={All:units.length};
  ['Available','Installment','Adjustment','CashSale','Dead'].forEach(s=>{cts[s]=units.filter(u=>u.status===s).length;});
  const isA=S.role==='admin';
  document.getElementById('pg-units').innerHTML=`<div class="ani">
    <div class="ph"><div class="ph-l"><h2>All Units</h2><p>${units.length} units · ${cts.Available} available · ${units.length-cts.Available} sold</p></div><div class="ph-r">${isA?'<button class="btn btn-g btn-sm" onclick="openUnitModal(null)">+ Add Unit</button>':''}</div></div>
    <div class="ft">${[['All','All'],['Available','Available'],['Installment','Installment'],['Adjustment','Adjustment'],['CashSale','Cash Sale'],['Dead','Dead']].map(([s,l])=>`<button class="ftb${_uf===s?' on':''}" onclick="setUF('${s}')">${l}<span class="ftb-n">${cts[s]||0}</span></button>`).join('')}</div>
    <div class="sbar"><span class="sbar-ic">🔍</span><input class="sinp" id="u-s" placeholder="Search by unit no, client name, booking no, phone..." value="${_us}" oninput="setUS(this.value)"></div>
    <div id="ul-ct"></div>
  </div>`;
  rULF();
}
function setUF(s){_uf=s;rUnits();}
function setUS(q){_us=q;rULF();}
function rULF(){
  let units=gunits();
  if(_uf!=='All')units=units.filter(u=>u.status===_uf);
  if(_us){const q=_us.toLowerCase();units=units.filter(u=>u.unitNo.toLowerCase().includes(q)||(u.customerName||'').toLowerCase().includes(q)||(u.bookingNo||'').toLowerCase().includes(q)||(u.phone||'').includes(q));}
  const ct=document.getElementById('ul-ct');if(!ct)return;
  if(!units.length){ct.innerHTML=`<div class="card"><div class="empty"><div class="ei">🏢</div><div class="et">No units found</div></div></div>`;return;}
  ct.innerHTML=`<div class="ul">`+units.map(u=>{
    const paid=actualPaid(u),rem=actualPending(u),p2=pct(paid,u.totalPrice);
    return `<div class="ur" onclick="openUD('${u.id}')">
      <div class="ur-no">${u.unitNo}</div>
      <div style="flex-shrink:0">${sbadge(u.status)}</div>
      <div class="ur-meta"><div class="ur-name">${u.customerName||'<span style="color:var(--t3)">Available</span>'}</div><div class="ur-sub">${u.floorLabel||u.floor} · ${u.type} · ${u.area} sqft${u.soldBy?' · '+u.soldBy:''}</div></div>
      ${u.totalPrice>0?`<div style="flex-shrink:0;width:68px"><div class="pbar"><div class="pbar-f" style="width:${p2}%"></div></div><div style="font-size:9px;color:var(--t3);margin-top:2px">${p2}% paid</div></div><div class="ur-bal"><div class="ur-v" style="color:${rem>0?'var(--err)':'var(--ok)'}">${fM(rem>0?rem:paid)}</div><div class="ur-vs">${rem>0?'pending':'paid'}</div></div>`:`<div class="ur-bal"><div class="ur-v c-m">—</div></div>`}
      <div class="arr">›</div>
    </div>`;
  }).join('')+`</div>`;
}

// ══ UNIT DETAIL ══════════════════════════════════
function rUD(unitId){
  if(!unitId){nav('units');return;}
  const u=gunit(unitId);if(!u){nav('units');return;}
  const recs=grecs(unitId).sort((a,b)=>b.date.localeCompare(a.date));
  const cons=gcons(unitId).sort((a,b)=>b.at.localeCompare(a.at));
  const totalPaid=actualPaid(u);
  const rem=actualPending(u);
  const p2=pct(totalPaid,u.totalPrice);
  const recSum=srecs(unitId);
  const isSold=u.status!=='Available'&&u.status!=='Dead';
  const isA=S.role==='admin';

  document.getElementById('pg-unitdetail').innerHTML=`<div class="ani">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px" class="no-p">
      <button class="bk" onclick="nav('units')">← Back</button>
      <button class="btn btn-gh btn-sm" onclick="printUD('${unitId}')">🖨 Print</button>
    </div>
    <div class="card mb14">
      <div class="cb">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">
              <h2 style="font-size:26px;font-weight:700;font-family:var(--mono),monospace">${u.unitNo}</h2>
              ${sbadge(u.status)}
            </div>
            <div style="font-size:12px;color:var(--t3)">${u.floorLabel||u.floor} · ${u.type} · ${u.area} sqft${u.bookingNo?' · Booking #'+u.bookingNo:''}</div>
          </div>
          <div style="display:flex;gap:7px;flex-wrap:wrap" class="no-p">
            ${u.status==='Available'&&isA?`<button class="btn btn-g btn-sm" onclick="openSellModal('${unitId}')">🏷 Mark Sold</button>`:''}
            ${isSold?`<button class="btn btn-gr btn-sm" onclick="openRecModal('${unitId}')">💰 Add Payment</button>`:''}
            ${isSold?`<button class="btn btn-d btn-sm" onclick="openConModal('${unitId}')">📞 Log Call</button>`:''}
            ${isSold&&u.phone?`<button class="btn btn-gh btn-sm" onclick="showWATemplates('${unitId}')">💬 WhatsApp</button>`:''}
            ${isSold?`<button class="btn btn-gh btn-sm" onclick="printClientStatement('${esc(u.customerName)}')">📄 Statement</button>`:''}
            ${isA&&isSold?`<button class="btn btn-gh btn-sm" onclick="openSellModal('${unitId}')">✏ Edit</button>`:''}
          </div>
        </div>
      </div>
    </div>
    <div class="ud">
      <div style="display:flex;flex-direction:column;gap:13px">
        ${isSold?`<div class="card"><div class="ch"><h3>👤 Client Info</h3></div><div class="cb">
          <div class="ir"><span class="ir-l">Name</span><span class="ir-r">${esc(u.customerName)||'—'}</span></div>
          <div class="ir"><span class="ir-l">Phone</span><span class="ir-r">${u.phone?`<a href="tel:+92${u.phone.replace(/^0/,'').replace(/[^0-9]/g,'')}" style="color:var(--info);text-decoration:none">${esc(u.phone)}</a> <a href="https://wa.me/92${u.phone.replace(/^0/,'').replace(/[^0-9]/g,'')}" target="_blank" title="Open WhatsApp" style="margin-left:4px;text-decoration:none">💬</a>`:'—'}</span></div>
          <div class="ir"><span class="ir-l">Booking #</span><span class="ir-r">${esc(u.bookingNo)||'—'}</span></div>
          <div class="ir"><span class="ir-l">Sold By</span><span class="ir-r">${esc(u.soldBy)||'—'}</span></div>
          <div class="ir"><span class="ir-l">Remarks</span><span class="ir-r" style="font-size:11px">${esc(u.remarks)||'—'}</span></div>
        </div></div>`:''}
        ${isSold?`<div class="card"><div class="ch"><h3>💵 Financial</h3></div><div class="cb">
          <div class="ir"><span class="ir-l">Total Price</span><span class="ir-r">${fMF(u.totalPrice)}</span></div>
          <div class="ir"><span class="ir-l">Base Paid</span><span class="ir-r">${fMF(u.totalPaid)}</span></div>
          ${recSum>0?`<div class="ir"><span class="ir-l">Recovery Added</span><span class="ir-r c-g">+${fMF(recSum)}</span></div>`:''}
          <div class="ir"><span class="ir-l">Total Paid</span><span class="ir-r c-g" style="font-weight:700">${fMF(totalPaid)}</span></div>
          <div class="ir"><span class="ir-l">Pending</span><span class="ir-r" style="color:${rem>0?'var(--err)':'var(--ok)'};font-weight:${rem===0?'700':'500'}">${rem===0?'✅ Fully Paid':fMF(rem)}</span></div>
          <div class="ir"><span class="ir-l">Recovery %</span><span class="ir-r">${p2}%</span></div>
          <div style="margin-top:10px"><div class="pbar" style="width:100%;height:7px"><div class="pbar-f" style="width:${p2}%"></div></div></div>
          ${u.lastPaymentDate?`<div style="font-size:11px;color:var(--t3);margin-top:8px">Last payment: ${fD(u.lastPaymentDate)}</div>`:''}
        </div></div>`:''}
      </div>
      <div style="display:flex;flex-direction:column;gap:13px">
        <div class="card">
          <div class="ch"><div><h3>📞 Contact History</h3><p>${cons.length} contacts logged</p></div>${isSold?`<button class="btn btn-d btn-sm no-p" onclick="openConModal('${unitId}')">+ Add</button>`:''}</div>
          ${!cons.length?'<div class="empty"><div class="ei">📞</div><div class="et">No contacts yet</div><div class="es">Log a call or meeting</div></div>':
            '<div class="tw" style="max-height:360px;overflow-y:auto"><table class="t"><thead><tr><th>Date</th><th>Type</th><th>Response</th><th>Notes / What Client Said</th><th>Follow-up</th><th>By</th></tr></thead><tbody>'+
            cons.map(function(c){
              var fuOv=c.fu&&c.fu<td()&&c.fu!==td();
              var fuTdy=c.fu&&c.fu===td();
              var clr=c.status==='WillPay'?'var(--ok)':c.status==='Dispute'?'var(--err)':c.status==='NoResponse'?'#CBD5E1':'var(--info)';
              return '<tr style="border-left:3px solid '+clr+'">'+
                '<td style="white-space:nowrap;font-weight:600">'+fD(c.date)+'</td>'+
                '<td style="white-space:nowrap">'+ctic(c.type)+' '+c.type+'</td>'+
                '<td style="white-space:nowrap">'+cbadge(c.status)+'</td>'+
                '<td style="font-size:12px;color:var(--t2);max-width:220px;word-break:break-word">'+(c.notes?esc(c.notes):'<span style="color:var(--t4);font-style:italic">No notes</span>')+'</td>'+
                '<td style="font-size:11px;color:'+(fuOv?'var(--err)':fuTdy?'var(--warn)':'var(--t3)')+';font-weight:'+(fuOv||fuTdy?700:400)+';white-space:nowrap">'+(c.fu?fD(c.fu)+(fuOv?' ⚠':fuTdy?' 📅':''):'—')+'</td>'+
                '<td style="font-size:11px;color:var(--t3)">'+gunm(c.by)+'</td>'+
              '</tr>';
            }).join('')+
            '</tbody></table></div>'
          }
        </div>
        ${isSold?`<div class="card">
          <div class="ch"><div><h3>💰 Payment History</h3><p>${recs.length} payment(s) recorded · Total: ${fM(recSum)}</p></div><button class="btn btn-gr btn-sm no-p" onclick="openRecModal('${unitId}')">+ Add</button></div>
          ${!recs.length?`<div class="empty"><div class="ei">💰</div><div class="et">No recovery payments yet</div><div class="es">Base pending from import: ${fMF(Math.max(0,u.totalPrice-u.totalPaid))}</div></div>`:
            `<div class="tw"><table class="t"><thead><tr><th>Date</th><th>Type</th><th>Receipt</th><th>Notes</th><th class="r">Amount</th>${isA?'<th></th>':''}</tr></thead><tbody>
            ${recs.map(r=>`<tr><td>${fD(r.date)}</td><td>${pbadge(r.ptype)}</td><td style="font-size:11px;color:var(--t3)">${r.rcpt||'—'}</td><td style="font-size:11px;color:var(--t3);max-width:120px">${r.notes||'—'}</td><td class="r mono c-g">+${fM(r.amt)}</td><td><button class="btn btn-gh btn-xs" onclick="printPaymentReceipt('${r.id}')">🧾</button>${isA?`<button class="btn btn-r btn-xs" style="margin-left:3px" onclick="delRec('${r.id}')">Del</button>`:''}</td></tr>`).join('')}
            </tbody></table></div>`
          }
        </div>`:''}
      </div>
    </div>
  </div>`;
}

function printUD(unitId){
  const u=gunit(unitId);
  const recs=grecs(unitId).sort((a,b)=>b.date.localeCompare(a.date));
  const cons=gcons(unitId).sort((a,b)=>b.at.localeCompare(a.at));
  const totalPaid=actualPaid(u);
  const rem=actualPending(u);
  const p2=pct(totalPaid,u.totalPrice);
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Unit ${u.unitNo} — Nexunova RMS</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:13px;color:#111;padding:28px;max-width:720px;margin:0 auto}
    h1{font-size:24px;margin-bottom:4px}
    h3{font-size:14px;border-bottom:2px solid #C9A84C;padding-bottom:5px;margin:20px 0 10px;color:var(--ink)}
    .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0}
    .lbl{color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
    .val{font-weight:600;text-align:right}
    table{width:100%;border-collapse:collapse;margin-top:6px}
    th{background:#f5f5f5;padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#666;border-bottom:2px solid #ddd}
    td{padding:7px 10px;border-bottom:1px solid #f0f0f0;font-size:12px}
    .hdr{background:var(--ink);color:white;padding:18px 22px;border-radius:var(--rm);margin-bottom:20px}
    .hdr h1{color:white;margin:0 0 4px}
    .hdr p{color:#C9A84C;font-size:11px;margin:0;letter-spacing:1px;text-transform:uppercase}
    @media print{body{padding:0}}
  </style></head><body>
  <div class="hdr"><h1>Unit ${u.unitNo}</h1><p>Nexunova RMS · Printed ${new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'})}</p></div>
  <h3>Unit Information</h3>
  <div class="row"><span class="lbl">Unit No</span><span class="val">${u.unitNo}</span></div>
  <div class="row"><span class="lbl">Floor</span><span class="val">${u.floorLabel||u.floor}</span></div>
  <div class="row"><span class="lbl">Type</span><span class="val">${u.type}</span></div>
  <div class="row"><span class="lbl">Area</span><span class="val">${u.area} sqft</span></div>
  <div class="row"><span class="lbl">Status</span><span class="val">${u.status}</span></div>
  <div class="row"><span class="lbl">Booking #</span><span class="val">${u.bookingNo||'—'}</span></div>
  ${u.customerName?`<h3>Client Information</h3>
  <div class="row"><span class="lbl">Name</span><span class="val">${u.customerName}</span></div>
  <div class="row"><span class="lbl">Phone</span><span class="val">${u.phone||'—'}</span></div>
  <div class="row"><span class="lbl">Sold By</span><span class="val">${u.soldBy||'—'}</span></div>
  <div class="row"><span class="lbl">Remarks</span><span class="val">${u.remarks||'—'}</span></div>`:''}
  ${u.totalPrice?`<h3>Financial Summary</h3>
  <div class="row"><span class="lbl">Total Price</span><span class="val">PKR ${Number(u.totalPrice).toLocaleString('en-PK')}</span></div>
  <div class="row"><span class="lbl">Amount Paid</span><span class="val" style="color:green">PKR ${Number(totalPaid).toLocaleString('en-PK')}</span></div>
  <div class="row"><span class="lbl">Pending</span><span class="val" style="color:${rem>0?'#c00':'green'}">PKR ${Number(rem).toLocaleString('en-PK')}</span></div>
  <div class="row"><span class="lbl">Recovery %</span><span class="val">${p2}%</span></div>`:''}
  ${cons.length?`<h3>Contact History (${cons.length} logs)</h3>
  <table><thead><tr><th>Date</th><th>Type</th><th>Response</th><th>Notes</th><th>Follow-up</th></tr></thead><tbody>
  ${cons.map(c=>`<tr><td>${fD(c.date)}</td><td>${c.type}</td><td>${c.status}</td><td>${c.notes||'—'}</td><td>${c.fu?fD(c.fu):'—'}</td></tr>`).join('')}
  </tbody></table>`:''}
  ${recs.length?`<h3>Extra Payments (${recs.length})</h3>
  <table><thead><tr><th>Date</th><th>Type</th><th>Receipt</th><th style="text-align:right">Amount</th></tr></thead><tbody>
  ${recs.map(r=>`<tr><td>${fD(r.date)}</td><td>${r.ptype}</td><td>${r.rcpt||'—'}</td><td style="text-align:right;font-weight:600">PKR ${Number(r.amt).toLocaleString('en-PK')}</td></tr>`).join('')}
  </tbody></table>`:''}
  </body></html>`);w.document.close();setTimeout(()=>w.print(),250);w.onafterprint=()=>w.close();
}


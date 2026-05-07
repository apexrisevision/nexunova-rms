
// ── PRINT CLIENT STATEMENT ──
function printClientStatement(clientName){
  var units=gunits().filter(function(u){return u.customerName===clientName;});
  if(!units.length){toast('No units found for this client','warn');return;}
  var allRecs=[],allCons=[];
  units.forEach(function(u){allRecs=allRecs.concat(grecs(u.id));allCons=allCons.concat(gcons(u.id));});
  allRecs.sort(function(a,b){return b.date.localeCompare(a.date);});
  allCons.sort(function(a,b){return b.date.localeCompare(a.date);});
  var totPrice=units.reduce(function(s,u){return s+Number(u.totalPrice||0);},0);
  var totPaid=units.reduce(function(s,u){return s+actualPaid(u);},0);
  var totPend=units.reduce(function(s,u){return s+actualPending(u);},0);
  var w=window.open('','_blank','width=900,height=700');
  if(!w){toast('Allow pop-ups for this site','warn');return;}
  var h='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Statement - '+clientName+'</title>';
  h+='<style>body{font-family:Arial,sans-serif;font-size:11px;padding:20px;color:#111}';
  h+='.hdr{background:var(--ink);color:white;padding:14px 18px;border-radius:var(--rs);margin-bottom:12px}h1{color:white;font-size:18px;margin:0 0 2px}.gold{color:#C9A84C;font-size:10px;text-transform:uppercase;letter-spacing:1px}';
  h+='.sum{display:flex;gap:16px;flex-wrap:wrap;padding:10px 14px;background:#f5f7fa;border:1px solid #dde;border-radius:4px;margin-bottom:12px;font-size:10px}';
  h+='.sum-item{display:flex;flex-direction:column;gap:2px}.sum-item b{font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888}';
  h+='table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:10px}th{background:var(--ink);color:white;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact}';
  h+='td{padding:5px 8px;border-bottom:1px solid #eee}tr:nth-child(even) td{background:#f9fafb}';
  h+='h3{font-size:12px;border-bottom:2px solid #C9A84C;padding-bottom:4px;margin:14px 0 8px;color:var(--ink)}';
  h+='@media print{@page{margin:1cm;size:A4}}';
  h+='</style></head><body>';
  h+='<div class="hdr"><h1>Account Statement</h1><div class="gold">'+clientName+' — Nexunova RMS — '+new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'})+'</div></div>';
  h+='<div class="sum">';
  h+='<div class="sum-item"><b>Client</b>'+clientName+'</div>';
  h+='<div class="sum-item"><b>Phone</b>'+(units[0].phone||'—')+'</div>';
  h+='<div class="sum-item"><b>Units</b>'+units.length+'</div>';
  h+='<div class="sum-item"><b>Total Portfolio</b>PKR '+totPrice.toLocaleString('en-PK')+'</div>';
  h+='<div class="sum-item"><b>Total Paid</b><span style="color:green">PKR '+totPaid.toLocaleString('en-PK')+'</span></div>';
  h+='<div class="sum-item"><b>Balance Pending</b><span style="color:'+(totPend>0?'red':'green')+'">PKR '+totPend.toLocaleString('en-PK')+'</span></div>';
  h+='</div>';
  h+='<h3>Units & Financial Summary</h3>';
  h+='<table><thead><tr><th>Unit No</th><th>Floor</th><th>Type</th><th>Sale Type</th><th>Total Price</th><th>Amount Paid</th><th>Balance</th><th>Recovery %</th><th>Sold By</th></tr></thead><tbody>';
  units.forEach(function(u){var pd=actualPaid(u);var rm=actualPending(u);var p2=u.totalPrice?Math.round(pd/u.totalPrice*100):0;h+='<tr><td>'+u.unitNo+'</td><td>'+u.floorLabel+'</td><td>'+u.type+'</td><td>'+u.status+'</td><td>PKR '+Number(u.totalPrice).toLocaleString('en-PK')+'</td><td style="color:green">PKR '+pd.toLocaleString('en-PK')+'</td><td style="color:'+(rm>0?'red':'green')+'">PKR '+rm.toLocaleString('en-PK')+'</td><td>'+p2+'%</td><td>'+esc(u.soldBy||'—')+'</td></tr>';});
  h+='</tbody></table>';
  if(allRecs.length){
    h+='<h3>Payment History ('+allRecs.length+' payments)</h3>';
    h+='<table><thead><tr><th>Date</th><th>Unit</th><th>Amount</th><th>Type</th><th>Receipt No</th><th>Notes</th><th>Recorded By</th></tr></thead><tbody>';
    allRecs.forEach(function(r){var u=gunit(r.uid);h+='<tr><td>'+fD(r.date)+'</td><td>'+esc(u?u.unitNo:'?')+'</td><td style="font-weight:700">PKR '+Number(r.amt).toLocaleString('en-PK')+'</td><td>'+r.ptype+'</td><td>'+(r.rcpt||'—')+'</td><td>'+(r.notes||'—')+'</td><td>'+gunm(r.by)+'</td></tr>';});
    h+='</tbody></table>';
  }
  if(allCons.length){
    h+='<h3>Contact History ('+allCons.length+' logs)</h3>';
    h+='<table><thead><tr><th>Date</th><th>Unit</th><th>Type</th><th>Response</th><th>Notes</th><th>Follow-up</th><th>By</th></tr></thead><tbody>';
    allCons.forEach(function(c){var u=gunit(c.uid);h+='<tr><td>'+fD(c.date)+'</td><td>'+esc(u?u.unitNo:'?')+'</td><td>'+c.type+'</td><td>'+c.status+'</td><td>'+(c.notes||'—')+'</td><td>'+(c.fu?fD(c.fu):'—')+'</td><td>'+gunm(c.by)+'</td></tr>';});
    h+='</tbody></table>';
  }
  h+='</body></html>';
  w.document.write(h);w.document.close();
  setTimeout(function(){w.print();},400);
  w.onafterprint=function(){w.close();};
}

function printUnitStatement(unitId){
  var u=gunit(unitId);if(!u)return;
  printClientStatement(u.customerName);
}

// ── PAYMENT RECEIPT PRINT ──
function printPaymentReceipt(recId){
  var db=gdb();
  var rec=(db.recoveries[S.cid]||[]).find(function(r){return r.id===recId;});
  if(!rec){toast('Payment not found','err');return;}
  var u=gunit(rec.uid);
  var w=window.open('','_blank','width=600,height=500');
  if(!w){toast('Allow pop-ups','warn');return;}
  var h='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt</title>';
  h+='<style>body{font-family:Arial,sans-serif;max-width:520px;margin:30px auto;padding:20px;font-size:12px;color:#111}';
  h+='.hdr{background:var(--ink);color:white;padding:16px 20px;border-radius:var(--rm);margin-bottom:16px;text-align:center}';
  h+='.hdr h1{margin:0;font-size:20px;color:#fff}.hdr p{margin:4px 0 0;color:#C9A84C;font-size:10px;text-transform:uppercase;letter-spacing:1px}';
  h+='.rcpt-no{text-align:center;font-size:24px;font-weight:700;color:var(--ink);margin:10px 0;font-family:monospace}';
  h+='.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f0f0}';
  h+='.lbl{color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.5px}.val{font-weight:700;text-align:right}';
  h+='.amt{text-align:center;background:#f0fdf4;border:2px solid #16a34a;border-radius:var(--rm);padding:16px;margin:14px 0}';
  h+='.amt-v{font-size:28px;font-weight:700;color:#16a34a;font-family:monospace}';
  h+='.footer{text-align:center;font-size:10px;color:#888;margin-top:16px;border-top:1px solid #eee;padding-top:10px}';
  h+='@media print{body{margin:0;padding:10px}@page{size:A5;margin:.5cm}}</style></head><body>';
  h+='<div class="hdr"><h1>Nexunova RMS</h1><p>Official Payment Receipt</p></div>';
  h+='<div class="rcpt-no">Receipt #'+(rec.rcpt||rec.id.toUpperCase().slice(-6))+'</div>';
  h+='<div class="amt"><div style="font-size:11px;color:#16a34a;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Amount Received</div>';
  h+='<div class="amt-v">PKR '+Number(rec.amt).toLocaleString('en-PK')+'</div></div>';
  h+='<div class="row"><span class="lbl">Date</span><span class="val">'+fD(rec.date)+'</span></div>';
  h+='<div class="row"><span class="lbl">Unit No</span><span class="val">'+(u?u.unitNo:'?')+'</span></div>';
  h+='<div class="row"><span class="lbl">Client Name</span><span class="val">'+(u?esc(u.customerName):'—')+'</span></div>';
  h+='<div class="row"><span class="lbl">Floor / Type</span><span class="val">'+(u?(u.floorLabel||u.floor)+' · '+u.type:'—')+'</span></div>';
  h+='<div class="row"><span class="lbl">Payment Type</span><span class="val">'+rec.ptype+'</span></div>';
  h+='<div class="row"><span class="lbl">Notes</span><span class="val" style="max-width:220px;text-align:right">'+(rec.notes||'—')+'</span></div>';
  if(u){h+='<div class="row"><span class="lbl">Balance After Payment</span><span class="val" style="color:'+(actualPending(u)>0?'red':'green')+'">'+(actualPending(u)>0?'PKR '+actualPending(u).toLocaleString('en-PK')+' pending':'✅ Fully Paid')+'</span></div>';}
  h+='<div class="row"><span class="lbl">Recorded By</span><span class="val">'+gunm(rec.by)+'</span></div>';
  h+='<div class="footer">This is a computer-generated receipt. Nexunova RMS<br>Generated: '+new Date().toLocaleString('en-PK')+'</div>';
  h+='</body></html>';
  w.document.write(h);w.document.close();
  setTimeout(function(){w.print();},400);
  w.onafterprint=function(){w.close();};
}

// ── CSV EXPORT ──
function expRpt(){
  const tbl=document.querySelector('#r-ct table');if(!tbl){toast('No report to export','warn');return;}
  const rows=[];tbl.querySelectorAll('tr').forEach(tr=>{const r=[];tr.querySelectorAll('th,td').forEach(td=>r.push(td.innerText.replace(/\n/g,' ').trim()));rows.push(r);});
  const csv=rows.map(r=>r.map(c=>'"'+c.replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));a.download=`Nexunova_${_rt}_${td()}.csv`;a.click();
  toast('Exported to CSV','ok');
}



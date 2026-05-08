// ══ DOCUMENTS & PRINT MODULE ══════════════════

// ── Shared: amount to English words (PKR system) ──
function amtWords(n){
  n=Math.round(Number(n)||0);
  if(!n)return 'Zero';
  var a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  var b=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function w(n){if(n<20)return a[n];if(n<100)return b[Math.floor(n/10)]+(n%10?' '+a[n%10]:'');return a[Math.floor(n/100)]+' Hundred'+(n%100?' and '+w(n%100):'');}
  var s='';
  if(n>=10000000){s+=w(Math.floor(n/10000000))+' Crore ';n%=10000000;}
  if(n>=100000){s+=w(Math.floor(n/100000))+' Lakh ';n%=100000;}
  if(n>=1000){s+=w(Math.floor(n/1000))+' Thousand ';n%=1000;}
  if(n>0)s+=w(n);
  return s.trim()+' Only';
}

// ── Shared: base CSS (ink = #1E2D47, gold = #C9A84C) ──
function _pCSS(sz){
  sz=sz||'A4';
  return 'body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:0;padding:0}'+
    '*{box-sizing:border-box}'+
    '.lh{background:#1E2D47;color:#fff;padding:16px 22px;display:flex;justify-content:space-between;align-items:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.lh-l h1{margin:0;font-size:20px;font-weight:700;letter-spacing:.5px}'+
    '.lh-l p{margin:3px 0 0;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#C9A84C}'+
    '.lh-r{text-align:right;font-size:9px;color:rgba(255,255,255,.65);line-height:1.6}'+
    '.gold-bar{height:3px;background:linear-gradient(90deg,#C9A84C,#e8c87a,#C9A84C);-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.body{padding:18px 22px}'+
    '.doc-title{font-size:15px;font-weight:700;color:#1E2D47;border-bottom:2px solid #C9A84C;padding-bottom:6px;margin-bottom:14px;text-transform:uppercase;letter-spacing:.5px}'+
    '.sec-title{font-size:11px;font-weight:700;color:#1E2D47;border-left:3px solid #C9A84C;padding-left:7px;margin:14px 0 7px;text-transform:uppercase;letter-spacing:.5px}'+
    '.info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 16px;background:#f5f7fa;border:1px solid #dde;border-radius:4px;padding:12px 14px;margin-bottom:12px}'+
    '.info-grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 16px}'+
    '.ig-item{display:flex;flex-direction:column;gap:1px}'+
    '.ig-lbl{font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888;font-weight:700}'+
    '.ig-val{font-size:11px;font-weight:600;color:#111}'+
    'table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px}'+
    'th{background:#1E2D47;color:#fff;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.3px;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    'td{padding:5px 8px;border-bottom:1px solid #eee;vertical-align:top}'+
    'tr:nth-child(even) td{background:#f9fafb}'+
    '.amt-box{text-align:center;background:#f0fdf4;border:2px solid #16a34a;border-radius:6px;padding:16px 14px;margin:12px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.amt-box-v{font-size:28px;font-weight:700;color:#16a34a;font-family:monospace;margin:4px 0}'+
    '.amt-box-w{font-size:10px;color:#166534;font-style:italic;margin-top:4px}'+
    '.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0}'+
    '.lbl{color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.5px}'+
    '.val{font-weight:700;text-align:right}'+
    '.sig-row{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:28px}'+
    '.sig-box{border-top:1.5px solid #1E2D47;padding-top:6px}'+
    '.sig-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#555}'+
    '.sig-name{font-size:11px;font-weight:700;color:#1E2D47;margin-top:2px}'+
    '.footer-bar{border-top:1px solid #dde;margin-top:16px;padding-top:8px;text-align:center;font-size:9px;color:#999}'+
    '.badge{padding:2px 8px;border-radius:99px;font-size:9px;font-weight:700}'+
    '.badge-ok{background:#dcfce7;color:#16a34a}'+
    '.badge-warn{background:#fef9c3;color:#854d0e}'+
    '.badge-err{background:#fee2e2;color:#b91c1c}'+
    '.badge-info{background:#dbeafe;color:#1e40af}'+
    '.overdue-box{background:#fff7ed;border:1.5px solid #f97316;border-radius:4px;padding:12px 14px;margin:10px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.terms ol{margin:6px 0;padding-left:18px;line-height:1.7;font-size:10px;color:#333}'+
    '.terms li{margin-bottom:2px}'+
    '.no-break{page-break-inside:avoid}'+
    '@media print{@page{size:'+sz+';margin:1cm}.no-print{display:none}}';
}

// ── Shared: letterhead HTML ──
function _lh(docType){
  var co=S?S.coName||'Nexunova':'Nexunova';
  var logo=typeof getCoLogo==='function'?getCoLogo():null;
  var dt=new Date().toLocaleDateString('en-PK',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  var leftContent=logo
    ?'<img src="'+logo+'" style="height:52px;max-width:150px;object-fit:contain;background:transparent;display:block;margin-bottom:4px" alt="'+esc(co)+'">'
    +'<p style="margin:0;font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#C9A84C">'+esc(co)+'</p>'
    :'<h1 style="margin:0 0 2px;font-size:19px;font-weight:700">'+esc(co)+'</h1>'
    +'<p style="margin:0;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#C9A84C">Nexunova Recovery Management System</p>';
  return '<div class="lh">'+
    '<div class="lh-l">'+leftContent+'</div>'+
    '<div class="lh-r">'+esc(docType)+'<br>'+dt+'<br>Generated by: '+esc(S?S.name||'System':'System')+'</div>'+
  '</div><div class="gold-bar"></div>';
}

// ── Shared: open print window ──
function _pw(title,css,sz){
  var w=window.open('','_blank','width=820,height=900');
  if(!w){toast('Allow pop-ups for print documents','warn');return null;}
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+title+'</title><style>'+css+'</style></head><body>');
  return w;
}
function _pclose(w){
  w.document.write('</body></html>');
  w.document.close();
  setTimeout(function(){w.print();},400);
  w.onafterprint=function(){w.close();};
}

// ══ 1. PAYMENT RECEIPT ═══════════════════════════
function printReceipt(recId){
  var db=gdb();
  var rec=(db.recoveries[S.cid]||[]).find(function(r){return r.id===recId;});
  if(!rec){toast('Payment record not found','err');return;}
  var u=gunit(rec.uid);
  var amt=Number(rec.amt||0);
  var pending=u?actualPending(u):0;
  var rcptNo=rec.rcpt||('R-'+rec.id.toUpperCase().slice(-6));
  var w=_pw('Receipt '+rcptNo,_pCSS('A5'),'A5');
  if(!w)return;

  var h=_lh('PAYMENT RECEIPT');
  h+='<div class="body">';
  h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
  h+='<div class="doc-title" style="border:none;margin:0;padding:0">Payment Receipt</div>';
  h+='<div style="text-align:right"><div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.5px">Receipt No</div>';
  h+='<div style="font-size:16px;font-weight:700;color:#1E2D47;font-family:monospace">'+esc(rcptNo)+'</div></div></div>';

  h+='<div class="amt-box">';
  h+='<div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#166534;font-weight:700">Amount Received</div>';
  h+='<div class="amt-box-v">PKR '+amt.toLocaleString('en-PK')+'</div>';
  h+='<div class="amt-box-w">'+amtWords(amt)+'</div>';
  h+='</div>';

  h+='<div class="row"><span class="lbl">Date</span><span class="val">'+fD(rec.date)+'</span></div>';
  h+='<div class="row"><span class="lbl">Unit No</span><span class="val">'+(u?esc(u.unitNo):'—')+'</span></div>';
  h+='<div class="row"><span class="lbl">Client Name</span><span class="val">'+(u?esc(u.customerName):'—')+'</span></div>';
  if(u)h+='<div class="row"><span class="lbl">Floor / Type</span><span class="val">'+esc((u.floorLabel||u.floor)+' · '+u.type)+'</span></div>';
  h+='<div class="row"><span class="lbl">Payment Type</span><span class="val">'+esc(rec.ptype||'—')+'</span></div>';
  if(rec.notes)h+='<div class="row"><span class="lbl">Notes</span><span class="val" style="max-width:220px;text-align:right">'+esc(rec.notes)+'</span></div>';
  h+='<div class="row"><span class="lbl">Recorded By</span><span class="val">'+esc(gunm(rec.by))+'</span></div>';
  if(u){
    h+='<div class="row" style="margin-top:4px"><span class="lbl">Balance After Payment</span>';
    h+=pending>0
      ?'<span class="val" style="color:#dc2626">PKR '+pending.toLocaleString('en-PK')+' pending</span>'
      :'<span class="val" style="color:#16a34a">&#10003; Fully Paid</span>';
    h+='</div>';
  }
  if(u&&u.totalPrice){
    var pct=Math.round(actualPaid(u)/u.totalPrice*100);
    h+='<div style="margin-top:10px;background:#f5f7fa;border-radius:4px;padding:8px 12px;font-size:10px">';
    h+='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:#555">Total Price</span><span style="font-weight:700">PKR '+Number(u.totalPrice).toLocaleString('en-PK')+'</span></div>';
    h+='<div style="height:6px;background:#e5e7eb;border-radius:99px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:#16a34a;-webkit-print-color-adjust:exact;print-color-adjust:exact"></div></div>';
    h+='<div style="text-align:right;margin-top:3px;font-size:9px;color:#555">'+pct+'% recovered</div></div>';
  }

  h+='<div class="sig-row no-break">';
  h+='<div class="sig-box"><div style="height:28px"></div><div class="sig-lbl">Client Signature</div><div class="sig-name">'+(u?esc(u.customerName):'___________')+'</div></div>';
  h+='<div class="sig-box"><div style="height:28px"></div><div class="sig-lbl">Authorized Signatory</div><div class="sig-name">'+esc(S?S.coName||'Nexunova':'Nexunova')+'</div></div>';
  h+='</div>';

  h+='<div class="footer-bar">This is a computer-generated receipt. '+esc(S?S.coName||'Nexunova':'Nexunova')+' &mdash; Nexunova RMS &mdash; '+new Date().toLocaleString('en-PK')+'</div>';
  h+='</div>';

  w.document.write(h);
  _pclose(w);
}

// Backward-compat alias
function printPaymentReceipt(recId){printReceipt(recId);}

// ══ 2. SALE AGREEMENT ════════════════════════════
function printSaleAgreement(unitId){
  var u=gunit(unitId);
  if(!u){toast('Unit not found','err');return;}
  if(!u.customerName||u.status==='Available'){toast('Unit has no client — cannot print agreement','warn');return;}
  var recs=grecs(unitId).sort(function(a,b){return a.date.localeCompare(b.date);});
  var db=gdb();
  var prj=u.projectId?(db.projects[S.cid]||[]).find(function(p){return p.id===u.projectId;}):null;
  var agNo='AGR-'+unitId.toUpperCase().slice(-6);
  var today=new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'});
  var w=_pw('Sale Agreement '+agNo,_pCSS('A4'),'A4');
  if(!w)return;

  var h=_lh('SALE AGREEMENT');
  h+='<div class="body">';
  h+='<div style="text-align:center;margin-bottom:14px">';
  h+='<div class="doc-title" style="display:inline-block">Sale Agreement &amp; Booking Confirmation</div>';
  h+='<div style="font-size:10px;color:#666;margin-top:4px">Agreement No: <b>'+agNo+'</b> &nbsp;|&nbsp; Date: <b>'+today+'</b>'+(u.bookingNo?' &nbsp;|&nbsp; Booking #: <b>'+esc(u.bookingNo)+'</b>':'')+'</div>';
  h+='</div>';

  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">';
  h+='<div style="border:1px solid #dde;border-radius:4px;padding:12px">';
  h+='<div class="sec-title" style="margin-top:0">Seller</div>';
  h+='<div style="font-size:11px;line-height:1.7"><b>'+esc(S?S.coName||'Nexunova':'Nexunova')+'</b><br>Nexunova Real Estate &amp; Development<br>Registered Real Estate Developer</div>';
  h+='</div>';
  h+='<div style="border:1px solid #dde;border-radius:4px;padding:12px">';
  h+='<div class="sec-title" style="margin-top:0">Buyer</div>';
  h+='<div style="font-size:11px;line-height:1.7"><b>'+esc(u.customerName)+'</b>'+(u.phone?'<br>Phone: '+esc(u.phone):'')+'</div>';
  h+='</div></div>';

  h+='<div class="sec-title">Property Details</div>';
  h+='<div class="info-grid">';
  var pid=[
    {l:'Unit No',v:u.unitNo},{l:'Floor',v:u.floorLabel||u.floor},
    {l:'Type',v:u.type},{l:'Area',v:u.area?u.area+' Sq. Ft':'—'},
    {l:'Status',v:u.status},{l:'Booking No',v:u.bookingNo||'—'},
    {l:'Project',v:prj?prj.name:'—'},{l:'Sold By',v:u.soldBy||'—'},
    {l:'Sale Date',v:u.soldDate?fD(u.soldDate):today}
  ];
  pid.forEach(function(x){h+='<div class="ig-item"><div class="ig-lbl">'+x.l+'</div><div class="ig-val">'+esc(String(x.v||'—'))+'</div></div>';});
  h+='</div>';

  h+='<div class="sec-title">Financial Summary</div>';
  var paid=actualPaid(u),pend=actualPending(u),pct=u.totalPrice?Math.round(paid/u.totalPrice*100):0;
  h+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">';
  var fins=[
    {l:'Total Sale Price',v:'PKR '+Number(u.totalPrice).toLocaleString('en-PK'),c:'#1E2D47'},
    {l:'Amount Paid',v:'PKR '+paid.toLocaleString('en-PK'),c:'#16a34a'},
    {l:'Balance Pending',v:'PKR '+pend.toLocaleString('en-PK'),c:pend>0?'#dc2626':'#16a34a'},
    {l:'Recovery',v:pct+'%',c:pct>=100?'#16a34a':pct>=50?'#854d0e':'#dc2626'}
  ];
  fins.forEach(function(f){
    h+='<div style="border:1px solid #dde;border-radius:4px;padding:10px;text-align:center">';
    h+='<div style="font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:3px">'+f.l+'</div>';
    h+='<div style="font-size:12px;font-weight:700;color:'+f.c+'">'+f.v+'</div></div>';
  });
  h+='</div>';
  h+='<div style="font-size:10px;color:#555;font-style:italic;margin-bottom:12px">Total Sale Price in words: <b>'+amtWords(Number(u.totalPrice||0))+'</b></div>';

  if(recs.length){
    h+='<div class="sec-title no-break">Payment History ('+recs.length+' payments)</div>';
    h+='<table class="no-break"><thead><tr><th>#</th><th>Date</th><th>Amount</th><th>Type</th><th>Receipt No</th><th>Notes</th></tr></thead><tbody>';
    recs.forEach(function(r,i){
      h+='<tr><td style="color:#888">'+(i+1)+'</td><td>'+fD(r.date)+'</td>';
      h+='<td style="font-weight:700;color:#16a34a">PKR '+Number(r.amt).toLocaleString('en-PK')+'</td>';
      h+='<td>'+esc(r.ptype||'—')+'</td><td style="font-family:monospace;font-size:9px">'+(r.rcpt||'—')+'</td>';
      h+='<td style="color:#666">'+(r.notes?esc(r.notes):'—')+'</td></tr>';
    });
    h+='</tbody></table>';
  }else{
    h+='<div style="background:#fefce8;border:1px solid #fde047;border-radius:4px;padding:8px 12px;font-size:10px;color:#854d0e;margin-bottom:12px">No payments recorded yet.</div>';
  }

  h+='<div class="sec-title no-break">Terms &amp; Conditions</div>';
  h+='<div class="terms"><ol>';
  var terms=[
    'The property described herein is sold on the terms and conditions stated in this agreement, subject to the laws of Pakistan.',
    'The buyer agrees to pay all remaining installments on the dates agreed upon. Late payments may attract a surcharge at the discretion of the seller.',
    'Possession of the property shall be handed over to the buyer upon full payment of the total sale price including all dues.',
    'The seller reserves the right to cancel this booking in case of default in payment for more than 90 days, after issuing a formal demand notice.',
    'All costs related to transfer, documentation, NOC, and registration fees shall be borne by the buyer unless otherwise agreed.',
    'This agreement is subject to the jurisdiction of courts in the city where the property is located.',
    'Both parties confirm that the above-mentioned details are accurate to the best of their knowledge.',
    'Any modifications to this agreement must be made in writing and signed by both parties.'
  ];
  terms.forEach(function(t){h+='<li>'+t+'</li>';});
  h+='</ol></div>';

  h+='<div class="sig-row no-break">';
  h+='<div class="sig-box"><div style="height:36px"></div><div class="sig-lbl">Buyer Signature &amp; Date</div><div class="sig-name">'+esc(u.customerName)+'</div><div style="font-size:9px;color:#888;margin-top:2px">'+(u.phone?esc(u.phone):'')+'</div></div>';
  h+='<div class="sig-box"><div style="height:36px"></div><div class="sig-lbl">Authorized Signatory &amp; Stamp</div><div class="sig-name">'+esc(S?S.coName||'Nexunova':'Nexunova')+'</div><div style="font-size:9px;color:#888;margin-top:2px">Nexunova RMS</div></div>';
  h+='</div>';

  h+='<div class="footer-bar">This is a legally binding document. '+esc(S?S.coName||'Nexunova':'Nexunova')+' &mdash; Nexunova RMS &mdash; Printed: '+new Date().toLocaleString('en-PK')+'</div>';
  h+='</div>';

  w.document.write(h);
  _pclose(w);
}

// ══ 3. CLIENT ACCOUNT STATEMENT ══════════════════
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
  var w=_pw('Statement - '+clientName,_pCSS('A4'),'A4');
  if(!w)return;

  var h=_lh('ACCOUNT STATEMENT');
  h+='<div class="body">';
  h+='<div class="doc-title">Account Statement &mdash; '+esc(clientName)+'</div>';

  h+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">';
  var cards=[
    {l:'Client Name',v:clientName,c:'#1E2D47'},
    {l:'Phone',v:units[0].phone||'—',c:'#1E2D47'},
    {l:'Total Units',v:units.length,c:'#1E2D47'},
    {l:'Total Portfolio',v:'PKR '+totPrice.toLocaleString('en-PK'),c:'#1E2D47'},
    {l:'Amount Paid',v:'PKR '+totPaid.toLocaleString('en-PK'),c:'#16a34a'},
    {l:'Balance Pending',v:'PKR '+totPend.toLocaleString('en-PK'),c:totPend>0?'#dc2626':'#16a34a'}
  ];
  cards.forEach(function(c){
    h+='<div style="border:1px solid #dde;border-radius:4px;padding:10px">';
    h+='<div style="font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888">'+c.l+'</div>';
    h+='<div style="font-size:12px;font-weight:700;color:'+c.c+';margin-top:2px">'+esc(String(c.v))+'</div></div>';
  });
  h+='</div>';

  h+='<div class="sec-title">Units &amp; Financial Summary</div>';
  h+='<table><thead><tr><th>Unit No</th><th>Floor</th><th>Type</th><th>Status</th><th>Total Price</th><th>Paid</th><th>Balance</th><th>Recovery</th><th>Sold By</th></tr></thead><tbody>';
  units.forEach(function(u){
    var pd=actualPaid(u),rm=actualPending(u),p2=u.totalPrice?Math.round(pd/u.totalPrice*100):0;
    h+='<tr>';
    h+='<td style="font-weight:700">'+esc(u.unitNo)+'</td>';
    h+='<td>'+esc(u.floorLabel||u.floor)+'</td>';
    h+='<td>'+esc(u.type)+'</td>';
    h+='<td>'+esc(u.status)+'</td>';
    h+='<td>PKR '+Number(u.totalPrice).toLocaleString('en-PK')+'</td>';
    h+='<td style="color:#16a34a;font-weight:700">PKR '+pd.toLocaleString('en-PK')+'</td>';
    h+='<td style="color:'+(rm>0?'#dc2626':'#16a34a')+';font-weight:700">PKR '+rm.toLocaleString('en-PK')+'</td>';
    h+='<td>'+p2+'%</td>';
    h+='<td style="font-size:10px">'+esc(u.soldBy||'—')+'</td></tr>';
  });
  h+='</tbody></table>';

  if(allRecs.length){
    h+='<div class="sec-title no-break">Payment History ('+allRecs.length+' transactions)</div>';
    h+='<table><thead><tr><th>Date</th><th>Unit</th><th>Amount</th><th>Type</th><th>Receipt No</th><th>Notes</th><th>By</th></tr></thead><tbody>';
    allRecs.forEach(function(r){
      var u=gunit(r.uid);
      h+='<tr><td>'+fD(r.date)+'</td>';
      h+='<td style="font-weight:700">'+esc(u?u.unitNo:'?')+'</td>';
      h+='<td style="font-weight:700;color:#16a34a">PKR '+Number(r.amt).toLocaleString('en-PK')+'</td>';
      h+='<td>'+esc(r.ptype||'—')+'</td>';
      h+='<td style="font-family:monospace;font-size:9px">'+(r.rcpt||'—')+'</td>';
      h+='<td style="color:#666">'+(r.notes?esc(r.notes):'—')+'</td>';
      h+='<td>'+esc(gunm(r.by))+'</td></tr>';
    });
    h+='</tbody></table>';
  }

  if(allCons.length){
    h+='<div class="sec-title no-break">Contact History ('+allCons.length+' logs)</div>';
    h+='<table><thead><tr><th>Date</th><th>Unit</th><th>Type</th><th>Response</th><th>Notes</th><th>Follow-up</th><th>By</th></tr></thead><tbody>';
    allCons.forEach(function(c){
      var u=gunit(c.uid);
      h+='<tr><td>'+fD(c.date)+'</td>';
      h+='<td>'+esc(u?u.unitNo:'?')+'</td>';
      h+='<td>'+esc(c.type||'—')+'</td>';
      h+='<td>'+esc(c.status||'—')+'</td>';
      h+='<td style="color:#666">'+(c.notes?esc(c.notes):'—')+'</td>';
      h+='<td>'+(c.fu?fD(c.fu):'—')+'</td>';
      h+='<td>'+esc(gunm(c.by))+'</td></tr>';
    });
    h+='</tbody></table>';
  }

  h+='<div class="footer-bar">Generated by '+esc(S?S.name||'System':'System')+' &mdash; '+esc(S?S.coName||'Nexunova':'Nexunova')+' &mdash; '+new Date().toLocaleString('en-PK')+'</div>';
  h+='</div>';

  w.document.write(h);
  _pclose(w);
}

function printUnitStatement(unitId){
  var u=gunit(unitId);if(!u)return;
  printClientStatement(u.customerName);
}

// ══ 4. DEMAND LETTER ═════════════════════════════
function printDemandLetter(unitId){
  var u=gunit(unitId);
  if(!u){toast('Unit not found','err');return;}
  if(!u.customerName||u.status==='Available'){toast('Unit has no client','warn');return;}
  var pend=actualPending(u);
  if(pend<=0){toast('No pending balance for this unit','info');return;}
  var paid=actualPaid(u);
  var dsp=daysSincePay(u);
  var recs=grecs(unitId).sort(function(a,b){return b.date.localeCompare(a.date);});
  var lastRec=recs[0]||null;
  var today=new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'});
  var letterNo='DL-'+unitId.toUpperCase().slice(-6)+'-'+Date.now().toString(36).toUpperCase().slice(-4);
  var w=_pw('Demand Letter '+letterNo,_pCSS('A4'),'A4');
  if(!w)return;

  var severity=dsp===null||dsp>60?'critical':dsp>=30?'warning':'ok';
  var h=_lh('DEMAND NOTICE');
  h+='<div class="body">';

  h+='<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">';
  h+='<div><div class="doc-title">Demand Notice &mdash; Outstanding Payment</div>';
  h+='<div style="font-size:10px;color:#666">Ref: <b>'+letterNo+'</b> &nbsp;|&nbsp; Date: <b>'+today+'</b></div></div>';
  h+=(severity==='critical'?'<div class="badge badge-err" style="font-size:11px;padding:5px 12px">CRITICAL OVERDUE</div>':severity==='warning'?'<div class="badge badge-warn" style="font-size:11px;padding:5px 12px">OVERDUE</div>':'');
  h+='</div>';

  h+='<div style="margin-bottom:14px;font-size:11px;line-height:1.8">';
  h+='<div style="font-weight:700;font-size:13px;color:#1E2D47">'+esc(u.customerName)+'</div>';
  if(u.phone)h+='<div style="color:#555">Phone: '+esc(u.phone)+'</div>';
  h+='</div>';

  h+='<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:700;color:#1E2D47;margin-bottom:4px">Subject: Demand for Outstanding Payment — Unit '+esc(u.unitNo)+'</div></div>';

  h+='<div style="font-size:11px;line-height:1.85;color:#222;margin-bottom:14px">';
  h+='Dear <b>'+esc(u.customerName)+'</b>,<br><br>';
  h+='We hope this letter finds you in good health. We are writing on behalf of <b>'+esc(S?S.coName||'Nexunova':'Nexunova')+'</b> regarding your outstanding payment obligations for the property detailed below.<br><br>';
  h+='Despite our previous reminders, we note that a significant balance remains unpaid on your property account. We kindly but firmly request that you arrange immediate settlement of the outstanding dues at your earliest convenience.';
  h+='</div>';

  h+='<div class="overdue-box no-break">';
  h+='<div style="font-size:11px;font-weight:700;color:#c2410c;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">&#9888; Payment Account Summary</div>';
  var od=[
    {l:'Unit No',v:u.unitNo},{l:'Floor / Type',v:(u.floorLabel||u.floor)+' · '+u.type},
    {l:'Booking No',v:u.bookingNo||'—'},{l:'Total Sale Price',v:'PKR '+Number(u.totalPrice||0).toLocaleString('en-PK')},
    {l:'Amount Paid to Date',v:'PKR '+paid.toLocaleString('en-PK')},{l:'Outstanding Balance',v:'PKR '+pend.toLocaleString('en-PK')},
    {l:'Last Payment',v:lastRec?'PKR '+Number(lastRec.amt).toLocaleString('en-PK')+' on '+fD(lastRec.date):'No payment recorded'},
    {l:'Days Since Last Payment',v:dsp===null?'Never paid':dsp+' days'}
  ];
  h+='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:5px 24px;">';
  od.forEach(function(x){
    h+='<div class="row" style="border-bottom:1px solid rgba(0,0,0,.06)">';
    h+='<span class="lbl" style="color:#9a3412">'+x.l+'</span>';
    var isAmt=x.l.includes('Outstanding')||x.l.includes('Sale Price')||x.l.includes('Paid');
    h+='<span class="val" style="'+(x.l.includes('Outstanding')?'color:#dc2626':'')+'">'+esc(String(x.v))+'</span></div>';
  });
  h+='</div></div>';

  h+='<div style="font-size:11px;line-height:1.85;color:#222;margin:14px 0">';
  h+='The outstanding amount of <b style="color:#dc2626">PKR '+pend.toLocaleString('en-PK')+' ('+amtWords(pend)+')</b> is hereby formally demanded.<br><br>';
  h+='You are requested to clear the above outstanding amount within <b>15 days</b> from the date of this notice. Failure to respond or make payment within the stipulated period may result in:<br>';
  h+='<ul style="margin:6px 0;padding-left:20px;line-height:1.8;color:#333">';
  h+='<li>Formal legal proceedings as per applicable laws of Pakistan</li>';
  h+='<li>Cancellation of the booking agreement with forfeiture of previously paid amounts as per the agreement terms</li>';
  h+='<li>Reporting to relevant authorities as required</li>';
  h+='</ul>';
  h+='We sincerely hope it will not come to that, and urge you to contact our Recovery Department immediately to discuss payment arrangements.<br><br>';
  h+='We appreciate your prompt attention to this matter.';
  h+='</div>';

  h+='<div class="sig-row no-break" style="margin-top:24px">';
  h+='<div><div style="font-size:11px;font-weight:700;color:#1E2D47;margin-bottom:2px">Recovery Department</div>';
  h+='<div style="font-size:10px;color:#555">'+esc(S?S.coName||'Nexunova':'Nexunova')+'</div>';
  h+='<div style="font-size:10px;color:#888">Nexunova RMS</div></div>';
  h+='<div class="sig-box"><div style="height:36px"></div><div class="sig-lbl">Authorized Signatory &amp; Stamp</div></div>';
  h+='</div>';

  h+='<div class="footer-bar">Confidential &mdash; '+esc(S?S.coName||'Nexunova':'Nexunova')+' &mdash; Nexunova RMS &mdash; '+new Date().toLocaleString('en-PK')+'</div>';
  h+='</div>';

  w.document.write(h);
  _pclose(w);
}

// ══ 5. UNIT REPORT ═══════════════════════════════
function printUnitReport(unitId){
  var u=gunit(unitId);
  if(!u){toast('Unit not found','err');return;}
  var recs=grecs(unitId).sort(function(a,b){return b.date.localeCompare(a.date);});
  var cons=gcons(unitId).sort(function(a,b){return b.date.localeCompare(a.date);});
  var db=gdb();
  var prj=u.projectId?(db.projects[S.cid]||[]).find(function(p){return p.id===u.projectId;}):null;
  var paid=actualPaid(u),pend=actualPending(u);
  var pct=u.totalPrice?Math.round(paid/u.totalPrice*100):0;
  var rptNo='UR-'+unitId.toUpperCase().slice(-6);
  var w=_pw('Unit Report '+rptNo,_pCSS('A4'),'A4');
  if(!w)return;

  var h=_lh('UNIT REPORT');
  h+='<div class="body">';
  h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">';
  h+='<div class="doc-title" style="margin-bottom:0">Unit Report &mdash; '+esc(u.unitNo)+'</div>';
  h+='<div style="text-align:right;font-size:10px;color:#666">Report No: <b>'+rptNo+'</b></div></div>';

  h+='<div class="sec-title" style="margin-top:0">Unit Information</div>';
  h+='<div class="info-grid">';
  var uinfo=[
    {l:'Unit No',v:u.unitNo},{l:'Floor',v:u.floorLabel||u.floor},{l:'Type',v:u.type},
    {l:'Area',v:u.area?u.area+' Sq. Ft':'—'},{l:'Status',v:u.status},{l:'Booking No',v:u.bookingNo||'—'},
    {l:'Project',v:prj?prj.name:'—'},{l:'Sold By',v:u.soldBy||'—'},{l:'Sale Date',v:u.soldDate?fD(u.soldDate):'—'}
  ];
  uinfo.forEach(function(x){h+='<div class="ig-item"><div class="ig-lbl">'+x.l+'</div><div class="ig-val">'+esc(String(x.v||'—'))+'</div></div>';});
  h+='</div>';

  if(u.customerName){
    h+='<div class="sec-title">Client Information</div>';
    h+='<div class="info-grid-2" style="background:#f5f7fa;border:1px solid #dde;border-radius:4px;padding:12px 14px;margin-bottom:12px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px 16px">';
    var cinfo=[
      {l:'Client Name',v:u.customerName},{l:'Phone',v:u.phone||'—'},
      {l:'Receipt No',v:u.receiptNo||'—'},{l:'Remarks',v:u.remarks||'—'}
    ];
    cinfo.forEach(function(x){h+='<div class="ig-item"><div class="ig-lbl">'+x.l+'</div><div class="ig-val">'+esc(String(x.v||'—'))+'</div></div>';});
    h+='</div>';
  }

  h+='<div class="sec-title">Financial Summary</div>';
  h+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">';
  var fsum=[
    {l:'Total Price',v:'PKR '+Number(u.totalPrice||0).toLocaleString('en-PK'),c:'#1E2D47'},
    {l:'Amount Paid',v:'PKR '+paid.toLocaleString('en-PK'),c:'#16a34a'},
    {l:'Balance Due',v:'PKR '+pend.toLocaleString('en-PK'),c:pend>0?'#dc2626':'#16a34a'},
    {l:'Recovery %',v:pct+'%',c:pct>=100?'#16a34a':pct>=50?'#854d0e':'#dc2626'}
  ];
  fsum.forEach(function(f){
    h+='<div style="border:1px solid #dde;border-radius:4px;padding:10px;text-align:center">';
    h+='<div style="font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:3px">'+f.l+'</div>';
    h+='<div style="font-size:13px;font-weight:700;color:'+f.c+'">'+f.v+'</div></div>';
  });
  h+='</div>';
  h+='<div style="height:8px;background:#e5e7eb;border-radius:99px;overflow:hidden;margin-bottom:3px;-webkit-print-color-adjust:exact;print-color-adjust:exact">';
  h+='<div style="height:100%;width:'+pct+'%;background:'+(pct>=100?'#16a34a':pct>=50?'#f59e0b':'#ef4444')+';-webkit-print-color-adjust:exact;print-color-adjust:exact"></div></div>';
  h+='<div style="font-size:10px;color:#555;margin-bottom:12px">'+pct+'% of total price recovered &mdash; Last payment: '+(u.lastPaymentDate?fD(u.lastPaymentDate):'No payment recorded')+'</div>';

  if(recs.length){
    h+='<div class="sec-title no-break">Payment History ('+recs.length+' payments)</div>';
    h+='<table><thead><tr><th>#</th><th>Date</th><th>Amount</th><th>Type</th><th>Receipt No</th><th>Notes</th><th>Recorded By</th></tr></thead><tbody>';
    var runBal=Number(u.totalPrice||0);
    recs.slice().reverse().forEach(function(r,i){
      runBal-=Number(r.amt||0);
      h+='<tr><td style="color:#888">'+(i+1)+'</td>';
      h+='<td>'+fD(r.date)+'</td>';
      h+='<td style="font-weight:700;color:#16a34a">PKR '+Number(r.amt).toLocaleString('en-PK')+'</td>';
      h+='<td>'+esc(r.ptype||'—')+'</td>';
      h+='<td style="font-family:monospace;font-size:9px">'+(r.rcpt||'—')+'</td>';
      h+='<td style="color:#666">'+(r.notes?esc(r.notes):'—')+'</td>';
      h+='<td>'+esc(gunm(r.by))+'</td></tr>';
    });
    h+='</tbody></table>';
  }else if(u.customerName){
    h+='<div style="background:#fefce8;border:1px solid #fde047;border-radius:4px;padding:8px 12px;font-size:10px;color:#854d0e;margin-bottom:12px">No payments recorded for this unit yet.</div>';
  }

  if(cons.length){
    h+='<div class="sec-title no-break">Contact History ('+cons.length+' logs)</div>';
    h+='<table><thead><tr><th>#</th><th>Date</th><th>Type</th><th>Response</th><th>Notes</th><th>Follow-up</th><th>By</th></tr></thead><tbody>';
    cons.forEach(function(c,i){
      h+='<tr><td style="color:#888">'+(i+1)+'</td>';
      h+='<td>'+fD(c.date)+'</td>';
      h+='<td>'+esc(c.type||'—')+'</td>';
      h+='<td>'+esc(c.status||'—')+'</td>';
      h+='<td style="color:#666">'+(c.notes?esc(c.notes):'—')+'</td>';
      h+='<td>'+(c.fu?fD(c.fu):'—')+'</td>';
      h+='<td>'+esc(gunm(c.by))+'</td></tr>';
    });
    h+='</tbody></table>';
  }

  if(u.remarks){
    h+='<div class="sec-title">Remarks</div>';
    h+='<div style="background:#f5f7fa;border:1px solid #dde;border-radius:4px;padding:10px 14px;font-size:11px;color:#333;line-height:1.7">'+esc(u.remarks)+'</div>';
  }

  h+='<div class="footer-bar">Generated by '+esc(S?S.name||'System':'System')+' &mdash; '+esc(S?S.coName||'Nexunova':'Nexunova')+' &mdash; Nexunova RMS &mdash; '+new Date().toLocaleString('en-PK')+'</div>';
  h+='</div>';

  w.document.write(h);
  _pclose(w);
}

// ══ IMPROVED UNIT DETAIL PRINT (overrides units.js version) ══
function printUD(unitId){
  var u=gunit(unitId);
  if(!u){toast('Unit not found','err');return;}
  var recs=grecs(unitId).sort(function(a,b){return a.date.localeCompare(b.date);});
  var cons=gcons(unitId).sort(function(a,b){return b.date.localeCompare(a.date);});
  var db=gdb();
  var prj=u.projectId?(db.projects[S.cid]||[]).find(function(p){return p.id===u.projectId;}):null;
  var paid=actualPaid(u),pend=actualPending(u);
  var recovPct=u.totalPrice?Math.min(100,Math.round(paid/u.totalPrice*100)):0;
  var isSold=u.status!=='Available'&&u.status!=='Dead';
  var coName=S?S.coName||'Nexunova':'Nexunova';
  var printDate=new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'});
  var printTime=new Date().toLocaleTimeString('en-PK',{hour:'2-digit',minute:'2-digit'});

  var css=
    'body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:0;padding:0}'+
    '*{box-sizing:border-box}'+
    '.lh{background:#1E2D47;color:#fff;display:flex;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.lh-logo{width:78px;min-height:78px;background:#16253a;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.lh-logo-ic{width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#C9A84C,#e8c87a);display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:900;color:#1E2D47;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.lh-mid{padding:14px 18px;flex:1}'+
    '.lh-co{font-size:19px;font-weight:700;letter-spacing:.4px;margin:0 0 2px}'+
    '.lh-sub{font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#C9A84C;margin:0 0 5px}'+
    '.lh-meta{font-size:9px;color:rgba(255,255,255,.5);line-height:1.6}'+
    '.lh-right{padding:14px 18px;text-align:right;font-size:9px;color:rgba(255,255,255,.55);line-height:1.8;border-left:1px solid rgba(255,255,255,.1)}'+
    '.lh-right b{color:#fff;font-size:12px;display:block;margin-bottom:2px}'+
    '.gold-bar{height:4px;background:linear-gradient(90deg,#C9A84C,#f0d87a,#C9A84C);-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.body{padding:16px 20px}'+
    '.dh{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #C9A84C}'+
    '.dh-title{font-size:16px;font-weight:700;color:#1E2D47;text-transform:uppercase;letter-spacing:.5px}'+
    '.dh-sub{font-size:10px;color:#888;margin-top:2px}'+
    '.dh-r{text-align:right;font-size:10px;color:#555;line-height:1.8}'+
    '.sec{margin-bottom:13px}'+
    '.sh{font-size:9px;font-weight:700;color:#fff;background:#1E2D47;padding:5px 10px;text-transform:uppercase;letter-spacing:.6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.sh-inner{border-left:3px solid #C9A84C;padding-left:8px;font-size:10px;font-weight:700;color:#1E2D47;text-transform:uppercase;letter-spacing:.5px;margin:10px 0 5px}'+
    '.grid3{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #dde;border-top:none}'+
    '.grid2{display:grid;grid-template-columns:repeat(2,1fr);border:1px solid #dde;border-top:none}'+
    '.gi{padding:7px 10px;border-right:1px solid #dde;border-bottom:1px solid #dde}'+
    '.grid3 .gi:nth-child(3n){border-right:none}'+
    '.grid2 .gi:nth-child(2n){border-right:none}'+
    '.gi-l{font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888;font-weight:700;margin-bottom:2px}'+
    '.gi-v{font-size:11px;font-weight:600;color:#111}'+
    '.fin{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:1px 0 7px}'+
    '.fc{border:1px solid #dde;border-radius:3px;padding:10px;text-align:center}'+
    '.fc-l{font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:3px}'+
    '.fc-v{font-size:13px;font-weight:700}'+
    '.prog-bg{height:7px;background:#e5e7eb;border-radius:99px;overflow:hidden;margin:4px 0 3px;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.prog-fill{height:100%;border-radius:99px;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    'table{width:100%;border-collapse:collapse;font-size:10px}'+
    'th{background:#1E2D47;color:#fff;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.3px;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    'th.r,td.r{text-align:right}'+
    'td{padding:5px 8px;border-bottom:1px solid #eee;vertical-align:top}'+
    'tr:nth-child(even) td{background:#f9fafb}'+
    '.tfoot-r td{background:#f0f4f8!important;font-weight:700;border-top:2px solid #C9A84C;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.chip-r{display:inline-block;font-family:monospace;font-size:9px;background:#e0e7ff;color:#3730a3;padding:1px 5px;border-radius:3px}'+
    '.chip-p{display:inline-block;font-size:9px;background:#dcfce7;color:#15803d;padding:1px 6px;border-radius:3px;font-weight:700;text-transform:uppercase}'+
    '.sig{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:20px;page-break-inside:avoid}'+
    '.sig-col{border-top:1.5px solid #1E2D47;padding-top:7px}'+
    '.sig-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#555}'+
    '.sig-name{font-size:12px;font-weight:700;color:#1E2D47;margin-top:3px}'+
    '.sig-role{font-size:9px;color:#888;margin-top:1px}'+
    '.pg-footer{margin-top:12px;padding-top:8px;border-top:1px solid #dde;display:flex;justify-content:space-between;font-size:9px;color:#bbb}'+
    '@media print{'+
      '@page{size:A4;margin:1cm;@bottom-right{content:"Page "counter(page)" of "counter(pages);font-size:8px;color:#aaa}}'+
      'body{padding:0}'+
    '}';

  var w=_pw('Unit '+u.unitNo+' — '+coName,css,'A4');
  if(!w)return;

  // ── Letterhead ──
  var logo=typeof getCoLogo==='function'?getCoLogo():null;
  var coInitial=(coName.charAt(0)||'N').toUpperCase();
  var h='<div class="lh">';
  if(logo){
    h+='<div class="lh-logo" style="background:#16253a;padding:8px 10px;display:flex;align-items:center;justify-content:center;-webkit-print-color-adjust:exact;print-color-adjust:exact">';
    h+='<img src="'+logo+'" style="height:50px;max-width:72px;object-fit:contain;background:transparent;display:block" alt="'+esc(coName)+'">';
    h+='</div>';
  }else{
    h+='<div class="lh-logo"><div class="lh-logo-ic">'+coInitial+'</div></div>';
  }
  h+='<div class="lh-mid">';
  h+='<div class="lh-co">'+esc(coName)+'</div>';
  h+='<div class="lh-sub">Recovery Management System</div>';
  h+='<div class="lh-meta">Nexunova RMS &nbsp;&middot;&nbsp; Real Estate Recovery &amp; Management</div>';
  h+='</div>';
  h+='<div class="lh-right"><b>Unit Detail Report</b>'+printDate+'<br>'+printTime+'<br>By: '+esc(S?S.name||'System':'System')+'</div>';
  h+='</div>';
  h+='<div class="gold-bar"></div>';
  h+='<div class="body">';

  // ── Doc title bar ──
  h+='<div class="dh">';
  h+='<div><div class="dh-title">Unit Detail Report</div>';
  h+='<div class="dh-sub">'+esc(coName)+' &mdash; Nexunova RMS</div></div>';
  h+='<div class="dh-r"><span style="font-size:18px;font-weight:700;color:#1E2D47;font-family:monospace">'+esc(u.unitNo)+'</span><br>';
  h+=esc(u.floorLabel||u.floor)+' &middot; '+esc(u.type)+(u.area?' &middot; '+u.area+' sqft':'')+'<br>';
  h+='<b style="color:'+(u.status==='Available'?'#16a34a':u.status==='Dead'?'#6b7280':'#1d4ed8')+'">'+esc(u.status)+'</b>';
  h+='</div></div>';

  // ── Unit Info ──
  h+='<div class="sec"><div class="sh">Unit Information</div><div class="grid3">';
  var ui=[
    {l:'Unit No',v:u.unitNo},{l:'Floor',v:u.floorLabel||u.floor},{l:'Type',v:u.type},
    {l:'Area',v:u.area?u.area+' Sq. Ft':'—'},{l:'Status',v:u.status},{l:'Booking No',v:u.bookingNo||'—'},
    {l:'Project',v:prj?prj.name:'—'},{l:'Sold By',v:u.soldBy||'—'},{l:'Sale Date',v:u.soldDate?fD(u.soldDate):'—'}
  ];
  ui.forEach(function(x){h+='<div class="gi"><div class="gi-l">'+x.l+'</div><div class="gi-v">'+esc(String(x.v||'—'))+'</div></div>';});
  h+='</div></div>';

  // ── Client Info ──
  if(isSold&&u.customerName){
    h+='<div class="sec"><div class="sh">Client Information</div><div class="grid2">';
    [{l:'Client Name',v:u.customerName},{l:'Phone',v:u.phone||'—'},{l:'Ref / Receipt No',v:u.receiptNo||'—'},{l:'Remarks',v:u.remarks||'—'}]
      .forEach(function(x){h+='<div class="gi"><div class="gi-l">'+x.l+'</div><div class="gi-v">'+esc(String(x.v||'—'))+'</div></div>';});
    h+='</div></div>';
  }

  // ── Financial Summary ──
  if(u.totalPrice){
    var progColor=recovPct>=100?'#16a34a':recovPct>=60?'#22c55e':recovPct>=30?'#f59e0b':'#ef4444';
    h+='<div class="sec"><div class="sh">Financial Summary</div>';
    h+='<div class="fin">';
    h+='<div class="fc"><div class="fc-l">Total Sale Price</div><div class="fc-v" style="color:#1E2D47">PKR '+Number(u.totalPrice).toLocaleString('en-PK')+'</div></div>';
    h+='<div class="fc"><div class="fc-l">Amount Paid</div><div class="fc-v" style="color:#16a34a">PKR '+paid.toLocaleString('en-PK')+'</div></div>';
    h+='<div class="fc"><div class="fc-l">Balance Pending</div><div class="fc-v" style="color:'+(pend>0?'#dc2626':'#16a34a')+'">PKR '+pend.toLocaleString('en-PK')+'</div></div>';
    h+='</div>';
    h+='<div style="display:flex;justify-content:space-between;font-size:9px;color:#555;margin-bottom:2px"><span>Recovery Progress</span><span style="font-weight:700;color:'+progColor+'">'+recovPct+'%</span></div>';
    h+='<div class="prog-bg"><div class="prog-fill" style="width:'+recovPct+'%;background:'+progColor+'"></div></div>';
    h+='<div style="font-size:9px;color:#888;margin-top:3px">Last Payment: <b>'+(u.lastPaymentDate?fD(u.lastPaymentDate):'No payment recorded')+'</b>'+(pend>0?' &nbsp;&middot;&nbsp; Pending: <i style="color:#dc2626">'+amtWords(pend)+'</i>':' &nbsp;&middot;&nbsp; <b style="color:#16a34a">Fully Paid</b>')+'</div>';
    h+='</div>';
  }

  // ── Payment History ──
  if(recs.length){
    h+='<div class="sec"><div class="sh">Payment History ('+recs.length+' payments)</div>';
    h+='<table><thead><tr><th>#</th><th>Date</th><th>Payment Type</th><th>Receipt No</th><th>Notes</th><th class="r">Amount (PKR)</th><th class="r">Balance After</th></tr></thead><tbody>';
    var runBal=Number(u.totalPrice||0);
    recs.forEach(function(r,i){
      runBal-=Number(r.amt||0);
      h+='<tr>';
      h+='<td style="color:#aaa;font-size:9px">'+(i+1)+'</td>';
      h+='<td style="white-space:nowrap">'+fD(r.date)+'</td>';
      h+='<td><span class="chip-p">'+esc(r.ptype||'—')+'</span></td>';
      h+='<td>'+(r.rcpt?'<span class="chip-r">'+esc(r.rcpt)+'</span>':'<span style="color:#ccc">—</span>')+'</td>';
      h+='<td style="color:#666;font-size:10px;max-width:130px">'+(r.notes?esc(r.notes):'—')+'</td>';
      h+='<td class="r" style="font-weight:700;color:#15803d">'+Number(r.amt).toLocaleString('en-PK')+'</td>';
      h+='<td class="r" style="color:'+(Math.max(0,runBal)>0?'#dc2626':'#16a34a')+'">'+Math.max(0,runBal).toLocaleString('en-PK')+'</td>';
      h+='</tr>';
    });
    h+='</tbody>';
    h+='<tfoot><tr class="tfoot-r">';
    h+='<td colspan="5" style="font-size:9px;color:#555;font-style:italic">Total Paid: '+amtWords(paid)+'</td>';
    h+='<td class="r" style="color:#16a34a">'+paid.toLocaleString('en-PK')+'</td>';
    h+='<td class="r" style="color:'+(pend>0?'#dc2626':'#16a34a')+'">'+pend.toLocaleString('en-PK')+'</td>';
    h+='</tr></tfoot></table></div>';
  }else if(isSold){
    h+='<div class="sec"><div class="sh">Payment History</div>';
    h+='<div style="padding:10px;background:#fefce8;border:1px solid #fde047;font-size:10px;color:#854d0e;border-top:none">No payments recorded yet.</div></div>';
  }

  // ── Contact History ──
  if(cons.length){
    h+='<div class="sec"><div class="sh">Contact History ('+cons.length+' logs)</div>';
    h+='<table><thead><tr><th>#</th><th>Date</th><th>Type</th><th>Response</th><th>Notes</th><th>Follow-up</th><th>By</th></tr></thead><tbody>';
    cons.forEach(function(c,i){
      h+='<tr>';
      h+='<td style="color:#aaa;font-size:9px">'+(i+1)+'</td>';
      h+='<td>'+fD(c.date)+'</td>';
      h+='<td>'+esc(c.type||'—')+'</td>';
      h+='<td>'+esc(c.status||'—')+'</td>';
      h+='<td style="color:#666;font-size:10px">'+(c.notes?esc(c.notes):'—')+'</td>';
      h+='<td>'+(c.fu?'<b style="color:#dc2626">'+fD(c.fu)+'</b>':'—')+'</td>';
      h+='<td>'+esc(gunm(c.by))+'</td>';
      h+='</tr>';
    });
    h+='</tbody></table></div>';
  }

  // ── Remarks ──
  if(u.remarks){
    h+='<div class="sec"><div class="sh-inner">Remarks</div>';
    h+='<div style="padding:8px 10px;background:#f5f7fa;border:1px solid #dde;font-size:10px;color:#333;line-height:1.7">'+esc(u.remarks)+'</div></div>';
  }

  // ── Signature / Authorization ──
  h+='<div class="sig">';
  h+='<div class="sig-col"><div style="height:32px"></div>';
  h+='<div class="sig-lbl">Client Signature &amp; Date</div>';
  h+='<div class="sig-name">'+(u.customerName?esc(u.customerName):'________________________')+'</div>';
  h+='<div class="sig-role">'+(u.phone?esc(u.phone):'')+'</div></div>';
  h+='<div class="sig-col"><div style="height:32px"></div>';
  h+='<div class="sig-lbl">Authorized Signatory &amp; Company Stamp</div>';
  h+='<div class="sig-name">'+esc(coName)+'</div>';
  h+='<div class="sig-role">Nexunova Recovery Management System</div></div>';
  h+='</div>';

  // ── Footer ──
  h+='<div class="pg-footer">';
  h+='<span>'+esc(coName)+' &mdash; Nexunova RMS &mdash; Confidential Document</span>';
  h+='<span>Printed: '+printDate+' at '+printTime+'</span>';
  h+='</div>';

  h+='</div>';
  w.document.write(h);
  _pclose(w);
}

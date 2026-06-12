// ══ BACKUP PAGE (ALL USERS) — restyled on the nx- foundation kit (batch 2) ════
// Trust surface: what's saved · when · one clear action. Logic unchanged
// (manualBkp · bkpExcel · restoreFromFile · triggerBkpFile).
function rBackup(){
  var db=gdb();
  var lastBkp=localStorage.getItem(STORE+'_last_manual_bkp');
  var totalUnits=gunits().length||(db.units[S.cid]||[]).length;
  var totalRecs=(db.recoveries[S.cid]||[]).length;
  var totalCons=(window._contactLogsCache||[]).length;
  var dataSize=new Blob([JSON.stringify(db)]).size;
  var sizekb=Math.round(dataSize/1024);
  var lastStr=lastBkp?new Date(lastBkp).toLocaleString('en-PK'):'Never';

  var kpis='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:var(--fk-sp-2);margin-bottom:var(--fk-sp-4)">'+
    NX.card(NX.kpi({label:'Units saved', value:totalUnits, dot:'success'}),{compact:true})+
    NX.card(NX.kpi({label:'Payments',   value:totalRecs,  dot:'primary'}),{compact:true})+
    NX.card(NX.kpi({label:'Call logs',  value:totalCons,  dot:'info'}),{compact:true})+
    NX.card(NX.kpi({label:'Data size',  value:sizekb+' KB'}),{compact:true})+
  '</div>';

  // Download card — the calm primary action
  var dlCard=NX.card(
    '<div class="nx-kpi-label" style="text-transform:none;font-size:var(--fk-fs-title);color:var(--fk-text);margin-bottom:4px">Download backup</div>'+
    '<div class="nx-kpi-label" style="text-transform:none;line-height:1.6;margin-bottom:var(--fk-sp-3)">Save your complete data as a JSON file, then keep it in Google Drive, OneDrive or a USB drive.</div>'+
    NX.banner('Tip: save the file inside your Google Drive / OneDrive folder so it auto-syncs to the cloud.','info')+
    '<div style="display:flex;flex-direction:column;gap:var(--fk-sp-2);margin-top:var(--fk-sp-3)">'+
      NX.button('Download full backup (.json)', {variant:'primary', onclick:'manualBkp()', attrs:'style="width:100%"'})+
      NX.button('Download as Excel (.xlsx)',    {variant:'secondary', onclick:'bkpExcel()', attrs:'style="width:100%"'})+
    '</div>'+
    '<div class="nx-kpi-label" style="text-transform:none;margin-top:var(--fk-sp-3)">Last manual backup: <b style="color:var(--fk-text)">'+esc(lastStr)+'</b></div>');

  // Restore card — destructive, clearly flagged
  var rsCard=NX.card(
    '<div class="nx-kpi-label" style="text-transform:none;font-size:var(--fk-fs-title);color:var(--fk-text);margin-bottom:4px">Restore backup</div>'+
    '<div class="nx-kpi-label" style="text-transform:none;line-height:1.6;margin-bottom:var(--fk-sp-3)">Load data from a previously downloaded .json backup file.</div>'+
    NX.banner('Restoring replaces all current local data with the backup. This cannot be undone.','danger')+
    '<input type="file" id="bkp-file-inp" accept=".json" style="display:none" onchange="restoreFromFile(this)">'+
    '<div style="margin-top:var(--fk-sp-3)">'+
      NX.button('Restore from .json file', {variant:'danger', onclick:'triggerBkpFile()', attrs:'style="width:100%"'})+
    '</div>');

  // Cloud instructions
  var step=function(items){return '<ol style="margin:0;padding-left:18px;font-size:var(--fk-fs-body);color:var(--fk-text-muted);line-height:1.9">'+items.map(function(i){return '<li>'+i+'</li>';}).join('')+'</ol>';};
  var cloudCard=NX.card(
    '<div class="nx-kpi-label" style="text-transform:none;font-size:var(--fk-fs-title);color:var(--fk-text);margin-bottom:var(--fk-sp-3)">How to back up to Google Drive / OneDrive</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-4)">'+
      '<div><div class="nx-kpi-label" style="margin-bottom:6px">Google Drive</div>'+
        step(['Install <b>Google Drive for Desktop</b>','Click <b>Download full backup</b> above','Move the file to your <b>Google Drive folder</b>','It auto-syncs to the cloud','Do this <b>weekly</b> for best safety'])+'</div>'+
      '<div><div class="nx-kpi-label" style="margin-bottom:6px">OneDrive</div>'+
        step(['OneDrive comes pre-installed on Windows','Click <b>Download full backup</b> above','Save the file to your <b>OneDrive folder</b>','It auto-syncs to the cloud','Enable <b>Auto-Save</b> in Settings'])+'</div>'+
    '</div>');

  document.getElementById('pg-backup').innerHTML=
    NX.pageHeader('Data backup & restore')+
    NX.banner('Your server data is automatically backed up by the platform. These exports contain local app data for your own offline copy.','info')+
    '<div style="height:var(--fk-sp-3)"></div>'+
    kpis+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3);margin-bottom:var(--fk-sp-3)">'+dlCard+rsCard+'</div>'+
    cloudCard;
}

function manualBkp(){
  var db=gdb();
  var j=JSON.stringify({data:db,at:new Date().toISOString(),v:'v8',units:(db.units[S.cid]||[]).length,payments:(db.recoveries[S.cid]||[]).length});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([j],{type:'application/json'}));
  a.download='Nexunova_backup_'+td()+'.json';a.click();
  localStorage.setItem(STORE+'_last_manual_bkp',new Date().toISOString());
  toast('Backup downloaded! Move it to Google Drive/OneDrive for cloud safety.','ok');
}

function bkpExcel(){
  if(typeof XLSX==='undefined'){toast('Excel library not loaded','warn');return;}
  var units=gunits();
  var rows=units.map(function(u){var pd=actualPaid(u),rm=actualPending(u);return {'Unit No':u.unitNo,'Floor':u.floorLabel||u.floor,'Type':u.type,'Area':u.area,'Status':u.status,'Customer':u.customerName||'','Phone':u.phone||'','Booking No':u.bookingNo||'','Total Price':u.totalPrice||0,'Paid':pd,'Pending':rm,'Recovery %':u.totalPrice?Math.round(pd/u.totalPrice*100):0,'Last Payment':u.lastPaymentDate||'','Sold By':u.soldBy||'','Remarks':u.remarks||''};});
  var wb=XLSX.utils.book_new();
  var ws=XLSX.utils.json_to_sheet(rows);
  xlsxWesternNumFmt(ws);
  XLSX.utils.book_append_sheet(wb,ws,'Units');
  var recs=grecs().sort(function(a,b){return b.date.localeCompare(a.date);});
  var rrows=recs.map(function(r){var u=gunit(r.uid);return {'Date':r.date,'Unit':u?u.unitNo:'?','Client':u?u.customerName||'':'','Amount':r.amt,'Type':r.ptype,'Receipt':r.rcpt||'','Notes':r.notes||'','By':gunm(r.by)};});
  var ws2=XLSX.utils.json_to_sheet(rrows);
  xlsxWesternNumFmt(ws2);
  XLSX.utils.book_append_sheet(wb,ws2,'Payments');
  XLSX.writeFile(wb,'Nexunova_DataExport_'+td()+'.xlsx');
  toast('Excel export downloaded','ok');
}

function triggerBkpFile(){
  var el=document.getElementById('bkp-file-inp');
  if(el)el.click();
  else{var ni=document.createElement('input');ni.type='file';ni.accept='.json';ni.onchange=function(e){restoreFromFile(e.target);};ni.click();}
}
function restoreFromFile(inp){
  var f=inp.files[0];if(!f)return;
  var r=new FileReader();
  r.onload=function(e){
    try{
      var bk=JSON.parse(e.target.result);
      var d=bk.data||bk;
      if(!d.users||!d.units)throw new Error('Invalid backup file');
      if(!confirm('Restore backup from '+new Date(bk.at||Date.now()).toLocaleString('en-PK')+'?\n\nThis will REPLACE all current data. Are you sure?'))return;
      localStorage.setItem(STORE,JSON.stringify(d));
      toast('Data restored successfully! Reloading...','ok');
      setTimeout(function(){location.reload();},1200);
    }catch(ex){toast('Invalid backup file: '+ex.message,'err');}
  };
  r.readAsText(f);
}

// Legacy login auto-backup removed (2026-06-04): it dumped the vestigial localStorage
// kbh_v4 store, not Supabase. Server data is backed up by the platform.


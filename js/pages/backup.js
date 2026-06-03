// ══ BACKUP PAGE (ALL USERS) ════════════════════
function rBackup(){
  var db=gdb();
  var lastBkp=localStorage.getItem(STORE+'_last_manual_bkp');
  var totalUnits=gunits().length||(db.units[S.cid]||[]).length;
  var totalRecs=(db.recoveries[S.cid]||[]).length;
  var totalCons=(window._contactLogsCache||[]).length;
  var dataSize=new Blob([JSON.stringify(db)]).size;
  var sizekb=Math.round(dataSize/1024);
  document.getElementById('pg-backup').innerHTML='<div class="ani">'+
    '<div class="ph"><div class="ph-l"><h2>Data Backup &amp; Restore</h2>'+
    '<p>Keep your data safe — backup regularly and save to Google Drive or OneDrive</p></div></div>'+

    // Status Card
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">'+
      '<div class="kpi" style="--ka:var(--ok)"><div class="kpi-lbl">Units Saved</div><div class="kpi-val">'+totalUnits+'</div></div>'+
      '<div class="kpi" style="--ka:var(--brand)"><div class="kpi-lbl">Payments</div><div class="kpi-val">'+totalRecs+'</div></div>'+
      '<div class="kpi" style="--ka:var(--info)"><div class="kpi-lbl">Call Logs</div><div class="kpi-val">'+totalCons+'</div></div>'+
      '<div class="kpi" style="--ka:var(--purple)"><div class="kpi-lbl">Data Size</div><div class="kpi-val">'+sizekb+'KB</div></div>'+
    '</div>'+

    // Backup Actions
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">'+
      '<div class="card"><div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download Backup</h3><p>Save a backup file to your computer</p></div>'+
      '<div class="cb">'+
        '<p style="font-size:12px;color:var(--t2);margin-bottom:14px;line-height:1.7">'+
        'Download your complete data as a <b>JSON backup file</b>. '+
        'Save this file to <b>Google Drive</b>, <b>OneDrive</b>, or any USB drive to keep it safe.<br><br>'+
        '<b style="color:var(--warn);display:inline-flex;align-items:center;gap:4px"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Tip:</b> Save the file inside your Google Drive or OneDrive folder so it auto-syncs to cloud.'+
        '</p>'+
        '<button class="btn btn-g btn-w" onclick="manualBkp()" style="width:100%;margin-bottom:8px;display:inline-flex;align-items:center;justify-content:center;gap:6px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download Full Backup (.json)</button>'+
        '<button class="btn btn-gh btn-w" onclick="bkpExcel()" style="width:100%;display:inline-flex;align-items:center;justify-content:center;gap:6px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>Download as Excel (.xlsx)</button>'+
        '<div style="font-size:11px;color:var(--t3);margin-top:10px">Last manual backup: <b>'+(lastBkp?new Date(lastBkp).toLocaleString('en-PK'):'Never')+'</b></div>'+
        '<div style="font-size:11px;color:var(--t3);margin-top:8px;line-height:1.5">Server data is automatically backed up by the platform. These exports contain local app data only.</div>'+
      '</div></div>'+

      '<div class="card"><div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Restore Backup</h3><p>Load data from a backup file</p></div>'+
      '<div class="cb">'+
        '<p style="font-size:12px;color:var(--t2);margin-bottom:14px;line-height:1.7">'+
        'Restore your data from a previously downloaded <b>.json backup file</b>. '+
        '<b style="color:var(--err)">Warning:</b> This will replace all current data with the backup data.'+
        '</p>'+
        '<input type="file" id="bkp-file-inp" accept=".json" style="display:none" onchange="restoreFromFile(this)">'+
        '<button class="btn btn-d btn-w" onclick="document.getElementById(&quot;bkp-file&quot;).click()" style="width:100%;margin-bottom:8px;display:inline-flex;align-items:center;justify-content:center;gap:6px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Restore from .json File</button>'+
      '</div></div>'+
    '</div>'+

    // Cloud Backup Instructions
    '<div class="card"><div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>How to Backup to Google Drive / OneDrive</h3></div>'+
    '<div class="cb">'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">'+
        '<div>'+
          '<h4 style="font-size:12px;font-weight:700;color:var(--ok);margin-bottom:8px;display:flex;align-items:center;gap:5px"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#10b981"/></svg>Google Drive</h4>'+
          '<ol style="font-size:12px;color:var(--t2);line-height:2;padding-left:18px">'+
            '<li>Install <b>Google Drive for Desktop</b> app</li>'+
            '<li>Click <b>Download Full Backup</b> above</li>'+
            '<li>Move the downloaded file to your <b>Google Drive folder</b></li>'+
            '<li>File auto-syncs to cloud</li>'+
            '<li>Do this <b>weekly</b> for best safety</li>'+
          '</ol>'+
        '</div>'+
        '<div>'+
          '<h4 style="font-size:12px;font-weight:700;color:var(--info);margin-bottom:8px;display:flex;align-items:center;gap:5px"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#3b82f6"/></svg>OneDrive</h4>'+
          '<ol style="font-size:12px;color:var(--t2);line-height:2;padding-left:18px">'+
            '<li>OneDrive comes pre-installed on Windows</li>'+
            '<li>Click <b>Download Full Backup</b> above</li>'+
            '<li>Save the file to your <b>OneDrive folder</b></li>'+
            '<li>File auto-syncs to cloud</li>'+
            '<li>Enable <b>Auto-Save</b> in Settings below</li>'+
          '</ol>'+
        '</div>'+
      '</div>'+
    '</div></div>'+

  '</div>';
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
  XLSX.utils.book_append_sheet(wb,ws,'Units');
  var recs=grecs().sort(function(a,b){return b.date.localeCompare(a.date);});
  var rrows=recs.map(function(r){var u=gunit(r.uid);return {'Date':r.date,'Unit':u?u.unitNo:'?','Client':u?u.customerName||'':'','Amount':r.amt,'Type':r.ptype,'Receipt':r.rcpt||'','Notes':r.notes||'','By':gunm(r.by)};});
  var ws2=XLSX.utils.json_to_sheet(rrows);
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


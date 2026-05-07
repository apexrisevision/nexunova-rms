// ══ BACKUP PAGE (ALL USERS) ════════════════════
function rBackup(){
  var db=gdb();
  var lastBkp=localStorage.getItem(STORE+'_last_manual_bkp');
  var lastAuto=localStorage.getItem(STORE+'_last_auto_bkp');
  var totalUnits=(db.units[S.cid]||[]).length;
  var totalRecs=(db.recoveries[S.cid]||[]).length;
  var totalCons=(db.contacts[S.cid]||[]).length;
  var dataSize=new Blob([JSON.stringify(db)]).size;
  var sizekb=Math.round(dataSize/1024);
  document.getElementById('pg-backup').innerHTML='<div class="ani">'+
    '<div class="ph"><div class="ph-l"><h2>💾 Data Backup &amp; Restore</h2>'+
    '<p>Keep your data safe — backup regularly and save to Google Drive or OneDrive</p></div></div>'+

    // Status Card
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">'+
      '<div class="kpi" style="--ka:var(--ok)"><div class="kpi-lbl">🏢 Units Saved</div><div class="kpi-val">'+totalUnits+'</div></div>'+
      '<div class="kpi" style="--ka:var(--brand)"><div class="kpi-lbl">💰 Payments</div><div class="kpi-val">'+totalRecs+'</div></div>'+
      '<div class="kpi" style="--ka:var(--info)"><div class="kpi-lbl">📞 Call Logs</div><div class="kpi-val">'+totalCons+'</div></div>'+
      '<div class="kpi" style="--ka:var(--purple)"><div class="kpi-lbl">📦 Data Size</div><div class="kpi-val">'+sizekb+'KB</div></div>'+
    '</div>'+

    // Backup Actions
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">'+
      '<div class="card"><div class="ch"><h3>📥 Download Backup</h3><p>Save a backup file to your computer</p></div>'+
      '<div class="cb">'+
        '<p style="font-size:12px;color:var(--t2);margin-bottom:14px;line-height:1.7">'+
        'Download your complete data as a <b>JSON backup file</b>. '+
        'Save this file to <b>Google Drive</b>, <b>OneDrive</b>, or any USB drive to keep it safe.<br><br>'+
        '<b style="color:var(--warn)">⚠️ Tip:</b> Save the file inside your Google Drive or OneDrive folder so it auto-syncs to cloud.'+
        '</p>'+
        '<button class="btn btn-g btn-w" onclick="manualBkp()" style="width:100%;margin-bottom:8px">📥 Download Full Backup (.json)</button>'+
        '<button class="btn btn-gh btn-w" onclick="bkpExcel()" style="width:100%">📊 Download as Excel (.xlsx)</button>'+
        '<div style="font-size:11px;color:var(--t3);margin-top:10px">Last manual backup: <b>'+(lastBkp?new Date(lastBkp).toLocaleString('en-PK'):'Never')+'</b></div>'+
      '</div></div>'+

      '<div class="card"><div class="ch"><h3>📤 Restore Backup</h3><p>Load data from a backup file</p></div>'+
      '<div class="cb">'+
        '<p style="font-size:12px;color:var(--t2);margin-bottom:14px;line-height:1.7">'+
        'Restore your data from a previously downloaded <b>.json backup file</b>. '+
        '<b style="color:var(--err)">Warning:</b> This will replace all current data with the backup data.'+
        '</p>'+
        '<input type="file" id="bkp-file-inp" accept=".json" style="display:none" onchange="restoreFromFile(this)">'+
        '<button class="btn btn-d btn-w" onclick="document.getElementById(&quot;bkp-file&quot;).click()" style="width:100%;margin-bottom:8px">📤 Restore from .json File</button>'+
        '<div style="font-size:11px;color:var(--t3);margin-top:10px">Auto backup: <b>'+(lastAuto?new Date(lastAuto).toLocaleString('en-PK'):'Not run yet (will run on next login)')+'</b></div>'+
      '</div></div>'+
    '</div>'+

    // Cloud Backup Instructions
    '<div class="card"><div class="ch"><h3>☁️ How to Backup to Google Drive / OneDrive</h3></div>'+
    '<div class="cb">'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">'+
        '<div>'+
          '<h4 style="font-size:12px;font-weight:700;color:var(--ok);margin-bottom:8px">🟢 Google Drive</h4>'+
          '<ol style="font-size:12px;color:var(--t2);line-height:2;padding-left:18px">'+
            '<li>Install <b>Google Drive for Desktop</b> app</li>'+
            '<li>Click <b>Download Full Backup</b> above</li>'+
            '<li>Move the downloaded file to your <b>Google Drive folder</b></li>'+
            '<li>File auto-syncs to cloud ✅</li>'+
            '<li>Do this <b>weekly</b> for best safety</li>'+
          '</ol>'+
        '</div>'+
        '<div>'+
          '<h4 style="font-size:12px;font-weight:700;color:var(--info);margin-bottom:8px">🔵 OneDrive</h4>'+
          '<ol style="font-size:12px;color:var(--t2);line-height:2;padding-left:18px">'+
            '<li>OneDrive comes pre-installed on Windows</li>'+
            '<li>Click <b>Download Full Backup</b> above</li>'+
            '<li>Save the file to your <b>OneDrive folder</b></li>'+
            '<li>File auto-syncs to cloud ✅</li>'+
            '<li>Enable <b>Auto-Save</b> in Settings below</li>'+
          '</ol>'+
        '</div>'+
      '</div>'+
    '</div></div>'+

    // Auto backup settings
    '<div class="card" style="margin-top:14px"><div class="ch"><h3>⚙️ Auto-Backup Settings</h3><p>Automatic daily backup — never lose your data</p></div>'+
    '<div class="cb">'+
      '<div style="display:flex;align-items:center;gap:14px;padding:12px;background:var(--ok-bg);border-radius:var(--rm);margin-bottom:12px">'+
        '<span style="font-size:24px">🤖</span>'+
        '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--ok)">Auto-backup is ACTIVE</div>'+
        '<div style="font-size:11px;color:var(--t2);margin-top:2px">Every time you log in, if 24 hours have passed since last backup, a backup file is automatically downloaded to your Downloads folder.</div></div>'+
      '</div>'+
      '<p style="font-size:12px;color:var(--t2);line-height:1.7">'+
        '<b>Recommendation:</b> Move auto-backup files from Downloads to your Google Drive or OneDrive folder for cloud safety. '+
        'Files are named <b>Nexunova_backup_YYYY-MM-DD.json</b> — keep the latest 3-4 files.'+
      '</p>'+
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
  toast('✅ Backup downloaded! Move it to Google Drive/OneDrive for cloud safety.','ok');
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
      toast('✅ Data restored successfully! Reloading...','ok');
      setTimeout(function(){location.reload();},1200);
    }catch(ex){toast('Invalid backup file: '+ex.message,'err');}
  };
  r.readAsText(f);
}

// Auto-backup on login (runs every 24 hours)
function checkAutoBackup(){
  var lastAuto=localStorage.getItem(STORE+'_last_auto_bkp');
  var now=Date.now();
  var dayMs=24*60*60*1000;
  if(!lastAuto||(now-parseInt(lastAuto))>dayMs){
    setTimeout(function(){
      var db=gdb();
      var j=JSON.stringify({data:db,at:new Date().toISOString(),v:'v8'});
      var a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([j],{type:'application/json'}));
      a.download='Nexunova_AutoBackup_'+td()+'.json';
      a.click();
      localStorage.setItem(STORE+'_last_auto_bkp',now.toString());
      toast('🤖 Daily auto-backup downloaded to your Downloads folder. Move it to Google Drive for safety!','ok');
    },3000);
  }
}


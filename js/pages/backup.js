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
    '<div class="nx-kpi-label" style="text-transform:none;font-size:var(--fk-fs-title);color:var(--fk-text);margin-bottom:4px">Download your data</div>'+
    '<div class="nx-kpi-label" style="text-transform:none;line-height:1.6;margin-bottom:var(--fk-sp-3)">Export a readable Excel snapshot of your live company data — projects, units, clients, sales, payments, installments and agents, each on its own sheet.</div>'+
    NX.banner('Tip: keep the file in your Google Drive / OneDrive folder so it auto-syncs to the cloud.','info')+
    '<div style="display:flex;flex-direction:column;gap:var(--fk-sp-2);margin-top:var(--fk-sp-3)">'+
      NX.button('Download as Excel (.xlsx)',    {variant:'primary', onclick:'bkpExcel()', attrs:'style="width:100%"'})+
      NX.button('Download local cache (.json)', {variant:'secondary', onclick:'manualBkp()', attrs:'style="width:100%"'})+
    '</div>'+
    '<div class="nx-kpi-label" style="text-transform:none;margin-top:var(--fk-sp-3)">Last local cache backup: <b style="color:var(--fk-text)">'+esc(lastStr)+'</b></div>');

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
    NX.banner('Your live server database is backed up automatically every day by the platform. The Excel export below is your own readable offline copy.','info')+
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

// Real, LIVE bulk export — pulls the tenant's full business data straight from
// Supabase (export_company_data RPC) and writes a multi-sheet workbook. This
// replaced the old localStorage dump (which only saw the vestigial local cache).
async function bkpExcel(){
  await window.ensureXLSX();
  if(typeof XLSX==='undefined'){toast('Excel library not loaded','warn');return;}
  if(!window.S||!S.cid){toast('No company in session','warn');return;}
  toast('Preparing export — fetching live data…','info');
  try{
    var res=await supabase.rpc('export_company_data',{p_company_id:S.cid});
    if(res.error) throw res.error;
    var d=res.data; if(!d){toast('No data returned','warn');return;}
    var total=buildCompanyWorkbook(d, true);
    toast('Exported '+total+' records to Excel','ok');
  }catch(ex){ toast('Export failed: '+(ex.message||ex),'err'); }
}

// Shared workbook builder. `download`=true writes the file immediately and
// returns the record count; otherwise returns {wb,total} for the caller (used
// by the super-admin all-tenant export which merges many companies).
function buildCompanyWorkbook(d, download){
  var coName=(d.meta&&d.meta.company&&d.meta.company.name)||'Company';
  var wb=XLSX.utils.book_new();
  var sheets=[['Projects',d.projects],['Units',d.units],['Clients',d.clients],
              ['Sales',d.sales],['Payments',d.payments],['Installments',d.installments],['Agents',d.agents]];
  var total=0;
  sheets.forEach(function(pair){
    var name=pair[0], rows=pair[1]||[]; total+=rows.length;
    var ws=XLSX.utils.json_to_sheet(rows.length?rows:[{'(no records)':''}]);
    if(typeof xlsxWesternNumFmt==='function'&&rows.length) xlsxWesternNumFmt(ws);
    XLSX.utils.book_append_sheet(wb,ws,name);
  });
  var meta=[{Field:'Company',Value:coName},{Field:'Exported at',Value:new Date().toLocaleString('en-PK')},
    {Field:'Projects',Value:(d.projects||[]).length},{Field:'Units',Value:(d.units||[]).length},
    {Field:'Clients',Value:(d.clients||[]).length},{Field:'Sales',Value:(d.sales||[]).length},
    {Field:'Payments',Value:(d.payments||[]).length},{Field:'Installments',Value:(d.installments||[]).length},
    {Field:'Agents',Value:(d.agents||[]).length}];
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(meta),'Summary');
  wb.SheetNames.unshift(wb.SheetNames.pop()); // Summary to front
  if(download){
    var safe=coName.replace(/[^a-z0-9]+/ig,'_').slice(0,40);
    XLSX.writeFile(wb,'Nexunova_'+safe+'_'+td()+'.xlsx');
    return total;
  }
  return {wb:wb,total:total};
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


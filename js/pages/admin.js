// ══ ADMIN PAGE ════════════════════════════════
function rAdmin(){
  if(S.role!=='admin'){nav('dashboard');return;}
  document.getElementById('pg-admin').innerHTML=`<div class="ani">
    <div class="ph"><div class="ph-l"><h2>Admin Panel</h2></div></div>
    <div class="atb"><div class="atb-i${_at==='users'?' on':''}" onclick="setAT('users')">👥 Users</div><div class="atb-i${_at==='import'?' on':''}" onclick="setAT('import')">📊 Import Excel</div><div class="atb-i${_at==='data'?' on':''}" onclick="setAT('data')">💾 Backup</div><div class="atb-i${_at==='log'?' on':''}" onclick="setAT('log')">📋 Activity Log</div><div class="atb-i${_at==='settings'?' on':''}" onclick="setAT('settings')">⚙️ Settings</div></div>
    <div id="a-ct"></div>
  </div>`;
  rAT();
}
function setAT(t){_at=t;document.querySelectorAll('.atb-i').forEach(a=>a.classList.remove('on'));document.querySelector(`.atb-i[onclick="setAT('${t}')"]`)?.classList.add('on');rAT();}
function rAT(){
  const ct=document.getElementById('a-ct');if(!ct)return;
  const db=gdb();
  if(_at==='users'){
    const users=db.users.filter(u=>u.companyIds.includes(S.cid));
    const staffUsers=users.filter(u=>u.role!=='admin');
    const atLimit=staffUsers.length>=2;
    const roleBadge=r=>{
      if(r==='admin')  return '<span class="badge" style="background:#dbeafe;color:#1d4ed8">👑 Admin</span>';
      if(r==='accounts')return '<span class="badge" style="background:#fff7ed;color:#c2410c">💼 Accounts</span>';
      return             '<span class="badge" style="background:#dcfce7;color:#15803d">🔧 Recovery</span>';
    };
    ct.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-size:12px;color:var(--t3)">${staffUsers.length} / 2 staff &nbsp;·&nbsp; 1 admin + up to 2 staff</div>
      ${atLimit
        ? `<span style="font-size:11px;color:var(--warn);background:var(--warn-bg,rgba(234,179,8,.12));padding:5px 10px;border-radius:6px">⚠ Max staff reached (2/2)</span>`
        : `<button class="btn btn-g btn-sm" onclick="openUserModal(null)">+ Add User</button>`}
    </div>
    <div class="card"><div class="tw"><table class="t"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Created</th><th></th></tr></thead><tbody>
    ${users.map(u=>`<tr>
      <td><b>${esc(u.name)}</b>${u.id===S.userId?'<span style="font-size:10px;color:var(--t3);margin-left:5px">(you)</span>':''}</td>
      <td style="font-size:11px;color:var(--t2)">${esc(u.username)}</td>
      <td>${roleBadge(u.role==='user'?'recovery':u.role)}</td>
      <td style="font-size:11px;color:var(--t3)">${fD(u.createdAt)}</td>
      <td><div style="display:flex;gap:6px">
        ${u.role!=='admin'?`<button class="btn btn-gh btn-xs" onclick="openUserModal('${u.id}')">Edit</button>`:''}
        ${u.id!==S.userId&&u.role!=='admin'?`<button class="btn btn-r btn-xs" onclick="delUser('${u.id}')">Del</button>`:'<span style="font-size:10px;color:var(--t3)">—</span>'}
      </div></td>
    </tr>`).join('')}
    </tbody></table></div></div>
    <div style="margin-top:10px;padding:10px 14px;background:var(--canvas);border-radius:6px;font-size:11px;color:var(--t3);line-height:1.7">
      💡 <b>Recovery Staff</b> — Dashboard, Units, Clients, Payments, Call Logs.<br>
      💡 <b>Accounts Staff</b> — Dashboard, Payments, Reports, Agents.
    </div>`;
  } else if(_at==='import'){
    ct.innerHTML=`<div class="card"><div class="cb">
      <p style="font-size:13px;color:var(--t2);margin-bottom:14px;line-height:1.6">Import your Excel recovery sheet. Units, clients, prices, and pending amounts are read automatically. <b>Existing unit data will be replaced.</b></p>
      <div class="iz" onclick="document.getElementById('xl-f').click()" ondragover="event.preventDefault();this.classList.add('dg')" ondragleave="this.classList.remove('dg')" ondrop="hDrop(event)">
        <div class="iz-ic">📊</div><div class="iz-t">Click to select Excel file (.xlsx)</div><div class="iz-s">Or drag and drop your Nexunova Recovery Sheet</div>
      </div>
      <input id="xl-f" type="file" accept=".xlsx,.xls" style="display:none" onchange="readXL(this)">
      <div id="xl-prv" style="margin-top:14px"></div>
      <div id="xl-act" style="margin-top:12px;display:none"><button class="btn btn-g" onclick="doImport()">✓ Import & Replace Unit Data</button></div>
      <div style="margin-top:16px;padding:12px;background:var(--warn-bg);border-radius:var(--rs);font-size:12px;color:var(--warn)">⚠️ Already imported: ${db.units[S.cid]?.length||0} units loaded from Excel. Import again only if data has changed.</div>
    </div></div>`;
  } else if(_at==='data'){
    ct.innerHTML=`<div class="card"><div class="cb" style="display:flex;flex-direction:column;gap:10px;max-width:320px">
      <p style="font-size:12px;color:var(--t3)">Backup and restore all system data</p>
      <button class="btn btn-d" onclick="bkpData()">⬇ Download Backup File</button>
      <button class="btn btn-gh" onclick="rstData()">⬆ Restore from Backup</button>
      <button class="btn btn-r" style="margin-top:6px" onclick="rstSeed()">⚠ Reset to Original Excel Data</button>
    </div></div>`;
  } else if(_at==='log'){
    // Task 5: Activity Log viewer
    const logs=(db.log||[]).slice(0,100);
    const typeClr={rec:'var(--ok)',con:'var(--info)',sell:'var(--brand)','del-rec':'var(--err)'};
    ct.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700">Last ${logs.length} activities</div>
      ${S.role==='admin'?`<button class="btn btn-r btn-sm" onclick="clearLog()">🗑 Clear Log</button>`:''}
    </div>
    <div class="card"><div class="tw"><table class="t"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr></thead><tbody>
    ${!logs.length?'<tr><td colspan="4" style="text-align:center;color:var(--t3);padding:24px">No activity recorded yet</td></tr>':
      logs.map(l=>{
        const clr=typeClr[l.type]||'var(--t3)';
        const ts=l.time?new Date(l.time).toLocaleString('en-PK',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
        return `<tr style="border-left:3px solid ${clr}"><td style="font-size:11px;color:var(--t3);white-space:nowrap">${ts}</td><td style="font-size:12px;font-weight:600">${esc(l.user||'?')}</td><td><span class="badge" style="background:${clr}22;color:${clr}">${l.type||'?'}</span></td><td style="font-size:12px;color:var(--t2);max-width:300px;word-break:break-word">${esc(l.msg||'—')}</td></tr>`;
      }).join('')}
    </tbody></table></div></div>`;
  } else if(_at==='settings'){
    const settings=db.settings||{overdueDays:30};
    const existLogo=(db.companies||[]).find(c=>c.id===S.cid)?.logo||null;
    ct.innerHTML=`<div class="card"><div class="cb" style="max-width:460px">
      <h3 style="margin-bottom:16px;font-size:15px">System Settings</h3>

      <div style="margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid var(--line)">
        <div style="font-size:13px;font-weight:700;margin-bottom:3px">Company Logo</div>
        <p style="font-size:11px;color:var(--t3);margin:0 0 10px;line-height:1.6">Appears in the sidebar, topbar, and all printed documents.</p>
        <div id="logo-prev-wrap" style="margin-bottom:10px;padding:12px;background:var(--canvas);border:1.5px dashed var(--line);border-radius:var(--rm);min-height:64px;display:flex;align-items:center;justify-content:center">
          ${existLogo
            ? `<img src="${existLogo}" style="max-height:60px;max-width:180px;object-fit:contain">`
            : `<span style="font-size:11px;color:var(--t3)">No logo uploaded</span>`}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-gh btn-sm" onclick="document.getElementById('logo-inp').click()">📤 Upload PNG Logo</button>
          ${existLogo?`<button class="btn btn-r btn-sm" onclick="removeCoLogo()">✕ Remove Logo</button>`:''}
          <input type="file" id="logo-inp" accept=".png" style="display:none" onchange="uploadCoLogo(this)">
        </div>
        <p style="font-size:10px;color:var(--warn);margin:8px 0 0;line-height:1.5">⚠ PNG with transparent background recommended &mdash; Use <b>remove.bg</b> for free background removal &mdash; Max 2MB (auto-compressed)</p>
      </div>

      <div class="fr" style="margin-bottom:14px">
        <label class="fl">Overdue Threshold (days)</label>
        <p style="font-size:11px;color:var(--t3);margin-bottom:6px">Units with no payment for this many days are marked overdue</p>
        <input id="set-od" class="inp-light" style="width:100%;padding:10px 13px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px;outline:none" type="number" min="1" max="365" value="${settings.overdueDays||30}">
      </div>
      <button class="btn btn-g" onclick="saveSettings()">Save Settings</button>
    </div></div>`;
  }
}
function clearLog(){
  if(!confirm('Clear all activity logs? This cannot be undone.'))return;
  const db=gdb();db.log=[];sdb(db);toast('Activity log cleared','ok');rAT();
}
function saveSettings(){
  const od=parseInt(document.getElementById('set-od')?.value)||30;
  const db=gdb();db.settings=db.settings||{};db.settings.overdueDays=od;
  sdb(db);toast('Settings saved ✅','ok');
}
function bkpData(){const db=gdb();const j=JSON.stringify({data:db,at:new Date().toISOString(),v:'v5'});const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([j],{type:'application/json'}));a.download=`Nexunova_backup_${td()}.json`;a.click();toast('Backup downloaded','ok');}
function rstData(){const inp=document.createElement('input');inp.type='file';inp.accept='.json';inp.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const bk=JSON.parse(ev.target.result);const d=bk.data||bk;if(!d.users)throw new Error();localStorage.setItem(STORE,JSON.stringify(d));toast('Data restored!','ok');setTimeout(()=>location.reload(),900);}catch{toast('Invalid backup file','err');}};r.readAsText(f);};document.body.appendChild(inp);inp.click();document.body.removeChild(inp);}
function rstSeed(){if(!confirm('Reset all data to original Excel import? All added payments and call logs will be lost.'))return;localStorage.removeItem(STORE);localStorage.removeItem(OLD_STORE);toast('Data reset','warn');setTimeout(()=>location.reload(),900);}

// ══ EXCEL IMPORT ══════════════════════════════
function readXL(inp){
  const f=inp.files[0];if(!f)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      if(typeof XLSX==='undefined'){toast('SheetJS not loaded — use online','warn');return;}
      const wb=XLSX.read(e.target.result,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      let hr=-1;
      for(let i=0;i<raw.length;i++){const r=raw[i].map(v=>String(v).toUpperCase());if(r.some(v=>v.includes('UNIT #')||v.includes('CLIENT NAME'))){hr=i;break;}}
      if(hr<0){toast('Cannot find data in file','err');return;}
      const hdrs=raw[hr];
      const getv=(names)=>{for(const nm of names){const idx=hdrs.findIndex(h=>String(h).toUpperCase().includes(nm.toUpperCase()));if(idx>=0&&raw[0][idx]!==undefined&&raw[0][idx]!=='')return undefined;}};
      const get=(r,names)=>{for(const nm of names){const idx=hdrs.findIndex(h=>String(h).toUpperCase().includes(nm.toUpperCase()));if(idx>=0&&r[idx]!==undefined&&String(r[idx])!=='')return r[idx];}return '';};
      const fl_map={'G':'Ground Floor','UG':'Lower Ground','1':'1st Floor','2':'2nd Floor','3':'3rd Floor','4':'4th Floor','5':'5th Floor','6':'6th Floor','7':'7th Floor','8':'8th Floor','9':'9th Floor'};
      const tp_map={'SHOP':'Shop','1 BED':'1 Bed','2 BED':'2 Bed','3 BED':'3 Bed','PARK 2 BED':'Park 2 Bed','PARK 3 BED':'Park 3 Bed'};
      const units=[];
      for(let i=hr+1;i<raw.length;i++){
        const r=raw[i];
        const unitNo=String(get(r,['UNIT #','UNIT#'])||'').trim();
        const floor=String(get(r,['FLOOR'])||'').trim();
        if(!unitNo||!floor||unitNo==='D'||floor==='D')continue;
        const client=String(get(r,['CLIENT NAME'])||'').trim();
        const price=parseFloat(get(r,['FINAL PRICE'])||0)||0;
        const pendency=parseFloat(get(r,['PENDENCY AMOUNT','PENDENCY AFTER'])||0)||0;
        const type=String(get(r,['TYPE'])||'').trim();
        const area=parseFloat(get(r,['AREA'])||0)||0;
        const booking=String(get(r,['BOOKING #','BOOKING#'])||'').trim();
        const phone=String(get(r,['CONTACT #','CONTACT#'])||'').trim();
        const sp=String(get(r,['C/O','SALE PERSON','SOLD BY'])||'').trim();
        const remarks=String(get(r,['REMARKS'])||'').trim();
        const hasC=!!(client&&client!=='0'&&price>0);
        let status='Available';
        if(hasC){if(remarks.toUpperCase().includes('ADJUSTMENT'))status='Adjustment';else if(remarks.toUpperCase().includes('CASH DEAL')||remarks.toUpperCase().includes('FULLY PAID'))status='CashSale';else status='Installment';}
        units.push({id:'ui'+uid(),unitNo,floor,floorLabel:fl_map[floor]||floor,type:tp_map[type.toUpperCase()]||type,area,bookingNo:booking!=='nan'?booking:'',status,customerName:hasC?client:'',phone:phone!=='nan'&&phone!=='0'?phone:'',totalPrice:hasC?price:0,totalPaid:hasC?Math.max(0,price-Math.max(0,pendency)):0,pendingAmount:hasC?Math.max(0,pendency):0,soldBy:sp!=='nan'?sp:'',remarks:remarks!=='nan'?remarks:'',receiptNo:'',lastPaymentDate:'',soldDate:'',companyId:S.cid});
      }
      _xlrows=units;
      const sold=units.filter(u=>u.status!=='Available').length;
      const prv=document.getElementById('xl-prv');if(prv)prv.innerHTML=`<div style="background:var(--ok-bg);border-radius:var(--rs);padding:12px;font-size:13px;color:var(--ok)">✅ <b>${units.length} units</b> found — ${sold} sold, ${units.length-sold} available</div>`;
      const act=document.getElementById('xl-act');if(act)act.style.display='block';
    }catch(err){toast('Error: '+err.message,'err');}
  };
  reader.readAsArrayBuffer(f);
}
function hDrop(e){e.preventDefault();document.querySelector('.iz')?.classList.remove('dg');const f=e.dataTransfer.files[0];if(f){const fi={files:[f]};readXL(fi);}}
function doImport(){
  if(!_xlrows.length){toast('No data to import','warn');return;}
  if(!confirm(`Import ${_xlrows.length} units? This replaces existing unit data.`))return;
  const db=gdb();const cnt=_xlrows.length;db.units[S.cid]=_xlrows;sdb(db);_xlrows=[];
  toast(`${cnt} units imported successfully!`,'ok');nav('dashboard');
}

// ══ LOGO UPLOAD ═══════════════════════════════
function uploadCoLogo(inp){
  const f=inp.files[0];
  if(!f)return;
  if(f.type!=='image/png'){toast('PNG files only','err');inp.value='';return;}
  if(f.size>2*1024*1024){toast('Max size is 2 MB','err');inp.value='';return;}
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const maxW=300,maxH=120;
      let w=img.width,h=img.height;
      if(w>maxW||h>maxH){const sc=Math.min(maxW/w,maxH/h);w=Math.round(w*sc);h=Math.round(h*sc);}
      const canvas=document.createElement('canvas');
      canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d');
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(img,0,0,w,h);
      const logo=canvas.toDataURL('image/png',0.8);
      const db=gdb();
      const idx=(db.companies||[]).findIndex(c=>c.id===S.cid);
      if(idx<0){toast('Company not found','err');return;}
      db.companies[idx].logo=logo;
      sdb(db);
      const wrap=document.getElementById('logo-prev-wrap');
      if(wrap)wrap.innerHTML=`<img src="${logo}" style="max-height:60px;max-width:180px;object-fit:contain">`;
      if(typeof updateCoLogo==='function')updateCoLogo();
      toast('Logo saved!','ok');
      inp.value='';
      setTimeout(()=>rAT(),120);
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(f);
}

function removeCoLogo(){
  if(!confirm('Remove company logo?'))return;
  const db=gdb();
  const idx=(db.companies||[]).findIndex(c=>c.id===S.cid);
  if(idx<0)return;
  delete db.companies[idx].logo;
  sdb(db);
  if(typeof updateCoLogo==='function')updateCoLogo();
  toast('Logo removed','ok');
  rAT();
}


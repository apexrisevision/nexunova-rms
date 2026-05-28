// ══ ADMIN PAGE ════════════════════════════════
function rAdmin(){
  if(S.role!=='admin' && S.role!=='owner'){nav('dashboard');return;}
  if(!_at || _at==='users' || _at==='audit') _at='settings';

  const _cards=[
    {t:'users',    ic:'users',       lb:'Users',         sub:'Team accounts & roles',    col:'#2563EB'},
    {t:'import',   ic:'file-text',   lb:'Import Excel',  sub:'Bulk data import',         col:'#10B981'},
    {t:'data',     ic:'database',    lb:'Backup',        sub:'Export & restore data',    col:'#0EA5E9'},
    {t:'log',      ic:'history',     lb:'Activity Log',  sub:'Track user actions',       col:'#F59E0B'},
    {t:'settings', ic:'settings',    lb:'Settings',      sub:'System configuration',     col:'#6366F1'},
    {t:'security', ic:'shield',      lb:'Security',      sub:'Auth & access control',    col:'#EF4444'},
    {t:'profile',  ic:'building-2',  lb:'Company',       sub:'Profile & branding',       col:'#8B5CF6'},
    {t:'plan',     ic:'layers',      lb:'Plan & Usage',  sub:'Subscription & limits',    col:'#A855F7'},
    {t:'audit',    ic:'list-checks', lb:'Audit Trail',   sub:'Full event history',       col:'#14B8A6'},
  ];

  const h=new Date().getHours();
  const greet=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  const planBadge=S.planCode?`<span class="adm-plan-badge">${esc(S.planCode)}</span>`:'';
  const roleLbl=S.role==='owner'?'Owner':'Admin';

  document.getElementById('pg-admin').innerHTML=`<div class="ani module-executive">
    <div class="adm-hero">
      <div class="adm-hero-ic">${_sbi('settings',22)}</div>
      <div class="adm-hero-txt">
        <div class="adm-hero-sup">${greet}, ${esc(S.name||S.username||'Admin')}</div>
        <h2 class="adm-hero-ttl">Admin Panel</h2>
        <div class="adm-hero-meta">
          ${S.coName?`<span class="adm-hero-co">${esc(S.coName)}</span>`:''}
          <span class="adm-role-pill">${roleLbl}</span>
          ${planBadge}
        </div>
      </div>
    </div>
    <div class="adm-nav-grid">
      ${_cards.map(c=>`<div class="adm-nav-card${_at===c.t?' on':''}" onclick="setAT('${c.t}')" style="--adm-accent:${c.col}"><div class="adm-nav-card-ic">${_sbi(c.ic,18)}</div><div class="adm-nav-card-body"><span class="adm-nav-card-lbl">${c.lb}</span><span class="adm-nav-card-sub">${c.sub}</span></div></div>`).join('')}
    </div>
    <div id="a-ct"></div>
  </div>`;
  rAT();
}
function setAT(t){_at=t;document.querySelectorAll('.adm-nav-card').forEach(a=>a.classList.remove('on'));document.querySelector(`.adm-nav-card[onclick="setAT('${t}')"]`)?.classList.add('on');rAT();}
function rAT(){
  const ct=document.getElementById('a-ct');if(!ct)return;
  const db=gdb();
  if(_at==='users'){
    nav('users');
    return;
  } else if(_at==='import'){
    ct.innerHTML=`<div class="card"><div class="cb">
      <p style="font-size:13px;color:var(--t2);margin-bottom:14px;line-height:1.6">Import your Excel recovery sheet. Units, clients, prices, and pending amounts are read automatically. <b>Existing unit data will be replaced.</b></p>
      <div class="iz" onclick="document.getElementById('xl-f').click()" ondragover="event.preventDefault();this.classList.add('dg')" ondragleave="this.classList.remove('dg')" ondrop="hDrop(event)">
        <div class="iz-ic"><svg width="28" height="28" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg></div><div class="iz-t">Click to select Excel file (.xlsx)</div><div class="iz-s">Or drag and drop your Nexunova Recovery Sheet</div>
      </div>
      <input id="xl-f" type="file" accept=".xlsx,.xls" style="display:none" onchange="readXL(this)">
      <div id="xl-prv" style="margin-top:14px"></div>
      <div id="xl-act" style="margin-top:12px;display:none"><button class="btn btn-g" onclick="doImport()">✓ Import & Replace Unit Data</button></div>
      <div style="margin-top:16px;padding:12px;background:var(--warn-bg);border-radius:var(--rs);font-size:12px;color:var(--warn)">Already imported: ${db.units[S.cid]?.length||0} units loaded from Excel. Import again only if data has changed.</div>
    </div></div>`;
  } else if(_at==='data'){
    ct.innerHTML=`<div class="card"><div class="cb" style="display:flex;flex-direction:column;gap:10px;max-width:320px">
      <p style="font-size:12px;color:var(--t3)">Backup and restore all system data</p>
      <button class="btn btn-d" onclick="bkpData()">⬇ Download Backup File</button>
      <button class="btn btn-gh" onclick="rstData()">⬆ Restore from Backup</button>
      <button class="btn btn-r" style="margin-top:6px" onclick="rstSeed()">Reset to Original Excel Data</button>
    </div></div>`;
  } else if(_at==='log'){
    // Task 5: Activity Log viewer
    const logs=(db.log||[]).slice(0,100);
    const typeClr={rec:'var(--ok)',con:'var(--info)',sell:'var(--brand)','del-rec':'var(--err)'};
    ct.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700">Last ${logs.length} activities</div>
      ${S.role==='admin'?`<button class="btn btn-r btn-sm" onclick="clearLog()">Clear Log</button>`:''}
    </div>
    <div class="card"><div class="tw"><table class="t"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr></thead><tbody>
    ${!logs.length?'<tr><td colspan="4" style="text-align:center;color:var(--t3);padding:24px">No activity recorded yet</td></tr>':
      logs.map(l=>{
        const clr=typeClr[l.type]||'var(--t3)';
        const ts=l.time?new Date(l.time).toLocaleString('en-PK',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
        return `<tr style="border-left:3px solid ${clr}"><td style="font-size:11px;color:var(--t3);white-space:nowrap">${ts}</td><td style="font-size:12px;font-weight:600">${esc(l.user||'?')}</td><td><span class="badge" style="background:${clr}22;color:${clr}">${l.type||'?'}</span></td><td style="font-size:12px;color:var(--t2);max-width:300px;word-break:break-word">${esc(l.msg||'—')}</td></tr>`;
      }).join('')}
    </tbody></table></div></div>`;
  } else if(_at==='profile'){
    if(typeof rBranding==='function') rBranding(ct);
    else _adminLoadProfile(ct);
    return;
  } else if(_at==='plan'){
    _adminLoadPlan(ct);
    return;
  } else if(_at==='audit'){
    nav('audit');
    return;
  } else if(_at==='settings'){
    _adminLoadSettings(ct);
    return;
  } else if(_at==='security'){
    _adminLoadSecurity(ct);
    return;
  }
}
function clearLog(){
  if(!confirm('Clear all activity logs? This cannot be undone.'))return;
  const db=gdb();db.log=[];sdb(db);toast('Activity log cleared','ok');rAT();
}
async function saveSettings(){
  if (typeof demoGuard === 'function' && demoGuard('Save Settings')) return;
  const od=parseInt(document.getElementById('set-od')?.value)||30;
  localStorage.setItem('rms_od_'+S.cid, od);
  const mtgt = parseAmt(document.getElementById('set-mtgt')?.value||'0');
  const atgt = parseAmt(document.getElementById('set-atgt')?.value||'0');
  try {
    await supabase.rpc('save_company_targets', { p_company_id: S.cid, p_monthly: mtgt, p_annual: atgt });
  } catch(e) { console.warn('save_company_targets:', e.message); }
  toast('Settings saved','ok');
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
      const prv=document.getElementById('xl-prv');if(prv)prv.innerHTML=`<div style="background:var(--ok-bg);border-radius:var(--rs);padding:12px;font-size:13px;color:var(--ok)"><b>${units.length} units</b> found — ${sold} sold, ${units.length-sold} available</div>`;
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
      localStorage.setItem('rms_logo_'+S.cid, logo);
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
  localStorage.removeItem('rms_logo_'+S.cid);
  if(typeof updateCoLogo==='function')updateCoLogo();
  toast('Logo removed','ok');
  rAT();
}

// ── Settings ──────────────────────────────────────────────────────

async function _adminLoadSettings(ct) {
  const existLogo = localStorage.getItem('rms_logo_'+S.cid) || null;
  const od = parseInt(localStorage.getItem('rms_od_'+S.cid)) || 30;
  let monthTgt = 0, annualTgt = 0;
  try {
    const { data: tgt } = await supabase.rpc('get_company_targets', { p_company_id: S.cid });
    if (tgt) { monthTgt = Number(tgt.monthly_target||0); annualTgt = Number(tgt.annual_target||0); }
  } catch(_) {}

  ct.innerHTML = `<div class="card"><div class="cb" style="max-width:460px">
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
        <button class="btn btn-gh btn-sm" onclick="document.getElementById('logo-inp').click()">Upload PNG Logo</button>
        ${existLogo?`<button class="btn btn-r btn-sm" onclick="removeCoLogo()">✕ Remove Logo</button>`:''}
        <input type="file" id="logo-inp" accept=".png" style="display:none" onchange="uploadCoLogo(this)">
      </div>
      <p style="font-size:10px;color:var(--warn);margin:8px 0 0;line-height:1.5">PNG with transparent background recommended — Use <b>remove.bg</b> for free background removal — Max 2MB (auto-compressed)</p>
    </div>

    <div class="fr" style="margin-bottom:14px">
      <label class="fl">Overdue Threshold (days)</label>
      <p style="font-size:11px;color:var(--t3);margin-bottom:6px">Units with no payment for this many days are marked overdue</p>
      <input id="set-od" class="inp-light" style="width:100%;padding:10px 13px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px;outline:none" type="number" min="1" max="365" value="${od}">
    </div>

    <div style="margin-bottom:20px;padding:14px;background:var(--canvas);border:1px solid var(--line);border-radius:var(--rm)">
      <div style="font-size:13px;font-weight:700;margin-bottom:10px">Recovery Targets</div>
      <p style="font-size:11px;color:var(--t3);margin:0 0 10px;line-height:1.5">Show target vs actual progress on the dashboard. Leave 0 to disable.</p>
      <div class="g2">
        <div class="fr">
          <label class="fl">Monthly Target (PKR)</label>
          <input id="set-mtgt" class="inp-light inp-amt" value="${monthTgt||0}" style="width:100%;padding:10px 13px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px">
        </div>
        <div class="fr">
          <label class="fl">Annual Target (PKR)</label>
          <input id="set-atgt" class="inp-light inp-amt" value="${annualTgt||0}" style="width:100%;padding:10px 13px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:13px">
        </div>
      </div>
    </div>

    <div style="margin-top:24px;margin-bottom:20px;padding:16px;background:var(--canvas);border:1px solid var(--line);border-radius:var(--rm)">
      <div style="font-size:13px;font-weight:700;margin-bottom:6px">Setup Wizard</div>
      <p style="font-size:11px;color:var(--t3);margin:0 0 12px;line-height:1.55">Re-run the 6-step setup wizard anytime to add more sites or users, or to tweak company profile / branding / business rules.</p>
      <button class="btn btn-gh btn-sm" onclick="if(typeof OB!=='undefined' &amp;&amp; S&amp;&amp;S.cid) OB.show(S.cid); else toast('Wizard not available','err');">⚙ Re-run Setup Wizard</button>
    </div>

    <button class="btn btn-g" onclick="saveSettings()">Save Settings</button>
  </div></div>`;
}

// ── Company Profile (Supabase) ────────────────────────────────────

async function _adminLoadProfile(ct) {
  ct.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:16px 0">⏳ Loading…</div>';
  try {
    const { data, error } = await supabase.rpc('get_company_profile', { p_company_id: S.cid });
    if (error) throw error;
    const typeOpts = ['real_estate','housing_society','property_management','real_estate_agency','developer','builder','construction','marketing','rental','mixed','other']
      .map(t => `<option value="${t}" ${data.company_type===t?'selected':''}>${t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`).join('');
    ct.innerHTML = `<div class="card"><div class="cb" style="max-width:500px">
      <h3 style="margin-bottom:16px;font-size:15px">Company Profile</h3>
      <div class="g2">
        <div class="fr"><label class="fl">Company Name <span style="color:var(--err)">*</span></label><input id="cp-name" class="inp-light" value="${esc(data.company_name||'')}"></div>
        <div class="fr"><label class="fl">Company Type</label><select id="cp-type" class="inp-light">${typeOpts}</select></div>
        <div class="fr"><label class="fl">Business Email</label><input id="cp-email" class="inp-light" type="email" value="${esc(data.business_email||'')}"></div>
        <div class="fr"><label class="fl">Business Phone</label><input id="cp-phone" class="inp-light" type="tel" value="${esc(data.business_phone||'')}"></div>
        <div class="fr"><label class="fl">City</label><input id="cp-city" class="inp-light" value="${esc(data.city||'')}"></div>
        <div class="fr"><label class="fl">Country</label><input id="cp-country" class="inp-light" value="${esc(data.country||'Pakistan')}"></div>
      </div>
      <div class="fr" style="margin-top:2px"><label class="fl">Address</label><textarea id="cp-address" class="inp-light" rows="2">${esc(data.address||'')}</textarea></div>
      <div style="margin-top:14px"><button class="btn btn-g" id="cp-save-btn" onclick="saveCoProfile()">Save Company Profile</button></div>
    </div></div>`;
  } catch (e) {
    ct.innerHTML = `<div style="color:var(--err);font-size:12px">Could not load profile: ${esc(e.message)}</div>`;
  }
}

async function saveCoProfile() {
  const name = document.getElementById('cp-name')?.value?.trim();
  if (!name) { toast('Company name is required', 'warn'); return; }
  const btn = document.getElementById('cp-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const { error } = await supabase.rpc('update_company_profile', {
      p_company_id: S.cid,
      p_data: {
        company_name:   name,
        company_type:   document.getElementById('cp-type')?.value   || 'real_estate',
        business_email: document.getElementById('cp-email')?.value?.trim()   || null,
        business_phone: document.getElementById('cp-phone')?.value?.trim()   || null,
        city:           document.getElementById('cp-city')?.value?.trim()    || null,
        country:        document.getElementById('cp-country')?.value?.trim() || 'Pakistan',
        address:        document.getElementById('cp-address')?.value?.trim() || null,
      }
    });
    if (error) throw error;
    S.coName = name;
    sessionStorage.setItem('nxn_sess', JSON.stringify(S));
    const sbCo = document.getElementById('sb-co'); if (sbCo) sbCo.textContent = name;
    toast('Company profile saved', 'ok');
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Company Profile'; }
  }
}

// ── Plan & Usage (Supabase) ───────────────────────────────────────

async function _adminLoadPlan(ct) {
  ct.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:16px 0">⏳ Loading plan…</div>';
  try {
    const { data: usage } = await supabase.rpc('get_plan_usage_admin', { p_company_id: S.cid });
    const sub  = usage || {};
    const plan = sub.subscription_plans || {};
    const cnts = [Number(usage?.count_units||0), Number(usage?.count_projects||0), Number(usage?.count_users||0)];
    const maxes= [plan.max_units||0, plan.max_projects||0, plan.max_users||0];
    const lbls = ['Units','Projects','Users'];
    const scol = {trialing:'#f59e0b',active:'#22c55e',past_due:'#ef4444',cancelled:'#94a3b8',expired:'#94a3b8',pending_payment:'#f59e0b'}[sub.status] || '#94a3b8';
    const bar  = (used,max) => { const pct=max?Math.min(100,Math.round(used/max*100)):0; return `<div style="background:var(--line);border-radius:4px;height:6px;margin-top:5px;overflow:hidden"><div style="background:${pct>85?'#ef4444':'var(--brand)'};width:${pct}%;height:100%;border-radius:4px"></div></div>`; };
    const usageCards = lbls.map((l,i) => `<div style="padding:14px;background:var(--canvas);border:1px solid var(--line);border-radius:var(--r)">
      <div style="font-size:10px;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:.5px">${l}</div>
      <div style="font-size:20px;font-weight:800;color:var(--text);margin:4px 0">${cnts[i]} <span style="font-size:12px;color:var(--t3);font-weight:400">/ ${maxes[i]||'∞'}</span></div>
      ${bar(cnts[i], maxes[i])}
    </div>`).join('');
    ct.innerHTML = `<div class="card mb14"><div class="cb">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;flex-wrap:wrap">
        <div>
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Current Plan</div>
          <div style="font-size:22px;font-weight:800;color:var(--brand)">${esc(plan.plan_name||S.planCode||'—')}</div>
        </div>
        <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:${scol}18;color:${scol};border:1px solid ${scol}44">${(sub.status||'unknown').replace(/_/g,' ')}</span>
        ${plan.price ? `<span style="font-size:12px;color:var(--t3)">${plan.currency||'PKR'} ${fM(plan.price)} / ${sub.billing_cycle||'mo'}</span>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:18px">${usageCards}</div>
      ${sub.current_period_end ? `<div style="font-size:12px;color:var(--t3)">Period ends: <strong>${fD(sub.current_period_end.split('T')[0])}</strong></div>` : ''}
      ${(() => {
        if (!sub.trial_ends_at) return '';
        const dLeft = Math.ceil((new Date(sub.trial_ends_at) - Date.now()) / 86400000);
        const col = dLeft <= 0 ? '#ef4444' : dLeft <= 3 ? '#ef4444' : '#f59e0b';
        const msg = dLeft <= 0 ? 'Trial expired' : `Trial ends in <strong>${dLeft} day${dLeft===1?'':'s'}</strong> (${fD(sub.trial_ends_at.split('T')[0])})`;
        return `<div style="font-size:12px;color:${col};margin-top:4px">${msg}</div>`;
      })()}
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-p btn-sm" onclick="_adminOpenUpgradeRequest()">⬆ Request Upgrade</button>
        <a href="mailto:sales@nexunova.com" class="btn btn-gh btn-sm" style="text-decoration:none">Email Sales</a>
      </div>
      <div id="admin-upgrade-form" style="display:none;margin-top:14px;padding:14px;background:var(--canvas);border:1px solid var(--line);border-radius:8px">
        <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px">Upgrade Request</div>
        <div class="fg"><label class="fl">Desired Plan</label>
          <select id="au-plan" class="fi">
            <option value="Starter">Starter</option>
            <option value="Growth" selected>Growth</option>
            <option value="Professional">Professional</option>
            <option value="Enterprise">Enterprise</option>
          </select>
        </div>
        <div class="fg"><label class="fl">Message (optional)</label>
          <textarea id="au-msg" class="fi" rows="2" placeholder="Any specific requirements or questions…"></textarea>
        </div>
        <div id="au-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
          <button class="btn btn-g btn-sm" onclick="document.getElementById('admin-upgrade-form').style.display='none'">Cancel</button>
          <button class="btn btn-p btn-sm" id="au-submit-btn" onclick="_adminSubmitUpgrade()">Send Request</button>
        </div>
      </div>
    </div></div>`;
  } catch (e) {
    ct.innerHTML = `<div style="color:var(--err);font-size:12px">Could not load plan: ${esc(e.message)}</div>`;
  }
}

function _adminOpenUpgradeRequest() {
  const form = document.getElementById('admin-upgrade-form');
  if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
}

async function _adminSubmitUpgrade() {
  const plan = document.getElementById('au-plan')?.value || 'Growth';
  const msg  = document.getElementById('au-msg')?.value  || '';
  const btn  = document.getElementById('au-submit-btn');
  const err  = document.getElementById('au-err');
  if (err)  err.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const { data, error } = await supabase.rpc('create_sa_support_ticket', {
      p_data: {
        company_id:   S.cid,
        company_name: S.company || '',
        submitted_by: S.name || S.username || '',
        subject:      `Upgrade Request — ${plan} Plan`,
        body:         `Company: ${S.company || ''}\nUser: ${S.name||S.username||''}\nDesired Plan: ${plan}\n\n${msg}`.trim(),
        category:     'billing',
        priority:     'high'
      }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast('Upgrade request sent — we will contact you shortly', 'ok');
    const form = document.getElementById('admin-upgrade-form');
    if (form) form.style.display = 'none';
  } catch(e) {
    if (err) err.textContent = e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Request'; }
  }
}

// ── Supabase Audit Trail ──────────────────────────────────────────

async function _adminLoadAudit(ct) {
  ct.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:16px 0">⏳ Loading audit trail…</div>';
  try {
    const { data: feed } = await supabase.rpc('get_admin_audit_feed', { p_company_id: S.cid, p_limit: 80 });
    const entries = [
      ...((feed?.transfers)||[]).map(r  => ({ts:r.created_at, icon:'', type:'Transfer',  desc:`Unit ${r.units?.unit_no||'—'} — ${r.from_owner} → ${r.to_owner}`, by:r.created_by})),
      ...((feed?.reminders)||[]).map(r => ({ts:r.sent_at,    icon:'', type:'Reminder',  desc:`${(r.reminder_type||'').toUpperCase()} to ${r.client_name||'—'} · PKR ${fM(r.amount_due||0)}`, by:r.sent_by})),
      ...((feed?.possessions)||[]).map(r => ({ts:r.updated_at, icon:'', type:'Possession',desc:`Unit ${r.units?.unit_no||'—'} — ${r.status} · ${r.client_name||'—'}`, by:r.created_by})),
    ].sort((a,b) => (b.ts||'').localeCompare(a.ts||'')).slice(0, 80);

    const typeColor = {'Transfer':'#6C63FF','Reminder':'#f59e0b','Possession':'#22c55e'};
    const rows = entries.length === 0
      ? '<tr><td colspan="4" style="text-align:center;color:var(--t3);padding:28px">No Supabase events found yet</td></tr>'
      : entries.map(e => {
          const ts  = e.ts ? new Date(e.ts).toLocaleString('en-PK',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
          const col = typeColor[e.type] || 'var(--t3)';
          return `<tr><td style="font-size:11px;color:var(--t3);white-space:nowrap">${ts}</td>
            <td><span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:${col}18;color:${col}">${e.type}</span></td>
            <td style="font-size:12px;color:var(--t2);max-width:300px;word-break:break-word">${esc(e.desc)}</td>
            <td style="font-size:11px;color:var(--t3)">${esc(e.by||'—')}</td></tr>`;
        }).join('');
    ct.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-size:12px;color:var(--t3)">Last ${entries.length} events · Transfers, Reminders, Possessions</div>
      <button class="btn btn-gh btn-sm" onclick="_adminLoadAudit(document.getElementById('a-ct'))">↺ Refresh</button>
    </div>
    <div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Time</th><th>Type</th><th>Details</th><th>By</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
  } catch (e) {
    ct.innerHTML = `<div style="color:var(--err);font-size:12px">Could not load audit trail: ${esc(e.message)}</div>`;
  }
}

// ══ CHANGE PASSWORD PAGE ══════════════════════════════════════════════

function rChangepassword() {
  const el = document.getElementById('pg-changepassword');
  if (!el) return;

  el.innerHTML = `
    <div class="ph">
      <div>
        <h2>Change Password</h2>
        <p>Update your login password. You will stay logged in after the change.</p>
      </div>
    </div>
    <div style="max-width:420px">
      <div class="card">
        <div class="cb" style="display:flex;flex-direction:column;gap:14px">
          <div class="fo">
            <label class="fl">Current Password *</label>
            <input id="cp-cur" class="fi" type="password" placeholder="Your current password" autocomplete="current-password">
          </div>
          <div class="fo">
            <label class="fl">New Password *</label>
            <input id="cp-new" class="fi" type="password" placeholder="Min 8 characters" autocomplete="new-password"
              oninput="document.getElementById('cp-match-hint').textContent=''">
          </div>
          <div class="fo">
            <label class="fl">Confirm New Password *</label>
            <input id="cp-conf" class="fi" type="password" placeholder="Repeat new password" autocomplete="new-password"
              oninput="document.getElementById('cp-match-hint').textContent=this.value&&this.value===document.getElementById('cp-new').value?'Passwords match':''">
            <div id="cp-match-hint" style="font-size:11px;color:var(--ok);margin-top:4px"></div>
          </div>
          <div id="cp-err" style="display:none;color:var(--err);font-size:12px;padding:6px 0"></div>
          <button class="btn btn-primary" id="cp-btn" onclick="submitChangePassword()" style="align-self:flex-start">
            Update Password
          </button>
        </div>
      </div>
    </div>`;
}

async function submitChangePassword() {
  const curPwd  = (document.getElementById('cp-cur')?.value  || '');
  const newPwd  = (document.getElementById('cp-new')?.value  || '');
  const confPwd = (document.getElementById('cp-conf')?.value || '');
  const errEl   = document.getElementById('cp-err');
  const btn     = document.getElementById('cp-btn');

  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = ''; } };

  if (!curPwd)             { showErr('Current password is required.'); return; }
  if (newPwd.length < 8)  { showErr('New password must be at least 8 characters.'); return; }
  if (newPwd !== confPwd) { showErr('New passwords do not match.'); return; }
  if (newPwd === curPwd)  { showErr('New password must be different from current password.'); return; }

  if (btn) btn.disabled = true;

  try {
    // Step 1: Verify current password via verify_login RPC
    const { data: chk, error: chkErr } = await supabase.rpc('verify_login', {
      p_company_code: S.coCode || '',
      p_username:     S.username || '',
      p_password:     curPwd
    });

    if (chkErr || !chk?.success) {
      showErr('Current password is incorrect.');
      if (btn) btn.disabled = false;
      return;
    }

    // Step 2: Update password via update_app_user RPC
    const { data: res, error: updErr } = await supabase.rpc('update_app_user', {
      p_user_id:    S.userId,
      p_company_id: S.cid,
      p_password:   newPwd
    });

    if (updErr) throw updErr;
    if (!res?.success) throw new Error(res?.message || 'Password update failed.');

    ['cp-cur','cp-new','cp-conf'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const hint = document.getElementById('cp-match-hint');
    if (hint) hint.textContent = '';

    notify.success('Password updated successfully.');

  } catch(e) {
    showErr(e.message || 'An error occurred. Please try again.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ══ MODULE 12 — SECURITY TAB ══════════════════════════════════════

async function _adminLoadSecurity(ct) {
  ct.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:16px 0">⏳ Loading security settings…</div>';

  const [settRes, ipRes, evRes, lockedRes] = await Promise.all([
    supabase.rpc('get_security_settings',  { p_company_id: S.cid }),
    supabase.rpc('get_ip_whitelist',       { p_company_id: S.cid }),
    supabase.rpc('get_auth_events',        { p_company_id: S.cid, p_limit: 30, p_offset: 0, p_event_type: null }),
    supabase.rpc('get_locked_users',       { p_company_id: S.cid }),
  ]);

  const cfg     = settRes.data  || {};
  const ipList  = Array.isArray(ipRes.data)  ? ipRes.data  : [];
  const events  = Array.isArray(evRes.data)  ? evRes.data  : [];
  const locked  = Array.isArray(lockedRes.data) ? lockedRes.data : [];

  const curTimeout = cfg.session_timeout_min ?? 120;

  const timeoutOpts = [
    { v:0,    l:'Never (disabled)' },
    { v:15,   l:'15 minutes' },
    { v:30,   l:'30 minutes' },
    { v:60,   l:'1 hour' },
    { v:120,  l:'2 hours (default)' },
    { v:240,  l:'4 hours' },
    { v:480,  l:'8 hours' },
  ].map(o => `<option value="${o.v}" ${Number(curTimeout)===o.v?'selected':''}>${o.l}</option>`).join('');

  const evColors = {
    login_success: '#22c55e', login_failed: '#ef4444',
    login_locked: '#f97316', logout: '#94a3b8',
    session_expired: '#a78bfa', ip_blocked: '#dc2626',
  };
  const evRows = events.length === 0
    ? '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--t3)">No auth events recorded yet</td></tr>'
    : events.map(e => {
        const col = evColors[e.event_type] || 'var(--t3)';
        const dt  = e.created_at ? new Date(e.created_at).toLocaleString('en-PK', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
        return `<tr>
          <td style="font-size:11px;color:var(--t3);white-space:nowrap">${dt}</td>
          <td><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${col}18;color:${col};border:1px solid ${col}44">${e.event_type}</span></td>
          <td style="font-size:12px">${esc(e.username||'—')}</td>
          <td style="font-size:11px;color:var(--t3)">${esc(e.ip_address||'—')}</td>
        </tr>`;
      }).join('');

  const ipRows = ipList.length === 0
    ? '<tr><td colspan="3" style="text-align:center;padding:16px;color:var(--t3);font-size:12px">No IP ranges added</td></tr>'
    : ipList.map(ip => `<tr>
        <td style="font-size:12px;font-family:monospace;font-weight:600">${esc(ip.ip_range)}</td>
        <td style="font-size:12px;color:var(--t3)">${esc(ip.label||'—')}</td>
        <td><button class="btn btn-r btn-xs" onclick="secRemoveIP('${ip.id}')">Remove</button></td>
      </tr>`).join('');

  const lockedHtml = locked.length === 0
    ? '<div style="font-size:12px;color:var(--t3);padding:8px 0">No users are currently locked out.</div>'
    : locked.map(u => {
        const unlockAt = u.locked_until ? new Date(u.locked_until).toLocaleString('en-PK',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)">
          <div>
            <div style="font-size:13px;font-weight:600">${esc(u.full_name)} <span style="font-size:11px;color:var(--t3)">(${esc(u.username)})</span></div>
            <div style="font-size:11px;color:var(--err)">Locked until ${unlockAt} · ${u.failed_login_attempts} failed attempts</div>
          </div>
          <button class="btn btn-gh btn-xs" onclick="secUnlockUser('${u.id}')">Unlock</button>
        </div>`;
      }).join('');

  ct.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:18px;padding-bottom:32px">

      <!-- Session Timeout -->
      <div class="card"><div class="cb">
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">Session Timeout</div>
        <p style="font-size:12px;color:var(--t3);margin:0 0 14px;line-height:1.6">Auto-logout users after a period of inactivity. Applies to all sessions on next login.</p>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <select id="sec-timeout" class="inp-light" style="min-width:200px">
            ${timeoutOpts}
          </select>
          <button class="btn btn-g" onclick="secSaveTimeout()">Save Timeout</button>
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--t3)">
          Current browser session timeout: <b>${curTimeout === 0 ? 'Disabled' : curTimeout + ' minutes'}</b>
        </div>
      </div></div>

      <!-- Failed Login / Lockout Status -->
      <div class="card"><div class="cb">
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">Account Lockout</div>
        <p style="font-size:12px;color:var(--t3);margin:0 0 10px;line-height:1.6">Accounts are locked for 15 minutes after 5 consecutive failed login attempts.</p>
        ${locked.length > 0 ? `<div style="font-size:11px;font-weight:700;color:var(--err);margin-bottom:8px">${locked.length} user${locked.length!==1?'s are':' is'} currently locked out:</div>` : ''}
        <div id="sec-locked-wrap">${lockedHtml}</div>
      </div></div>

      <!-- Admin Two-Factor Authentication -->
      <div class="card"><div class="cb">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="font-size:14px;font-weight:700">Two-Factor Authentication (Admins)</div>
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(34,197,94,.15);color:#22c55e">Recommended</span>
        </div>
        <p style="font-size:12px;color:var(--t3);margin:0 0 14px;line-height:1.6">
          When enabled, <b>Admin and Owner</b> accounts must enter a one-time code sent to their email at every sign-in.
          Requires the email service to be configured; if it is ever unreachable, sign-in proceeds without the code so you can never be locked out.
        </p>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;font-weight:600">
          <input type="checkbox" id="sec-2fa" ${cfg.require_2fa_admin ? 'checked' : ''} onchange="secSave2FA(this.checked)">
          Require email 2FA for Admin / Owner logins
        </label>
      </div></div>

      <!-- IP Whitelist -->
      <div class="card"><div class="cb">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="font-size:14px;font-weight:700">IP Whitelist</div>
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(99,102,241,.15);color:#818cf8">Enterprise</span>
        </div>
        <p style="font-size:12px;color:var(--t3);margin:0 0 14px;line-height:1.6">Restrict logins to specific IP addresses or CIDR ranges. Only used for access monitoring — enforcement requires Supabase Edge Functions.</p>
        <div class="tbl-wrap" style="margin-bottom:14px">
          <table class="data-tbl" id="sec-ip-tbl">
            <thead><tr><th>IP Range / Address</th><th>Label</th><th>Action</th></tr></thead>
            <tbody id="sec-ip-tbody">${ipRows}</tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input class="inp-light" id="sec-ip-range" placeholder="e.g. 203.123.45.67 or 192.168.1.0/24" style="flex:1;min-width:200px">
          <input class="inp-light" id="sec-ip-label" placeholder="Label (e.g. Office Karachi)" style="flex:1;min-width:160px">
          <button class="btn btn-gh" onclick="secAddIP()">Add IP</button>
        </div>
      </div></div>

      <!-- Recent Auth Events -->
      <div class="card"><div class="cb">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="font-size:14px;font-weight:700">Recent Login Events</div>
          <button class="btn btn-gh btn-xs" onclick="secExportAuthEvents()">Export CSV</button>
        </div>
        <div class="tbl-wrap">
          <table class="data-tbl">
            <thead><tr><th>Time</th><th>Event</th><th>Username</th><th>IP</th></tr></thead>
            <tbody>${evRows}</tbody>
          </table>
        </div>
      </div></div>

    </div>`;

  window._secAuthEvents = events;
}

async function secSaveTimeout() {
  const min = parseInt(document.getElementById('sec-timeout')?.value || '120', 10);
  const { data, error } = await supabase.rpc('save_security_settings', {
    p_company_id: S.cid,
    p_data: { session_timeout_min: min }
  });
  if (error || data?.success === false) { toast('Failed to save', 'err'); return; }
  if (typeof _setIdleTimeoutMin === 'function') _setIdleTimeoutMin(min);
  toast('Session timeout saved', 'ok');
}

async function secSave2FA(enabled) {
  // save_security_settings is merge-safe, so sending only this field preserves
  // the session timeout, lockout, and IP-whitelist settings.
  const { data, error } = await supabase.rpc('save_security_settings', {
    p_company_id: S.cid,
    p_data: { require_2fa_admin: !!enabled }
  });
  if (error || data?.success === false) {
    toast('Failed to save', 'err');
    const cb = document.getElementById('sec-2fa');
    if (cb) cb.checked = !enabled;   // revert the toggle on failure
    return;
  }
  toast(enabled ? 'Admin 2FA enabled' : 'Admin 2FA disabled', 'ok');
}

async function secAddIP() {
  const range = (document.getElementById('sec-ip-range')?.value || '').trim();
  const label = (document.getElementById('sec-ip-label')?.value || '').trim();
  if (!range) { toast('IP range is required', 'warn'); return; }
  const { data, error } = await supabase.rpc('add_ip_whitelist_entry', {
    p_company_id: S.cid,
    p_ip_range:   range,
    p_label:      label,
    p_created_by: S.name || S.username
  });
  if (error || data?.success === false) { toast(data?.error || 'Failed to add IP', 'err'); return; }
  toast('IP added', 'ok');
  _adminLoadSecurity(document.getElementById('a-ct'));
}

async function secRemoveIP(id) {
  if (!confirm('Remove this IP from the whitelist?')) return;
  const { data, error } = await supabase.rpc('remove_ip_whitelist_entry', {
    p_company_id: S.cid,
    p_id: id
  });
  if (error || data?.success === false) { toast('Failed to remove', 'err'); return; }
  toast('IP removed', 'ok');
  _adminLoadSecurity(document.getElementById('a-ct'));
}

async function secUnlockUser(userId) {
  if (!confirm('Unlock this user account?')) return;
  const { error } = await supabase.rpc('update_app_user', {
    p_user_id:    userId,
    p_company_id: S.cid,
    p_data: { locked_until: null, failed_login_attempts: 0 }
  });
  if (error) { toast('Failed to unlock: ' + error.message, 'err'); return; }
  toast('User unlocked', 'ok');
  _adminLoadSecurity(document.getElementById('a-ct'));
}

function secExportAuthEvents() {
  const events = window._secAuthEvents || [];
  if (!events.length) { toast('No events to export', 'warn'); return; }
  const headers = ['Time','Event','Username','IP Address'];
  const rows = events.map(e => [
    e.created_at ? new Date(e.created_at).toISOString() : '',
    e.event_type || '',
    e.username   || '',
    e.ip_address || '',
  ]);
  const csv  = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const a    = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `auth_events_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

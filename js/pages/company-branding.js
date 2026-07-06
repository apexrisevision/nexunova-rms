// ══ COMPANY BRANDING & SETUP WIZARD ══════════════════
// Manages company identity, letterhead config, and first-time setup wizard.
// Cached globally as window._cobranding after login.

// ── Load & cache branding ─────────────────────────────────────────────────────
async function loadCobranding() {
  if (!S || !S.cid) return;
  try {
    const { data } = await supabase.rpc('get_company_branding', { p_company_id: S.cid });
    if (data) window._cobranding = data;
    // Refresh staff chrome (sidebar/topbar) now that display_name + server logo are known.
    if (typeof updateCoLogo === 'function') updateCoLogo();
    // Adjustment B: migrate any per-browser localStorage logo to the server profile.
    _migrateLocalLogoIfNeeded();
  } catch (e) { /* non-fatal — letterhead will fall back to defaults */ }
}

// One-time: if this browser holds a base64 logo (legacy localStorage-only) but the
// company profile has no server logo yet, upload it silently so it stops being
// browser-only. Runs on the admin's own browser (the one that uploaded it).
async function _migrateLocalLogoIfNeeded() {
  try {
    if (!S || !S.cid) return;
    const b = window._cobranding || {};
    if (b.logo_url) return;                                   // server already has a logo
    const local = localStorage.getItem('rms_logo_' + S.cid);
    if (!local || local.indexOf('data:') !== 0) return;       // nothing to migrate (or already a URL)
    const resp = await fetch(local);
    const blob = await resp.blob();
    const ext  = blob.type === 'image/jpeg' ? 'jpg' : 'png';
    const file = new File([blob], 'logo.' + ext, { type: blob.type || 'image/png' });
    await uploadCompanyLogo(file);
    if (typeof updateCoLogo === 'function') updateCoLogo();
    if (typeof toast === 'function') toast('Your logo is now saved to your company profile', 'ok');
  } catch (e) { /* silent — the localStorage fallback still renders it locally */ }
}

// ── Feature flags — cache on login, check before gated pages ─────────────────
// window._featureFlags = null  →  not loaded yet (default-allow)
// window._featureFlags = {}    →  loaded; missing key = enabled (default-open)
async function loadFeatureFlags() {
  if (!S || !S.cid) return;
  try {
    // Caller-scoped reader (own company via _rms_caller); NOT the super-admin
    // list_company_feature_flags, which raises 42501→403 for normal users.
    const { data } = await supabase.rpc('get_my_feature_flags');
    const flags = {};
    if (Array.isArray(data)) {
      data.forEach(r => { flags[r.feature_key] = r.enabled !== false; });
    }
    window._featureFlags = flags;
    _updateSidebarFeatureVisibility();
  } catch (e) {
    window._featureFlags = {}; // on error: allow everything
  }
}

// hasFeature(key) — true if enabled or unknown (default-open SaaS model)
function hasFeature(key) {
  if (!window._featureFlags) return true;
  if (!(key in window._featureFlags)) return true;
  return window._featureFlags[key] === true;
}

// Hide sidebar nav items for disabled features
function _updateSidebarFeatureVisibility() {
  const _PAGE_TO_FLAG = {
    'noc':        'noc',
    'campaigns':  'campaigns',
    'forecasting':'forecasting',
    'commscenter':'comms_center',
    'executive':  'executive_dashboard',
    'possession': 'possession',
    'legalcases': 'legal',
    'blacklist':  'blacklist',
    'escalations':'escalations',
    'pdc':        'pdc',
  };
  Object.entries(_PAGE_TO_FLAG).forEach(([pg, flag]) => {
    const el = document.querySelector(`.ni[data-pg="${pg}"]`);
    if (!el) return;
    const on = hasFeature(flag);
    // Disabled features are HIDDEN (not dimmed). Use !important — the sidebar's
    // .ni rule sets display with !important, which a plain inline style can't beat.
    if (on) el.style.removeProperty('display');
    else    el.style.setProperty('display', 'none', 'important');
    el.style.opacity     = '';
    el.title             = on ? '' : 'Upgrade your plan to unlock this feature';
    el.dataset.gated     = on ? '' : '1';
  });
}

// Shown when navigating to a gated page that is disabled
function _showFeatureGate(pg) {
  const el = document.getElementById('pg-' + pg);
  if (!el) return;
  const names = {
    noc:'NOC Management', campaigns:'Recovery Campaigns', forecasting:'Recovery Forecasting',
    commscenter:'Communications Center', executive:'Executive Dashboard',
    possession:'Possession Module', legalcases:'Legal Cases',
    blacklist:'Blacklist Register', escalations:'Escalations', pdc:'PDC Register',
  };
  const label = names[pg] || pg;
  el.innerHTML = `
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:40px 20px;text-align:center">
    <div style="width:64px;height:64px;border-radius:16px;background:rgba(99,102,241,.10);display:flex;align-items:center;justify-content:center;margin-bottom:20px">
      <svg width="28" height="28" fill="none" stroke="#6366F1" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    </div>
    <div style="font-size:20px;font-weight:700;color:var(--t1);margin-bottom:8px">${label} — Feature Locked</div>
    <div style="font-size:14px;color:var(--t3);max-width:400px;line-height:1.6;margin-bottom:24px">
      This feature is not enabled on your current plan.<br>Contact your administrator or upgrade your subscription to unlock it.
    </div>
    <button class="btn btn-g" style="padding:0 28px;height:40px" onclick="nav('admin')">
      View Subscription
    </button>
  </div>`;
}

// ── Admin: Company tab (full branding editor) ─────────────────────────────────
async function rBranding(ct) {
  ct.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:16px 0">⏳ Loading…</div>';
  try {
    const { data, error } = await supabase.rpc('get_company_branding', { p_company_id: S.cid });
    if (error) throw error;
    const b = data || {};
    const logo = typeof getCoLogo === 'function' ? getCoLogo() : null;
    ct.innerHTML = `
<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">

  <!-- LEFT: Company Identity -->
  <div class="card" style="flex:1;min-width:280px"><div class="cb">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="font-size:15px;margin:0;font-weight:700">Company Identity</h3>
      <button class="btn btn-g btn-sm" onclick="openBrandingWizard()">⚙ Setup Wizard</button>
    </div>
    <div class="fr"><label class="fl">Company Name * <span style="color:var(--t3);font-weight:400">(legal — on receipts &amp; documents)</span></label>
      <input id="br-name" class="inp-light" value="${esc(b.company_name||'')}"></div>
    <div class="fr"><label class="fl">Display Name <span style="color:var(--t3);font-weight:400">(brand — shown to staff &amp; members)</span></label>
      <input id="br-display" class="inp-light" placeholder="${esc(b.company_name||'Brand name')}" value="${esc(b.display_name||'')}"></div>
    <div class="fr"><label class="fl">Business Email</label>
      <input id="br-email" class="inp-light" type="email" value="${esc(b.business_email||'')}"></div>
    <div class="fr"><label class="fl">Business Phone</label>
      <input id="br-phone" class="inp-light" type="tel" value="${esc(b.business_phone||'')}"></div>
    <div class="fr"><label class="fl">Website</label>
      <input id="br-web" class="inp-light" type="url" placeholder="https://example.com" value="${esc(b.website||'')}"></div>
    <div class="g2">
      <div class="fr"><label class="fl">City</label>
        <input id="br-city" class="inp-light" value="${esc(b.city||'')}"></div>
      <div class="fr"><label class="fl">Country</label>
        <input id="br-country" class="inp-light" value="${esc(b.country||'Pakistan')}"></div>
    </div>
    <div class="fr"><label class="fl">Address</label>
      <textarea id="br-address" class="inp-light" rows="2">${esc(b.address||'')}</textarea></div>
    <div class="g2">
      <div class="fr"><label class="fl">NTN Number</label>
        <input id="br-ntn" class="inp-light" placeholder="e.g. 1234567-8" value="${esc(b.ntn_number||'')}"></div>
      <div class="fr"><label class="fl">Registration No.</label>
        <input id="br-reg" class="inp-light" value="${esc(b.registration_number||'')}"></div>
    </div>
  </div></div>

  <!-- RIGHT: Letterhead & Branding -->
  <div class="card" style="flex:1;min-width:280px"><div class="cb">
    <h3 style="font-size:15px;margin-bottom:16px;font-weight:700">Letterhead & Branding</h3>

    <div style="margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--line)">
      <div style="font-size:13px;font-weight:700;margin-bottom:4px">Company Logo</div>
      <p style="font-size:11px;color:var(--t3);margin:0 0 10px;line-height:1.5">Appears on all printed documents and the sidebar. PNG, JPG, SVG or WebP (≤2 MB). PNG with a transparent background looks best.</p>
      <div id="logo-prev-wrap" style="margin-bottom:10px;padding:12px;background:var(--canvas);border:1.5px dashed var(--line);border-radius:var(--rm);min-height:64px;display:flex;align-items:center;justify-content:center">
        ${logo
          ? `<img src="${logo}" style="max-height:60px;max-width:180px;object-fit:contain">`
          : `<span style="font-size:11px;color:var(--t3)">No logo uploaded</span>`}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-gh btn-sm" onclick="document.getElementById('logo-inp').click()">Upload PNG Logo</button>
        ${logo ? `<button class="btn btn-r btn-sm" onclick="removeCoLogo()">✕ Remove</button>` : ''}
        <input type="file" id="logo-inp" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none" onchange="uploadCoLogo(this)">
      </div>
    </div>

    <div class="fr"><label class="fl">Letterhead Subtitle</label>
      <input id="br-sub" class="inp-light" placeholder="Recovery Management System"
        value="${esc(b.letterhead_subtitle||'Recovery Management System')}"></div>

    <div class="fr"><label class="fl">Formatted Address (for letterhead)</label>
      <input id="br-addrfull" class="inp-light" placeholder="Office #5, Business Bay, Karachi"
        value="${esc(b.address_full||'')}">
      <p style="font-size:10px;color:var(--t3);margin:4px 0 0">Shows on right side of all print documents. Leave blank to auto-build from city/country.</p></div>

    <div class="g2">
      <div class="fr"><label class="fl">Document Header Color</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="br-color" type="color" value="${b.doc_brand_color||'#1E2D47'}"
            style="width:48px;height:38px;border:1.5px solid var(--line);border-radius:var(--rm);cursor:pointer;padding:2px"
            oninput="document.getElementById('br-color-hex').value=this.value">
          <input id="br-color-hex" class="inp-light" style="flex:1" value="${b.doc_brand_color||'#1E2D47'}"
            oninput="document.getElementById('br-color').value=this.value">
        </div>
      </div>
      <div class="fr"><label class="fl">Accent Color</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="br-accent" type="color" value="${b.accent_color||'#C9A84C'}"
            style="width:48px;height:38px;border:1.5px solid var(--line);border-radius:var(--rm);cursor:pointer;padding:2px"
            oninput="document.getElementById('br-accent-hex').value=this.value">
          <input id="br-accent-hex" class="inp-light" style="flex:1" value="${b.accent_color||'#C9A84C'}"
            oninput="document.getElementById('br-accent').value=this.value">
        </div>
      </div>
    </div>
  </div></div>

  <!-- BOTTOM: Signature & Footer + Live Preview -->
  <div class="card" style="width:100%"><div class="cb">
    <h3 style="font-size:15px;margin-bottom:16px;font-weight:700">Document Signature & Footer</h3>
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <div class="g2">
          <div class="fr"><label class="fl">Signatory Name</label>
            <input id="br-signame" class="inp-light" placeholder="Muhammad Ahmed"
              value="${esc(b.signature_name||'')}"></div>
          <div class="fr"><label class="fl">Signatory Title</label>
            <input id="br-sigtitle" class="inp-light" placeholder="Authorized Signatory"
              value="${esc(b.signature_title||'Authorized Signatory')}"></div>
        </div>
        <div class="fr"><label class="fl">Document Footer Text</label>
          <input id="br-footer" class="inp-light"
            placeholder="This is a computer-generated document. No signature required."
            value="${esc(b.footer_text||'')}"></div>
        <div style="margin-top:16px">
          <button class="btn btn-g" id="br-save-btn" onclick="saveBranding()">Save Company Branding</button>
        </div>
      </div>
      <div style="flex:1;min-width:280px">
        <div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Live Preview</div>
        <div id="br-preview" style="border:1px solid var(--line);border-radius:var(--rm);overflow:hidden;font-family:Arial,sans-serif;font-size:10px">
          ${_brPreview(b, logo)}
        </div>
        <button class="btn btn-gh btn-sm" style="margin-top:8px" onclick="_refreshBrPreview()">↺ Refresh Preview</button>
      </div>
    </div>
  </div></div>

</div>`;
  } catch (e) {
    ct.innerHTML = `<div style="color:var(--err);font-size:12px;padding:16px">Could not load branding: ${esc(e.message)}</div>`;
  }
}

function _brPreview(b, logo) {
  const hdr = b.doc_brand_color || '#1E2D47';
  const acc = b.accent_color || '#C9A84C';
  const co  = b.company_name || S?.coName || 'Your Company';
  const sub = b.letterhead_subtitle || 'Recovery Management System';
  const addr = b.address_full || [b.city, b.country].filter(Boolean).join(', ') || 'Address Line';
  const sigName  = b.signature_name  || 'Signatory Name';
  const sigTitle = b.signature_title || 'Authorized Signatory';
  const footer   = b.footer_text     || 'This is a computer-generated document.';
  return `<div style="background:${hdr};color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
    <div>${logo ? `<img src="${logo}" style="height:36px;max-width:110px;object-fit:contain;display:block;margin-bottom:2px">` : ''}
      <div style="font-size:${logo?'7':'13'}px;font-weight:700;${logo?'text-transform:uppercase;letter-spacing:1px;color:'+acc:''};">${esc(co)}</div>
      ${!logo ? `<div style="font-size:7px;text-transform:uppercase;letter-spacing:1px;color:${acc}">${esc(sub)}</div>` : ''}
    </div>
    <div style="text-align:right;font-size:7px;color:rgba(255,255,255,.7);line-height:1.7">Receipt Voucher<br>${new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'})}<br>${esc(addr)}</div>
  </div>
  <div style="height:2px;background:linear-gradient(90deg,${acc},#ffe,${acc})"></div>
  <div style="padding:10px 14px;background:#fff">
    <div style="font-size:11px;font-weight:700;color:${hdr};border-bottom:1.5px solid ${acc};padding-bottom:4px;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Document Title</div>
    <div style="display:flex;gap:12px;font-size:9px;color:#555;margin-bottom:10px">
      <div><div style="font-size:7px;text-transform:uppercase;color:#999;font-weight:700">Client</div><div style="font-weight:700;color:#111">John Smith</div></div>
      <div><div style="font-size:7px;text-transform:uppercase;color:#999;font-weight:700">Unit</div><div style="font-weight:700;color:#111">A-101</div></div>
      <div><div style="font-size:7px;text-transform:uppercase;color:#999;font-weight:700">Amount</div><div style="font-weight:700;color:#111">PKR 50,000</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:8px;border-top:1px solid ${hdr}">
      <div style="font-size:8px">
        <div style="border-top:1px solid ${hdr};padding-top:3px;width:80px;margin-top:16px"></div>
        <div style="font-size:7px;font-weight:700;color:${hdr}">${esc(sigName)}</div>
        <div style="font-size:7px;color:#888">${esc(sigTitle)}</div>
      </div>
    </div>
    <div style="border-top:1px solid #eee;margin-top:8px;padding-top:4px;font-size:7px;color:#bbb;text-align:center">${esc(footer)}</div>
  </div>`;
}

function _refreshBrPreview() {
  const b = {
    doc_brand_color:     document.getElementById('br-color')?.value     || '#1E2D47',
    accent_color:        document.getElementById('br-accent')?.value     || '#C9A84C',
    company_name:        document.getElementById('br-name')?.value       || '',
    letterhead_subtitle: document.getElementById('br-sub')?.value        || '',
    address_full:        document.getElementById('br-addrfull')?.value   || '',
    city:                document.getElementById('br-city')?.value       || '',
    country:             document.getElementById('br-country')?.value    || '',
    signature_name:      document.getElementById('br-signame')?.value    || '',
    signature_title:     document.getElementById('br-sigtitle')?.value   || '',
    footer_text:         document.getElementById('br-footer')?.value     || '',
  };
  const logo = typeof getCoLogo === 'function' ? getCoLogo() : null;
  const pv = document.getElementById('br-preview');
  if (pv) pv.innerHTML = _brPreview(b, logo);
}

async function saveBranding() {
  if (typeof demoGuard === 'function' && demoGuard('Save Branding')) return;
  const name = document.getElementById('br-name')?.value?.trim();
  if (!name) { toast('Company name is required', 'warn'); return; }
  const btn = document.getElementById('br-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const payload = {
      company_name:        name,
      display_name:        document.getElementById('br-display')?.value?.trim()  || '',
      website:             document.getElementById('br-web')?.value?.trim()      || '',
      business_email:      document.getElementById('br-email')?.value?.trim()    || '',
      business_phone:      document.getElementById('br-phone')?.value?.trim()    || '',
      city:                document.getElementById('br-city')?.value?.trim()     || '',
      country:             document.getElementById('br-country')?.value?.trim()  || 'Pakistan',
      address:             document.getElementById('br-address')?.value?.trim()  || '',
      ntn_number:          document.getElementById('br-ntn')?.value?.trim()      || '',
      registration_number: document.getElementById('br-reg')?.value?.trim()      || '',
      letterhead_subtitle: document.getElementById('br-sub')?.value?.trim()      || '',
      address_full:        document.getElementById('br-addrfull')?.value?.trim() || '',
      doc_brand_color:     document.getElementById('br-color')?.value            || '#1E2D47',
      accent_color:        document.getElementById('br-accent')?.value           || '#C9A84C',
      signature_name:      document.getElementById('br-signame')?.value?.trim()  || '',
      signature_title:     document.getElementById('br-sigtitle')?.value?.trim() || '',
      footer_text:         document.getElementById('br-footer')?.value?.trim()   || '',
    };
    const { error } = await supabase.rpc('save_company_branding', { p_company_id: S.cid, p_data: payload });
    if (error) throw error;
    window._cobranding = { ...window._cobranding, ...payload };
    S.coName = name;
    sessionStorage.setItem('nxn_sess', JSON.stringify(S));
    // Staff chrome shows the display (brand) name; falls back to legal name.
    const staffName = payload.display_name || name;
    const sbCo = document.getElementById('sb-co'); if (sbCo) sbCo.textContent = staffName;
    if (typeof updateCoLogo === 'function') updateCoLogo();
    toast('Company branding saved', 'ok');
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Company Branding'; }
  }
}

// ══ COMPANY SETUP WIZARD ════════════════════════════════════════════════════
let _wz = null;

function openBrandingWizard() {
  // Remove existing if any
  document.getElementById('wz-overlay')?.remove();
  const existing = window._cobranding || {};
  const logo = typeof getCoLogo === 'function' ? getCoLogo() : null;
  _wz = {
    step: 1,
    totalSteps: 4,
    data: {
      company_name:        existing.company_name        || S?.coName  || '',
      display_name:        existing.display_name        || '',
      website:             existing.website             || '',
      business_email:      existing.business_email      || '',
      business_phone:      existing.business_phone      || '',
      city:                existing.city                || '',
      country:             existing.country             || 'Pakistan',
      address:             existing.address             || '',
      ntn_number:          existing.ntn_number          || '',
      registration_number: existing.registration_number || '',
      letterhead_subtitle: existing.letterhead_subtitle || 'Recovery Management System',
      address_full:        existing.address_full        || '',
      doc_brand_color:     existing.doc_brand_color     || '#1E2D47',
      accent_color:        existing.accent_color        || '#C9A84C',
      signature_name:      existing.signature_name      || '',
      signature_title:     existing.signature_title     || 'Authorized Signatory',
      footer_text:         existing.footer_text         || '',
    },
    logo,
  };
  const ov = document.createElement('div');
  ov.id = 'wz-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeIn .2s ease';
  document.body.appendChild(ov);
  _wzRender();
}

function _wzCollect() {
  if (!_wz) return;
  const g = id => document.getElementById(id)?.value?.trim() || '';
  const gc = id => document.getElementById(id)?.value || '';
  const step = _wz.step;
  if (step === 1) {
    _wz.data.company_name   = g('wz-name');
    _wz.data.display_name   = g('wz-display');
    _wz.data.website        = g('wz-web');
    _wz.data.business_email = g('wz-email');
    _wz.data.business_phone = g('wz-phone');
    _wz.data.city           = g('wz-city');
    _wz.data.country        = g('wz-country');
    _wz.data.address        = g('wz-address');
    _wz.data.ntn_number     = g('wz-ntn');
    _wz.data.registration_number = g('wz-reg');
  } else if (step === 2) {
    _wz.data.doc_brand_color     = gc('wz-color');
    _wz.data.accent_color        = gc('wz-accent');
    _wz.data.letterhead_subtitle = g('wz-sub');
    _wz.data.address_full        = g('wz-addrfull');
  } else if (step === 3) {
    _wz.data.signature_name  = g('wz-signame');
    _wz.data.signature_title = g('wz-sigtitle');
    _wz.data.footer_text     = g('wz-footer');
  }
}

function _wzNav(dir) {
  _wzCollect();
  if (dir === 1 && _wz.step === 1 && !_wz.data.company_name) {
    toast('Company name is required', 'warn'); return;
  }
  _wz.step = Math.max(1, Math.min(_wz.totalSteps, _wz.step + dir));
  _wzRender();
}

function _wzRender() {
  const ov = document.getElementById('wz-overlay'); if (!ov) return;
  const s = _wz.step;
  const d = _wz.data;
  const stepLabels = ['Company Identity', 'Branding', 'Documents', 'Preview'];
  const dots = stepLabels.map((lb, i) => {
    const n = i + 1;
    const done = n < s, active = n === s;
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">
      <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;
        background:${done?'#22c55e':active?'var(--brand)':'var(--line)'};
        color:${done||active?'#fff':'var(--t3)'};transition:all .2s">
        ${done ? '✓' : n}
      </div>
      <div style="font-size:10px;color:${active?'var(--brand)':done?'#22c55e':'var(--t3)'};font-weight:${active?700:400}">${lb}</div>
    </div>
    ${n<4?`<div style="flex:1;height:2px;background:${done?'#22c55e':'var(--line)'};margin-bottom:18px;max-width:40px"></div>`:''}`;
  }).join('');

  let body = '';
  if (s === 1) {
    body = `<div class="g2">
      <div class="fr"><label class="fl">Company Name * <span style="color:var(--t3);font-weight:400">(legal)</span></label><input id="wz-name" class="inp-light" value="${esc(d.company_name)}"></div>
      <div class="fr"><label class="fl">Display Name <span style="color:var(--t3);font-weight:400">(brand)</span></label><input id="wz-display" class="inp-light" placeholder="${esc(d.company_name||'Brand name')}" value="${esc(d.display_name)}"></div>
      <div class="fr"><label class="fl">Business Email</label><input id="wz-email" class="inp-light" type="email" value="${esc(d.business_email)}"></div>
      <div class="fr"><label class="fl">Business Phone</label><input id="wz-phone" class="inp-light" type="tel" value="${esc(d.business_phone)}"></div>
      <div class="fr"><label class="fl">Website</label><input id="wz-web" class="inp-light" type="url" placeholder="https://example.com" value="${esc(d.website)}"></div>
      <div class="fr"><label class="fl">City</label><input id="wz-city" class="inp-light" value="${esc(d.city)}"></div>
      <div class="fr"><label class="fl">Country</label><input id="wz-country" class="inp-light" value="${esc(d.country||'Pakistan')}"></div>
    </div>
    <div class="fr"><label class="fl">Full Address</label><textarea id="wz-address" class="inp-light" rows="2">${esc(d.address)}</textarea></div>
    <div class="g2">
      <div class="fr"><label class="fl">NTN Number</label><input id="wz-ntn" class="inp-light" placeholder="1234567-8" value="${esc(d.ntn_number)}"></div>
      <div class="fr"><label class="fl">Registration No.</label><input id="wz-reg" class="inp-light" value="${esc(d.registration_number)}"></div>
    </div>`;
  } else if (s === 2) {
    body = `<div style="margin-bottom:14px;padding:12px;background:var(--canvas);border:1.5px dashed var(--line);border-radius:var(--rm);min-height:64px;display:flex;align-items:center;justify-content:center" id="wz-logo-wrap">
      ${_wz.logo ? `<img src="${_wz.logo}" style="max-height:60px;max-width:200px;object-fit:contain">` : `<span style="font-size:12px;color:var(--t3)">No logo — </span>&nbsp;<button class="btn btn-gh btn-sm" onclick="document.getElementById('wz-logo-inp').click()">Upload PNG Logo</button>`}
    </div>
    ${_wz.logo ? `<div style="display:flex;gap:8px;margin-bottom:14px"><button class="btn btn-gh btn-sm" onclick="document.getElementById('wz-logo-inp').click()">Change Logo</button><button class="btn btn-r btn-sm" onclick="_wzRemoveLogo()">✕ Remove</button></div>` : ''}
    <input type="file" id="wz-logo-inp" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none" onchange="_wzUploadLogo(this)">

    <div class="fr"><label class="fl">Letterhead Subtitle</label>
      <input id="wz-sub" class="inp-light" value="${esc(d.letterhead_subtitle)}" placeholder="Recovery Management System"></div>
    <div class="fr"><label class="fl">Letterhead Address Line</label>
      <input id="wz-addrfull" class="inp-light" value="${esc(d.address_full)}" placeholder="Office #5, Business Bay, Karachi">
      <p style="font-size:10px;color:var(--t3);margin:3px 0 0">Shown on the right side of all print documents</p></div>

    <div class="g2" style="margin-top:4px">
      <div class="fr"><label class="fl">Document Header Color</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="wz-color" type="color" value="${d.doc_brand_color}"
            style="width:44px;height:36px;border:1.5px solid var(--line);border-radius:var(--rm);padding:2px;cursor:pointer"
            oninput="document.getElementById('wz-color-hex').value=this.value">
          <input id="wz-color-hex" class="inp-light" style="flex:1" value="${d.doc_brand_color}"
            oninput="document.getElementById('wz-color').value=this.value">
        </div></div>
      <div class="fr"><label class="fl">Accent / Gold Color</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="wz-accent" type="color" value="${d.accent_color}"
            style="width:44px;height:36px;border:1.5px solid var(--line);border-radius:var(--rm);padding:2px;cursor:pointer"
            oninput="document.getElementById('wz-accent-hex').value=this.value">
          <input id="wz-accent-hex" class="inp-light" style="flex:1" value="${d.accent_color}"
            oninput="document.getElementById('wz-accent').value=this.value">
        </div></div>
    </div>`;
  } else if (s === 3) {
    body = `<p style="font-size:12px;color:var(--t2);margin:0 0 16px;line-height:1.6">Define the signature block and footer that appear on all official documents.</p>
    <div class="g2">
      <div class="fr"><label class="fl">Authorized Signatory Name</label>
        <input id="wz-signame" class="inp-light" value="${esc(d.signature_name)}" placeholder="Muhammad Ahmed"></div>
      <div class="fr"><label class="fl">Signatory Title</label>
        <input id="wz-sigtitle" class="inp-light" value="${esc(d.signature_title)}" placeholder="Authorized Signatory"></div>
    </div>
    <div class="fr"><label class="fl">Document Footer Text</label>
      <input id="wz-footer" class="inp-light" value="${esc(d.footer_text)}"
        placeholder="This is a computer-generated document. Contact accounts@company.com for queries."></div>
    <div style="margin-top:14px;padding:12px;background:var(--ok-bg);border-radius:var(--rm);font-size:12px;color:var(--ok)">
      ✓ All print documents will automatically use this signature block and footer text.
    </div>`;
  } else if (s === 4) {
    _wzCollect();
    const prev = _brPreview(_wz.data, _wz.logo);
    body = `<p style="font-size:12px;color:var(--t2);margin:0 0 14px;line-height:1.6">This is how your letterhead will appear on all printed documents. Everything looks good? Click <b>Save & Finish</b>.</p>
    <div style="border:1px solid var(--line);border-radius:var(--rm);overflow:hidden;max-width:500px;margin:0 auto">
      ${prev}
    </div>`;
  }

  ov.innerHTML = `<div style="background:var(--card);border-radius:var(--r);box-shadow:0 20px 60px rgba(0,0,0,.25);width:100%;max-width:620px;max-height:92vh;overflow-y:auto;display:flex;flex-direction:column">
    <div style="padding:20px 24px 16px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card);z-index:1">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:18px;font-weight:800;color:var(--text)">Company Setup Wizard</div>
          <div style="font-size:12px;color:var(--t3);margin-top:2px">Step ${s} of ${_wz.totalSteps} — ${stepLabels[s-1]}</div>
        </div>
        <button onclick="_wzClose()" style="background:none;border:none;font-size:22px;color:var(--t3);cursor:pointer;line-height:1;padding:0 4px">✕</button>
      </div>
      <div style="display:flex;align-items:center;margin-top:16px;gap:0">${dots}</div>
    </div>
    <div style="padding:20px 24px;flex:1">${body}</div>
    <div style="padding:16px 24px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:10px;position:sticky;bottom:0;background:var(--card)">
      <button class="btn btn-gh" onclick="_wzNav(-1)" ${s===1?'disabled':''}>← Back</button>
      ${s < _wz.totalSteps
        ? `<button class="btn btn-g" onclick="_wzNav(1)">Next →</button>`
        : `<button class="btn btn-g" id="wz-finish-btn" onclick="_wzFinish()">✓ Save & Finish</button>`}
    </div>
  </div>`;
}

async function _wzUploadLogo(inp) {
  const f = inp.files[0]; if (!f) return;
  const wrap = document.getElementById('wz-logo-wrap');
  if (wrap) wrap.innerHTML = '<span style="font-size:12px;color:var(--t3)">⏳ Uploading…</span>';
  try {
    const url = await uploadCompanyLogo(f);   // → company-logos bucket + companies.logo_url
    _wz.logo = url;
    if (typeof updateCoLogo === 'function') updateCoLogo();
    _wzRender();
  } catch (e) {
    toast('Logo upload failed: ' + (e.message || e), 'err');
    _wzRender();
  }
}

async function _wzRemoveLogo() {
  try { await clearCompanyLogo(); } catch (e) { toast('Could not remove logo', 'err'); return; }
  _wz.logo = null;
  if (typeof updateCoLogo === 'function') updateCoLogo();
  _wzRender();
}

function _wzClose() {
  document.getElementById('wz-overlay')?.remove();
  _wz = null;
}

async function _wzFinish() {
  _wzCollect();
  const btn = document.getElementById('wz-finish-btn');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }
  try {
    const payload = { ..._wz.data, onboarding_complete: true };
    const { error } = await supabase.rpc('save_company_branding', { p_company_id: S.cid, p_data: payload });
    if (error) throw error;
    window._cobranding = { ...window._cobranding, ...payload };
    S.coName = payload.company_name;
    sessionStorage.setItem('nxn_sess', JSON.stringify(S));
    const staffName = payload.display_name || payload.company_name;
    const sbCo = document.getElementById('sb-co'); if (sbCo) sbCo.textContent = staffName;
    if (typeof updateCoLogo === 'function') updateCoLogo();
    _wzClose();
    toast('Company branding saved successfully!', 'ok');
    // Refresh Company tab if open
    const ct = document.getElementById('a-ct');
    if (ct && document.getElementById('pg-admin')?.style.display !== 'none') rBranding(ct);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
    if (btn) { btn.disabled=false; btn.textContent='✓ Save & Finish'; }
  }
}

/**
 * Database Store for Nexunova RMS
 * Handles all Supabase data operations via SECURITY DEFINER RPCs.
 */

// ═══════════════════════════════════════════════════════════
// UNITS CACHE — loaded once on login, refreshed on changes
// gunits()/gunit() in helpers.js read from this cache
// ═══════════════════════════════════════════════════════════
window._unitsCache = [];
window._unitsCacheLoaded = false;
window._appUsersCache = [];

async function loadAppUsersCache(companyId) {
  try {
    if (!companyId) { window._appUsersCache = []; return false; }
    const { data, error } = await supabase.rpc('list_app_users', { p_company_id: companyId });
    if (error) { console.error('[loadAppUsersCache]', error); return false; }
    window._appUsersCache = (data || []).map(u => ({
      id:          u.id,
      fullName:    u.full_name || '',
      name:        u.full_name || '',
      username:    u.username  || '',
      email:       u.email     || '',
      phone:       u.phone     || '',
      role:        u.role      || 'staff',
      status:      u.status    || 'active',
      permissions: u.module_permissions || {}
    }));
    console.log(`✅ App users cache loaded: ${window._appUsersCache.length} users`);
    return true;
  } catch (err) { console.error('[loadAppUsersCache]', err); return false; }
}

/**
 * Load all units for current company via RPC into memory cache.
 * Uses get_units_cache_bundle to fetch units+sales+payments+agents in one round-trip.
 */
async function loadUnitsCache(companyId) {
  try {
    if (!companyId) {
      window._unitsCache = [];
      window._unitsCacheLoaded = false;
      return false;
    }

    const { data: bundle, error: bErr } = await supabase.rpc('get_units_cache_bundle', { p_company_id: companyId });
    if (bErr) {
      console.error('[loadUnitsCache] error:', bErr);
      window._unitsCache = [];
      return false;
    }

    const uData = bundle?.units    || [];
    const sData = bundle?.sales    || [];
    const pData = bundle?.payments || [];
    const aData = bundle?.agents   || [];

    const saleByUnit = {};
    sData.forEach(s => { saleByUnit[s.unit_id] = s; });

    const paysBySale = {};
    pData.forEach(p => {
      if (!paysBySale[p.sale_id]) paysBySale[p.sale_id] = { total: 0, lastDate: null };
      paysBySale[p.sale_id].total += Number(p.amount || 0);
      if (!paysBySale[p.sale_id].lastDate || p.payment_date > paysBySale[p.sale_id].lastDate) {
        paysBySale[p.sale_id].lastDate = p.payment_date;
      }
    });

    const agentById = {};
    aData.forEach(a => { agentById[a.id] = a.full_name; });

    window._unitsCache = uData.map(u => {
      const typeObj   = (window._typesCache    || []).find(t => t.id === u.unit_type_id);
      const statusObj = (window._statusesCache || []).find(s => s.id === u.status_id);
      const sale      = saleByUnit[u.id] || null;
      const clientObj = sale ? (window._clientsCache || []).find(c => c.id === sale.client_id) : null;
      const payInfo   = sale ? (paysBySale[sale.id] || null) : null;
      const totalPrice = sale ? Number(sale.net_amount || sale.total_amount || 0) : Number(u.base_price || 0);
      const totalPaid  = payInfo ? payInfo.total : 0;
      return {
        id:            u.id,
        unitNo:        u.unit_no       || '',
        unitCode:      u.unit_code     || '',
        projectId:     u.project_id    || null,
        unitTypeId:    u.unit_type_id  || null,
        statusId:      u.status_id     || null,
        floorId:       u.floor_id      || null,
        floorNo:       u.floor_no      || null,
        floorLabel:    u.floor_label   || '',
        floor:         u.floor_label   || '',
        block:         u.block         || '',
        type:          typeObj?.name   || '',
        typeName:      typeObj?.name   || '',
        area:          Number(u.area        || 0),
        carpetArea:    u.carpet_area ? Number(u.carpet_area) : null,
        areaUnit:      u.area_unit     || 'sqft',
        bedrooms:      u.bedrooms      || null,
        bathrooms:     u.bathrooms     || null,
        parkingCount:  Number(u.parking_count || 0),
        facing:        u.facing        || '',
        status:        statusObj?.name  || 'Available',
        statusColor:   statusObj?.color || '#6b7280',
        isAvailable:   statusObj?.isAvailable ?? true,
        basePrice:     Number(u.base_price || 0),
        totalPrice,
        totalPaid,
        pendingAmount: Math.max(0, totalPrice - totalPaid),
        customerName:  clientObj?.fullName || clientObj?.name || '',
        phone:         clientObj?.phone || clientObj?.phonePrimary || '',
        soldBy:        sale?.agent_id ? (agentById[sale.agent_id] || '') : '',
        saleId:        sale?.id || null,
        clientId:      sale?.client_id || null,
        saleTypeId:    sale?.sale_type_id || null,
        saleTypeName:  sale?.sale_type_id ? ((window._saleTypesCache || []).find(t => t.id === sale.sale_type_id)?.name || '') : '',
        saleDate:      sale?.sale_date || null,
        bookingNo:     sale?.sale_number || '',
        lastPaymentDate: payInfo?.lastDate || null,
        features:      u.features      || {},
        notes:         u.notes         || '',
        remarks:       u.notes         || '',
        isPremium:           u.is_premium  || false,
        isCorner:            u.is_corner   || false,
        maintenanceMonthly:  u.maintenance_monthly ? Number(u.maintenance_monthly) : null,
        possessionDate:      u.possession_date     || null,
        handoverStatus:      u.handover_status     || null,
        transferHistory:     u.transfer_history    || null,
        imageUrls:           Array.isArray(u.image_urls)    ? u.image_urls    : [],
        documentUrls:        Array.isArray(u.document_urls) ? u.document_urls : [],
        companyId:           u.company_id,
        createdBy:           u.created_by          || null,
        createdAt:           u.created_at          || '',
        updatedAt:           u.updated_at          || ''
      };
    });

    window._unitsCacheLoaded = true;
    console.log(`✅ Units cache loaded: ${window._unitsCache.length} units`);
    return true;
  } catch (err) {
    console.error('[loadUnitsCache] exception:', err);
    window._unitsCache = [];
    return false;
  }
}

// ─── COMPANY MANAGEMENT ───

function getCurrentCompanyId() {
  return localStorage.getItem('nexunova_company_id');
}
function setCurrentCompanyId(companyId) {
  localStorage.setItem('nexunova_company_id', companyId);
}

// ─── UNITS ───

async function getUnits(companyId) {
  try {
    const { data, error } = await supabase.rpc('get_units_all', { p_company_id: companyId });
    if (error) { console.error('Error fetching units:', error); return []; }
    return data || [];
  } catch (err) { console.error('Exception in getUnits:', err); return []; }
}

async function getUnitsByProject(projectId) {
  try {
    const { data, error } = await supabase.rpc('get_units_by_project', { p_project_id: projectId });
    if (error) { console.error('Error fetching units by project:', error); return []; }
    return data || [];
  } catch (err) { console.error('Exception in getUnitsByProject:', err); return []; }
}

async function saveUnit(data) {
  try {
    const { id, ...unitData } = data;
    if (id) {
      const cid = unitData.company_id;
      const { data: result, error } = await supabase.rpc('update_unit', {
        p_id: id, p_company_id: cid, p_data: unitData
      });
      if (error) { console.error('Error updating unit:', error); return null; }
      return result?.unit || result || null;
    } else {
      const { data: result, error } = await supabase.rpc('create_unit', { p_data: unitData });
      if (error) { console.error('Error creating unit:', error); return null; }
      return result?.unit || result || null;
    }
  } catch (err) { console.error('Exception in saveUnit:', err); return null; }
}

async function deleteUnit(unitId) {
  try {
    const cid = getCurrentCompanyId();
    const { error } = await supabase.rpc('delete_unit', { p_id: unitId, p_company_id: cid });
    if (error) { console.error('Error deleting unit:', error); return false; }
    return true;
  } catch (err) { console.error('Exception in deleteUnit:', err); return false; }
}

// ─── CLIENTS ───

async function getClients(companyId) {
  try {
    const { data, error } = await supabase.rpc('get_clients_all', { p_company_id: companyId });
    if (error) { console.error('Error fetching clients:', error); return []; }
    return data || [];
  } catch (err) { console.error('Exception in getClients:', err); return []; }
}

async function getClient(clientId) {
  try {
    const cid = getCurrentCompanyId();
    const { data, error } = await supabase.rpc('get_client_by_id', { p_id: clientId, p_company_id: cid });
    if (error) { console.error('Error fetching client:', error); return null; }
    return data;
  } catch (err) { console.error('Exception in getClient:', err); return null; }
}

// RPC-only. The old localStorage-first fallback (fake 'local_' ids that never reached
// the DB) was removed 2026-06-12 — a failed save must FAIL LOUDLY, never persist a
// browser-only record. Currently has no callers (clients.js calls the RPCs directly);
// kept as a guarded stub so any future re-wiring inherits the safe behaviour.
async function saveClient(data) {
  const { id, ...clientData } = data;
  const cid = data.company_id;
  try {
    if(id) {
      const { data: result, error } = await supabase.rpc('update_client', {
        p_id: id, p_company_id: cid, p_data: clientData
      });
      if(error) throw error;
      return result?.client || result;
    } else {
      const { data: result, error } = await supabase.rpc('create_client', { p_data: { ...clientData, company_id: cid } });
      if(error) throw error;
      return result?.client || result;
    }
  } catch(err) {
    console.error('[saveClient] save failed — nothing persisted:', err);
    if (typeof toast === 'function') toast('Could not save client: ' + (err.message || 'connection error') + ' — please retry', 'err');
    return { _error: err };
  }
}

// ─── STRANDED LOCAL CLIENT RECORDS (legacy localStorage fallback recovery) ───
// Older builds "saved" clients into localStorage['kbh_v4'].clients[cid] with fake
// 'local_' ids when the RPC failed. Those records never reached the DB. Detect them
// at login and offer a JSON export so the data can be recovered manually.

function _getStrandedLocalClients() {
  try {
    const raw = localStorage.getItem('kbh_v4');
    if (!raw) return [];
    const db = JSON.parse(raw);
    const out = [];
    Object.keys(db.clients || {}).forEach(cid => {
      (db.clients[cid] || []).forEach(c => {
        if (c && typeof c.id === 'string' && c.id.indexOf('local_') === 0) out.push({ company_id: cid, ...c });
      });
    });
    return out;
  } catch (e) { console.error('[strandedClients] scan failed:', e); return []; }
}

function downloadStrandedClients() {
  const rows = _getStrandedLocalClients();
  if (!rows.length) return;
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stranded_clients_' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function checkStrandedLocalClients() {
  const rows = _getStrandedLocalClients();
  if (!rows.length) return;
  console.warn('[strandedClients] ' + rows.length + ' unsynced local client record(s) found in this browser (never saved to the database):', rows);
  _rmsSysBanner('sys-banner-stranded',
    '<strong>' + rows.length + ' unsaved client record' + (rows.length > 1 ? 's' : '') + '</strong>&nbsp;found in this browser from an older version — ' +
    (rows.length > 1 ? 'they were' : 'it was') + ' never saved to the database. Export and re-enter ' + (rows.length > 1 ? 'them' : 'it') + '.',
    '<button class="trial-banner-cta" onclick="downloadStrandedClients()">Download JSON</button>');
}

// ─── CACHE-LOAD FAILURE TRACKING (FIX 4) ───
// auth.js records which login-time cache loaders returned false here, so a failed
// fetch is visually distinguishable from a genuinely empty tenant. Retry re-runs
// ONLY the failed loaders, then re-renders the current page.
window._cacheLoadFailed = window._cacheLoadFailed || {};

const _CACHE_LOADERS = {
  floors:    (cid) => loadFloorsCache(cid),
  types:     (cid) => loadTypesCache(cid),
  statuses:  (cid) => loadStatusesCache(cid),
  saletypes: (cid) => loadSaleTypesCache(cid),
  projects:  (cid) => loadProjectsCache(cid),
  clients:   (cid) => loadClientsCache(cid),
  units:     (cid) => loadUnitsCache(cid),
};

function showCacheLoadFailureBanner() {
  const failed = Object.keys(window._cacheLoadFailed);
  if (!failed.length) return;
  _rmsSysBanner('sys-banner-cachefail',
    '<strong>Couldn’t load all data</strong>&nbsp;(' + failed.join(', ') + ') — what you see may be incomplete. This is a connection problem, not missing records.',
    '<button class="trial-banner-cta" onclick="retryFailedCacheLoads(this)">Retry</button>');
}

async function retryFailedCacheLoads(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Retrying…'; }
  const cid = (typeof S !== 'undefined' && S && S.cid) ? S.cid : null;
  if (!cid) { if (btn) { btn.disabled = false; btn.textContent = 'Retry'; } return; }
  for (const name of Object.keys(window._cacheLoadFailed)) {
    const fn = _CACHE_LOADERS[name];
    if (!fn) { delete window._cacheLoadFailed[name]; continue; }
    const ok = await fn(cid);
    if (ok !== false) delete window._cacheLoadFailed[name];
  }
  const still = Object.keys(window._cacheLoadFailed);
  if (!still.length) {
    const b = document.getElementById('sys-banner-cachefail'); if (b) b.remove();
    if (typeof toast === 'function') toast('Data loaded', 'ok');
    const curEl = document.querySelector('.pg.on');
    if (curEl && typeof nav === 'function') nav(curEl.id.replace(/^pg-/, ''));
  } else {
    if (typeof toast === 'function') toast('Still couldn’t load: ' + still.join(', ') + ' — check your connection', 'err');
    showCacheLoadFailureBanner();
    if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
  }
}

// ─── SHARED SYSTEM BANNER (reuses existing trial-banner styles) ───
// Inserted above the page wrap (sibling of #trial-banner) so page re-renders never wipe it.
function _rmsSysBanner(id, msgHtml, ctaHtml) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    const anchor = document.getElementById('trial-banner');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor.nextSibling);
    else { const app = document.getElementById('s-app'); if (app) app.insertBefore(el, app.firstChild); else return; }
  }
  el.innerHTML =
    '<div class="trial-banner-inner expired">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
    '<span>' + msgHtml + '</span>' + (ctaHtml || '') +
    '<button class="demo-banner-close" onclick="document.getElementById(\'' + id + '\').remove()" title="Dismiss">&#10005;</button>' +
    '</div>';
}

async function deleteClient(clientId) {
  try {
    const cid = getCurrentCompanyId();
    const { error } = await supabase.rpc('delete_client', { p_id: clientId, p_company_id: cid });
    if (error) { console.error('Error deleting client:', error); return false; }
    return true;
  } catch (err) { console.error('Exception in deleteClient:', err); return false; }
}

// ─── COMPANIES ───

async function getCompanies() {
  try {
    const { data, error } = await supabase.rpc('list_companies');
    if (error) { console.error('Error fetching companies:', error); return []; }
    return data || [];
  } catch (err) { console.error('Exception in getCompanies:', err); return []; }
}

async function getCurrentCompany() {
  const companyId = getCurrentCompanyId();
  if (!companyId) return null;
  try {
    const { data, error } = await supabase.rpc('get_company', { p_company_id: companyId });
    if (error) { console.error('Error fetching current company:', error); return null; }
    return data;
  } catch (err) { console.error('Exception in getCurrentCompany:', err); return null; }
}

// ─── CLIENTS CACHE ───

window._clientsCache = [];
window._clientsCacheLoaded = false;

async function loadClientsCache(companyId) {
  try {
    if (!companyId) { window._clientsCache = []; window._clientsCacheLoaded = false; return false; }
    const { data, error } = await supabase.rpc('get_clients_all', { p_company_id: companyId });
    if (error) { console.error('[loadClientsCache]', error); window._clientsCache = []; return false; }
    window._clientsCache = (data || []).map(c => ({
      id:             c.id,
      companyId:      c.company_id,
      projectId:      c.project_id      || null,
      clientCode:     c.client_code     || '',
      fullName:       c.full_name       || '',
      name:           c.full_name       || '',
      fatherName:     c.father_name     || '',
      cnic:           c.cnic            || '',
      passportNo:     c.passport_no     || '',
      phonePrimary:   c.phone_primary   || '',
      phone:          c.phone_primary   || '',
      phoneSecondary: c.phone_secondary || '',
      whatsapp:       c.whatsapp        || '',
      email:          c.email           || '',
      address:        c.address         || '',
      city:           c.city            || '',
      country:        c.country         || 'Pakistan',
      occupation:     c.occupation      || '',
      companyName:    c.company_name    || '',
      referenceBy:    c.reference_by    || '',
      clientCategory: c.client_category || '',
      notes:          c.notes           || '',
      metadata:       c.metadata        || {},
      status:         c.status          || 'active',
      clientPhotoUrl:    c.client_photo_url    || '',
      cnicFrontUrl:      c.cnic_front_url      || '',
      cnicBackUrl:       c.cnic_back_url       || '',
      overseasLocal:     c.overseas_local      || 'local',
      nextOfKinName:     c.next_of_kin_name    || '',
      nextOfKinRelation: c.next_of_kin_relation|| '',
      nextOfKinPhone:    c.next_of_kin_phone   || '',
      nextOfKinCnic:     c.next_of_kin_cnic    || '',
      nextOfKinPhotoUrl: c.next_of_kin_photo_url || '',
      leadSource:        c.lead_source         || '',
      bankName:          c.bank_name           || '',
      bankAccountTitle:  c.bank_account_title  || '',
      bankAccountNo:     c.bank_account_no     || '',
      bankIban:          c.bank_iban           || '',
      createdBy:      c.created_by      || null,
      createdAt:      c.created_at      || '',
      updatedAt:      c.updated_at      || ''
    }));
    window._clientsCacheLoaded = true;
    console.log(`✅ Clients cache loaded: ${window._clientsCache.length} clients`);
    return true;
  } catch (err) { console.error('[loadClientsCache]', err); window._clientsCache = []; return false; }
}

// ─── PROJECTS ───

window._projectsCache = [];
window._projectsCacheLoaded = false;

async function loadProjectsCache(companyId) {
  try {
    if (!companyId) { window._projectsCache = []; window._projectsCacheLoaded = false; return false; }
    const { data, error } = await supabase.rpc('list_projects', { p_company_id: companyId });
    if (error) { console.error('[loadProjectsCache]', error); window._projectsCache = []; return false; }
    window._projectsCache = (data || []).map(p => ({
      id: p.id, companyId: p.company_id,
      projectCode: p.project_code || '', projectName: p.project_name || '',
      name: p.project_name || '',
      location: p.location || '', city: p.city || '', country: p.country || 'Pakistan',
      totalArea: Number(p.total_area || 0), areaUnit: p.area_unit || 'sqft',
      totalUnits: Number(p.total_units || 0),
      description: p.description || '', startDate: p.start_date || '',
      expectedCompletion: p.expected_completion_date || '',
      deliveryDate: p.delivery_date || null,
      status: p.status || 'active', coverImageUrl: p.cover_image_url || '',
      builderName: p.builder_name || '', builderContact: p.builder_contact || '', builderEmail: p.builder_email || '',
      gpsLat: p.gps_lat || null, gpsLng: p.gps_lng || null, mapLink: p.map_link || '',
      constructionProgress: Number(p.construction_progress || 0),
      amenities: Array.isArray(p.amenities) ? p.amenities : [],
      nocNumber: p.noc_number || '', nocAuthority: p.noc_authority || '', nocDate: p.noc_date || '', nocNotes: p.noc_notes || '',
      coverImages: Array.isArray(p.cover_images) ? p.cover_images : [],
      createdBy: p.created_by || null, createdAt: p.created_at || ''
    }));
    window._projectsCacheLoaded = true;
    console.log(`✅ Projects cache loaded: ${window._projectsCache.length} projects`);
    return true;
  } catch (err) { console.error('[loadProjectsCache]', err); window._projectsCache = []; return false; }
}

async function saveProject(data) {
  try {
    const { id, ...prjData } = data;
    const cid = prjData.company_id || getCurrentCompanyId();
    const { data: r, error } = await supabase.rpc('upsert_project', {
      p_company_id: cid, p_data: prjData, p_id: id || null
    });
    if (error) { console.error('[saveProject] failed — code:', error.code, '| message:', error.message); return { _error: error }; }
    return r && r.id ? { id: r.id, ...prjData } : r;
  } catch (err) { console.error('saveProject:', err); return null; }
}

async function deleteProjectDB(projectId) {
  try {
    const cid = getCurrentCompanyId();
    const { error } = await supabase.rpc('delete_project', { p_id: projectId, p_company_id: cid });
    if (error) { console.error('deleteProjectDB:', error); return false; }
    return true;
  } catch (err) { console.error('deleteProjectDB:', err); return false; }
}

// ─── PROJECT MILESTONES ───

async function loadProjectMilestones(projectId, companyId) {
  try {
    const { data, error } = await supabase.rpc('list_project_milestones', { p_project_id: projectId, p_company_id: companyId });
    if (error) { console.error('[loadProjectMilestones]', error); return []; }
    return (data || []).map(m => ({
      id: m.id, projectId: m.project_id, companyId: m.company_id,
      phaseName: m.phase_name || '', description: m.description || '',
      targetDate: m.target_date || '', completionDate: m.completion_date || '',
      progressPct: Number(m.progress_pct || 0), status: m.status || 'pending',
      sortOrder: Number(m.sort_order || 0), createdAt: m.created_at || ''
    }));
  } catch (err) { console.error('[loadProjectMilestones]', err); return []; }
}

async function saveMilestone(data) {
  try {
    const { id, ...payload } = data;
    const cid = payload.company_id || getCurrentCompanyId();
    const { data: r, error } = await supabase.rpc('upsert_project_milestone', {
      p_company_id: cid, p_data: payload, p_id: id || null
    });
    if (error) { console.error('[saveMilestone]', error); return null; }
    return r && r.id ? { id: r.id, ...payload } : r;
  } catch (err) { console.error('[saveMilestone]', err); return null; }
}

async function deleteMilestoneDB(id) {
  try {
    const cid = getCurrentCompanyId();
    const { error } = await supabase.rpc('delete_project_milestone', { p_id: id, p_company_id: cid });
    if (error) { console.error('[deleteMilestoneDB]', error); return false; }
    return true;
  } catch (err) { console.error('[deleteMilestoneDB]', err); return false; }
}

// ─── PROJECT BANK ACCOUNTS ───

async function loadProjectBankAccounts(projectId, companyId) {
  try {
    const { data, error } = await supabase.rpc('list_project_bank_accounts', { p_project_id: projectId, p_company_id: companyId });
    if (error) { console.error('[loadProjectBankAccounts]', error); return []; }
    return (data || []).map(b => ({
      id: b.id, projectId: b.project_id, companyId: b.company_id,
      bankName: b.bank_name || '', accountTitle: b.account_title || '',
      accountNo: b.account_no || '', iban: b.iban || '', branch: b.branch || '',
      isPrimary: !!b.is_primary, notes: b.notes || '', createdAt: b.created_at || ''
    }));
  } catch (err) { console.error('[loadProjectBankAccounts]', err); return []; }
}

async function saveBankAccount(data) {
  try {
    const { id, ...payload } = data;
    const cid = payload.company_id || getCurrentCompanyId();
    const { data: r, error } = await supabase.rpc('upsert_project_bank_account', {
      p_company_id: cid, p_data: payload, p_id: id || null
    });
    if (error) { console.error('[saveBankAccount]', error); return null; }
    return r && r.id ? { id: r.id, ...payload } : r;
  } catch (err) { console.error('[saveBankAccount]', err); return null; }
}

async function deleteBankAccountDB(id) {
  try {
    const cid = getCurrentCompanyId();
    const { error } = await supabase.rpc('delete_project_bank_account', { p_id: id, p_company_id: cid });
    if (error) { console.error('[deleteBankAccountDB]', error); return false; }
    return true;
  } catch (err) { console.error('[deleteBankAccountDB]', err); return false; }
}

// ─── PROJECT EXPENSES ───

async function loadProjectExpenses(projectId, companyId) {
  try {
    const { data, error } = await supabase.rpc('list_project_expenses', { p_project_id: projectId, p_company_id: companyId });
    if (error) { console.error('[loadProjectExpenses]', error); return []; }
    return (data || []).map(e => ({
      id: e.id, projectId: e.project_id, companyId: e.company_id,
      category: e.expense_category || '', description: e.description || '',
      amount: Number(e.amount || 0), expenseDate: e.expense_date || '',
      notes: e.notes || '', createdBy: e.created_by || '', createdAt: e.created_at || ''
    }));
  } catch (err) { console.error('[loadProjectExpenses]', err); return []; }
}

async function saveExpense(data) {
  try {
    const { id, ...payload } = data;
    const cid = payload.company_id || getCurrentCompanyId();
    const { data: r, error } = await supabase.rpc('upsert_project_expense', {
      p_company_id: cid, p_data: payload, p_id: id || null
    });
    if (error) { console.error('[saveExpense]', error); return null; }
    return r && r.id ? { id: r.id, ...payload } : r;
  } catch (err) { console.error('[saveExpense]', err); return null; }
}

async function deleteExpenseDB(id) {
  try {
    const cid = getCurrentCompanyId();
    const { error } = await supabase.rpc('delete_project_expense', { p_id: id, p_company_id: cid });
    if (error) { console.error('[deleteExpenseDB]', error); return false; }
    return true;
  } catch (err) { console.error('[deleteExpenseDB]', err); return false; }
}

// ─── FLOORS ───

window._floorsCache = [];
window._floorsCacheLoaded = false;

async function loadFloorsCache(companyId) {
  try {
    if (!companyId) { window._floorsCache = []; window._floorsCacheLoaded = false; return false; }
    const { data, error } = await supabase.rpc('list_floors', { p_company_id: companyId });
    if (error) { console.error('[loadFloorsCache]', error); window._floorsCache = []; return false; }
    window._floorsCache = (data || []).map(f => ({
      id: f.id, companyId: f.company_id,
      name: f.name, floorCode: f.floor_code || '',
      sortOrder: Number(f.sort_order || 0), isActive: f.is_active !== false
    }));
    window._floorsCacheLoaded = true;
    console.log(`✅ Floors cache loaded: ${window._floorsCache.length} floors`);
    return true;
  } catch (err) { console.error('[loadFloorsCache]', err); window._floorsCache = []; return false; }
}

async function saveFloor(data) {
  try {
    const { id, ...d } = data;
    const cid = d.company_id || getCurrentCompanyId();
    const { data: r, error } = await supabase.rpc('upsert_floor', {
      p_company_id: cid, p_data: d, p_id: id || null
    });
    if (error) { console.error('saveFloor:', error); return { _error: error }; }
    return r && r.id ? { id: r.id, ...d } : r;
  } catch (err) { console.error('saveFloor:', err); return { _error: err }; }
}

async function deleteFloor(id) {
  try {
    const cid = getCurrentCompanyId();
    const { error } = await supabase.rpc('delete_floor', { p_id: id, p_company_id: cid });
    if (error) { console.error('deleteFloor:', error); return false; }
    return true;
  } catch (err) { console.error('deleteFloor:', err); return false; }
}

// ─── UNIT TYPES ───

window._typesCache = [];
window._typesCacheLoaded = false;

async function loadTypesCache(companyId) {
  try {
    if (!companyId) { window._typesCache = []; window._typesCacheLoaded = false; return false; }
    const { data, error } = await supabase.rpc('list_unit_types', { p_company_id: companyId });
    if (error) { console.error('[loadTypesCache]', error); window._typesCache = []; return false; }
    window._typesCache = (data || []).map(t => ({
      id: t.id, companyId: t.company_id, projectId: t.project_id || null,
      typeCode: t.type_code || '', typeName: t.type_name || '',
      name: t.type_name || '',
      defaultArea:  t.default_area  != null ? Number(t.default_area)  : null,
      defaultPrice: t.default_price != null ? Number(t.default_price) : null,
      sortOrder: Number(t.sort_order || 0), isActive: t.is_active !== false
    }));
    window._typesCacheLoaded = true;
    console.log(`✅ Types cache loaded: ${window._typesCache.length} types`);
    return true;
  } catch (err) { console.error('[loadTypesCache]', err); window._typesCache = []; return false; }
}

async function saveUnitType(data) {
  try {
    const { id, ...d } = data;
    const cid = d.company_id || getCurrentCompanyId();
    const { data: r, error } = await supabase.rpc('upsert_unit_type', {
      p_company_id: cid, p_data: d, p_id: id || null
    });
    if (error) { console.error('saveUnitType:', error); return { _error: error }; }
    return r && r.id ? { id: r.id, ...d } : r;
  } catch (err) { console.error('saveUnitType:', err); return { _error: err }; }
}

async function deleteUnitType(id) {
  try {
    const cid = getCurrentCompanyId();
    const { error } = await supabase.rpc('delete_unit_type', { p_id: id, p_company_id: cid });
    if (error) { console.error('deleteUnitType:', error); return false; }
    return true;
  } catch (err) { console.error('deleteUnitType:', err); return false; }
}

// ─── UNIT STATUSES ───

window._statusesCache = [];
window._statusesCacheLoaded = false;

async function loadStatusesCache(companyId) {
  try {
    if (!companyId) { window._statusesCache = []; window._statusesCacheLoaded = false; return false; }
    const { data, error } = await supabase.rpc('list_unit_statuses', { p_company_id: companyId });
    if (error) { console.error('[loadStatusesCache]', error); window._statusesCache = []; return false; }
    window._statusesCache = (data || []).map(s => ({
      id: s.id, companyId: s.company_id, projectId: s.project_id || null,
      statusCode: s.status_code || '', statusName: s.status_name || '',
      name: s.status_name || '',
      color: s.color_hex || '#6b7280',
      isAvailable: s.is_available || false,
      sortOrder: Number(s.sort_order || 0), isActive: s.is_active !== false
    }));
    window._statusesCacheLoaded = true;
    console.log(`✅ Statuses cache loaded: ${window._statusesCache.length} statuses`);
    return true;
  } catch (err) { console.error('[loadStatusesCache]', err); window._statusesCache = []; return false; }
}

async function saveUnitStatus(data) {
  try {
    const { id, ...d } = data;
    const cid = d.company_id || getCurrentCompanyId();
    const { data: r, error } = await supabase.rpc('upsert_unit_status', {
      p_company_id: cid, p_data: d, p_id: id || null
    });
    if (error) { console.error('saveUnitStatus:', error); return { _error: error }; }
    return r && r.id ? { id: r.id, ...d } : r;
  } catch (err) { console.error('saveUnitStatus:', err); return { _error: err }; }
}

async function deleteUnitStatus(id) {
  try {
    const cid = getCurrentCompanyId();
    const { error } = await supabase.rpc('delete_unit_status', { p_id: id, p_company_id: cid });
    if (error) { console.error('deleteUnitStatus:', error); return false; }
    return true;
  } catch (err) { console.error('deleteUnitStatus:', err); return false; }
}

// ─── SALE TYPES (user-defined deal types: Installment / Full Cash / Adjustment …) ───

window._saleTypesCache = [];
window._saleTypesCacheLoaded = false;

async function loadSaleTypesCache(companyId) {
  try {
    if (!companyId) { window._saleTypesCache = []; window._saleTypesCacheLoaded = false; return false; }
    const { data, error } = await supabase.rpc('list_sale_types', { p_company_id: companyId });
    if (error) { console.error('[loadSaleTypesCache]', error); window._saleTypesCache = []; return false; }
    window._saleTypesCache = (data || []).map(s => ({
      id: s.id, companyId: s.company_id, projectId: s.project_id || null,
      typeCode: s.type_code || '', typeName: s.type_name || '',
      name: s.type_name || '',
      color: s.color_hex || '#6b7280',
      sortOrder: Number(s.sort_order || 0), isActive: s.is_active !== false
    }));
    window._saleTypesCacheLoaded = true;
    console.log(`✅ Sale types cache loaded: ${window._saleTypesCache.length} types`);
    return true;
  } catch (err) { console.error('[loadSaleTypesCache]', err); window._saleTypesCache = []; return false; }
}

async function saveSaleType(data) {
  try {
    const { id, ...d } = data;
    const cid = d.company_id || getCurrentCompanyId();
    const { data: r, error } = await supabase.rpc('upsert_sale_type', {
      p_company_id: cid, p_data: d, p_id: id || null
    });
    if (error) { console.error('saveSaleType:', error); return { _error: error }; }
    return r && r.id ? { id: r.id, ...d } : r;
  } catch (err) { console.error('saveSaleType:', err); return { _error: err }; }
}

async function deleteSaleType(id) {
  try {
    const cid = getCurrentCompanyId();
    const { error } = await supabase.rpc('delete_sale_type', { p_id: id, p_company_id: cid });
    if (error) { console.error('deleteSaleType:', error); return false; }
    return true;
  } catch (err) { console.error('deleteSaleType:', err); return false; }
}

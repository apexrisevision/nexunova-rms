/**
 * Database Store for Nexunova RMS
 * Handles all Supabase data operations
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
 * Load all units for current company from Supabase into memory cache.
 * Joins sales, payments, clients, and agents so financial fields are populated.
 * @param {string} companyId
 * @returns {Promise<boolean>} success
 */
async function loadUnitsCache(companyId) {
  try {
    if (!companyId) {
      window._unitsCache = [];
      window._unitsCacheLoaded = false;
      return false;
    }

    const [
      { data: uData, error: uErr },
      { data: sData },
      { data: pData },
      { data: aData }
    ] = await Promise.all([
      supabase.from('units').select('*').eq('company_id', companyId).order('unit_no', { ascending: true }),
      supabase.from('sales').select('id,unit_id,client_id,agent_id,sale_number,sale_date,net_amount,total_amount,status').eq('company_id', companyId).neq('status', 'cancelled'),
      supabase.from('payments').select('sale_id,amount,payment_date').eq('company_id', companyId).order('payment_date', { ascending: false }),
      supabase.from('agents').select('id,full_name').eq('company_id', companyId)
    ]);

    if (uErr) {
      console.error('[loadUnitsCache] error:', uErr);
      window._unitsCache = [];
      return false;
    }

    const saleByUnit = {};
    (sData || []).forEach(s => { saleByUnit[s.unit_id] = s; });

    const paysBySale = {};
    (pData || []).forEach(p => {
      if (!paysBySale[p.sale_id]) paysBySale[p.sale_id] = { total: 0, lastDate: null };
      paysBySale[p.sale_id].total += Number(p.amount || 0);
      if (!paysBySale[p.sale_id].lastDate || p.payment_date > paysBySale[p.sale_id].lastDate) {
        paysBySale[p.sale_id].lastDate = p.payment_date;
      }
    });

    const agentById = {};
    (aData || []).forEach(a => { agentById[a.id] = a.full_name; });

    window._unitsCache = (uData || []).map(u => {
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

/**
 * Get current company ID from localStorage
 * @returns {string|null} Company ID or null if not set
 */
function getCurrentCompanyId() {
  return localStorage.getItem('nexunova_company_id');
}

/**
 * Set current company ID in localStorage
 * @param {string} companyId - The company ID to set
 */
function setCurrentCompanyId(companyId) {
  localStorage.setItem('nexunova_company_id', companyId);
}

// ─── UNITS ───

/**
 * Fetch all units for a company
 * @param {string} companyId - Company ID
 * @returns {Promise<Array>} Array of units
 */
async function getUnits(companyId) {
  try {
    const { data, error } = await supabase
      .from('units')
      .select('*')
      .eq('company_id', companyId)
      .order('unit_no', { ascending: true });

    if (error) {
      console.error('Error fetching units:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('Exception in getUnits:', err);
    return [];
  }
}

/**
 * Fetch units by project ID
 * @param {string} projectId - Project ID
 * @returns {Promise<Array>} Array of units
 */
async function getUnitsByProject(projectId) {
  try {
    const { data, error } = await supabase
      .from('units')
      .select('*')
      .eq('project_id', projectId)
      .order('unit_no', { ascending: true });

    if (error) {
      console.error('Error fetching units by project:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('Exception in getUnitsByProject:', err);
    return [];
  }
}

/**
 * Save or update a unit
 * @param {Object} data - Unit data (id optional for new units)
 * @returns {Promise<Object>} Saved unit data
 */
async function saveUnit(data) {
  try {
    const { id, ...unitData } = data;

    if (id) {
      // Update existing unit
      const { data: result, error } = await supabase
        .from('units')
        .update(unitData)
        .eq('id', id)
        .select();

      if (error) {
        console.error('Error updating unit:', error);
        return null;
      }
      return result?.[0] || null;
    } else {
      // Create new unit
      const { data: result, error } = await supabase
        .from('units')
        .insert([unitData])
        .select();

      if (error) {
        console.error('Error creating unit:', error);
        return null;
      }
      return result?.[0] || null;
    }
  } catch (err) {
    console.error('Exception in saveUnit:', err);
    return null;
  }
}

/**
 * Delete a unit
 * @param {string} unitId - Unit ID
 * @returns {Promise<boolean>} Success status
 */
async function deleteUnit(unitId) {
  try {
    const { error } = await supabase
      .from('units')
      .delete()
      .eq('id', unitId);

    if (error) {
      console.error('Error deleting unit:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Exception in deleteUnit:', err);
    return false;
  }
}

// ─── CLIENTS ───

/**
 * Fetch all clients for a company
 * @param {string} companyId - Company ID
 * @returns {Promise<Array>} Array of clients
 */
async function getClients(companyId) {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('company_id', companyId)
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching clients:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('Exception in getClients:', err);
    return [];
  }
}

/**
 * Fetch client by ID
 * @param {string} clientId - Client ID
 * @returns {Promise<Object|null>} Client data or null
 */
async function getClient(clientId) {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (error) {
      console.error('Error fetching client:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Exception in getClient:', err);
    return null;
  }
}

/**
 * Save or update a client
 * @param {Object} data - Client data (id optional for new clients)
 * @returns {Promise<Object>} Saved client data
 */
async function saveClient(data) {
  const { id, ...clientData } = data;
  const cid = data.company_id;

  // Always persist to localStorage first
  const db = gdb();
  if(!db.clients) db.clients = {};
  if(!db.clients[cid]) db.clients[cid] = [];

  let localRecord;
  if(id) {
    const idx = db.clients[cid].findIndex(c => c.id === id);
    localRecord = { ...clientData, id };
    if(idx !== -1) db.clients[cid][idx] = localRecord;
    else db.clients[cid].push(localRecord);
  } else {
    localRecord = { ...clientData, id: 'local_' + Date.now() };
    db.clients[cid].push(localRecord);
  }
  sdb(db);

  // Try Supabase (best-effort, does not block)
  try {
    if(id) {
      const { data: result, error } = await supabase
        .from('clients').update(clientData).eq('id', id).select();
      if(!error && result?.[0]) return result[0];
    } else {
      const { data: result, error } = await supabase
        .from('clients').insert([clientData]).select();
      if(!error && result?.[0]) return result[0];
    }
  } catch(err) {
    console.warn('Supabase saveClient failed, using localStorage:', err);
  }

  return localRecord;
}

/**
 * Delete a client
 * @param {string} clientId - Client ID
 * @returns {Promise<boolean>} Success status
 */
async function deleteClient(clientId) {
  try {
    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', clientId);

    if (error) {
      console.error('Error deleting client:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Exception in deleteClient:', err);
    return false;
  }
}

// ─── COMPANIES ───

/**
 * Fetch all companies
 * @returns {Promise<Array>} Array of companies
 */
async function getCompanies() {
  try {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching companies:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('Exception in getCompanies:', err);
    return [];
  }
}

/**
 * Get current company data
 * @returns {Promise<Object|null>} Current company data or null
 */
async function getCurrentCompany() {
  const companyId = getCurrentCompanyId();
  if (!companyId) return null;

  try {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (error) {
      console.error('Error fetching current company:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Exception in getCurrentCompany:', err);
    return null;
  }
}

// ─── CLIENTS ───

window._clientsCache = [];
window._clientsCacheLoaded = false;

async function loadClientsCache(companyId) {
  try {
    if (!companyId) { window._clientsCache = []; window._clientsCacheLoaded = false; return false; }
    const { data, error } = await supabase
      .from('clients').select('*').eq('company_id', companyId).order('full_name', { ascending: true });
    if (error) { console.error('[loadClientsCache]', error); window._clientsCache = []; return false; }
    window._clientsCache = (data || []).map(c => ({
      id:             c.id,
      companyId:      c.company_id,
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
    const { data, error } = await supabase.from('projects').select('*').eq('company_id', companyId).order('project_name', { ascending: true });
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
    if (id) {
      const { data: r, error } = await supabase.from('projects').update(prjData).eq('id', id).select();
      if (error) { console.error('[saveProject] UPDATE failed — code:', error.code, '| message:', error.message, '| hint:', error.hint, '| details:', error.details); return { _error: error }; }
      return r?.[0] || null;
    } else {
      const { data: r, error } = await supabase.from('projects').insert([prjData]).select();
      if (error) { console.error('[saveProject] INSERT failed — code:', error.code, '| message:', error.message, '| hint:', error.hint, '| details:', error.details); return { _error: error }; }
      return r?.[0] || null;
    }
  } catch (err) { console.error('saveProject:', err); return null; }
}

async function deleteProjectDB(projectId) {
  try {
    const { error } = await supabase.from('projects').delete().eq('id', projectId);
    if (error) { console.error('deleteProjectDB:', error); return false; }
    return true;
  } catch (err) { console.error('deleteProjectDB:', err); return false; }
}

// ─── PROJECT MILESTONES ───

async function loadProjectMilestones(projectId, companyId) {
  try {
    const { data, error } = await supabase.from('project_milestones')
      .select('*').eq('project_id', projectId).eq('company_id', companyId)
      .order('sort_order', { ascending: true });
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
    if (id) {
      const { data: r, error } = await supabase.from('project_milestones').update(payload).eq('id', id).select();
      if (error) { console.error('[saveMilestone]', error); return null; }
      return r?.[0] || null;
    } else {
      const { data: r, error } = await supabase.from('project_milestones').insert([payload]).select();
      if (error) { console.error('[saveMilestone]', error); return null; }
      return r?.[0] || null;
    }
  } catch (err) { console.error('[saveMilestone]', err); return null; }
}

async function deleteMilestoneDB(id) {
  try {
    const { error } = await supabase.from('project_milestones').delete().eq('id', id);
    if (error) { console.error('[deleteMilestoneDB]', error); return false; }
    return true;
  } catch (err) { console.error('[deleteMilestoneDB]', err); return false; }
}

// ─── PROJECT BANK ACCOUNTS ───

async function loadProjectBankAccounts(projectId, companyId) {
  try {
    const { data, error } = await supabase.from('project_bank_accounts')
      .select('*').eq('project_id', projectId).eq('company_id', companyId)
      .order('is_primary', { ascending: false });
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
    if (id) {
      const { data: r, error } = await supabase.from('project_bank_accounts').update(payload).eq('id', id).select();
      if (error) { console.error('[saveBankAccount]', error); return null; }
      return r?.[0] || null;
    } else {
      const { data: r, error } = await supabase.from('project_bank_accounts').insert([payload]).select();
      if (error) { console.error('[saveBankAccount]', error); return null; }
      return r?.[0] || null;
    }
  } catch (err) { console.error('[saveBankAccount]', err); return null; }
}

async function deleteBankAccountDB(id) {
  try {
    const { error } = await supabase.from('project_bank_accounts').delete().eq('id', id);
    if (error) { console.error('[deleteBankAccountDB]', error); return false; }
    return true;
  } catch (err) { console.error('[deleteBankAccountDB]', err); return false; }
}

// ─── PROJECT EXPENSES ───

async function loadProjectExpenses(projectId, companyId) {
  try {
    const { data, error } = await supabase.from('project_expenses')
      .select('*').eq('project_id', projectId).eq('company_id', companyId)
      .order('expense_date', { ascending: false });
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
    if (id) {
      const { data: r, error } = await supabase.from('project_expenses').update(payload).eq('id', id).select();
      if (error) { console.error('[saveExpense]', error); return null; }
      return r?.[0] || null;
    } else {
      const { data: r, error } = await supabase.from('project_expenses').insert([payload]).select();
      if (error) { console.error('[saveExpense]', error); return null; }
      return r?.[0] || null;
    }
  } catch (err) { console.error('[saveExpense]', err); return null; }
}

async function deleteExpenseDB(id) {
  try {
    const { error } = await supabase.from('project_expenses').delete().eq('id', id);
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
    const { data, error } = await supabase
      .from('floors')
      .select('*')
      .eq('company_id', companyId)
      .order('sort_order', { ascending: true });
    if (error) { console.error('[loadFloorsCache]', error); window._floorsCache = []; return false; }
    window._floorsCache = (data || []).map(f => ({
      id: f.id, companyId: f.company_id,
      name: f.name, sortOrder: Number(f.sort_order || 0), isActive: f.is_active !== false
    }));
    window._floorsCacheLoaded = true;
    console.log(`✅ Floors cache loaded: ${window._floorsCache.length} floors`);
    return true;
  } catch (err) { console.error('[loadFloorsCache]', err); window._floorsCache = []; return false; }
}

async function saveFloor(data) {
  try {
    const { id, ...d } = data;
    if (id) {
      const { data: r, error } = await supabase.from('floors').update(d).eq('id', id).select();
      if (error) { console.error('saveFloor:', error); return { _error: error }; }
      return r?.[0] || null;
    } else {
      const { data: r, error } = await supabase.from('floors').insert([d]).select();
      if (error) { console.error('saveFloor:', error); return { _error: error }; }
      return r?.[0] || null;
    }
  } catch (err) { console.error('saveFloor:', err); return { _error: err }; }
}

async function deleteFloor(id) {
  try {
    const { error } = await supabase.from('floors').delete().eq('id', id);
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
    const { data, error } = await supabase
      .from('category_unit_types')
      .select('*')
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .order('sort_order', { ascending: true });
    if (error) { console.error('[loadTypesCache]', error); window._typesCache = []; return false; }
    window._typesCache = (data || []).map(t => ({
      id: t.id, companyId: t.company_id,
      typeCode: t.type_code || '', typeName: t.type_name || '',
      name: t.type_name || '',
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
    if (id) {
      const { data: r, error } = await supabase.from('category_unit_types').update(d).eq('id', id).select();
      if (error) { console.error('saveUnitType:', error); return { _error: error }; }
      return r?.[0] || null;
    } else {
      const { data: r, error } = await supabase.from('category_unit_types').insert([d]).select();
      if (error) { console.error('saveUnitType:', error); return { _error: error }; }
      return r?.[0] || null;
    }
  } catch (err) { console.error('saveUnitType:', err); return { _error: err }; }
}

async function deleteUnitType(id) {
  try {
    const { error } = await supabase.from('category_unit_types').delete().eq('id', id);
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
    const { data, error } = await supabase
      .from('category_unit_statuses')
      .select('*')
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .order('sort_order', { ascending: true });
    if (error) { console.error('[loadStatusesCache]', error); window._statusesCache = []; return false; }
    window._statusesCache = (data || []).map(s => ({
      id: s.id, companyId: s.company_id,
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
    if (id) {
      const { data: r, error } = await supabase.from('category_unit_statuses').update(d).eq('id', id).select();
      if (error) { console.error('saveUnitStatus:', error); return { _error: error }; }
      return r?.[0] || null;
    } else {
      const { data: r, error } = await supabase.from('category_unit_statuses').insert([d]).select();
      if (error) { console.error('saveUnitStatus:', error); return { _error: error }; }
      return r?.[0] || null;
    }
  } catch (err) { console.error('saveUnitStatus:', err); return { _error: err }; }
}

async function deleteUnitStatus(id) {
  try {
    const { error } = await supabase.from('category_unit_statuses').delete().eq('id', id);
    if (error) { console.error('deleteUnitStatus:', error); return false; }
    return true;
  } catch (err) { console.error('deleteUnitStatus:', err); return false; }
}

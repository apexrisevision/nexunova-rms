/**
 * Database Store for Nexunova RMS
 * Handles all Supabase data operations
 */

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

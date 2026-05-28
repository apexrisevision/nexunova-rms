// ══ COMMUNICATIONS CENTER (Module 7 — foundation) ════════════════
// Per-tenant message template library + message log + opt-out awareness.
// Gateway-agnostic: templates power the manual WhatsApp sends used across
// the app (radar, promises, risk board). Automated/bulk dispatch + delivery
// tracking are a separate layer pending a WhatsApp/SMS gateway decision.
// RPCs: list_message_templates, upsert_message_template, delete_message_template,
//       seed_default_templates, get_message_log.

let _wcTab       = 'templates';   // 'templates' | 'broadcast' | 'log'
let _wcTemplates = [];
let _wcChannel   = 'all';
let _wcLog       = [];
let _wcClients   = [];            // broadcast audience pool (lazy)
let _wcBcSel     = new Set();     // selected client ids for broadcast
let _wcBcAud     = 'overdue';     // 'selected' | 'all' | 'overdue'

const _WC_MERGE_FIELDS = [
  '{{client_name}}','{{amount}}','{{due_date}}','{{days_overdue}}',
  '{{receipt_no}}','{{promise_date}}','{{cheque_no}}','{{deposit_date}}','{{company_name}}'
];
const _WC_CATEGORIES = ['custom','installment_due','overdue','payment_received','promise_reminder','pdc_reminder','legal_notice','demand_letter'];
const _WC_LANGS = ['en','ur','en_US','ur_PK'];

async function rCommsCenter() {
  const pg = document.getElementById('pg-commscenter');
  if (!pg) return;
  _wcTab = 'templates';

  pg.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l">
        <h2>Communications Center</h2>
        <p>Editable message templates for recovery WhatsApp / SMS / email. Templates power the manual sends across the app.</p>
      </div>
      <div class="ph-r" style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-g btn-sm"  onclick="_wcOpenEdit()">+ New Template</button>
        <button class="btn btn-gh btn-sm" onclick="_wcSeed()">Seed Defaults</button>
      </div>
    </div>

    <div style="display:flex;border-bottom:2px solid var(--line);margin-bottom:14px">
      <button id="wc-tab-templates-btn" class="btn btn-xs" style="padding:8px 16px;border:none;border-bottom:2px solid var(--brand);margin-bottom:-2px;font-size:13px;font-weight:700;color:var(--brand);background:none;cursor:pointer" onclick="wcShowTab('templates')">Templates</button>
      <button id="wc-tab-broadcast-btn" class="btn btn-xs" style="padding:8px 16px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;font-size:13px;font-weight:600;color:var(--t3);background:none;cursor:pointer" onclick="wcShowTab('broadcast')">Broadcast</button>
      <button id="wc-tab-log-btn"       class="btn btn-xs" style="padding:8px 16px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;font-size:13px;font-weight:600;color:var(--t3);background:none;cursor:pointer" onclick="wcShowTab('log')">Message Log</button>
    </div>

    <div id="wc-tab-templates"></div>
    <div id="wc-tab-broadcast" style="display:none"></div>
    <div id="wc-tab-log" style="display:none"></div>
  </div>`;

  pg.insertAdjacentHTML('beforeend', _wcEditModalHTML());
  await _wcLoadTemplates();
}

function wcShowTab(tab) {
  _wcTab = tab;
  ['templates','broadcast','log'].forEach(t => {
    const div = document.getElementById('wc-tab-'+t);
    const btn = document.getElementById('wc-tab-'+t+'-btn');
    if (div) div.style.display = t === tab ? '' : 'none';
    if (btn) {
      btn.style.borderBottomColor = t === tab ? 'var(--brand)' : 'transparent';
      btn.style.color             = t === tab ? 'var(--brand)' : 'var(--t3)';
      btn.style.fontWeight        = t === tab ? '700' : '600';
    }
  });
  if (tab === 'broadcast') _wcLoadBroadcast();
  if (tab === 'log')       _wcLoadLog();
}

// ─── Templates ───────────────────────────────────────────────────
async function _wcLoadTemplates() {
  const body = document.getElementById('wc-tab-templates');
  if (!body) return;
  body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading templates…</div>';
  try {
    const { data, error } = await supabase.rpc('list_message_templates', { p_company_id: S.cid, p_channel: null });
    if (error) throw error;
    _wcTemplates = Array.isArray(data) ? data : [];
    _wcRenderTemplates();
  } catch(e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Could not load templates</div><div class="es">${esc(e.message||'Error')}</div></div></div>`;
  }
}

function _wcRenderTemplates() {
  const body = document.getElementById('wc-tab-templates');
  if (!body) return;

  const channels = ['all','whatsapp','sms','email'];
  const chips = channels.map(c => {
    const active = _wcChannel === c;
    return `<button class="btn btn-xs" style="padding:5px 12px;border-radius:20px;border:1px solid ${active?'var(--brand)':'var(--line)'};background:${active?'var(--brand)':'transparent'};color:${active?'#fff':'var(--t2)'};font-weight:700;cursor:pointer" onclick="_wcSetChannel('${c}')">${c==='all'?'All':c.toUpperCase()}</button>`;
  }).join('');

  const rows = _wcChannel === 'all' ? _wcTemplates : _wcTemplates.filter(t => t.channel === _wcChannel);

  const mergeRef = `<div style="font-size:11px;color:var(--t3);margin:0 0 12px">
    <b>Merge fields:</b> ${_WC_MERGE_FIELDS.map(f => `<code style="background:var(--canvas);padding:1px 5px;border-radius:4px;margin:0 2px;font-size:10px">${f}</code>`).join('')}
  </div>`;

  if (!rows.length) {
    body.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${chips}</div>${mergeRef}
      <div class="card"><div class="empty">
        <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
        <div class="et">No templates yet</div>
        <div class="es">Click <strong>Seed Defaults</strong> for a starter set, or create your own.</div>
        <button class="btn btn-g btn-sm" style="margin-top:12px" onclick="_wcSeed()">Seed Default Templates</button>
      </div></div>`;
    return;
  }

  body.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${chips}</div>${mergeRef}` +
    rows.map(t => {
      const chColor = t.channel==='whatsapp'?'#16a34a':t.channel==='sms'?'#3b82f6':'#8b5cf6';
      return `<div class="card" style="margin-bottom:10px">
        <div class="cb" style="padding:14px 16px">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px">
            <div>
              <div style="font-size:14px;font-weight:800">${esc(t.name)}
                ${!t.is_active?`<span style="font-size:9px;color:var(--t3);border:1px solid var(--line);padding:1px 6px;border-radius:10px;margin-left:6px">inactive</span>`:''}</div>
              <div style="font-size:10px;color:var(--t3);margin-top:2px">
                <span style="color:${chColor};font-weight:700">${t.channel.toUpperCase()}</span> · ${esc(t.category)}
              </div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-gh btn-xs" onclick="_wcOpenEdit('${t.id}')">Edit</button>
              <button class="btn btn-gh btn-xs" style="color:#ef4444" onclick="_wcDelete('${t.id}')">Delete</button>
            </div>
          </div>
          ${t.subject?`<div style="font-size:12px;font-weight:700;margin-bottom:4px">${esc(t.subject)}</div>`:''}
          <div style="font-size:12px;color:var(--t2);white-space:pre-wrap;background:var(--canvas);border-radius:6px;padding:8px 10px">${esc(t.body)}</div>
        </div>
      </div>`;
    }).join('');
}

function _wcSetChannel(c) { _wcChannel = c; _wcRenderTemplates(); }

async function _wcSeed() {
  try {
    const { data, error } = await supabase.rpc('seed_default_templates', { p_company_id: S.cid });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast((data.added || 0) + ' default template(s) added', 'ok');
    await _wcLoadTemplates();
  } catch(e) {
    toast('Seeding failed: ' + (e.message || ''), 'err');
  }
}

// ─── Edit / Create modal ─────────────────────────────────────────
function _wcEditModalHTML() {
  return `<div id="wc-edit-modal" class="mo" style="display:none" onclick="if(event.target===this)_wcCloseEdit()">
    <div class="mo-box" style="max-width:560px">
      <div class="mo-hd"><span id="wc-edit-title">New Template</span><button class="mo-cl" onclick="_wcCloseEdit()">✕</button></div>
      <div class="mo-bd">
        <input type="hidden" id="wc-f-id">
        <div class="fg"><label class="fl">Name *</label><input id="wc-f-name" class="fi" placeholder="e.g. Overdue Reminder"></div>
        <div style="display:flex;gap:10px">
          <div class="fg" style="flex:1"><label class="fl">Channel</label>
            <select id="wc-f-channel" class="fi" onchange="_wcToggleSubject()">
              <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option>
            </select></div>
          <div class="fg" style="flex:1"><label class="fl">Category</label>
            <select id="wc-f-category" class="fi">${_WC_CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div>
        </div>
        <div class="fg" id="wc-f-subject-wrap" style="display:none"><label class="fl">Subject (email)</label><input id="wc-f-subject" class="fi"></div>
        <div class="fg"><label class="fl">Body *</label>
          <textarea id="wc-f-body" class="fi" rows="5" placeholder="Assalam o Alaikum {{client_name}}…"></textarea></div>
        <div style="font-size:10px;color:var(--t3)">Merge: ${_WC_MERGE_FIELDS.map(f=>`<code style="background:var(--canvas);padding:1px 4px;border-radius:3px;cursor:pointer" onclick="_wcInsertMerge('${f}')">${f}</code>`).join(' ')}</div>

        <div id="wc-f-meta-wrap" style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)">
          <div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:6px">WhatsApp Cloud API / BSP (for automated sends)</div>
          <div class="fg"><label class="fl">Approved template name</label>
            <input id="wc-f-meta-name" class="fi" placeholder="e.g. installment_due_reminder"></div>
          <div style="display:flex;gap:10px">
            <div class="fg" style="flex:1"><label class="fl">Language</label>
              <select id="wc-f-meta-lang" class="fi">${_WC_LANGS.map(l=>`<option value="${l}">${l}</option>`).join('')}</select></div>
            <div class="fg" style="flex:2"><label class="fl">Variable order → {{1}},{{2}}…</label>
              <input id="wc-f-meta-vars" class="fi" placeholder="client_name, amount, due_date"></div>
          </div>
          <div style="font-size:10px;color:var(--t3)">Comma-separated merge keys in the order Meta expects. Blank template name = free-text (only valid inside a 24h window).</div>
        </div>

        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px"><input type="checkbox" id="wc-f-active" checked> Active</label>
        <div id="wc-edit-err" style="color:var(--err);font-size:12px;margin-top:6px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-gh btn-sm" onclick="_wcCloseEdit()">Cancel</button>
        <button class="btn btn-g btn-sm"  id="wc-save-btn" onclick="_wcSave()">Save Template</button>
      </div>
    </div>
  </div>`;
}

function _wcOpenEdit(id) {
  const m = document.getElementById('wc-edit-modal');
  if (!m) return;
  const t = id ? _wcTemplates.find(x => x.id === id) : null;
  document.getElementById('wc-edit-title').textContent = t ? 'Edit Template' : 'New Template';
  document.getElementById('wc-f-id').value       = t ? t.id : '';
  document.getElementById('wc-f-name').value     = t ? (t.name||'') : '';
  document.getElementById('wc-f-channel').value  = t ? (t.channel||'whatsapp') : 'whatsapp';
  document.getElementById('wc-f-category').value = t ? (t.category||'custom') : 'custom';
  document.getElementById('wc-f-subject').value  = t ? (t.subject||'') : '';
  document.getElementById('wc-f-body').value     = t ? (t.body||'') : '';
  document.getElementById('wc-f-active').checked = t ? !!t.is_active : true;
  document.getElementById('wc-f-meta-name').value = t ? (t.meta_template_name||'') : '';
  document.getElementById('wc-f-meta-lang').value = t ? (t.meta_language||'en') : 'en';
  document.getElementById('wc-f-meta-vars').value = (t && Array.isArray(t.variable_map)) ? t.variable_map.join(', ') : '';
  document.getElementById('wc-edit-err').textContent = '';
  _wcToggleSubject();
  m.style.display = 'flex';
}
function _wcCloseEdit() { const m = document.getElementById('wc-edit-modal'); if (m) m.style.display = 'none'; }
function _wcToggleSubject() {
  const ch = document.getElementById('wc-f-channel');
  const wrap = document.getElementById('wc-f-subject-wrap');
  const meta = document.getElementById('wc-f-meta-wrap');
  if (ch && wrap) wrap.style.display = ch.value === 'email' ? '' : 'none';
  if (ch && meta) meta.style.display = ch.value === 'whatsapp' ? '' : 'none';
}
function _wcInsertMerge(field) {
  const ta = document.getElementById('wc-f-body');
  if (!ta) return;
  const s = ta.selectionStart || ta.value.length;
  ta.value = ta.value.slice(0, s) + field + ta.value.slice(ta.selectionEnd || s);
  ta.focus();
}

async function _wcSave() {
  const name    = document.getElementById('wc-f-name').value.trim();
  const channel = document.getElementById('wc-f-channel').value;
  const category= document.getElementById('wc-f-category').value;
  const subject = document.getElementById('wc-f-subject').value.trim();
  const bodyTxt = document.getElementById('wc-f-body').value.trim();
  const active  = document.getElementById('wc-f-active').checked;
  const id      = document.getElementById('wc-f-id').value;
  const err     = document.getElementById('wc-edit-err');
  if (!name)    { if (err) err.textContent = 'Name is required'; return; }
  if (!bodyTxt) { if (err) err.textContent = 'Body is required'; return; }

  const btn = document.getElementById('wc-save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Saving…'; }
  try {
    const payload = { name, channel, category, subject: channel==='email'?subject:null, body: bodyTxt, is_active: active, created_by: S.username || null };
    if (channel === 'whatsapp') {
      const mName = document.getElementById('wc-f-meta-name').value.trim();
      const mVars = document.getElementById('wc-f-meta-vars').value.trim();
      payload.meta_template_name = mName || null;
      payload.meta_language      = document.getElementById('wc-f-meta-lang').value;
      payload.variable_map       = mVars ? mVars.split(',').map(s=>s.trim()).filter(Boolean) : [];
    }
    if (id) payload.id = id;
    const { data, error } = await supabase.rpc('upsert_message_template', { p_company_id: S.cid, p_data: payload });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    _wcCloseEdit();
    toast('Template saved', 'ok');
    await _wcLoadTemplates();
  } catch(e) {
    if (err) err.textContent = e.message || 'Failed';
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Save Template'; }
  }
}

async function _wcDelete(id) {
  if (!confirm('Delete this template?')) return;
  try {
    const { data, error } = await supabase.rpc('delete_message_template', { p_id: id, p_company_id: S.cid });
    if (error) throw error;
    if (!data?.success) throw new Error('Failed');
    toast('Template deleted', 'ok');
    await _wcLoadTemplates();
  } catch(e) {
    toast('Delete failed: ' + (e.message || ''), 'err');
  }
}

// ─── Message Log ─────────────────────────────────────────────────
async function _wcLoadLog() {
  const body = document.getElementById('wc-tab-log');
  if (!body) return;
  body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading log…</div>';
  try {
    const { data, error } = await supabase.rpc('get_message_log', { p_company_id: S.cid, p_limit: 200 });
    if (error) throw error;
    _wcLog = Array.isArray(data) ? data : [];
    _wcRenderLog();
  } catch(e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="es">${esc(e.message||'Error')}</div></div></div>`;
  }
}

function _wcRenderLog() {
  const body = document.getElementById('wc-tab-log');
  if (!body) return;
  if (!_wcLog.length) {
    body.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
      <div class="et">No messages logged yet</div>
      <div class="es">Sends made from the app are recorded here.</div>
    </div></div>`;
    return;
  }
  const stColor = { manual:'var(--t2)', queued:'#f59e0b', sending:'#f59e0b', sent:'#3b82f6', delivered:'#16a34a', read:'#16a34a', failed:'#ef4444', cancelled:'var(--t3)' };
  body.innerHTML = `<div class="card"><div class="cb" style="padding:0"><div class="tw"><table class="t" style="width:100%">
    <thead><tr><th>Date</th><th>Client</th><th class="hide-sm">Channel</th><th class="hide-sm">Category</th><th>Status</th><th>By</th></tr></thead>
    <tbody>${_wcLog.map(m => `<tr>
      <td style="font-size:11px;color:var(--t3)">${m.created_at ? new Date(m.created_at).toLocaleString('en-PK') : '—'}${m.scheduled_at?`<div style="font-size:9px;color:#f59e0b">⏱ ${new Date(m.scheduled_at).toLocaleString('en-PK')}</div>`:''}</td>
      <td style="font-size:13px;font-weight:700">${esc(m.client_name||'—')}<div style="font-size:10px;color:var(--t3)">${esc(m.to_address||'')}</div></td>
      <td class="hide-sm" style="font-size:11px">${esc(m.channel||'—')}${m.provider?`<div style="font-size:9px;color:var(--t3)">${esc(m.provider)}</div>`:''}</td>
      <td class="hide-sm" style="font-size:11px;color:var(--t2)">${esc(m.category||'—')}</td>
      <td><span style="font-size:11px;font-weight:700;color:${stColor[m.status]||'var(--t3)'}">${esc(m.status||'—')}</span>${m.error?`<div style="font-size:9px;color:#ef4444" title="${esc(m.error)}">⚠ error</div>`:''}</td>
      <td style="font-size:11px;color:var(--t2)">${esc(m.sent_by||'—')}</td>
    </tr>`).join('')}</tbody>
  </table></div></div></div>`;
}

// ─── Broadcast ───────────────────────────────────────────────────
async function _wcLoadBroadcast() {
  const body = document.getElementById('wc-tab-broadcast');
  if (!body) return;
  // ensure templates are available for the picker
  if (!_wcTemplates.length) {
    try {
      const { data } = await supabase.rpc('list_message_templates', { p_company_id: S.cid, p_channel: 'whatsapp' });
      _wcTemplates = Array.isArray(data) ? data : [];
    } catch(e) { /* non-fatal */ }
  }
  const waTpls = _wcTemplates.filter(t => t.channel === 'whatsapp' && t.is_active);
  body.innerHTML = `<div class="card"><div class="cb" style="padding:16px">
    <div class="fg"><label class="fl">Template</label>
      <select id="wc-bc-tpl" class="fi" onchange="_wcBcOnTpl()">
        <option value="">— Custom message —</option>
        ${waTpls.map(t => `<option value="${t.id}">${esc(t.name)} (${esc(t.category)})</option>`).join('')}
      </select></div>
    <div class="fg"><label class="fl">Message body</label>
      <textarea id="wc-bc-body" class="fi" rows="4" placeholder="Assalam o Alaikum {{client_name}}…"></textarea>
      <div style="font-size:10px;color:var(--t3);margin-top:4px">Broadcast auto-fills <code>{{client_name}}</code> &amp; <code>{{company_name}}</code> per client.</div></div>
    <div class="fg"><label class="fl">Audience</label>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px">
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="wc-bc-aud" value="overdue" ${_wcBcAud==='overdue'?'checked':''} onchange="_wcBcSetAud('overdue')"> Overdue clients</label>
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="wc-bc-aud" value="all" ${_wcBcAud==='all'?'checked':''} onchange="_wcBcSetAud('all')"> All clients</label>
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="wc-bc-aud" value="selected" ${_wcBcAud==='selected'?'checked':''} onchange="_wcBcSetAud('selected')"> Selected clients</label>
      </div></div>
    <div id="wc-bc-selwrap" style="display:none"></div>
    <div class="fg"><label class="fl">Schedule (optional)</label>
      <input type="datetime-local" id="wc-bc-sched" class="fi" style="max-width:240px">
      <div style="font-size:10px;color:var(--t3);margin-top:4px">Blank = queue for the next dispatch sweep.</div></div>
    <div id="wc-bc-result" style="font-size:12px;margin-top:6px"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:8px">
      <button class="btn btn-g btn-sm" id="wc-bc-send" onclick="_wcBcSend()">Queue Broadcast</button>
    </div>
  </div></div>
  <div style="font-size:11px;color:var(--t3);margin-top:8px">Opted-out / DND clients are skipped automatically. Until a gateway is configured, messages queue in <b>dry-run</b> and won't actually send.</div>`;
  if (_wcBcAud === 'selected') _wcBcSetAud('selected');
}

function _wcBcOnTpl() {
  const sel = document.getElementById('wc-bc-tpl');
  const ta  = document.getElementById('wc-bc-body');
  if (!sel || !ta) return;
  const t = _wcTemplates.find(x => x.id === sel.value);
  if (t) ta.value = t.body || '';
}

function _wcBcSetAud(a) {
  _wcBcAud = a;
  const wrap = document.getElementById('wc-bc-selwrap');
  if (!wrap) return;
  if (a === 'selected') { wrap.style.display = ''; _wcBcLoadClients(); }
  else wrap.style.display = 'none';
}

async function _wcBcLoadClients() {
  const wrap = document.getElementById('wc-bc-selwrap');
  if (!wrap) return;
  if (!_wcClients.length) {
    wrap.innerHTML = '<div style="padding:12px;color:var(--t3);font-size:12px">⏳ Loading clients…</div>';
    try {
      const { data, error } = await supabase.rpc('list_clients_lookup', { p_company_id: S.cid });
      if (error) throw error;
      _wcClients = Array.isArray(data) ? data : [];
    } catch(e) {
      wrap.innerHTML = `<div style="padding:12px;color:#ef4444;font-size:12px">${esc(e.message||'Could not load clients')}</div>`;
      return;
    }
  }
  wrap.innerHTML = `<div class="fg"><label class="fl" id="wc-bc-sellabel">Pick clients (${_wcBcSel.size} selected)</label>
    <input class="fi" placeholder="Search name / code / phone…" oninput="_wcBcFilter(this.value)">
    <div id="wc-bc-clist" style="max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:6px;margin-top:6px"></div></div>`;
  _wcBcFilter('');
}

function _wcBcFilter(q) {
  q = (q||'').toLowerCase();
  const list = document.getElementById('wc-bc-clist');
  if (!list) return;
  const rows = _wcClients.filter(c => !q
    || (c.full_name||c.client_name||'').toLowerCase().includes(q)
    || (c.client_code||'').toLowerCase().includes(q)
    || (c.phone||c.phone_primary||'').includes(q));
  list.innerHTML = rows.length ? rows.map(c => `<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--line);font-size:12px;cursor:pointer">
    <input type="checkbox" ${_wcBcSel.has(c.id)?'checked':''} onchange="_wcBcToggle('${c.id}',this.checked)">
    <span style="font-weight:600">${esc(c.full_name||c.client_name||'—')}</span>
    <span style="color:var(--t3)">${esc(c.client_code||'')}${c.phone||c.phone_primary?' · '+esc(c.phone||c.phone_primary):''}</span>
  </label>`).join('') : '<div style="padding:12px;color:var(--t3);font-size:12px">No matching clients</div>';
}

function _wcBcToggle(id, on) {
  if (on) _wcBcSel.add(id); else _wcBcSel.delete(id);
  const lbl = document.getElementById('wc-bc-sellabel');
  if (lbl) lbl.textContent = `Pick clients (${_wcBcSel.size} selected)`;
}

async function _wcBcSend() {
  const tplId = document.getElementById('wc-bc-tpl').value;
  const bodyTxt = document.getElementById('wc-bc-body').value.trim();
  const sched = document.getElementById('wc-bc-sched').value;
  const res = document.getElementById('wc-bc-result');
  if (!tplId && !bodyTxt) { res.style.color = 'var(--err)'; res.textContent = 'Pick a template or write a message.'; return; }
  if (_wcBcAud === 'selected' && _wcBcSel.size === 0) { res.style.color = 'var(--err)'; res.textContent = 'Select at least one client.'; return; }
  if ((_wcBcAud === 'all' || _wcBcAud === 'overdue') &&
      !confirm(`Queue this broadcast to ${_wcBcAud === 'all' ? 'ALL' : 'all OVERDUE'} clients?`)) return;

  const payload = { audience: _wcBcAud, channel: 'whatsapp', sent_by: S.username || null };
  if (tplId) payload.template_id = tplId; else payload.body = bodyTxt;
  if (_wcBcAud === 'selected') payload.client_ids = [..._wcBcSel];
  if (sched) payload.scheduled_at = new Date(sched).toISOString();

  const btn = document.getElementById('wc-bc-send');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Queueing…'; }
  try {
    const { data, error } = await supabase.rpc('broadcast_message', { p_company_id: S.cid, p_data: payload });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    res.style.color = '#16a34a';
    res.textContent = `Queued ${data.queued} · skipped ${data.skipped} (opt-out) · matched ${data.matched}.`;
    toast(`Broadcast queued: ${data.queued}`, 'ok');
    _wcBcSel.clear();
  } catch(e) {
    res.style.color = 'var(--err)';
    res.textContent = e.message || 'Failed';
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Queue Broadcast'; }
  }
}

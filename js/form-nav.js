// ══ FORM NAVIGATION BAR — reusable component ════════════════════════════
//
// Mount with:
//   mountFormNav({
//     targetSel:  '#some-container-id',  // OR pass a DOM element directly
//     entity:     'unit'  | 'sale' | 'client' | 'payment' | ...,
//     dateField:  'created_at' | 'sale_date' | 'payment_date' | ...,
//     currentId:  <id of the entry currently displayed>,
//     loadList:   async (yearMonth) => [{id, <dateField>, ...}, ...],
//                   yearMonth = 'YYYY-MM'. Should return entries sorted asc
//                   by dateField. Caller is free to read from cache.
//     openEntry:  (id) => void,         // navigate to a specific entry
//     onEdit:     (id) => void,         // optional — defaults to openEntry+edit nav
//     onDelete:   (id) => Promise<void>,// optional — wired to delete handler
//     storageKey: 'rms.fnav.<entity>',  // localStorage key for last-picked month
//   })
//
// Calendar month is REMEMBERED per entity in localStorage so reopening a
// detail page keeps the same scope.
//
// "First" / "Last" / "Prev" / "Next" always navigate WITHIN the selected
// month (matches user mental model: "May select hai to May ki first").
// ─────────────────────────────────────────────────────────────────────────

(function (g) {

  // ── Lucide SVG icons (inline, no extra fetch) ──
  const ICO = {
    first:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>',
    prev:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    next:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    last:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>',
    edit:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    del:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    rows:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/></svg>',
    save:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    xmark:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function ymOf(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function ymLabel(ym) {
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return '';
    const [y, m] = ym.split('-');
    return MONTH_NAMES[parseInt(m, 10) - 1] + ' ' + y;
  }

  function currentYM() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // Build a list of YYYY-MM strings from the entries (so the picker only
  // shows months that actually contain data). Always include the current
  // month for the user to add new entries.
  function monthsFromEntries(entries, dateField) {
    const set = new Set();
    (entries || []).forEach(e => {
      const ym = ymOf(e[dateField] || e.created_at);
      if (ym) set.add(ym);
    });
    set.add(currentYM());
    return Array.from(set).sort().reverse();
  }

  async function mountFormNav(opts) {
    const {
      targetSel,
      entity      = 'entry',
      dateField   = 'created_at',
      currentId,
      loadList,
      openEntry,
      onEdit,
      onDelete,
      onSave,                // optional — form context
      onCancel,              // optional — form context
      saveLabel  = 'Save',
      cancelLabel = 'Cancel',
      storageKey
    } = opts || {};

    const host = typeof targetSel === 'string'
      ? (targetSel.startsWith('#') ? document.getElementById(targetSel.slice(1)) : document.querySelector(targetSel))
      : targetSel;
    if (!host) return;

    const lsKey = storageKey || ('rms.fnav.' + entity);

    // Pick initial month: stored value, else month of current entry, else current month.
    let selectedYM = '';
    try { selectedYM = localStorage.getItem(lsKey) || ''; } catch {}

    // First load — get an unscoped page-1 of entries so we know what months exist
    let allEntries = [];
    try { allEntries = (await loadList(null)) || []; } catch (e) {
      console.error('[form-nav] loadList(null) failed:', e);
    }

    if (!selectedYM && currentId) {
      const cur = allEntries.find(e => e.id === currentId);
      if (cur) selectedYM = ymOf(cur[dateField] || cur.created_at) || currentYM();
    }
    if (!selectedYM) selectedYM = currentYM();

    // Helper: get list scoped to a YM
    async function listForMonth(ym) {
      // Caller may honour the ym arg; otherwise we filter ourselves.
      let list = null;
      try { list = await loadList(ym); } catch (e) { console.error('[form-nav] loadList(ym) failed:', e); }
      if (!Array.isArray(list)) list = allEntries;
      // Defensive filter (caller may or may not have filtered)
      return list
        .filter(e => ymOf(e[dateField] || e.created_at) === ym)
        .sort((a, b) => String(a[dateField] || a.created_at || '').localeCompare(String(b[dateField] || b.created_at || '')));
    }

    // Pretty-print the entity name for the "Browse" label
    const entityLabel = String(entity || 'entries').replace(/(^|\s)\S/g, c => c.toUpperCase()) + 's';
    const hasSaveCancel = typeof onSave === 'function' || typeof onCancel === 'function';

    // Save / Cancel group — rendered only on form pages (when onSave/onCancel passed).
    // Sits on the RIGHT just before Edit/Delete so it's always thumb-distance from
    // the user's reading flow.
    const saveCancelHtml = hasSaveCancel ? `
        <div class="fnav-grp is-form">
          ${typeof onSave === 'function' ? `<button class="fnav-btn is-save" id="fnav-save" title="Save (Ctrl+S)">${ICO.save}<span>${esc(saveLabel)}</span></button>` : ''}
          ${typeof onCancel === 'function' ? `<button class="fnav-btn is-cancel" id="fnav-cancel" title="Cancel (Esc)">${ICO.xmark}<span>${esc(cancelLabel)}</span></button>` : ''}
        </div>` : '';

    // Render shell — visually distinct so the user can spot it on any page.
    // .is-form modifier on .fnav makes the bar accent stronger when in form mode.
    host.innerHTML = `
      <div class="fnav${hasSaveCancel ? ' is-form' : ''}" role="toolbar" aria-label="Entry navigation">
        <span class="fnav-tag" title="Browse saved ${esc(entity || 'entries')} records">
          ${ICO.rows}<span>Browse ${esc(entityLabel)}</span>
        </span>
        <div class="fnav-grp">
          <select class="fnav-month" id="fnav-month" title="Filter by month"></select>
        </div>
        <div class="fnav-grp">
          <button class="fnav-btn" id="fnav-first" title="First entry in month (Shift+Home)">${ICO.first}</button>
          <button class="fnav-btn" id="fnav-prev"  title="Previous entry (Alt+◀)">${ICO.prev}</button>
        </div>
        <div class="fnav-grp">
          <span class="fnav-count" id="fnav-count">—</span>
        </div>
        <div class="fnav-grp">
          <button class="fnav-btn" id="fnav-next" title="Next entry (Alt+▶)">${ICO.next}</button>
          <button class="fnav-btn" id="fnav-last" title="Last entry in month (Shift+End)">${ICO.last}</button>
        </div>
        ${saveCancelHtml}
        <div class="fnav-grp is-end">
          <button class="fnav-btn is-edit" id="fnav-edit" title="Edit (e)">${ICO.edit}<span>Edit</span></button>
          <button class="fnav-btn is-del"  id="fnav-del"  title="Delete (Del)">${ICO.del}<span>Delete</span></button>
        </div>
      </div>`;

    const monthSel  = host.querySelector('#fnav-month');
    const btnFirst  = host.querySelector('#fnav-first');
    const btnPrev   = host.querySelector('#fnav-prev');
    const btnNext   = host.querySelector('#fnav-next');
    const btnLast   = host.querySelector('#fnav-last');
    const btnEdit   = host.querySelector('#fnav-edit');
    const btnDel    = host.querySelector('#fnav-del');
    const cntLbl    = host.querySelector('#fnav-count');
    const btnSave   = host.querySelector('#fnav-save');
    const btnCancel = host.querySelector('#fnav-cancel');

    // Populate month picker
    function refreshMonths() {
      const months = monthsFromEntries(allEntries, dateField);
      monthSel.innerHTML = months.map(m =>
        `<option value="${m}"${m === selectedYM ? ' selected' : ''}>${ymLabel(m)}</option>`
      ).join('');
    }

    let monthList = [];

    async function refreshMonthList() {
      monthList = await listForMonth(selectedYM);
      const total = monthList.length;
      const idx = monthList.findIndex(e => e.id === currentId);
      cntLbl.innerHTML = total
        ? (idx >= 0
            ? `<strong>${idx + 1}</strong> of ${total}`
            : `${total} entries`)
        : `0 entries`;
      const atFirst = idx <= 0;
      const atLast  = idx < 0 || idx >= total - 1;
      btnFirst.disabled = total === 0 || atFirst;
      btnPrev.disabled  = total === 0 || atFirst;
      btnNext.disabled  = total === 0 || atLast;
      btnLast.disabled  = total === 0 || atLast;
      btnEdit.disabled  = !currentId;
      btnDel.disabled   = !currentId;
    }

    refreshMonths();
    await refreshMonthList();

    function persistMonth() {
      try { localStorage.setItem(lsKey, selectedYM); } catch {}
    }

    monthSel.addEventListener('change', async () => {
      selectedYM = monthSel.value;
      persistMonth();
      monthList = await listForMonth(selectedYM);
      if (monthList.length) {
        if (typeof openEntry === 'function') openEntry(monthList[0].id);
      } else {
        cntLbl.textContent = '0 entries';
        btnFirst.disabled = btnPrev.disabled = btnNext.disabled = btnLast.disabled = true;
      }
    });

    function navTo(targetIdx) {
      if (!monthList.length) return;
      const safe = Math.max(0, Math.min(monthList.length - 1, targetIdx));
      const target = monthList[safe];
      if (target && typeof openEntry === 'function') openEntry(target.id);
    }

    btnFirst.addEventListener('click', () => navTo(0));
    btnLast .addEventListener('click', () => navTo(monthList.length - 1));
    btnPrev .addEventListener('click', () => {
      const idx = monthList.findIndex(e => e.id === currentId);
      navTo(idx <= 0 ? 0 : idx - 1);
    });
    btnNext .addEventListener('click', () => {
      const idx = monthList.findIndex(e => e.id === currentId);
      if (idx < 0) navTo(0); else navTo(idx + 1);
    });

    btnEdit.addEventListener('click', () => {
      if (!currentId) return;
      if (typeof onEdit === 'function') onEdit(currentId);
    });

    btnDel.addEventListener('click', async () => {
      if (!currentId) return;
      if (typeof onDelete !== 'function') {
        if (typeof toast === 'function') toast('Delete not available for this entity yet.', 'warn');
        return;
      }
      const ok = window.confirm('Delete this ' + entity + '?\n\nThis action cannot be undone.');
      if (!ok) return;
      try { await onDelete(currentId); } catch (e) {
        if (typeof toast === 'function') toast('Could not delete: ' + (e?.message || e), 'err');
      }
    });

    // Form-mode Save / Cancel buttons
    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        try { await onSave(); } catch (e) {
          if (typeof toast === 'function') toast('Save failed: ' + (e?.message || e), 'err');
        }
      });
    }
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        try { onCancel(); } catch (e) { console.error('[form-nav] onCancel threw:', e); }
      });
    }

    // Keyboard shortcuts (scoped — only fire if the host is in the DOM)
    function kbHandler(e) {
      if (!document.body.contains(host)) {
        document.removeEventListener('keydown', kbHandler);
        return;
      }
      // Ctrl/Cmd+S → Save (works even when focus is inside a form input)
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        if (btnSave && !btnSave.disabled) { e.preventDefault(); btnSave.click(); }
        return;
      }
      const tag = (e.target?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey) return;
      if (e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); btnPrev.click(); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); btnNext.click(); }
      if (e.shiftKey && e.key === 'Home') { e.preventDefault(); btnFirst.click(); }
      if (e.shiftKey && e.key === 'End')  { e.preventDefault(); btnLast.click(); }
    }
    document.addEventListener('keydown', kbHandler);
  }

  g.mountFormNav = mountFormNav;

})(window);

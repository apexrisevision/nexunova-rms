// ════════════════════════════════════════════════════════════
//  Nexunova RMS — Enhancements v1.0
//  Searchable unit pickers for all relevant flows
//  ────────────────────────────────────────────────────────────
//  - Sell a Unit (sidebar button) → picker of AVAILABLE units
//  - Add Payment → picker of SOLD units (already searchable, enhanced)
//  - Log a Call → picker of SOLD units (already searchable, enhanced)
//  - Better search: matches unit no, customer, phone, booking, floor, type
//  - Empty state, keyboard navigation, escape to close
// ════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Wait for DOM ───────────────────────────────────────────
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // ────────────────────────────────────────────────────────────
  // 1. UNIT PICKER MODAL — reusable searchable list
  //    Call: pickUnit({ filter, title, onPick })
  //    filter: 'available' | 'sold' | 'all'
  //    onPick: function(unitId)
  // ────────────────────────────────────────────────────────────

  function pickUnit(opts) {
    if (typeof gunits !== 'function') {
      if (typeof toast === 'function') toast('Please log in first', 'err');
      return;
    }

    const filter  = opts.filter  || 'all';
    const title   = opts.title   || 'Select a Unit';
    const subtitle= opts.subtitle|| 'Type to search';
    const onPick  = opts.onPick  || function () {};

    let allUnits = gunits();

    if (filter === 'available') {
      allUnits = allUnits.filter(u => u.status === 'Available');
    } else if (filter === 'sold') {
      allUnits = allUnits.filter(u => u.status !== 'Available' && u.status !== 'Dead');
    }

    // Build modal once
    let modal = document.getElementById('m-unit-picker');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'm-unit-picker';
      modal.className = 'mov';
      modal.innerHTML = `
        <div class="md" style="max-width:560px;width:92vw">
          <div class="mh">
            <div>
              <h3 id="up-title">Select a Unit</h3>
              <p id="up-subtitle">Type to search</p>
            </div>
            <button class="mx" onclick="window.closeUnitPicker()">✕</button>
          </div>
          <div class="mb" style="padding:0">
            <div style="padding:14px 18px;border-bottom:1px solid var(--x-border)">
              <input id="up-search" type="text"
                placeholder="Search by unit no, customer, phone, booking..."
                autocomplete="off"
                style="width:100%;padding:11px 14px;font-size:14px;
                  background:var(--x-input-bg);color:var(--x-text);
                  border:1px solid var(--x-border-2);border-radius:8px;
                  outline:none;font-family:inherit"/>
              <div id="up-count" style="margin-top:8px;font-size:11px;color:var(--x-text-3);font-weight:500"></div>
            </div>
            <div id="up-list" style="max-height:50vh;overflow-y:auto;padding:6px 0"></div>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }

    // Populate
    const searchInp = document.getElementById('up-search');
    const list      = document.getElementById('up-list');
    const countEl   = document.getElementById('up-count');
    document.getElementById('up-title').textContent    = title;
    document.getElementById('up-subtitle').textContent = subtitle;

    let activeIndex = -1;
    let filteredUnits = [];

    function renderList(query) {
      const q = (query || '').trim().toLowerCase();
      filteredUnits = allUnits.filter(function (u) {
        if (!q) return true;
        const hay = [
          u.unitNo, u.customerName, u.phone, u.bookingNo,
          u.floorLabel, u.floor, u.type, u.soldBy
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });

      countEl.textContent =
        filteredUnits.length + ' of ' + allUnits.length + ' units' +
        (q ? ' matching "' + query + '"' : '');

      if (!filteredUnits.length) {
        list.innerHTML =
          '<div style="padding:40px 20px;text-align:center;color:var(--x-text-3)">' +
            '<div style="font-size:28px;margin-bottom:8px;opacity:0.5">🔍</div>' +
            '<div style="font-size:13px;font-weight:500">' +
              (allUnits.length === 0
                ? (filter === 'available' ? 'No available units to sell.'
                  : filter === 'sold' ? 'No sold units yet.'
                  : 'No units yet.')
                : 'No matches for "' + esc(query) + '"') +
            '</div>' +
          '</div>';
        return;
      }

      activeIndex = -1;
      list.innerHTML = filteredUnits.map(function (u, i) {
        const status = u.status || 'Available';
        const isAvail = status === 'Available';
        const pending = (typeof actualPending === 'function') ? actualPending(u) : 0;
        const paid    = (typeof actualPaid    === 'function') ? actualPaid(u)    : 0;

        const statusColor =
          status === 'Available'   ? 'var(--x-brand)'   :
          status === 'Dead'        ? 'var(--x-text-4)'  :
          pending > 0              ? 'var(--x-warning)' :
                                     'var(--x-success)';

        const customer = u.customerName ? esc(u.customerName) : '';
        const subline  = (u.floorLabel || u.floor || '') +
                        (u.type ? ' · ' + esc(u.type) : '') +
                        (u.area ? ' · ' + u.area + ' sqft' : '') +
                        (u.phone ? ' · ' + esc(u.phone) : '');

        const amountSide = !isAvail && u.totalPrice > 0
          ? '<div style="text-align:right;flex-shrink:0;margin-left:auto">' +
              '<div style="font-size:13px;font-weight:700;font-family:\'Plus Jakarta Sans\',sans-serif;' +
                'color:' + (pending > 0 ? 'var(--x-warning)' : 'var(--x-success)') + ';' +
                'font-feature-settings:\'tnum\' 1">' +
                (pending > 0 ? fM(pending) : fM(paid)) +
              '</div>' +
              '<div style="font-size:10px;color:var(--x-text-4);font-weight:500;text-transform:uppercase;letter-spacing:0.05em">' +
                (pending > 0 ? 'Pending' : 'Paid') +
              '</div>' +
            '</div>'
          : '<div style="margin-left:auto"></div>';

        return (
          '<div class="up-item" data-uid="' + esc(u.id) + '" data-i="' + i + '" ' +
            'style="display:flex;align-items:center;gap:12px;padding:11px 18px;' +
            'cursor:pointer;border-bottom:1px solid var(--x-border);transition:background 120ms ease">' +
            '<div style="width:6px;height:34px;background:' + statusColor + ';border-radius:3px;flex-shrink:0"></div>' +
            '<div style="min-width:0;flex:1">' +
              '<div style="font-size:13.5px;font-weight:600;color:var(--x-text);' +
                'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
                esc(u.unitNo) +
                (customer ? ' <span style="color:var(--x-text-3);font-weight:500"> · ' + customer + '</span>' : '') +
              '</div>' +
              '<div style="font-size:11px;color:var(--x-text-3);margin-top:2px;font-weight:500;' +
                'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
                esc(subline) +
              '</div>' +
            '</div>' +
            amountSide +
          '</div>'
        );
      }).join('');

      // Wire clicks
      list.querySelectorAll('.up-item').forEach(function (el) {
        el.addEventListener('click', function () {
          const uid = el.getAttribute('data-uid');
          closeUnitPicker();
          if (typeof onPick === 'function') onPick(uid);
        });
        el.addEventListener('mouseenter', function () {
          el.style.background = 'var(--x-surface-2)';
        });
        el.addEventListener('mouseleave', function () {
          if (parseInt(el.getAttribute('data-i'), 10) !== activeIndex)
            el.style.background = '';
        });
      });
    }

    // Keyboard navigation
    function highlight(i) {
      const items = list.querySelectorAll('.up-item');
      items.forEach(function (el) { el.style.background = ''; });
      if (i < 0 || i >= items.length) return;
      activeIndex = i;
      items[i].style.background = 'var(--x-brand-soft)';
      items[i].scrollIntoView({ block: 'nearest' });
    }

    searchInp.oninput = function () { renderList(this.value); };

    searchInp.onkeydown = function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeUnitPicker();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlight(Math.min(activeIndex + 1, filteredUnits.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlight(Math.max(activeIndex - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const items = list.querySelectorAll('.up-item');
        const idx   = activeIndex >= 0 ? activeIndex : 0;
        if (items[idx]) items[idx].click();
      }
    };

    searchInp.value = '';
    renderList('');
    modal.classList.add('open');
    setTimeout(function () { searchInp.focus(); }, 80);
  }

  function closeUnitPicker() {
    const m = document.getElementById('m-unit-picker');
    if (m) m.classList.remove('open');
  }

  window.pickUnit         = pickUnit;
  window.closeUnitPicker  = closeUnitPicker;

  // ────────────────────────────────────────────────────────────
  // 2. WRAP existing flows so they use the picker
  // ────────────────────────────────────────────────────────────

  ready(function () {
    // ── A. SIDEBAR "Sell a Unit" — direct picker ──
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.sb-act-sell');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (typeof S === 'undefined' || !S || (S.role !== 'admin' && S.role !== 'owner')) {
        if (typeof toast === 'function') toast('Admin only', 'warn');
        return;
      }
      pickUnit({
        filter   : 'available',
        title    : 'Sell a Unit',
        subtitle : 'Pick an available unit to sell',
        onPick   : function (uid) {
          if (typeof openSellModal === 'function') openSellModal(uid);
        }
      });
    }, true);

    // ── B. Dashboard "Add Payment" / "Log a Call" — already use openRecModal/openConModal
    //    Those now have built-in dropdowns AND auto-call enhanceModalSelects via om()
    //    So they get searchable enhancement automatically.

    // ── C. Replace the basic <select> in m-rec and m-con with rich picker
    //    when user clicks the SELECT — we open the picker instead.
    function attachPickerToSelect(selectId, filter, title) {
      document.addEventListener('mousedown', function (e) {
        const sel = document.getElementById(selectId);
        if (!sel || sel.dataset.pickerHooked === '1') {
          if (e.target !== sel) return;
        }
        if (e.target.id !== selectId) return;
        // If hidden by makeSearchable, the .ss-inp is what user clicks.
        e.preventDefault();
        sel.dataset.pickerHooked = '1';
        pickUnit({
          filter   : filter,
          title    : title,
          subtitle : 'Type to find quickly',
          onPick   : function (uid) {
            sel.value = uid;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      });
    }

    // Better: intercept the searchable wrapper input click for these dropdowns
    document.addEventListener('focus', function (e) {
      const inp = e.target;
      if (!inp || !inp.classList || !inp.classList.contains('ss-inp')) return;
      const wrap = inp.closest('.ss-wrap');
      if (!wrap) return;
      const realSelect = wrap.querySelector('select');
      if (!realSelect) return;
      // Determine which flow this is
      let cfg = null;
      if (realSelect.id === 'rc-u') {
        cfg = { filter: 'sold',      title: 'Add Payment',  subtitle: 'Pick a sold unit' };
      } else if (realSelect.id === 'cn-u') {
        cfg = { filter: 'sold',      title: 'Log a Call',   subtitle: 'Pick a unit to log activity for' };
      }
      if (!cfg) return;
      // Avoid loop: only intercept once per focus
      if (wrap.dataset.pickerActive === '1') return;
      wrap.dataset.pickerActive = '1';
      inp.blur();

      pickUnit({
        filter   : cfg.filter,
        title    : cfg.title,
        subtitle : cfg.subtitle,
        onPick   : function (uid) {
          realSelect.value = uid;
          // sync the visible input text
          const opt = Array.from(realSelect.options).find(function (o) { return o.value === uid; });
          if (opt) inp.value = opt.text;
          inp.setAttribute('data-val', uid);
          realSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      setTimeout(function () { wrap.dataset.pickerActive = ''; }, 300);
    }, true);
  });

  // ────────────────────────────────────────────────────────────
  // 3. Click outside picker = close (enable backdrop close)
  // ────────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'm-unit-picker') {
      closeUnitPicker();
    }
  });
})();

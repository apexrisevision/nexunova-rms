// ══════════════════════════════════════════════════════════════════
//  Nexunova RMS — Sale entry shim
//  (was: Sale Modal v2.0 — a 2nd, modal-based sale form)
//
//  2026-05-26: The modal-based sale form was a DUPLICATE of the canonical
//  full-page New Sale flow (js/pages/sales.js → rNewSale / nav('newsale')).
//  It only ever rendered for legacy localStorage units, which no longer
//  exist in the multi-tenant Supabase app. Reduced to a thin shim so the
//  "Sell a Unit" entry point (enhancements.js) routes to the single
//  canonical form, with the chosen unit pre-selected.
//
//  NOTE: login.html loads modals.js AFTER this file, and modals.js also
//  defines openSellModal — so the modals.js copy is the one that actually
//  wins at runtime. Both are kept IDENTICAL (this redirect shim) so behaviour
//  is the same regardless of load order. If you change one, change both.
// ══════════════════════════════════════════════════════════════════

function openSellModal(unitId) {
  if (S?.role !== 'admin' && S?.role !== 'owner') {
    if (typeof toast === 'function') toast('Admin only', 'warn');
    return;
  }
  // Hand the unit to the full-page New Sale form: rNewSale() restores
  // window._salFormState on mount and pre-selects sf-unit (+ fires
  // _salOnUnitChange to pull the unit's area).
  if (unitId) window._salFormState = { unitId };
  if (typeof nav === 'function') nav('newsale');
}

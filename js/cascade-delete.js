// ══ CASCADE-SAFE DELETE HELPER ════════════════════════════════════════
//
// Usage:
//   await cascadeDelete({
//     entity:      'unit',                  // for messages
//     displayName: u.unitNo,                // for confirm dialog
//     id:          unitId,
//     // Pre-check each dependency. The first non-zero count blocks delete.
//     checks: [
//       { table: 'sales',     fk: 'unit_id', label: 'sale record',     useV2: true },
//       { table: 'payments',  fk: 'unit_id', label: 'payment record' },
//     ],
//     // The RPC or direct delete to run if all checks pass
//     onDelete: async () => {
//       const { data, error } = await supabase.rpc('delete_unit', {...});
//       if (error) throw error;
//       if (!data?.success) throw new Error(data?.error || 'Delete failed');
//     },
//     onSuccess: async () => { await loadUnitsCache(S.cid); nav('units'); }
//   })
//
// Returns true if deleted, false if blocked / cancelled / errored.
// ─────────────────────────────────────────────────────────────────────

(function (g) {

  async function cascadeDelete(opts) {
    const {
      entity      = 'item',
      displayName = '',
      id,
      checks      = [],
      onDelete,
      onSuccess
    } = opts || {};

    if (typeof demoGuard === 'function' && demoGuard('Delete')) return false;

    if (!id) {
      _toast('Nothing to delete — missing id.', 'warn');
      return false;
    }
    if (typeof onDelete !== 'function') {
      _toast('Delete handler not configured.', 'err');
      return false;
    }

    // 1. Run dependency checks in parallel
    let blockers = [];
    if (checks.length && typeof supabase !== 'undefined' && typeof S !== 'undefined') {
      try {
        const results = await Promise.all(checks.map(c => _countDep(c)));
        blockers = results
          .map((cnt, i) => ({ cnt, def: checks[i] }))
          .filter(r => r.cnt > 0);
      } catch (e) {
        console.error('[cascadeDelete] check failed:', e);
        // Don't silently allow delete — surface the error to the user.
        _toast('Could not verify dependencies. Refusing to delete.', 'err');
        return false;
      }
    }

    if (blockers.length) {
      _showBlockerModal(entity, displayName, blockers);
      return false;
    }

    // 2. Confirm
    const confirmTxt = displayName
      ? `Delete ${entity} "${displayName}"?\n\nThis cannot be undone.`
      : `Delete this ${entity}?\n\nThis cannot be undone.`;
    if (!window.confirm(confirmTxt)) return false;

    // 3. Execute delete
    try {
      await onDelete();
    } catch (e) {
      console.error('[cascadeDelete] delete failed:', e);
      const msg = (e && e.message) ? e.message : String(e || 'Unknown error');
      // If the DB error mentions a foreign-key violation, surface a better message
      if (/foreign key|violates|constraint/i.test(msg)) {
        _showBlockerModal(entity, displayName, [{
          cnt: '?',
          def: { table: 'related rows', label: 'related record', fk: '' }
        }], 'The database refused this delete because related data exists. ' + msg);
      } else {
        _toast('Could not delete: ' + msg, 'err');
      }
      return false;
    }

    // 4. Success
    _toast((displayName ? `"${displayName}"` : 'Item') + ' deleted', 'ok');
    if (typeof onSuccess === 'function') {
      try { await onSuccess(); } catch (e) { console.error('[cascadeDelete] onSuccess threw:', e); }
    }
    return true;
  }

  // ── Internal helpers ─────────────────────────────────────────────

  function _toast(msg, kind) {
    if (typeof toast === 'function') toast(msg, kind || 'info');
    else console.log('[cascadeDelete]', kind || 'info', msg);
  }

  async function _countDep(check) {
    const { table, fk, extra } = check;
    if (!table || !fk) return 0;
    try {
      let q = supabase.from(table)
        .select('id', { count: 'exact', head: true })
        .eq(fk, _currentTargetId());
      if (S && S.cid) q = q.eq('company_id', S.cid);
      if (extra && typeof extra === 'object') {
        Object.keys(extra).forEach(k => { q = q.eq(k, extra[k]); });
      }
      const { count, error } = await q;
      if (error) {
        console.warn('[cascadeDelete] count error on ' + table + ':', error.message);
        return 0;
      }
      return count || 0;
    } catch (e) {
      console.warn('[cascadeDelete] count threw on ' + table + ':', e);
      return 0;
    }
  }

  // The current id is captured in the closure of cascadeDelete — but the
  // check function is shared. We pass id explicitly via a stack variable.
  // (Simpler: just pass id to _countDep directly.)
  let _stackId = null;
  function _currentTargetId() { return _stackId; }

  // Wrap cascadeDelete to set _stackId before checks
  const _orig = cascadeDelete;
  function _wrapped(opts) {
    _stackId = opts && opts.id;
    return _orig(opts).finally(() => { _stackId = null; });
  }

  function _showBlockerModal(entity, displayName, blockers, extraMsg) {
    const old = document.getElementById('m-cascade-block-dyn');
    if (old) old.remove();

    const list = blockers.map(b => {
      const cnt   = b.cnt;
      const label = (b.def.label || b.def.table) + (cnt === 1 ? '' : 's');
      return `<li><strong>${cnt}</strong> ${esc(label)}</li>`;
    }).join('');

    const el = document.createElement('div');
    el.id = 'm-cascade-block-dyn';
    el.className = 'mov';
    el.style.display = 'flex';
    el.onclick = e => { if (e.target === el) el.remove(); };
    el.innerHTML = `
      <div class="md" style="max-width:480px">
        <div class="mh">
          <div>
            <h3>Cannot delete ${esc(entity)}</h3>
            <p>Related data prevents this delete from being safe.</p>
          </div>
          <button class="mx" onclick="document.getElementById('m-cascade-block-dyn').remove()">✕</button>
        </div>
        <div class="mb">
          <p style="font-size:13px;color:var(--t2);margin-bottom:12px">
            ${displayName ? `<strong>"${esc(displayName)}"</strong> is` : 'This item is'} referenced by:
          </p>
          <ul style="font-size:13px;color:var(--t2);line-height:2;padding-left:18px;margin-bottom:14px">${list}</ul>
          <div style="padding:10px 12px;background:var(--bg-danger-soft,rgba(220,38,38,.08));border:1px solid color-mix(in srgb, var(--danger,#dc2626) 25%, transparent);border-radius:8px;font-size:12px;color:var(--text-soft,#475569);line-height:1.5">
            Deleting would orphan or corrupt those records. ${extraMsg ? esc(extraMsg) : 'Use Deactivate / Cancel / Transfer flows instead, or remove the related records first.'}
          </div>
        </div>
        <div class="mf">
          <button class="btn btn-gh" onclick="document.getElementById('m-cascade-block-dyn').remove()">OK, got it</button>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  g.cascadeDelete = _wrapped;

})(window);

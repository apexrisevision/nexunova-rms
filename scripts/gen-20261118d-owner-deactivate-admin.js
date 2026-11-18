#!/usr/bin/env node
/* Writes supabase/migrations/20261118d_owner_can_deactivate_admin.sql from the LIVE
   definitions of both update_app_user overloads, with one exact patch each (asserted). */
const fs = require('fs'), path = require('path');
const { q } = require('./_sbq');
(async () => {
  const sigs = ['public.update_app_user(uuid,uuid,text,text,text,text,text,text,jsonb)',
                'public.update_app_user(uuid,uuid,text,text,text,text,text,text,jsonb,uuid[])'];
  const OLD = `    IF v_target.role IN ('owner','admin') THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden_target',
        'message', 'You cannot modify an owner or admin user.');
    END IF;`;
  let out = `-- ══ RMS Users: the OWNER may deactivate / reactivate an ADMIN (20261118d) ══
-- NOT APPLIED until the owner says yes.
--
-- The bug: the Users screen shows "Deactivate" on an admin's row, but update_app_user refused
-- every change to an owner or admin unless the caller is a platform super admin — so even the
-- company OWNER got "You cannot modify an owner or admin user." (Awami, 18-Nov: freeing a plan
-- slot by deactivating amar@awami.)
--
-- The change, in both overloads: the owner may change ONLY the status of an admin (not
-- themself). Everything else stays refused exactly as before — an admin touching another admin,
-- anyone touching an owner, and any change to an admin's role, password, name, email, phone,
-- module access or projects.
`;
  for (const sig of sigs) {
    const def = (await q(`select pg_get_functiondef('${sig}'::regprocedure) d`))[0].d;
    if (def.split(OLD).length !== 2) throw new Error('patch point not found once in ' + sig);
    const hasProj = /p_project_ids/.test(def);
    const NEW = `    -- the owner may switch an admin on or off — the status and nothing else (20261118d)
    IF v_target.role IN ('owner','admin')
       AND NOT (v_me.role = 'owner' AND v_target.role = 'admin' AND v_target.id <> v_me.id
                AND p_status IN ('active','inactive')
                AND p_role IS NULL AND p_password IS NULL AND p_full_name IS NULL AND p_email IS NULL
                AND p_phone IS NULL AND p_module_permissions IS NULL${hasProj ? ' AND p_project_ids IS NULL' : ''}) THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden_target',
        'message', 'You cannot modify an owner or admin user.');
    END IF;`;
    out += '\n' + def.split(OLD).join(NEW).trim() + ';\n';
  }
  const f = path.join(__dirname, '..', 'supabase', 'migrations', '20261118d_owner_can_deactivate_admin.sql');
  fs.writeFileSync(f, out);
  console.log('written', f);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

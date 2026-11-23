#!/usr/bin/env node
/* Builds supabase/migrations/20261123a_nf_retire_site_box.sql and its _rollback.sql from the LIVE database:
   the rollback carries the live text and grants of every function the migration drops, so it puts back
   exactly what is there today. Read-only against the database. */
const fs = require('fs'), path = require('path');
const { q } = require('../_sbq');
const MIG = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const RASHID = '315f2852-852f-4653-9253-a5a27a7828c8', SHAROSE = '671bc3d9-f794-4e75-ab18-8fab2feb1466';

(async () => {
  /* every site-closing function, except _nf_site_view_day (nf_day_json still calls it; it does nothing
     once no member has a site box) */
  const fns = await q(`
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_functiondef(p.oid) def,
           COALESCE((SELECT json_agg(json_build_object('g', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END))
                       FROM aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
                      WHERE a.privilege_type = 'EXECUTE'), '[]') grantees
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND (p.proname LIKE 'nf\\_site%' OR p.proname LIKE '\\_nf\\_site%'
            OR p.proname IN ('_nf_ho_open_day', '_nf_ho_voucher_edit', 'nf_vouchers_site_match_guard'))
       AND p.proname <> '_nf_site_view_day'
     ORDER BY p.proname`);
  const sig = f => `public.${f.proname}(${f.args})`;
  /* functions go before the tables: _nf_site_accept_one takes an nf_site_lines row */
  const drops = fns.map(f => `DROP FUNCTION IF EXISTS ${sig(f)};`).join('\n');

  const mig = `-- ══ NexuFinance: retire the site cash box — back to one Daily Closing, one login (20261123a) ══
-- NOT APPLIED. Owner, 23-Nov-2026: "sharose banaye ga excel mai hee closing aur ham phir khud osay nexufinance pe
-- update karaingay, is liye ham ne jo 2 closing concept banaya hai remove it … pehle jaisay kar do".
-- Owner's terms (23-Nov):
--   * Sharose's 75 vouchers (05-20 Nov) STAY, with their created_by and audit as they are.
--   * Head Office Cash <-> Petty Cash transfer stays; nf_save_withdrawal (bank -> petty) and the petty -> bank
--     deposit stay.
--   * DC-011 (20-Nov, OPEN) was started by Sharose: it is put in Head Office's name so the owner can close it.
--   * Sharose's NexuFinance access ends (nf_members.active = false). His auth user and RMS login are not touched.
--   * the Site Closing module's tables go only if they hold 0 rows (checked here; the migration stops if not).
-- What goes: nf_site_days, nf_site_lines, nf_combined_closings, the ${fns.length} site functions, the site-match trigger on
-- nf_vouchers, the bill-photo bucket's policies (and the bucket when it is empty and storage allows), and the 'site'
-- role. What stays: Petty Cash (10200) and its balance, every voucher, the token sync, the duplicate guard, the
-- day's Excel, the WhatsApp brief, the bank deposit, real dates. With only the director left as a member the
-- two-login rules (own cash box, own-entry edits, head-office-only day actions) never limit anyone.
-- Rollback: 20261123a_nf_retire_site_box_rollback.sql (generated from the live definitions on 23-Nov).

DO $chk$
DECLARE n bigint;
BEGIN
  SELECT (SELECT count(*) FROM public.nf_site_days) + (SELECT count(*) FROM public.nf_site_lines)
       + (SELECT count(*) FROM public.nf_combined_closings) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'site tables are not empty (% rows) — nothing dropped', n; END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'nf-site-bills') THEN
    RAISE EXCEPTION 'the nf-site-bills bucket holds files — nothing dropped';
  END IF;
  IF EXISTS (SELECT 1 FROM public.nf_members WHERE role = 'site') THEN
    RAISE EXCEPTION 'a member still has the site role — nothing dropped';
  END IF;
END $chk$;

-- ── 1. DC-011 into Head Office's name ───────────────────────────────────────
-- created_by is immutable through nf_days_guard; it is lifted for this one row and put straight back.
-- The audit trigger stays on and records the change.
ALTER TABLE public.nf_days DISABLE TRIGGER nf_days_guard;
UPDATE public.nf_days
   SET created_by = '${RASHID}', updated_by = '${RASHID}', updated_at = now(), version = version + 1
 WHERE company_id = '${CO}' AND closing_no = 'DC-011' AND status = 'OPEN' AND created_by = '${SHAROSE}';
ALTER TABLE public.nf_days ENABLE TRIGGER nf_days_guard;

-- ── 2. Sharose's NexuFinance access ends ────────────────────────────────────
UPDATE public.nf_members
   SET active = false, cash_via = 'Cash', updated_at = now(), updated_by = '${RASHID}'
 WHERE company_id = '${CO}' AND user_id = '${SHAROSE}';

-- ── 2b. the cash boxes take back their own names (set to Head Office Cash / Site Cash on 18-Nov) ──
UPDATE public.nf_accounts SET via_label = CASE via WHEN 'Cash' THEN 'Cash in hand' ELSE 'Petty cash' END
 WHERE company_id = '${CO}' AND via IN ('Cash', 'Petty');

-- ── 3. the Site Closing module ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS nf_vouchers_site_match_guard ON public.nf_vouchers;
DROP POLICY IF EXISTS nf_site_bills_insert ON storage.objects;
DROP POLICY IF EXISTS nf_site_bills_read ON storage.objects;
DO $b$ BEGIN
  DELETE FROM storage.buckets WHERE id = 'nf-site-bills';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'nf-site-bills bucket kept (empty, private): %', SQLERRM;
END $b$;
DROP POLICY IF EXISTS nf_site_days_read ON public.nf_site_days;
DROP POLICY IF EXISTS nf_site_lines_read ON public.nf_site_lines;
DROP POLICY IF EXISTS nf_combined_closings_read ON public.nf_combined_closings;
${drops}
DROP TABLE public.nf_site_lines;
DROP TABLE public.nf_site_days;
DROP TABLE public.nf_combined_closings;

-- ── 4. no 'site' role any more ──────────────────────────────────────────────
ALTER TABLE public.nf_members DROP CONSTRAINT nf_members_role_check;
ALTER TABLE public.nf_members ADD CONSTRAINT nf_members_role_check CHECK (role IN ('accountant', 'director', 'viewer'));
`;

  const grants = fns.map(f => {
    const g = JSON.parse(typeof f.grantees === 'string' ? f.grantees : JSON.stringify(f.grantees)).map(x => x.g);
    return `REVOKE ALL ON FUNCTION ${sig(f)} FROM PUBLIC, anon, authenticated;` +
      (g.filter(x => ['anon', 'authenticated', 'PUBLIC', 'service_role'].includes(x)).map(x => `\nGRANT EXECUTE ON FUNCTION ${sig(f)} TO ${x};`).join(''));
  }).join('\n');
  /* create order: helpers that others call first is not needed in plpgsql/sql bodies except SQL functions that
     reference tables — tables come first, then all functions */
  const tableDDL = fs.readFileSync(path.join(MIG, '20261117b_nf_site_closing_stage1.sql'), 'utf8');
  const t0 = tableDDL.indexOf('CREATE TABLE public.nf_combined_closings'), t1 = tableDDL.indexOf('-- the policy helper');
  const pol0 = tableDDL.indexOf('CREATE POLICY nf_site_days_read'), pol1 = tableDDL.indexOf('-- ── 3. the site cash book');
  const a = fs.readFileSync(path.join(MIG, '20261118a_nf_site_matching.sql'), 'utf8');
  const a0 = a.indexOf('ALTER TABLE public.nf_site_lines'), a1 = a.indexOf('-- An HO voucher a site line');
  const defs = fns.map(f => f.def.trim().replace(/\s*$/, '') + ';').join('\n\n');

  const rb = `-- ══ ROLLBACK of 20261123a_nf_retire_site_box — puts the site cash box back as it was on 23-Nov-2026 ══
-- Generated from the live definitions (scripts/nf/gen-20261123a-retire-site-box.js). Run only on the owner's word.

ALTER TABLE public.nf_members DROP CONSTRAINT nf_members_role_check;
ALTER TABLE public.nf_members ADD CONSTRAINT nf_members_role_check CHECK (role IN ('accountant', 'director', 'viewer', 'site'));

${tableDDL.slice(t0, t1).trim()}

${a.slice(a0, a1).trim()}

-- functions, exactly as they were live
${defs}

${grants}

${tableDDL.slice(pol0, pol1).trim()}

CREATE TRIGGER nf_vouchers_site_match_guard BEFORE DELETE ON public.nf_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.nf_vouchers_site_match_guard();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('nf-site-bills', 'nf-site-bills', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS nf_site_bills_insert ON storage.objects;
CREATE POLICY nf_site_bills_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nf-site-bills' AND public.nf_site_bill_writer(public.nf_site_bill_company(name)));
DROP POLICY IF EXISTS nf_site_bills_read ON storage.objects;
CREATE POLICY nf_site_bills_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'nf-site-bills' AND public.nf_site_reader(public.nf_site_bill_company(name), true));

UPDATE public.nf_accounts SET via_label = CASE via WHEN 'Cash' THEN 'Head Office Cash' ELSE 'Site Cash' END
 WHERE company_id = '${CO}' AND via IN ('Cash', 'Petty');

UPDATE public.nf_members SET active = true, cash_via = 'Petty', updated_at = now(), updated_by = '${RASHID}'
 WHERE company_id = '${CO}' AND user_id = '${SHAROSE}';

ALTER TABLE public.nf_days DISABLE TRIGGER nf_days_guard;
UPDATE public.nf_days SET created_by = '${SHAROSE}', updated_at = now(), version = version + 1
 WHERE company_id = '${CO}' AND closing_no = 'DC-011' AND created_by = '${RASHID}' AND status = 'OPEN';
ALTER TABLE public.nf_days ENABLE TRIGGER nf_days_guard;
`;
  fs.writeFileSync(path.join(MIG, '20261123a_nf_retire_site_box.sql'), mig);
  fs.writeFileSync(path.join(MIG, '20261123a_nf_retire_site_box_rollback.sql'), rb);
  console.log('functions dropped:', fns.length, fns.map(f => f.proname).join(', '));
})();

-- ═══════════════════════════════════════════════════════════════════════════
-- The chart, and the people who get paid
-- ───────────────────────────────────────────────────────────────────────────
-- P2, first half: the reference data the cash book selects from, and the fix
-- to how a payee's name is compared.
--
-- Everything here is IDEMPOTENT. seed_daily_closing_chart() may be run any
-- number of times: it inserts what is missing, corrects what has drifted, and
-- reactivates what was switched off. It never deletes, because an account or a
-- drawer that has been used by an entry is referenced by that entry forever.
--
-- ⚠️ THE NAMES ARE THE CONTRACT. Every qb_accounts.name below must match the
-- Awami QuickBooks company file character for character — the IIF export in
-- Phase 3 matches on NAME, not on number, and QuickBooks silently creates a new
-- account when a name does not resolve. They are transcribed from BLUEPRINT.md
-- §A14 and capped at 31 characters, which is QuickBooks' own limit. The longest
-- here is 'Construction - Development Cost' at exactly 31.
--
-- Spec: BLUEPRINT §A14 · RULES invariants 5, 6, 7 · SCHEMA.md.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── payees.normalized_name gains punctuation stripping ─────────────────────
-- P1 shipped this as lower + trim + collapse-whitespace. P2's brief requires
-- punctuation removed as well, so "M/s Ahmed Traders" and "Ms Ahmed Traders"
-- are one payee rather than two.
--
-- Postgres cannot alter a generation expression in place, so the column is
-- dropped and re-added. That is only safe because payees is empty; it is not a
-- pattern to repeat once the table carries rows.
--
-- [[:punct:]] rather than [^a-z0-9 ] on purpose: the second would erase an Urdu
-- or accented name down to the empty string, and a payee master for a Peshawar
-- site cannot assume ASCII. Collapse runs AFTER the strip, so "Ahmed & Sons"
-- normalises to "ahmed sons" and not "ahmed  sons".
DROP INDEX IF EXISTS public.payees_name_unique;
ALTER TABLE public.payees DROP COLUMN IF EXISTS normalized_name;
ALTER TABLE public.payees ADD COLUMN normalized_name text
  GENERATED ALWAYS AS (
    btrim(regexp_replace(regexp_replace(lower(btrim(name)), '[[:punct:]]', '', 'g'),
                         '\s+', ' ', 'g'))
  ) STORED;

CREATE UNIQUE INDEX payees_name_unique
  ON public.payees (company_id,
                    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    normalized_name);

COMMENT ON COLUMN public.payees.normalized_name IS
  'Generated: lowercased, trimmed, punctuation stripped, internal whitespace collapsed. The uniqueness key — "Zubair", " zubair " and "ZUBAIR" are one payee. Generated columns are excluded from backup INSERTs by scripts/backup-full.js:252.';

-- ── The seeder ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_daily_closing_chart(
  p_company_id uuid, p_project_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_accounts int; v_defaults int; v_cash int; v_bank_ref uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_not_found');
  END IF;
  IF p_project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects
                      WHERE id = p_project_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_not_in_company');
  END IF;

  -- ── 1 · the chart (53 accounts, BLUEPRINT §A14) ──────────────────────────
  INSERT INTO public.qb_accounts (company_id, number, name, qb_type)
  SELECT p_company_id, v.number, v.name, v.qb_type
  FROM (VALUES
    ('1010', 'Cash in Hand',                    'BANK'),
    ('1020', 'Petty Cash',                      'BANK'),
    ('1030', 'Bank Al-Habib - Awami',           'BANK'),
    ('1100', 'Accounts Receivable',             'AR'),
    ('1120', 'PDC Receivable',                  'OCASSET'),
    ('1130', 'Staff Advances',                  'OCASSET'),
    ('1140', 'Advances to Suppliers',           'OCASSET'),
    ('1150', 'Prepaid Expenses',                'OCASSET'),
    ('1200', 'Units - Shops Inventory',         'OCASSET'),
    ('1210', 'Development Work in Progress',    'OCASSET'),
    ('1500', 'Land',                            'FIXASSET'),
    ('1510', 'Building - Construction',         'FIXASSET'),
    ('1520', 'Furniture & Fixtures',            'FIXASSET'),
    ('1530', 'Office Equipment',                'FIXASSET'),
    ('1540', 'Computer & IT Equipment',         'FIXASSET'),
    ('1550', 'Vehicles',                        'FIXASSET'),
    ('1590', 'Accumulated Depreciation',        'FIXASSET'),
    ('2010', 'Accounts Payable',                'AP'),
    ('2020', 'Advance from Customers',          'OCLIAB'),
    ('2030', 'PDC Payable',                     'OCLIAB'),
    ('2040', 'Salaries Payable',                'OCLIAB'),
    ('2050', 'Commission Payable',              'OCLIAB'),
    ('2060', 'Accrued Expenses',                'OCLIAB'),
    ('2100', 'Loan Payable - Short Term',       'OCLIAB'),
    ('2200', 'Loan Payable - Long Term',        'LTLIAB'),
    ('2210', 'Directors - Related Party Loan',  'LTLIAB'),
    ('3010', 'Owner''s Capital',                'EQUITY'),
    ('3020', 'Owner''s Drawings',               'EQUITY'),
    ('4010', 'Unit - Shop Sales',               'INC'),
    ('4020', 'Advertising Unit Income',         'INC'),
    ('4030', 'Processing Fee Income',           'INC'),
    ('4090', 'Other Income',                    'INC'),
    ('5010', 'Cost of Units Sold',              'COGS'),
    ('5020', 'Land Cost',                       'COGS'),
    ('5030', 'Construction - Development Cost', 'COGS'),
    ('5040', 'Dealer - Subdealer Commission',   'COGS'),
    ('6010', 'Salaries & Wages',                'EXP'),
    ('6020', 'Security - Guards Expense',       'EXP'),
    ('6030', 'Electricity & Utility Bills',     'EXP'),
    ('6040', 'Gas (Sui Gas) Bill',              'EXP'),
    ('6050', 'Office Rent',                     'EXP'),
    ('6060', 'Office & Admin Expense',          'EXP'),
    ('6070', 'Printing & Stationery',           'EXP'),
    ('6080', 'Marketing & Advertising',         'EXP'),
    ('6090', 'Communication & Internet',        'EXP'),
    ('6100', 'Travelling & Conveyance',         'EXP'),
    ('6110', 'Entertainment Expense',           'EXP'),
    ('6120', 'Repair & Maintenance',            'EXP'),
    ('6130', 'Legal & Professional Fees',       'EXP'),
    ('6140', 'Depreciation Expense',            'EXP'),
    ('6150', 'Miscellaneous Expense',           'EXP'),
    ('7010', 'Bank Charges',                    'EXP'),
    ('7020', 'Financial - Markup Charges',      'EXP')
  ) AS v(number, name, qb_type)
  ON CONFLICT (company_id, number) DO UPDATE
    SET name = EXCLUDED.name, qb_type = EXCLUDED.qb_type, is_active = true;

  SELECT count(*) INTO v_accounts FROM public.qb_accounts WHERE company_id = p_company_id;

  -- ── 2 · entry-type defaults (§A14 "Defaults") ────────────────────────────
  -- Only CLIENT_RECEIPT has a single answer; that is invariant 5, and it is why
  -- the rest are NULL rather than a guess. The mode defaults from §A14 —
  -- CASH → 1010, BANK → 1030 — are not entry-type defaults at all: they belong
  -- to the drawer and the bank account, and land on cash_accounts below.
  INSERT INTO public.entry_type_defaults (company_id, entry_type, default_qb_account_id, suggested_qb_types)
  SELECT p_company_id, v.entry_type,
         (SELECT a.id FROM public.qb_accounts a
           WHERE a.company_id = p_company_id AND a.number = v.number),
         v.suggested::jsonb
  FROM (VALUES
    ('CLIENT_RECEIPT', '2020'::text, '["OCLIAB"]'),
    ('EXPENSE',        NULL,         '["COGS","EXP"]'),
    ('LOAN_CAPITAL',   NULL,         '["OCLIAB","LTLIAB","EQUITY"]'),
    ('TRANSFER',       NULL,         '["BANK"]'),
    ('OTHER',          NULL,         '[]')
  ) AS v(entry_type, number, suggested)
  ON CONFLICT (company_id, entry_type) DO UPDATE
    SET default_qb_account_id = EXCLUDED.default_qb_account_id,
        suggested_qb_types    = EXCLUDED.suggested_qb_types;

  SELECT count(*) INTO v_defaults FROM public.entry_type_defaults WHERE company_id = p_company_id;

  -- ── 3 · the project's cash accounts ──────────────────────────────────────
  IF p_project_id IS NOT NULL THEN
    -- If a real Bank Al-Habib row exists in project_bank_accounts, reference it
    -- rather than restating its number and IBAN here. Looked up on every run,
    -- so adding that row later and re-seeding links it without a migration.
    SELECT pba.id INTO v_bank_ref
      FROM public.project_bank_accounts pba
     WHERE pba.project_id = p_project_id
       AND pba.bank_name ILIKE '%al%habib%'
     ORDER BY pba.is_primary DESC NULLS LAST, pba.created_at
     LIMIT 1;

    INSERT INTO public.cash_accounts (company_id, project_id, name, kind, qb_account_id, bank_account_id)
    SELECT p_company_id, p_project_id, v.name, v.kind,
           (SELECT a.id FROM public.qb_accounts a
             WHERE a.company_id = p_company_id AND a.number = v.number),
           CASE WHEN v.kind = 'BANK' THEN v_bank_ref ELSE NULL END
    FROM (VALUES
      ('Cash in Hand',          'CASH', '1010'),
      ('Bank Al-Habib - Awami', 'BANK', '1030')
    ) AS v(name, kind, number)
    ON CONFLICT (project_id, kind, name) DO UPDATE
      SET qb_account_id   = EXCLUDED.qb_account_id,
          bank_account_id = EXCLUDED.bank_account_id,
          is_active       = true;

    SELECT count(*) INTO v_cash FROM public.cash_accounts WHERE project_id = p_project_id;
  ELSE
    v_cash := 0;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'qb_accounts', v_accounts,
    'entry_type_defaults', v_defaults,
    'cash_accounts', v_cash,
    'bank_account_linked', v_bank_ref IS NOT NULL);
END;
$fn$;

COMMENT ON FUNCTION public.seed_daily_closing_chart(uuid, uuid) IS
  'Idempotent reference-data seeder for Daily Closing: the 53-account QuickBooks chart, the entry-type defaults, and a project''s cash drawer and bank account. Inserts what is missing, corrects drift, reactivates, never deletes. Safe to re-run.';

-- Seeding is an operator action, not something a signed-in user may trigger.
REVOKE ALL ON FUNCTION public.seed_daily_closing_chart(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_daily_closing_chart(uuid, uuid) TO service_role;

-- ── Run it for the pilot ───────────────────────────────────────────────────
-- Awami Market · company 96d210e7-… · project 59ded55b-… (RULES §0.6).
SELECT public.seed_daily_closing_chart(
  '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'::uuid,
  '59ded55b-9bc2-45b2-a372-49fc31807fa9'::uuid);

COMMIT;

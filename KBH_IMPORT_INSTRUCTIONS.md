# KBH Data Import — Instructions for VS Code Claude + Supabase (REVISED v2)

## What this is
One-time historical data import for KHUSHAL BAGH HEIGHTS (Fourteen Group of Companies).
File: `KBH_import.sql` — 260 units, 182 active + 49 cancelled sales, 231 clients,
6,271 installments (exact planner dates), 1,773 receipts (exact ledger dates/modes).

## Schema fixes already applied in v2
The first pre-flight (thank you) found column-name mismatches between the offline audit and
the live DB. These are now fixed in the file:
- companies.name        -> company_name
- projects.name         -> project_name
- projects.planned_units -> total_units
- category_unit_statuses.name/code -> status_name/status_code
- floors: removed non-existent project_id and short_code; floors now matched by
  company_id + floor_name, with ALL-CAPS and ordinal name variants OR'd together
  (UPPER GROUND / FIRST FLOOR / SECOND FLOOR / 3rd Floor ... 9th Floor).

## YOU MUST STILL VERIFY (you have live MCP; the offline audit was unreliable)
Before running, confirm these columns exist with these exact names. If any differ, correct the
SQL (column-name only — never touch data/amounts/dates), then proceed:

1. floors: `id`, `company_id`, `floor_name`   <- the lookup depends on floor_name
2. units: company_id, project_id, unit_no, floor_id, floor_no, floor_label, status_id, base_price, origin_type
3. clients: company_id, project_id, client_code, full_name, father_name, phone_primary, cnic, status
4. sales: company_id, project_id, unit_id, client_id, agent_id, sale_number, price_per_sqft, area_sqft,
          discount, down_payment, installment_count, status, is_active, sale_date, payment_plan_type, notes
5. installments: company_id, sale_id, installment_number, due_date, amount_due, installment_type
6. payments: company_id, sale_id, client_id, payment_code, amount, payment_date, payment_method,
             reference_no, status, notes
7. agents: company_id, project_id, agent_code, full_name, phone, status

Quick way: `SELECT column_name FROM information_schema.columns WHERE table_name = '<t>';` for each.

## How to run
1. Service-role / postgres (owner) connection ONLY (RMS tables are RLS-locked `deny_all_anon`).
2. Script is wrapped in BEGIN and does NOT auto-commit.
3. Read the verification SELECT at the end. Expect: units=260, active=182, cancelled=49,
   clients≈231, payments≈1773.
4. All good -> COMMIT;  else -> ROLLBACK; paste error + verification output, STOP.

## Do NOT
- Do not run twice (sales/payments would duplicate; not idempotent). ROLLBACK first if re-running.
- Do not change any data values, dates, or amounts. Column-name fixes only.

## By-design notes
- Sale type stored in sales.payment_plan_type='installment' (UI Sale-Type bug bypassed).
- Cancelled sales: receipts kept for audit/legal; refund accounting lives in QuickBooks A/P, not RMS.
- Unit 7-07: ledger has a +400,000 adjustment newer than the printed Client Record -> ledger used (correct).
- Payments ARE allocated to installments (oldest-first) in the second DO block, so recovery report is accurate.

## v3 fix (installment_type)
- installment_type 'booking' -> 'down_payment' (390 rows), 'final' -> 'custom' (156 rows).
- Now only uses: installment, down_payment, custom (all constraint-allowed).

## VERIFY these value-constraints too before re-running (you have live DB)
Check the CHECK constraints / allowed values for these columns; if any value below is not allowed,
tell me the allowed list and I will remap (do not edit data yourself):
- payments.payment_method  uses: 'cash', 'bank_transfer', 'cheque', 'adjustment'
- payments.status          uses: 'received'
- sales.status             uses: 'active', 'cancelled'
- sales.payment_plan_type  uses: 'installment'
- clients.status           uses: 'active'
- agents.status            uses: 'active'
- units.origin_type        uses: 'fresh'

Run: SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conrelid = 'payments'::regclass AND contype='c';   -- repeat per table

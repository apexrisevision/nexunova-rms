# v4 fixes — apply to YOUR already-patched file (do NOT overwrite your version)

You (agent) already applied these correctly — KEEP them:
- floor_name -> name (780)
- trg_payment_health DISABLE/ENABLE around the transaction
- client SELECT guard: client_code -> cnic for the 180 non-NULL-CNIC blocks
- (NULL-CNIC blocks correctly left on client_code — they can't conflict)

## NEW fix to apply now: 7 cancelled sales have sale_date = NULL (DB column is NOT NULL)

These 7 cancelled sales had no receipts and no schedule, so no real date exists.
Decision: set each to the day BEFORE its unit's active sale (keeps ownership history ordered);
for the 3 with no resolvable active date, use 2023-01-01 (project start).

Apply these exact values — find the line containing each sale_number and replace the
`,'cancelled',false,NULL,'installment',` with the date shown:

| sale_number   | set sale_date |
|---------------|---------------|
| KBH-S-160-C   | 2025-02-04    |
| KBH-S-111-C   | 2023-01-01    |
| KBH-S-194-C   | 2025-08-12    |
| KBH-S-196-C   | 2023-01-01    |
| KBH-S-188-C   | 2023-01-01    |
| KBH-S-185-C   | 2026-06-01    |
| KBH-S-159-C   | 2025-01-31    |

Regex (per row):
  ('KBH-S-160-C'.*?,'cancelled',false,)NULL(,'installment')  ->  \1'2025-02-04'\2

After applying all 7: confirm `,'cancelled',false,NULL,` count = 0, then re-run.

## installments.status note
The INSERT doesn't set installments.status (defaults to 'pending'); the allocation DO block
later updates it to paid/partial. That's fine — no change needed.

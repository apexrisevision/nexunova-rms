# Q · Between midnight and 5 AM Pakistan time, a JV dated "today" is refused as a future date

**Found** 2026-09-22 at 01:07 PKT, while running the Stage B regression (`verify-nf-journal-voucher.js`
timed out at JV-04 because nothing posted).
**Status** FIXED 2026-09-22 on the owner's instruction ("fix"), by migration `20260922a_nf_jv_date_in_pakistan_time.sql`. `nf_jv_save` now compares against `(now() AT TIME ZONE 'Asia/Karachi')::date`. New checks in `verify-nf-jv-harden.js`: JVX-05b (tomorrow in Pakistan is still refused) and JVX-05c (today in Pakistan is accepted at any hour).

## What happens

- The Journal Vouchers screen pre-fills today's date from the browser's clock (`today()` in
  `js/nf/nf-journal-voucher.js`), which in Peshawar is Pakistan time, UTC+5.
- `nf_jv_save` refuses any date after `CURRENT_DATE` (`NF:DATE_FUTURE`, added in 20260919p). The database
  runs in **UTC**.
- For the five hours after midnight in Pakistan, "today" on the screen is still "tomorrow" to the
  database, so a JV dated today is refused as a future date.

**Evidence, at the moment it happened:**
- this machine: Tue 22 Sep 2026, 01:07;
- the database: `now()` = 2026-09-21 20:07 UTC, `current_date` = 2026-09-21, `TimeZone` = UTC.

The suite posted a correct, balanced JV dated 22 Sep through the real screen, and it was not saved:
`nf_vouchers` 0 at cleanup.

## Scope

- `CURRENT_DATE` appears in one NexuFinance function: `nf_jv_save`, carried unchanged into 20260921o.
- The daily-closing path does not compare against the clock at all; a day's date is whatever the day
  was opened as.
- **Not affected:** the JV popup on the closing sheet (docs/PLAN.md §45). It dates the JV with the open
  day's own `business_date`, which cannot be in the future unless the day itself was opened ahead.

## The fix (applied: the first option below)

Compare against Pakistan's date, not the server's:

```sql
IF p_voucher_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'NF:DATE_FUTURE' ...
```

or keep the rule and give it a one-day allowance. Either is a one-line change to `nf_jv_save`. The
first is exact.

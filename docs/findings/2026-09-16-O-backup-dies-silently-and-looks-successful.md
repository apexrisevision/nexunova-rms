# O · `backup-full.js` can die halfway and look like it succeeded

**Found** 2026-09-16, while taking the pre-apply backup for NexuFinance Phase 1.
**Status** FIXED the same day (see "The fix"), recorded here because the failure mode — a backup that
reports success and is not one — is worth remembering whatever the code does now.

## What breaks

`node scripts/backup-full.js` stopped partway through the data phase and left a backup directory that
looks ordinary. Nothing said it had failed.

| | Last good backup `BACKUP_20260909_1102` | The failed run `BACKUP_20260916_1730` |
|---|---|---|
| `data/*.json` | 173 files | **163 files** |
| `MANIFEST.json` | present | **absent** |
| `RESTORE.md` | present | **absent** |
| `storage/` | present | **absent** |
| on disk | — | 236 MB written before it died |

**The evidence that it looked fine:**
- the shell reported **exit 0**;
- the log's last line is `subscription_pay_links  14 rows` — alphabetically in the "s" range, with the
  `t`/`u`/`v`/`w` tables, the storage download, `RESTORE.md` and `MANIFEST.json` never reached;
- there is no error line anywhere in the 172-line log.

The process was killed by the operating system (this machine had been hitting low memory all day; two
unrelated background jobs were killed the same hour). A killed process runs no `catch`, so the script's
own `.catch(e => process.exit(1))` never ran.

## Where it breaks

`scripts/backup-full.js`, the data phase (before the fix):

- `scripts/backup-full.js:240` — `rows.push(...batch)` builds **the whole table** in memory.
- `scripts/backup-full.js:265-275` — every row of every table is then *also* kept in `perCompany` and
  `shared`, so the Excel phase can write one workbook per tenant at the end. That means **the entire
  database is resident in the heap** at the moment the last table is read. `audit_logs` alone is ~74 MB.

Node's default old-space limit on this machine is well under what that needs.

## Who is affected

Anyone who takes a backup and believes it. That is the whole point of the file: it is the safety net
before a migration is applied. A truncated backup is worse than no backup, because the operator stops
looking for one.

`docs/daily-closing/RUNBOOK.md` and `docs/PLAN.md` both name this script as step 1 before an apply.

## What correct behaviour is

1. Memory must not grow with the size of the database: stream each table to disk in pages and never hold
   a whole table — or a whole tenant — in the heap.
2. A backup is finished only when it says so: `MANIFEST.json` written last, with per-table row counts
   checked against counts taken from live at the start, then a `DONE` marker as the final action.
3. **Anything without `DONE` and `MANIFEST.json` is a failed backup, whatever the exit code says.**
4. Death by signal must be reportable: whoever reads the directory afterwards (a person or a script) must
   be able to tell, without the log.

## What changes for a KBH or FMH user

Nothing directly — no tenant data is touched by this script; it only reads. What changes is the operator's
position: before the fix, a backup taken ahead of a migration could be silently partial, so a restore
would have come up short exactly when it was needed. KBH and FMH data is the majority of what it holds.

## The fix (2026-09-16)

`scripts/backup-full.js` rewritten around streaming:

- pages of 1,000 rows by primary key, appended straight to `data/<table>.json`; `audit_logs` goes through
  the same path as everything else (no `--skip-audit` in the pre-apply sequence);
- per-tenant Excel rows spooled to `_shards/<company>/<table>.jsonl` during the data phase and read back
  one sheet at a time, so no tenant's rows are ever all in memory;
- re-executes itself with `--max-old-space-size=4096`;
- live row counts taken **at the start**, compared per table at the end; a mismatch fails the backup unless
  the extra rows are newer than the start timestamp;
- `unhandledRejection` and `uncaughtException` exit non-zero;
- `MANIFEST.json` written at the very end, then a `DONE` file as the last action;
- `--verify <dir>` reports a directory as PASS or FAILED on `DONE` + `MANIFEST` + per-table counts;
- progress per table: rows, bytes, heap and RSS.

**Proved by killing it:** the process was killed mid-run on purpose; `--verify` reports the directory
FAILED, with no `DONE` and no `MANIFEST.json`. Evidence in `docs/PLAN.md` §9.7.

## Related

- Supabase's own automatic backups were checked the same day: the Management API returns
  `"backups": []` with `pitr_enabled: false` for this project. **There is no second safety net** — the
  local backup is the only one.
- [[SR-8]] (`docs/daily-closing/PHASES.md`) — evidence that cannot be seen is evidence that does not
  exist. This is its sibling: *output that stops is not the same as work that stopped*, and the operator
  cannot tell the two apart without a marker written by the work itself.

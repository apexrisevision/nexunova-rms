# Nexunova RMS — Backup & Disaster Recovery

_Last reviewed: 2026-06-18_

This document is the single source of truth for keeping **all tenants' data safe**.
The whole platform is one shared Supabase Postgres DB (rows scoped by `company_id`),
plus a Supabase Storage bucket for files, plus this git repo for the frontend.

| What | Where it lives | Size (2026-06-18) | How it's protected |
|------|----------------|-------------------|--------------------|
| App code (frontend) | this git repo → Vercel | — | Git history + GitHub |
| Database (all tenants) | Supabase Postgres `itqxljtfbrppntgyfush` | 130 MB, 111 tables, 7 tenants | Layers 1 + 2 below |
| Files (KYC, CNIC, logos) | Supabase Storage | 25 MB, 55 files | Layer 1 + Layer 3 |

> **Key fact:** one `pg_dump` of the `public` schema contains **every tenant** —
> no per-tenant dumps needed.

---

## The 3 layers

### Layer 1 — Platform daily backups (already ON, nothing to do)
Supabase takes an automatic **physical backup every day** (`walg_enabled: true`,
verified). Retention is typically 7 days on the current plan. These restore the
whole project in place from the Supabase Dashboard → Database → Backups.

- ⚠️ **Limitation:** they live inside the Supabase account and **cannot be
  downloaded**. If the account/project is lost, these go with it. That gap is
  what Layer 2 fixes.
- 🔧 **Optional upgrade — PITR:** Point-in-Time Recovery is currently **OFF**
  (`pitr_enabled: false`). It's a paid add-on that lets you restore to any
  second instead of only the daily snapshot. Worth enabling once data volume /
  revenue grows; at 130 MB it is not yet essential.

### Layer 2 — Off-platform nightly dump (GitHub Action) ⭐ the real safety net
`.github/workflows/nightly-backup.yml` runs every night, takes an encrypted
`pg_dump` of all tenant data, and stores it as a **GitHub Release asset** —
a copy that survives even if the Supabase account disappears.

**One-time setup:**
1. Push this repo to GitHub (private repo recommended).
2. Get the connection string: Supabase Dashboard → **Project Settings →
   Database → Connection string → "Session pooler"** (port **5432**, _not_ the
   6543 transaction pooler — pg_dump needs the session pooler). It looks like:
   ```
   postgresql://postgres.itqxljtfbrppntgyfush:YOUR-DB-PASSWORD@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres
   ```
3. In the GitHub repo → **Settings → Secrets and variables → Actions → New
   repository secret**, add:
   | Secret | Value |
   |--------|-------|
   | `SUPABASE_DB_URL` | the Session-pooler string above (with the real DB password) |
   | `BACKUP_GPG_PASSPHRASE` | any strong passphrase — **store it in a password manager**; without it the backups can't be decrypted |
4. Run it once manually: repo → **Actions → "Nightly DB backup" → Run workflow**.
   A new Release `backup-YYYY-MM-DD` with a `.dump.gpg` asset should appear.

It keeps the **last 30** nightly dumps and prunes older ones automatically.

### Layer 3 — Storage files
Supabase Storage objects (KYC/CNIC images, logos) are **not** inside the SQL
dump. They are covered by Layer 1 (platform infra), but for an off-platform copy
sync them periodically with `rclone` against Supabase's S3-compatible endpoint,
or download via the service-role key. (25 MB today — low priority but documented.)

---

## How to RESTORE from a Layer-2 backup

You need: the `.dump.gpg` file (download from the GitHub Release) and the
`BACKUP_GPG_PASSPHRASE`.

```bash
# 1. Decrypt
gpg --batch --passphrase "YOUR_PASSPHRASE" -o nexunova.dump -d nexunova_2026-06-18.dump.gpg

# 2. Inspect what's inside (optional)
pg_restore --list nexunova.dump | head

# 3a. Restore into a FRESH/empty Postgres (e.g. a new Supabase project):
pg_restore --no-owner --no-privileges --schema=public \
  -d "postgresql://postgres.<newref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
  nexunova.dump

# 3b. Restore a SINGLE table (surgical recovery), e.g. agents:
pg_restore --no-owner --data-only --table=agents -d "<conn>" nexunova.dump
```

> ⚠️ Restoring into a non-empty DB can conflict. For full DR, restore into a
> fresh project, then repoint `js/supabase.js` (SUPABASE_URL / anon key) and
> redeploy. For accidental data loss within 7 days, Layer 1 (Dashboard restore)
> is usually faster.

---

## Manual one-off dump (no automation)

```bash
pg_dump "postgresql://postgres.itqxljtfbrppntgyfush:PWD@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres" \
  -Fc --schema=public --no-owner --no-privileges -f nexunova_$(date +%F).dump
```

---

## In-app Excel export (human-readable, not a DR backup)

- **Per tenant:** any admin → **Data backup & restore** page → *Download as Excel*.
  Pulls live data via the `export_company_data` RPC into a multi-sheet workbook
  (Projects · Units · Clients · Sales · Payments · Installments · Agents).
- **All tenants:** Super-admin console → **Companies** tab → *Export all tenants
  (Excel)*. One workbook, every company, with a leading `Company` column.

These are convenience snapshots for reading/sharing — the **machine-grade**
restore path is always the `pg_dump` (Layers 1 & 2).

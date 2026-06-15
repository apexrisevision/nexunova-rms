# KBH Re-Import — Backup (2026-06-11)

Before the KBH clean re-import, all Fourteen-Group rows in the affected tables were
snapshotted **transactionally inside the database** to schema:

    kbh_backup_20260611

This is the authoritative, full-fidelity backup (exact column types preserved,
consistent point-in-time copy). It was chosen over loose JSON files because the
data volume (6,271 installments + 1,773 payments) is large and a DB-side snapshot
is the most reliable restore path.

## Captured (verified row counts == live pre-migration counts)

| schema table                              | rows |
|-------------------------------------------|------|
| kbh_backup_20260611.floors                | 10   |
| kbh_backup_20260611.category_unit_types   | 10   |
| kbh_backup_20260611.units                 | 260  |
| kbh_backup_20260611.clients               | 191  |
| kbh_backup_20260611.sales                 | 231  |
| kbh_backup_20260611.installments          | 6271 |
| kbh_backup_20260611.payments              | 1773 |
| kbh_backup_20260611.recovery_radar_logs   | 18   |
| kbh_backup_20260611.client_health_history | 4    |
| kbh_backup_20260611.projects_kbh          | 1    |

Tenant: Fourteen Group of companies (company_id 3249e3b5-c411-4f5f-ae48-0246304c9c87)
KBH project (PRESERVED, never touched): id 7f70ba90-130e-42b5-801b-4c9bafa82975

## Restore (if needed)

Re-import deletes only `public` rows for this tenant/project. To roll back, re-insert
from the snapshot (children after parents), e.g.:

```sql
INSERT INTO public.floors              SELECT * FROM kbh_backup_20260611.floors;
INSERT INTO public.category_unit_types SELECT * FROM kbh_backup_20260611.category_unit_types;
INSERT INTO public.units               SELECT * FROM kbh_backup_20260611.units;
INSERT INTO public.clients             SELECT * FROM kbh_backup_20260611.clients;
INSERT INTO public.sales               SELECT * FROM kbh_backup_20260611.sales;
INSERT INTO public.installments        SELECT * FROM kbh_backup_20260611.installments;
INSERT INTO public.payments            SELECT * FROM kbh_backup_20260611.payments;
-- (disable payment/audit triggers around the payments insert, as the import does)
```

Drop the snapshot only after the re-import is confirmed good:
`DROP SCHEMA kbh_backup_20260611 CASCADE;`

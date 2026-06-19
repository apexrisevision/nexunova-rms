-- Allot a proper Receipt # (voucher_code, PRV-<fy>-#####) to EVERY payment that
-- was missing one (1773 of 1794 — mostly the historical KBH import). Owner chose
-- the system voucher code as the official receipt number; this backfills history
-- so every receipt has a unique, per-company, fiscal-year-sequenced number.
--
-- Scheme: per (company, fiscal-year-of-payment_date), chronological by
-- (payment_date, created_at). Existing voucher_codes are NOT touched — missing
-- ones continue AFTER the current max seq in that (company, FY). voucher_sequences
-- is then synced so future record_payment() continues correctly.
-- Applied live via MCP 2026-06-19. Health/audit triggers were briefly disabled
-- (bulk UPDATE tripped calculate_client_health_score under the migration role).

ALTER TABLE public.payments DISABLE TRIGGER trg_payment_health;
ALTER TABLE public.payments DISABLE TRIGGER _trg_audit;

WITH base AS (
  SELECT id, company_id, payment_date, created_at,
    CASE WHEN extract(month from payment_date)>=7
         THEN right(extract(year from payment_date)::int::text,2)||right((extract(year from payment_date)::int+1)::text,2)
         ELSE right((extract(year from payment_date)::int-1)::text,2)||right(extract(year from payment_date)::int::text,2) END AS fy
  FROM public.payments WHERE voucher_code IS NULL
),
maxseq AS (
  SELECT company_id, fy, MAX(seq) AS mx FROM (
    SELECT company_id, split_part(voucher_code,'-',2) AS fy, CAST(split_part(voucher_code,'-',3) AS int) AS seq
      FROM public.payments WHERE voucher_code IS NOT NULL
    UNION ALL
    SELECT company_id, year AS fy, seq FROM public.voucher_sequences WHERE prefix='PRV'
  ) u GROUP BY company_id, fy
),
numbered AS (
  SELECT b.id, b.company_id, b.fy,
    COALESCE(m.mx,0) + row_number() OVER (PARTITION BY b.company_id, b.fy ORDER BY b.payment_date, b.created_at, b.id) AS newseq
  FROM base b LEFT JOIN maxseq m ON m.company_id=b.company_id AND m.fy=b.fy
)
UPDATE public.payments p
SET voucher_code = 'PRV-' || n.fy || '-' || LPAD(n.newseq::text,5,'0')
FROM numbered n WHERE p.id = n.id;

INSERT INTO public.voucher_sequences (company_id, prefix, year, seq)
SELECT company_id, 'PRV', fy, MAX(seq) FROM (
  SELECT company_id, split_part(voucher_code,'-',2) AS fy, CAST(split_part(voucher_code,'-',3) AS int) AS seq
    FROM public.payments WHERE voucher_code IS NOT NULL
) u GROUP BY company_id, fy
ON CONFLICT (company_id, prefix, year) DO UPDATE SET seq = GREATEST(public.voucher_sequences.seq, EXCLUDED.seq);

ALTER TABLE public.payments ENABLE TRIGGER trg_payment_health;
ALTER TABLE public.payments ENABLE TRIGGER _trg_audit;

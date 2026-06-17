-- Per-sale free-text commission note: who gets what %, splits, vouchers,
-- discount/pending notes. Source = KBH "Commission Report" REMARKS column.
-- RMS holds a single agent_id + commission_rate per sale; multi-agent splits
-- and payment detail live here as text (actual money stays in QuickBooks).
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS commission_notes text;

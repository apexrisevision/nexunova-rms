-- ================================================================
-- NEXUNOVA RMS — MODULE 7 DISPATCH — Phase A: QUEUE + TEMPLATE SCHEMA
-- 2026-05-28
-- Provider-AGNOSTIC. Extends the existing foundation (message_log,
-- message_templates from 20260525_module7_comms_foundation.sql).
-- message_log becomes the unified queue+log: status drives the
-- lifecycle queued -> sending -> sent -> delivered -> read | failed.
-- No provider creds required for this migration; it is inert until
-- the send adapter Edge Function is deployed + creds are set.
-- ================================================================

-- ---- message_log: queue lifecycle + provider tracking --------------------
ALTER TABLE public.message_log ADD COLUMN IF NOT EXISTS scheduled_at        timestamptz;          -- null = send asap
ALTER TABLE public.message_log ADD COLUMN IF NOT EXISTS provider            text;                 -- meta | wetarseel | sms | (null until dispatched)
ALTER TABLE public.message_log ADD COLUMN IF NOT EXISTS provider_message_id text;                 -- id returned by gateway (for webhook correlation)
ALTER TABLE public.message_log ADD COLUMN IF NOT EXISTS error               text;
ALTER TABLE public.message_log ADD COLUMN IF NOT EXISTS attempts            int NOT NULL DEFAULT 0;
ALTER TABLE public.message_log ADD COLUMN IF NOT EXISTS dedup_key           text;                 -- e.g. 'overdue:<sale>:d7' — prevents duplicate auto-triggers
ALTER TABLE public.message_log ADD COLUMN IF NOT EXISTS merge_data          jsonb;                -- vars used to render (audit + re-render)
ALTER TABLE public.message_log ADD COLUMN IF NOT EXISTS sale_id             uuid;                 -- source sale for installment/overdue/pdc events
ALTER TABLE public.message_log ADD COLUMN IF NOT EXISTS sent_at             timestamptz;
ALTER TABLE public.message_log ADD COLUMN IF NOT EXISTS delivered_at        timestamptz;
ALTER TABLE public.message_log ADD COLUMN IF NOT EXISTS read_at             timestamptz;

-- widen the status vocabulary (add 'sending' + 'cancelled')
ALTER TABLE public.message_log DROP CONSTRAINT IF EXISTS message_log_status_check;
ALTER TABLE public.message_log ADD CONSTRAINT message_log_status_check
  CHECK (status = ANY (ARRAY['manual','queued','sending','sent','delivered','read','failed','cancelled']));

-- queue-draining index: cheap lookup of due, sendable rows
CREATE INDEX IF NOT EXISTS idx_mlog_queue
  ON public.message_log (scheduled_at)
  WHERE status IN ('queued','sending');

-- provider correlation for webhook status updates
CREATE INDEX IF NOT EXISTS idx_mlog_provider_msg
  ON public.message_log (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- dedup: at most one LIVE message per (company, dedup_key); failed/cancelled
-- do not block a fresh retry/re-queue
CREATE UNIQUE INDEX IF NOT EXISTS uq_mlog_dedup
  ON public.message_log (company_id, dedup_key)
  WHERE dedup_key IS NOT NULL AND status <> 'failed' AND status <> 'cancelled';

-- ---- message_templates: Meta / BSP approved-template fields ----------------
-- Meta Cloud API (and WeTarseel/BSPs) require a pre-approved *template name* +
-- language, and positional {{1}},{{2}} variables. We keep the freeform `body`
-- (used for the in-app preview + the wa.me manual path) AND map ordered vars
-- to the approved template for true API sends.
ALTER TABLE public.message_templates ADD COLUMN IF NOT EXISTS meta_template_name text;
ALTER TABLE public.message_templates ADD COLUMN IF NOT EXISTS meta_language      text NOT NULL DEFAULT 'en';
ALTER TABLE public.message_templates ADD COLUMN IF NOT EXISTS variable_map       jsonb NOT NULL DEFAULT '[]'::jsonb; -- ["client_name","amount","due_date"] -> {{1}},{{2}},{{3}}

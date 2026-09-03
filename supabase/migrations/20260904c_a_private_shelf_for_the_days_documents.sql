-- ═══════════════════════════════════════════════════════════════════════════
-- A private shelf for the day's documents
-- ───────────────────────────────────────────────────────────────────────────
-- Created now, two prompts before the renderer that fills it, because it is not
-- the renderer's first user: a cashier attaching a bill to an entry needs it as
-- soon as the composer exists, and a bucket conjured mid-prompt is a bucket
-- somebody creates by hand and forgets to make private.
--
-- It holds three kinds of file, all confidential:
--   · attachments against a cash entry — bills, deposit slips, cheque images
--   · the Director PDF, every version of it
--   · the QuickBooks .iif export for a day
--
-- PUBLIC = FALSE AND NO POLICY AT ALL. That is deliberate, and it is the shape
-- 20260828j used for employee documents. anon and authenticated cannot read,
-- write or list this bucket by any route. Every read is a short-lived signed
-- URL minted server-side by something that knows who is asking; every write
-- goes through the service key. §A10: "Documents private; signed URLs."
--
-- RMS's prevailing habit is the opposite — upload to a public bucket, store the
-- public URL in a text column, and rely on the URL being hard to guess. That is
-- why cash_entry_attachments.storage_key holds a PATH and not a URL.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('daily-closing', 'daily-closing', false, 10485760,
        ARRAY['image/jpeg','image/jpg','image/png','application/pdf','text/plain'])
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Belt and braces: if a policy for this bucket is ever added by hand, this
-- migration re-running removes it again. There is no legitimate direct-access
-- policy for this bucket.
DROP POLICY IF EXISTS daily_closing_anon_read   ON storage.objects;
DROP POLICY IF EXISTS daily_closing_anon_upload ON storage.objects;

COMMIT;

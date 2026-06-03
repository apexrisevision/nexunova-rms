-- BATCH C3-1 (2026-06-03): tenant-scope storage.objects (close authenticated cross-tenant LIST/download/delete/tamper).
-- Folder convention: (storage.foldername(name))[1] = company_id for ALL 5 buckets. This requires the companion
-- frontend fix in js/pages/fieldvisits.js (path `field-visits/${co}/...` -> `${co}/field-visits/...`) so rms-files is
-- uniformly company-first; applied alongside this migration.
-- Caller company resolved via auth.uid() -> public.app_users (active). Super-admin may SELECT/DELETE cross-company
-- (needed for subscription payment-receipt review). Policies are TO authenticated only (anon fully excluded).
--
-- DEFERRED to a post-launch session (C3-2, tracked): set public=false on rms-documents/recovery-documents/rms-files
-- and migrate ~48 getPublicUrl render sites (9 files) to createSignedUrl. Until then the public-URL READ vector
-- remains on those 3 buckets (guessable-URL only; NOT an authenticated cross-tenant leak). Buckets stay public here
-- so existing getPublicUrl display keeps working with zero breakage.

DROP POLICY IF EXISTS "Allow authenticated uploads"        ON storage.objects;
DROP POLICY IF EXISTS "Allow public read"                  ON storage.objects;
DROP POLICY IF EXISTS "Allow company read own"             ON storage.objects;
DROP POLICY IF EXISTS "Allow company upload"               ON storage.objects;
DROP POLICY IF EXISTS rms_docs_public_read                 ON storage.objects;
DROP POLICY IF EXISTS rms_docs_public_insert               ON storage.objects;
DROP POLICY IF EXISTS rms_docs_public_update               ON storage.objects;
DROP POLICY IF EXISTS rms_docs_public_delete               ON storage.objects;
DROP POLICY IF EXISTS agent_docs_public_select             ON storage.objects;
DROP POLICY IF EXISTS agent_docs_public_insert             ON storage.objects;
DROP POLICY IF EXISTS agent_docs_public_update             ON storage.objects;
DROP POLICY IF EXISTS agent_docs_public_delete             ON storage.objects;
DROP POLICY IF EXISTS recovery_docs_public_read            ON storage.objects;
DROP POLICY IF EXISTS recovery_docs_authenticated_insert   ON storage.objects;

CREATE POLICY rms_tenant_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id IN ('rms-documents','recovery-documents','rms-files','agent-documents','payment-receipts')
  AND ( (storage.foldername(name))[1] = (SELECT a.company_id::text FROM public.app_users a
                                         WHERE a.auth_user_id = auth.uid() AND a.status='active' LIMIT 1)
        OR EXISTS (SELECT 1 FROM public.app_users a
                   WHERE a.auth_user_id = auth.uid() AND a.status='active' AND a.is_super_admin) )
);
CREATE POLICY rms_tenant_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('rms-documents','recovery-documents','rms-files','agent-documents','payment-receipts')
  AND (storage.foldername(name))[1] = (SELECT a.company_id::text FROM public.app_users a
                                       WHERE a.auth_user_id = auth.uid() AND a.status='active' LIMIT 1)
);
CREATE POLICY rms_tenant_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id IN ('rms-documents','recovery-documents','rms-files','agent-documents','payment-receipts')
  AND (storage.foldername(name))[1] = (SELECT a.company_id::text FROM public.app_users a
                                       WHERE a.auth_user_id = auth.uid() AND a.status='active' LIMIT 1)
)
WITH CHECK (
  bucket_id IN ('rms-documents','recovery-documents','rms-files','agent-documents','payment-receipts')
  AND (storage.foldername(name))[1] = (SELECT a.company_id::text FROM public.app_users a
                                       WHERE a.auth_user_id = auth.uid() AND a.status='active' LIMIT 1)
);
CREATE POLICY rms_tenant_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id IN ('rms-documents','recovery-documents','rms-files','agent-documents','payment-receipts')
  AND ( (storage.foldername(name))[1] = (SELECT a.company_id::text FROM public.app_users a
                                         WHERE a.auth_user_id = auth.uid() AND a.status='active' LIMIT 1)
        OR EXISTS (SELECT 1 FROM public.app_users a
                   WHERE a.auth_user_id = auth.uid() AND a.status='active' AND a.is_super_admin) )
);

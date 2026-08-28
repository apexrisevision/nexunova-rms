-- ══ A leave application may carry a document ════════════════════════════════
--
-- The portal already uploads to rms-documents under sales-signup/<token>/, and
-- the policy that allows it checks the token rather than trusting the caller.
-- A leave attachment follows the same shape and the same check: its own folder,
-- the same token test, nothing wider.
--
-- The token is the one the portal receives at sign-in, so only somebody who has
-- actually signed in can write, and only inside their own token's folder.
CREATE POLICY leave_anon_upload ON storage.objects
  FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'rms-documents'
    AND (storage.foldername(name))[1] = 'leave'
    AND public.sales_signup_token_valid((storage.foldername(name))[2])
  );

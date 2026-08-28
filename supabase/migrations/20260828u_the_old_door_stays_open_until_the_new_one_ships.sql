-- Sequencing, not indecision.
--
-- The database change is live the moment it is applied; the page that knows
-- about it is not live until it is pushed. Between those two moments the portal
-- is still uploading to rms-documents, and with salessignup_anon_upload dropped
-- an applicant standing in front of the form gets "Could not upload image" for
-- no reason they could act on.
--
-- A hole that has been open for months is not made materially worse by staying
-- open a few more minutes. A signup that certainly fails is worse than a risk
-- that might not be taken. So the old door is put back, to be closed again the
-- moment the new page is serving — that closing is 20260828t, re-run.
drop policy if exists salessignup_anon_upload on storage.objects;
create policy salessignup_anon_upload
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'rms-documents'
    and (storage.foldername(name))[1] = 'sales-signup'
    and public.sales_signup_token_valid((storage.foldername(name))[2])
  );

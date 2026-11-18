-- ══ NexuFinance — Site Closing: a PRIVATE bucket for bill photos (Stage 3) ══
-- NOT APPLIED. Written for the owner's go (docs/SITE_CLOSING_SPEC.md, Stage 3).
--
-- The site screen uploads a bill photo to  nf-site-bills/<company_id>/<date>/<file>
-- and stores that path in nf_site_lines.attachment_url. Until this is applied the
-- upload is refused and the screen says so ("Photo storage may not be set up yet");
-- every other part of the screen works without it.
--
--   * private bucket, images and PDFs only, 10 MB each
--   * the SITE accountant of a company may add photos under that company's folder
--   * that company's site accountant and HO (accountant, director, viewer) may read them
--   * nobody updates or deletes through the API (a bill once given stays)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('nf-site-bills', 'nf-site-bills', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- the company a path belongs to: its first folder, or NULL when that is not a uuid
CREATE OR REPLACE FUNCTION public.nf_site_bill_company(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN split_part(COALESCE(p_name, ''), '/', 1)::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$function$;

-- may this user add a bill for this company? only its active site accountant
CREATE OR REPLACE FUNCTION public.nf_site_bill_writer(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.nf_members m
                  WHERE m.company_id = p_company_id AND m.user_id = auth.uid() AND m.active AND m.role = 'site');
$function$;

REVOKE ALL ON FUNCTION public.nf_site_bill_company(text)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_site_bill_writer(uuid)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_site_bill_company(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_bill_writer(uuid)  TO authenticated;

DROP POLICY IF EXISTS nf_site_bills_insert ON storage.objects;
CREATE POLICY nf_site_bills_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nf-site-bills'
              AND public.nf_site_bill_writer(public.nf_site_bill_company(name)));

DROP POLICY IF EXISTS nf_site_bills_read ON storage.objects;
CREATE POLICY nf_site_bills_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'nf-site-bills'
         AND public.nf_site_reader(public.nf_site_bill_company(name), true));

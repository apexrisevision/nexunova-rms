-- ══ PHASE 1B — TENANT BRANDING ════════════════════════════════════════════════
-- Gives the tenant logo a real server home (company-logos bucket + companies.logo_url),
-- a plan-derived white-label flag (Adjustment A), and extends the branding RPCs with
-- display_name / website / logo_url / white_label. Applied to prod via MCP 2026-07-06.

-- 1) Company columns ----------------------------------------------------------
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS white_label_override boolean; -- NULL=derive from plan; super-admin override

-- 2) Public logo bucket + tenant-scoped write/select policies -----------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('company-logos','company-logos', true, 2097152,
        ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = true, file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp'];

-- Path convention: <company_id>/logo_<ts>_<rand>.<ext>  → foldername[1] = company_id.
-- NOTE: clients upload with upsert:false + a unique filename (upsert:true would take a
-- SELECT/UPDATE path that INSERT-scoped RLS denies — see anon_storage_upsert_rls_denied).
DROP POLICY IF EXISTS company_logos_insert ON storage.objects;
CREATE POLICY company_logos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-logos'
    AND ((storage.foldername(name))[1] = ((_rms_caller()).company_id)::text
         OR COALESCE((_rms_caller()).is_super_admin, false)));

DROP POLICY IF EXISTS company_logos_select ON storage.objects;
CREATE POLICY company_logos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'company-logos'
    AND ((storage.foldername(name))[1] = ((_rms_caller()).company_id)::text
         OR COALESCE((_rms_caller()).is_super_admin, false)));

DROP POLICY IF EXISTS company_logos_update ON storage.objects;
CREATE POLICY company_logos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-logos'
    AND ((storage.foldername(name))[1] = ((_rms_caller()).company_id)::text
         OR COALESCE((_rms_caller()).is_super_admin, false)))
  WITH CHECK (bucket_id = 'company-logos'
    AND ((storage.foldername(name))[1] = ((_rms_caller()).company_id)::text
         OR COALESCE((_rms_caller()).is_super_admin, false)));

DROP POLICY IF EXISTS company_logos_delete ON storage.objects;
CREATE POLICY company_logos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-logos'
    AND ((storage.foldername(name))[1] = ((_rms_caller()).company_id)::text
         OR COALESCE((_rms_caller()).is_super_admin, false)));

-- 3) White-label derivation (Adjustment A): Ultimate/Enterprise = white-label ---
CREATE OR REPLACE FUNCTION public._company_white_label(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT white_label_override FROM companies WHERE id = p_company_id),
    EXISTS (
      SELECT 1 FROM subscriptions s
      JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.company_id = p_company_id
        AND s.status IN ('active','trialing')
        AND lower(p.plan_name) IN ('ultimate','enterprise')
    )
  );
$$;

-- 4) set_company_logo — tenant-gated write of companies.logo_url --------------
CREATE OR REPLACE FUNCTION public.set_company_logo(p_company_id uuid, p_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'wrong_tenant' USING ERRCODE = '42501';
  END IF;
  UPDATE companies SET logo_url = NULLIF(p_url, ''), updated_at = now() WHERE id = p_company_id;
END;
$$;

-- 5) get_company_branding — + display_name, website, white_label -------------
CREATE OR REPLACE FUNCTION public.get_company_branding(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v JSONB;
BEGIN
  SELECT jsonb_build_object(
    'company_name',          c.company_name,
    'display_name',          c.display_name,
    'business_email',        c.business_email,
    'business_phone',        c.business_phone,
    'website',               c.website,
    'city',                  c.city,
    'country',               COALESCE(c.country, 'Pakistan'),
    'address',               c.address,
    'logo_url',              c.logo_url,
    'letterhead_subtitle',   COALESCE(b.letterhead_subtitle, 'Recovery Management System'),
    'address_full',          b.address_full,
    'ntn_number',            b.ntn_number,
    'registration_number',   b.registration_number,
    'doc_brand_color',       COALESCE(b.doc_brand_color, '#1E2D47'),
    'accent_color',          COALESCE(b.accent_color, '#C9A84C'),
    'signature_name',        b.signature_name,
    'signature_title',       COALESCE(b.signature_title, 'Authorized Signatory'),
    'footer_text',           b.footer_text,
    'white_label',           public._company_white_label(c.id),
    'onboarding_complete',   c.onboarding_complete
  )
  INTO v
  FROM companies c
  LEFT JOIN company_branding b ON b.company_id = c.id
  WHERE c.id = p_company_id;
  RETURN COALESCE(v, '{}'::jsonb);
END;
$$;

-- 6) save_company_branding — accept display_name, website, logo_url ----------
CREATE OR REPLACE FUNCTION public.save_company_branding(p_company_id uuid, p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'wrong_tenant' USING ERRCODE = '42501';
  END IF;
  UPDATE companies SET
    company_name        = COALESCE(NULLIF(p_data->>'company_name', ''), company_name),
    display_name        = CASE WHEN p_data ? 'display_name' THEN NULLIF(p_data->>'display_name','') ELSE display_name END,
    website             = CASE WHEN p_data ? 'website' THEN NULLIF(p_data->>'website','') ELSE website END,
    logo_url            = CASE WHEN p_data ? 'logo_url' THEN NULLIF(p_data->>'logo_url','') ELSE logo_url END,
    business_email      = NULLIF(p_data->>'business_email', ''),
    business_phone      = NULLIF(p_data->>'business_phone', ''),
    city                = NULLIF(p_data->>'city', ''),
    country             = COALESCE(NULLIF(p_data->>'country', ''), 'Pakistan'),
    address             = NULLIF(p_data->>'address', ''),
    onboarding_complete = COALESCE((p_data->>'onboarding_complete')::boolean, onboarding_complete),
    updated_at          = now()
  WHERE id = p_company_id;
  INSERT INTO company_branding (
    company_id, letterhead_subtitle, address_full, ntn_number,
    registration_number, doc_brand_color, accent_color,
    signature_name, signature_title, footer_text
  ) VALUES (
    p_company_id,
    COALESCE(NULLIF(p_data->>'letterhead_subtitle', ''), 'Recovery Management System'),
    NULLIF(p_data->>'address_full', ''),
    NULLIF(p_data->>'ntn_number', ''),
    NULLIF(p_data->>'registration_number', ''),
    COALESCE(NULLIF(p_data->>'doc_brand_color', ''), '#1E2D47'),
    COALESCE(NULLIF(p_data->>'accent_color', ''), '#C9A84C'),
    NULLIF(p_data->>'signature_name', ''),
    COALESCE(NULLIF(p_data->>'signature_title', ''), 'Authorized Signatory'),
    NULLIF(p_data->>'footer_text', '')
  )
  ON CONFLICT (company_id) DO UPDATE SET
    letterhead_subtitle = COALESCE(NULLIF(p_data->>'letterhead_subtitle', ''), 'Recovery Management System'),
    address_full        = NULLIF(p_data->>'address_full', ''),
    ntn_number          = NULLIF(p_data->>'ntn_number', ''),
    registration_number = NULLIF(p_data->>'registration_number', ''),
    doc_brand_color     = COALESCE(NULLIF(p_data->>'doc_brand_color', ''), company_branding.doc_brand_color),
    accent_color        = COALESCE(NULLIF(p_data->>'accent_color', ''), company_branding.accent_color),
    signature_name      = NULLIF(p_data->>'signature_name', ''),
    signature_title     = COALESCE(NULLIF(p_data->>'signature_title', ''), company_branding.signature_title),
    footer_text         = NULLIF(p_data->>'footer_text', ''),
    updated_at          = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_company_logo(uuid, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public._company_white_label(uuid) TO authenticated, anon;

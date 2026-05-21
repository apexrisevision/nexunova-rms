-- =====================================================================
-- 008 — RLS helper functions
-- =====================================================================
CREATE OR REPLACE FUNCTION public.current_auth_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$ SELECT auth.uid(); $$;

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT au.id FROM public.app_users au
  WHERE au.auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT pom.organization_id FROM public.platform_organization_members pom
  WHERE pom.auth_user_id = auth.uid() AND pom.status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_organization_members
    WHERE organization_id = p_org AND auth_user_id = auth.uid() AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_organization_members
    WHERE organization_id = p_org AND auth_user_id = auth.uid()
      AND status = 'active' AND role IN ('owner','admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_nexunova_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE auth_user_id = auth.uid() AND is_super_admin = true AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(p_org uuid, p_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_organization_members
    WHERE organization_id = p_org AND auth_user_id = auth.uid()
      AND status = 'active' AND role = p_role
  );
$$;

GRANT EXECUTE ON FUNCTION
  public.current_auth_user_id(), public.current_app_user_id(),
  public.current_user_org_ids(), public.is_org_member(uuid),
  public.is_org_admin(uuid), public.is_nexunova_staff(),
  public.has_org_role(uuid, text)
TO authenticated, anon;

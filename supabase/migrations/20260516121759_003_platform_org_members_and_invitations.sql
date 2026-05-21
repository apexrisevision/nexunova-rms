-- =====================================================================
-- 003 — platform_organization_members + platform_invitations
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.platform_organization_members (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  auth_user_id      uuid,
  role              text        NOT NULL,
  status            text        NOT NULL DEFAULT 'active',
  invited_by        uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  invited_at        timestamptz,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_active_at    timestamptz,
  permissions       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pom_role_chk   CHECK (role IN ('owner','admin','manager','rep','readonly')),
  CONSTRAINT pom_status_chk CHECK (status IN ('active','invited','suspended')),
  CONSTRAINT pom_unique_user_per_org UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS pom_user_idx       ON public.platform_organization_members(user_id);
CREATE INDEX IF NOT EXISTS pom_auth_user_idx  ON public.platform_organization_members(auth_user_id);
CREATE INDEX IF NOT EXISTS pom_org_status_idx ON public.platform_organization_members(organization_id, status);

CREATE TRIGGER trg_pom_updated_at
  BEFORE UPDATE ON public.platform_organization_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public._trg_pom_sync_auth_user_id()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.auth_user_id IS NULL THEN
    SELECT auth_user_id INTO NEW.auth_user_id
    FROM public.app_users WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_pom_fill_auth_user_id ON public.platform_organization_members;
CREATE TRIGGER trg_pom_fill_auth_user_id
  BEFORE INSERT OR UPDATE OF user_id ON public.platform_organization_members
  FOR EACH ROW EXECUTE FUNCTION public._trg_pom_sync_auth_user_id();

-- Backfill: every existing app_users row becomes a member of its company
INSERT INTO public.platform_organization_members (
  organization_id, user_id, auth_user_id, role, status, joined_at
)
SELECT au.company_id, au.id, au.auth_user_id, au.role, au.status, COALESCE(au.created_at, now())
FROM   public.app_users au
WHERE  au.status = 'active'
  AND  NOT EXISTS (
    SELECT 1 FROM public.platform_organization_members p
    WHERE  p.organization_id = au.company_id AND p.user_id = au.id
  );

CREATE OR REPLACE FUNCTION public._trg_app_users_mirror_to_pom()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.platform_organization_members (
      organization_id, user_id, auth_user_id, role, status, joined_at
    ) VALUES (
      NEW.company_id, NEW.id, NEW.auth_user_id, NEW.role, NEW.status, COALESCE(NEW.created_at, now())
    )
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.platform_organization_members
    SET    role         = NEW.role,
           status       = NEW.status,
           auth_user_id = NEW.auth_user_id,
           updated_at   = now()
    WHERE  organization_id = NEW.company_id AND user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_app_users_mirror_pom ON public.app_users;
CREATE TRIGGER trg_app_users_mirror_pom
  AFTER INSERT OR UPDATE OF role, status, auth_user_id ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public._trg_app_users_mirror_to_pom();

CREATE TABLE IF NOT EXISTS public.platform_invitations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email             text        NOT NULL,
  role              text        NOT NULL,
  token             text        NOT NULL UNIQUE,
  invited_by        uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  invited_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at       timestamptz,
  accepted_user_id  uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  revoked_at        timestamptz,
  resend_count      int         NOT NULL DEFAULT 0,
  last_sent_at      timestamptz,
  message           text,
  CONSTRAINT inv_role_chk CHECK (role IN ('owner','admin','manager','rep','readonly')),
  CONSTRAINT inv_email_chk CHECK (position('@' in email) > 1)
);

CREATE INDEX IF NOT EXISTS inv_org_email_idx ON public.platform_invitations(organization_id, LOWER(email));
CREATE INDEX IF NOT EXISTS inv_pending_idx   ON public.platform_invitations(organization_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;

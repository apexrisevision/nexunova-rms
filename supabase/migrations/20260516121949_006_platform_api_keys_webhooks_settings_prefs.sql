-- =====================================================================
-- 006 — api_keys, webhooks, settings, user_preferences
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.platform_api_keys (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  key_prefix      text        NOT NULL,
  key_hash        text        NOT NULL,
  scopes          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  rate_limit_per_minute int   NOT NULL DEFAULT 60,
  last_used_at    timestamptz,
  last_used_ip    inet,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  created_by      uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pak_org_idx    ON public.platform_api_keys(organization_id);
CREATE INDEX IF NOT EXISTS pak_prefix_idx ON public.platform_api_keys(key_prefix);

CREATE TABLE IF NOT EXISTS public.platform_webhooks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  url             text        NOT NULL,
  events          text[]      NOT NULL,
  secret_hash     text        NOT NULL,
  active          boolean     NOT NULL DEFAULT true,
  last_delivery_at      timestamptz,
  last_status_code      int,
  last_error_message    text,
  consecutive_failures  int   NOT NULL DEFAULT 0,
  created_by      uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pwh_org_idx ON public.platform_webhooks(organization_id);

CREATE TRIGGER trg_pwh_updated_at
  BEFORE UPDATE ON public.platform_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  setting_key     text        NOT NULL,
  setting_value   jsonb       NOT NULL,
  category        text        NOT NULL DEFAULT 'general',
  updated_by      uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ps_unique UNIQUE (organization_id, setting_key)
);
CREATE TRIGGER trg_ps_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_user_preferences (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  organization_id uuid        REFERENCES public.companies(id) ON DELETE CASCADE,
  preference_key  text        NOT NULL,
  preference_value jsonb      NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pup_user_org_key_unique
  ON public.platform_user_preferences (user_id, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), preference_key);
CREATE TRIGGER trg_pup_updated_at
  BEFORE UPDATE ON public.platform_user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

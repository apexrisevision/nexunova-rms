-- =====================================================================
-- 005 — platform_email_templates + platform_email_log + platform_notifications
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.platform_email_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        REFERENCES public.companies(id) ON DELETE CASCADE,
  template_key    text        NOT NULL,
  subject         text        NOT NULL,
  body_html       text        NOT NULL,
  body_text       text,
  variables       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  category        text        NOT NULL DEFAULT 'transactional',
  active          boolean     NOT NULL DEFAULT true,
  created_by      uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pet_global_key_unique
  ON public.platform_email_templates (template_key) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pet_org_key_unique
  ON public.platform_email_templates (organization_id, template_key) WHERE organization_id IS NOT NULL;

CREATE TRIGGER trg_pet_updated_at
  BEFORE UPDATE ON public.platform_email_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_email_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        REFERENCES public.companies(id) ON DELETE CASCADE,
  to_email        text        NOT NULL,
  to_user_id      uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  from_email      text        NOT NULL DEFAULT 'noreply@nexunova.com',
  reply_to        text,
  subject         text        NOT NULL,
  template_key    text,
  variables       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status          text        NOT NULL DEFAULT 'queued',
  provider        text        NOT NULL DEFAULT 'resend',
  provider_message_id text,
  sent_at         timestamptz,
  delivered_at    timestamptz,
  opened_at       timestamptz,
  clicked_at      timestamptz,
  bounced_at      timestamptz,
  complained_at   timestamptz,
  error_message   text,
  category        text        NOT NULL DEFAULT 'transactional',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pel_status_chk CHECK (status IN ('queued','sent','delivered','bounced','complained','failed'))
);

CREATE INDEX IF NOT EXISTS pel_org_idx      ON public.platform_email_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pel_to_email_idx ON public.platform_email_log(LOWER(to_email), created_at DESC);
CREATE INDEX IF NOT EXISTS pel_status_idx   ON public.platform_email_log(status);
CREATE INDEX IF NOT EXISTS pel_provider_id_idx
  ON public.platform_email_log(provider, provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.platform_notifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  type            text        NOT NULL,
  title           text        NOT NULL,
  body            text,
  action_url      text,
  action_label    text,
  icon            text,
  priority        text        NOT NULL DEFAULT 'normal',
  read_at         timestamptz,
  dismissed_at    timestamptz,
  expires_at      timestamptz,
  data            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pn_unread_idx
  ON public.platform_notifications(organization_id, user_id, created_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS pn_user_idx ON public.platform_notifications(user_id, created_at DESC);

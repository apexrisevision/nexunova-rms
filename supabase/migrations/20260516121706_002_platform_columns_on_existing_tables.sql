-- =====================================================================
-- 002 — Add spec-required platform columns to existing tables
-- =====================================================================
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS slug             text,
  ADD COLUMN IF NOT EXISTS brand_color      text         NOT NULL DEFAULT '#6C63FF',
  ADD COLUMN IF NOT EXISTS team_size_range  text,
  ADD COLUMN IF NOT EXISTS industry_tags    text[]       NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS signup_source    text,
  ADD COLUMN IF NOT EXISTS timezone         text         NOT NULL DEFAULT 'Asia/Karachi',
  ADD COLUMN IF NOT EXISTS currency         text         NOT NULL DEFAULT 'PKR',
  ADD COLUMN IF NOT EXISTS owner_user_id    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at     timestamptz,
  ADD COLUMN IF NOT EXISTS suspension_reason text;

UPDATE public.companies SET slug = LOWER(company_code) WHERE slug IS NULL;
ALTER TABLE public.companies ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS companies_slug_unique
  ON public.companies (LOWER(slug)) WHERE deleted_at IS NULL;

UPDATE public.companies c
SET    owner_user_id = (
  SELECT id FROM public.app_users
  WHERE  company_id = c.id AND role = 'owner' AND status = 'active'
  ORDER BY created_at ASC LIMIT 1
)
WHERE  c.owner_user_id IS NULL;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS product            text,
  ADD COLUMN IF NOT EXISTS tier               text,
  ADD COLUMN IF NOT EXISTS legacy_plan_name   text,
  ADD COLUMN IF NOT EXISTS trial_started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS discount_percent   numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method     text;

UPDATE public.subscriptions s
SET    product = COALESCE(s.product, 'rms'),
       tier    = COALESCE(s.tier, CASE sp.plan_code
                  WHEN 'free_trial'        THEN 'trial'
                  WHEN 'basic_monthly'     THEN 'starter'
                  WHEN 'basic_yearly'      THEN 'starter'
                  WHEN 'pro_monthly'       THEN 'professional'
                  WHEN 'pro_yearly'        THEN 'professional'
                  WHEN 'ultimate_monthly'  THEN 'enterprise'
                  WHEN 'ultimate_yearly'   THEN 'enterprise'
                  WHEN 'enterprise'        THEN 'enterprise'
                  ELSE 'starter'
                END),
       legacy_plan_name = COALESCE(s.legacy_plan_name, sp.plan_name),
       trial_started_at = COALESCE(s.trial_started_at, s.current_period_start)
FROM   public.subscription_plans sp
WHERE  sp.id = s.plan_id;

ALTER TABLE public.subscriptions
  ALTER COLUMN product SET NOT NULL,
  ALTER COLUMN tier    SET NOT NULL;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_product_chk CHECK (product IN ('rms','crm')) NOT VALID;
ALTER TABLE public.subscriptions VALIDATE CONSTRAINT subscriptions_product_chk;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_tier_chk CHECK (tier IN ('trial','starter','professional','enterprise')) NOT VALID;
ALTER TABLE public.subscriptions VALIDATE CONSTRAINT subscriptions_tier_chk;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_per_product
  ON public.subscriptions (company_id, product)
  WHERE status IN ('trialing','active','past_due','pending_payment','payment_under_review');

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pdf_storage_path  text,
  ADD COLUMN IF NOT EXISTS line_items        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tax_amount        numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_at           timestamptz,
  ADD COLUMN IF NOT EXISTS voided_at         timestamptz,
  ADD COLUMN IF NOT EXISTS product           text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='invoices' AND column_name='subscription_id'
  ) THEN
    UPDATE public.invoices i
    SET    product = COALESCE(i.product, s.product)
    FROM   public.subscriptions s
    WHERE  s.id = i.subscription_id AND i.product IS NULL;
  END IF;
END $$;

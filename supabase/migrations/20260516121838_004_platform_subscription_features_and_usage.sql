-- =====================================================================
-- 004 — platform_subscription_features + platform_subscription_usage
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.platform_subscription_features (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tier          text        NOT NULL,
  product       text        NOT NULL,
  feature_key   text        NOT NULL,
  feature_value jsonb       NOT NULL,
  display_label text,
  display_order int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT psf_tier_chk    CHECK (tier IN ('trial','starter','professional','enterprise')),
  CONSTRAINT psf_product_chk CHECK (product IN ('rms','crm')),
  CONSTRAINT psf_unique      UNIQUE (tier, product, feature_key)
);

CREATE INDEX IF NOT EXISTS psf_lookup_idx ON public.platform_subscription_features (tier, product);

CREATE TRIGGER trg_psf_updated_at
  BEFORE UPDATE ON public.platform_subscription_features
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_subscription_usage (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product         text        NOT NULL,
  metric          text        NOT NULL,
  current_value   numeric     NOT NULL DEFAULT 0,
  limit_value     numeric,
  period_start    timestamptz,
  period_end      timestamptz,
  last_updated    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT psu_product_chk CHECK (product IN ('rms','crm')),
  CONSTRAINT psu_unique      UNIQUE (organization_id, product, metric)
);

CREATE INDEX IF NOT EXISTS psu_org_idx  ON public.platform_subscription_usage(organization_id);
CREATE INDEX IF NOT EXISTS psu_near_limit_idx
  ON public.platform_subscription_usage(organization_id, product)
  WHERE limit_value IS NOT NULL AND current_value >= limit_value * 0.9;

CREATE OR REPLACE FUNCTION public.get_feature_value(
  p_organization_id uuid, p_product text, p_feature_key text
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT psf.feature_value
  FROM   public.platform_subscription_features psf
  JOIN   public.subscriptions s ON s.product = psf.product AND s.tier = psf.tier AND s.company_id = p_organization_id
  WHERE  psf.product  = p_product
    AND  psf.feature_key = p_feature_key
    AND  s.status IN ('trialing','active','past_due','pending_payment','payment_under_review')
  ORDER  BY s.created_at DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.check_subscription_limit(
  p_organization_id uuid, p_product text, p_metric text
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_limit numeric; v_used numeric; v_value jsonb;
BEGIN
  v_value := public.get_feature_value(p_organization_id, p_product, p_metric);
  IF v_value IS NULL THEN
    RETURN jsonb_build_object('can_add', true, 'current', 0, 'limit', NULL);
  END IF;
  v_limit := CASE
    WHEN jsonb_typeof(v_value) = 'number' THEN (v_value)::text::numeric
    WHEN v_value ? 'limit' THEN (v_value->>'limit')::numeric
    ELSE NULL END;
  SELECT COALESCE(current_value, 0) INTO v_used
  FROM   public.platform_subscription_usage
  WHERE  organization_id = p_organization_id AND product = p_product AND metric = p_metric;
  v_used := COALESCE(v_used, 0);
  RETURN jsonb_build_object(
    'can_add', (v_limit IS NULL OR v_used < v_limit),
    'current', v_used, 'limit', v_limit,
    'soft_at', CASE WHEN v_value ? 'soft_at' THEN (v_value->>'soft_at')::numeric ELSE NULL END);
END;
$$;

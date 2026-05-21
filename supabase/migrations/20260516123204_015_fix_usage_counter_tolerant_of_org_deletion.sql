-- =====================================================================
-- 015 — Make _increment_usage tolerant of org cascade-deletion
-- =====================================================================
-- During DELETE CASCADE from companies, app_users/projects/etc. fire their
-- "decrement counter" triggers AFTER the company row is gone. The upsert
-- into platform_subscription_usage then fails on the FK. Silently skip
-- when the org is being torn down.
CREATE OR REPLACE FUNCTION public._increment_usage(
  p_organization_id uuid,
  p_product         text,
  p_metric          text,
  p_delta           numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_organization_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.platform_subscription_usage
         (organization_id, product, metric, current_value, last_updated)
  VALUES (p_organization_id, p_product, p_metric, GREATEST(p_delta, 0), now())
  ON CONFLICT (organization_id, product, metric)
  DO UPDATE
    SET current_value = GREATEST(0, public.platform_subscription_usage.current_value + p_delta),
        last_updated  = now();
END;
$$;

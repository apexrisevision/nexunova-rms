-- =====================================================================
-- 011 — Attach audit triggers to platform tables + usage counter triggers
-- =====================================================================
DROP TRIGGER IF EXISTS audit_trg ON public.platform_organization_members;
CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON public.platform_organization_members
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

DROP TRIGGER IF EXISTS audit_trg ON public.platform_invitations;
CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON public.platform_invitations
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

DROP TRIGGER IF EXISTS audit_trg ON public.platform_api_keys;
CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON public.platform_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

DROP TRIGGER IF EXISTS audit_trg ON public.platform_webhooks;
CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON public.platform_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

DROP TRIGGER IF EXISTS audit_trg ON public.platform_settings;
CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE OR REPLACE FUNCTION public._increment_usage(
  p_organization_id uuid, p_product text, p_metric text, p_delta numeric
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.platform_subscription_usage
         (organization_id, product, metric, current_value, last_updated)
  VALUES (p_organization_id, p_product, p_metric, GREATEST(p_delta, 0), now())
  ON CONFLICT (organization_id, product, metric)
  DO UPDATE SET current_value = GREATEST(0, public.platform_subscription_usage.current_value + p_delta),
                last_updated  = now();
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_count_rms_metric()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_metric text;
BEGIN
  v_metric := TG_ARGV[0];
  IF TG_OP = 'INSERT' THEN
    IF (NEW.status IS NULL OR NEW.status = 'active') THEN
      PERFORM public._increment_usage(NEW.company_id, 'rms', v_metric, 1);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF (OLD.status IS NULL OR OLD.status = 'active') THEN
      PERFORM public._increment_usage(OLD.company_id, 'rms', v_metric, -1);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (OLD.status = 'active') AND (NEW.status IS DISTINCT FROM 'active') THEN
      PERFORM public._increment_usage(NEW.company_id, 'rms', v_metric, -1);
    ELSIF (OLD.status IS DISTINCT FROM 'active') AND (NEW.status = 'active') THEN
      PERFORM public._increment_usage(NEW.company_id, 'rms', v_metric, 1);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_count_users ON public.app_users;
CREATE TRIGGER trg_count_users
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public._trg_count_rms_metric('users');

DROP TRIGGER IF EXISTS trg_count_projects ON public.projects;
CREATE TRIGGER trg_count_projects
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public._trg_count_rms_metric('projects');

DROP TRIGGER IF EXISTS trg_count_clients ON public.clients;
CREATE TRIGGER trg_count_clients
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._trg_count_rms_metric('clients');

DROP TRIGGER IF EXISTS trg_count_agents ON public.agents;
CREATE TRIGGER trg_count_agents
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public._trg_count_rms_metric('agents');

CREATE OR REPLACE FUNCTION public._trg_count_units()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._increment_usage(NEW.company_id, 'rms', 'units', 1);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public._increment_usage(OLD.company_id, 'rms', 'units', -1);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_count_units ON public.units;
CREATE TRIGGER trg_count_units
  AFTER INSERT OR DELETE ON public.units
  FOR EACH ROW EXECUTE FUNCTION public._trg_count_units();

CREATE OR REPLACE FUNCTION public._trg_init_subscription_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT psf.feature_key, psf.feature_value
    FROM public.platform_subscription_features psf
    WHERE psf.tier = NEW.tier AND psf.product = NEW.product AND psf.feature_key LIKE 'max_%'
  LOOP
    INSERT INTO public.platform_subscription_usage
           (organization_id, product, metric, current_value, limit_value, period_start, period_end)
    VALUES (NEW.company_id, NEW.product, regexp_replace(r.feature_key, '^max_', ''),
            0,
            CASE WHEN jsonb_typeof(r.feature_value) = 'number' THEN r.feature_value::text::numeric
                 WHEN r.feature_value ? 'limit' THEN (r.feature_value->>'limit')::numeric ELSE NULL END,
            NEW.current_period_start, NEW.current_period_end)
    ON CONFLICT (organization_id, product, metric) DO UPDATE
      SET limit_value = EXCLUDED.limit_value,
          period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_init_sub_usage ON public.subscriptions;
CREATE TRIGGER trg_init_sub_usage
  AFTER INSERT OR UPDATE OF tier, product ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public._trg_init_subscription_usage();

DROP TRIGGER IF EXISTS trg_companies_updated ON public.companies;
CREATE TRIGGER trg_companies_updated
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

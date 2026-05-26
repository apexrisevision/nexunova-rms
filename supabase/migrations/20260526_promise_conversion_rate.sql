-- Module 8.2: Promise-to-payment conversion rate metric

CREATE OR REPLACE FUNCTION public.get_promise_conversion_rate(
  p_company_id  uuid,
  p_window_days integer DEFAULT 7
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_total_kept integer := 0;
  v_converted  integer := 0;
  v_avg_days   numeric := 0;
  v_rate       numeric := 0;
BEGIN
  -- Total kept promises in last 180 days
  SELECT COUNT(*) INTO v_total_kept
  FROM public.payment_promises pp
  WHERE pp.company_id = p_company_id
    AND pp.status      = 'kept'
    AND pp.updated_at >= now() - interval '180 days';

  -- Of those kept promises: how many had a verified payment within window_days of the promise date?
  SELECT
    COUNT(DISTINCT pp.id),
    AVG(EXTRACT(EPOCH FROM (py.created_at - pp.promise_date::timestamptz)) / 86400.0)
  INTO v_converted, v_avg_days
  FROM public.payment_promises pp
  JOIN public.payments py
    ON  py.client_id   = pp.client_id
    AND py.company_id  = pp.company_id
    AND py.created_at::date >= pp.promise_date
    AND py.created_at::date <= pp.promise_date + p_window_days
    AND py.status IN ('confirmed', 'cleared', 'verified', 'received')
  WHERE pp.company_id = p_company_id
    AND pp.status      = 'kept'
    AND pp.updated_at >= now() - interval '180 days';

  IF v_total_kept > 0 THEN
    v_rate := ROUND((COALESCE(v_converted, 0)::numeric / v_total_kept) * 100.0, 1);
  END IF;

  RETURN jsonb_build_object(
    'total_kept',      v_total_kept,
    'converted',       COALESCE(v_converted, 0),
    'rate',            COALESCE(v_rate, 0),
    'avg_days_to_pay', ROUND(COALESCE(v_avg_days, 0)::numeric, 1),
    'window_days',     p_window_days
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_promise_conversion_rate(uuid, integer) TO authenticated, anon;

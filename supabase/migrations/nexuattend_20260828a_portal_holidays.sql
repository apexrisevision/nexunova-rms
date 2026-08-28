-- ══ NexuAttend project — the company calendar for the employee portal ═══════
-- Applied to the NexuAttend Supabase project, not RMS. Kept here so the pair
-- can be read together; the bridge calls it.
--
-- 24 holidays were already recorded and no employee had ever been able to see
-- one. The ESS dashboard wants the next one and the Leave page wants the whole
-- year, so both come from this — one reader, not two.
CREATE OR REPLACE FUNCTION public.portal_holidays(p_secret text, p_company uuid, p_year int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_year int := COALESCE(p_year, EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Karachi'))::int);
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
BEGIN
  IF NOT public.portal_secret_ok(p_secret) THEN
    RETURN jsonb_build_object('error', 'bad_secret');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'year', v_year,
    'today', v_today,
    'holidays', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'name', h.name,
               'date', h.holiday_date,
               'optional', COALESCE(h.is_optional, false),
               'days_away', (h.holiday_date - v_today))
             ORDER BY h.holiday_date)
        FROM public.holidays h
       WHERE h.company_id = p_company
         AND EXTRACT(YEAR FROM h.holiday_date)::int = v_year), '[]'::jsonb),
    'next', (
      SELECT jsonb_build_object('name', h.name, 'date', h.holiday_date,
                                'optional', COALESCE(h.is_optional, false),
                                'days_away', (h.holiday_date - v_today))
        FROM public.holidays h
       WHERE h.company_id = p_company AND h.holiday_date >= v_today
       ORDER BY h.holiday_date LIMIT 1));
END $function$;

REVOKE ALL ON FUNCTION public.portal_holidays(text, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_holidays(text, uuid, int) TO anon;

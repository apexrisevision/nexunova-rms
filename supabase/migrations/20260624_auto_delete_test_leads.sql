-- ════════════════════════════════════════════════════════════════════════════
-- AUTO-DELETE TEST LEADS — "Send a test lead" buttons (Website/WhatsApp/Instagram)
-- post a _nx_test sentinel; the intake Edge Functions then set leads.is_test=true
-- on the created lead. A cron job deletes ONLY is_test leads older than 5 minutes.
-- Real leads always have is_test=false → never touched (verified: a 6-min-old real
-- lead survived cleanup; only the is_test one was removed).
-- (Applied live via MCP 2026-06-24; this file is the repo record.)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_leads_is_test ON public.leads(is_test) WHERE is_test;

CREATE OR REPLACE FUNCTION public.cleanup_test_leads()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[]; v_n int;
BEGIN
  SELECT array_agg(id) INTO v_ids
    FROM public.leads
   WHERE is_test = true AND created_at < now() - interval '5 minutes';
  IF v_ids IS NULL THEN RETURN 0; END IF;
  DELETE FROM public.lead_activities  WHERE lead_id = ANY(v_ids);
  DELETE FROM public.lead_assignments WHERE lead_id = ANY(v_ids);
  DELETE FROM public.lead_views       WHERE lead_id = ANY(v_ids);
  DELETE FROM public.leads WHERE id = ANY(v_ids) AND is_test = true;   -- belt-and-suspenders
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $function$;

-- run every 2 minutes (deletes test leads 5–7 min after they were created)
DO $$ BEGIN PERFORM cron.unschedule('cleanup_test_leads'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
  PERFORM cron.schedule('cleanup_test_leads', '*/2 * * * *', 'SELECT public.cleanup_test_leads()');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cron schedule failed (schedule manually): %', SQLERRM; END $$;

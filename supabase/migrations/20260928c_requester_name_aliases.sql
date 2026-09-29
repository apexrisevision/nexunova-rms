-- ─────────────────────────────────────────────────────────────────────────────
-- ONE PERSON, ONE NAME ON THE LINK  (2026-09-28)
--
-- "Waqar" and "Waqar landlord" showed on the availability link as two people
-- beside the 114 holds already filed under the agent row "Waqar Landlord"
-- (AGT-2026-0019). Cause: a requester typed as free text — on the desk, or the
-- name a dealer types on a link request that is then approved — was stored as
-- typed, with no agent behind it. Every spelling became a new person.
--
-- Fix, in reserve_unit_desk (the one place every booking goes through, including
-- request approvals and bulk bookings): when no agent / portal member was picked,
-- the typed name is resolved against the unit's company —
--   1. an agent whose full_name matches (case / spacing ignored), else
--   2. a nickname in agent_name_aliases.
-- Exactly one match → the hold is filed under that agent with the agent's own
-- name. No match or more than one → stored as typed, exactly as before.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_name_aliases (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  agent_id   uuid NOT NULL REFERENCES public.agents(id)    ON DELETE CASCADE,
  alias_key  text NOT NULL,          -- _hold_name_key() form: lower, trimmed, single spaces
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, alias_key)
);
ALTER TABLE public.agent_name_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_name_aliases FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._requester_agent_for_name(p_company_id uuid, p_name text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_key text := public._hold_name_key(p_name); v_ids uuid[];
BEGIN
  IF v_key = '' THEN RETURN NULL; END IF;
  SELECT array_agg(id) INTO v_ids FROM public.agents
   WHERE company_id = p_company_id AND public._hold_name_key(full_name) = v_key;
  IF array_length(v_ids,1) = 1 THEN RETURN v_ids[1]; END IF;
  IF array_length(v_ids,1) > 1 THEN RETURN NULL; END IF;       -- two agents, one name: never guess
  SELECT array_agg(agent_id) INTO v_ids FROM public.agent_name_aliases
   WHERE company_id = p_company_id AND alias_key = v_key;
  IF array_length(v_ids,1) = 1 THEN RETURN v_ids[1]; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._requester_agent_for_name(uuid, text) FROM PUBLIC, anon, authenticated;

DO $mig$
DECLARE v_def text; r record;
BEGIN
  SELECT pg_get_functiondef('public.reserve_unit_desk(text,uuid,uuid,uuid,text,text,text,integer,boolean,numeric,text,uuid)'::regprocedure)
    INTO v_def;
  IF position('_requester_agent_for_name' IN v_def) > 0 THEN RETURN; END IF;   -- re-runnable
  FOR r IN SELECT * FROM (VALUES
    (E'        v_tag public.category_unit_statuses;\nBEGIN',
     E'        v_tag public.category_unit_statuses;\n        v_agent_id uuid;\nBEGIN'),
    (E'  INSERT INTO public.reservations\n',
     E'  /* A typed name is filed under the agent it belongs to (full name or a\n' ||
     E'     nickname in agent_name_aliases), so one person is one name on the link. */\n' ||
     E'  v_agent_id := p_requested_by_agent_id;\n' ||
     E'  IF v_agent_id IS NULL AND p_requested_by_sales_user_id IS NULL THEN\n' ||
     E'    v_agent_id := public._requester_agent_for_name(v_unit.company_id, v_rname);\n' ||
     E'    IF v_agent_id IS NOT NULL THEN\n' ||
     E'      SELECT full_name INTO v_rname FROM public.agents WHERE id = v_agent_id; END IF;\n' ||
     E'  END IF;\n\n' ||
     E'  INSERT INTO public.reservations\n'),
    (E'     p_requested_by_agent_id, p_requested_by_sales_user_id, v_rname,',
     E'     v_agent_id, p_requested_by_sales_user_id, v_rname,')
  ) AS t(a, b) LOOP
    IF (length(v_def) - length(replace(v_def, r.a, ''))) / length(r.a) <> 1 THEN
      RAISE EXCEPTION 'anchor not found exactly once: %', left(r.a, 60); END IF;
    v_def := replace(v_def, r.a, r.b);
  END LOOP;
  EXECUTE v_def;
END $mig$;

-- ── Waqar: one person ──────────────────────────────────────────────────────
INSERT INTO public.agent_name_aliases (company_id, agent_id, alias_key)
SELECT a.company_id, a.id, k FROM public.agents a, unnest(ARRAY['waqar']) k
 WHERE a.id = '9b1c7cd6-55b4-442e-8219-36be10bff8cd'
ON CONFLICT (company_id, alias_key) DO NOTHING;

UPDATE public.reservations
   SET requested_by_agent_id = '9b1c7cd6-55b4-442e-8219-36be10bff8cd',
       requested_by_name = 'Waqar Landlord', updated_at = now()
 WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'
   AND requested_by_agent_id IS NULL AND requested_by_sales_user_id IS NULL
   AND public._hold_name_key(requested_by_name) IN ('waqar', 'waqar landlord');

UPDATE public.availability_requests
   SET requested_by_name = 'Waqar Landlord'
 WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'
   AND public._hold_name_key(requested_by_name) IN ('waqar', 'waqar landlord')
   AND requested_by_name <> 'Waqar Landlord';

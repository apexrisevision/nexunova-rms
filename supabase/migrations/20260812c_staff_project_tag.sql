-- 2026-08-12 — Staff project tag (owner-approved, LABEL ONLY)
--
-- Problem: two people named "Fawad khan" (one works FMH, one KBH) look identical in
-- every staff list, and a wrong pick already caused a real mis-attribution.
-- Every sales_user has project_id = NULL (umbrella-wide) and there is no other
-- marker, so the tag has to be stored explicitly.
--
-- DELIBERATE: this is a DISPLAY tag only. sales_users.project_id is untouched, so
-- nobody's availability board, lead creation or reservation scope changes
-- (those read sales_sessions.project_id, which comes from project_id, not this).

ALTER TABLE public.projects    ADD COLUMN IF NOT EXISTS short_code text;
ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS home_project_id uuid REFERENCES public.projects(id);

COMMENT ON COLUMN public.sales_users.home_project_id IS
  'Display-only: which project this staff member belongs to. Shown as a tag next to their name. Does NOT scope anything — that is project_id.';
COMMENT ON COLUMN public.projects.short_code IS
  'Short label for UI tags (e.g. KBH, FMH). Falls back to project_name when null.';

-- short labels for the Fourteen Group projects
UPDATE public.projects SET short_code='KBH'   WHERE id='7f70ba90-130e-42b5-801b-4c9bafa82975' AND short_code IS DISTINCT FROM 'KBH';
UPDATE public.projects SET short_code='FMH'   WHERE id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND short_code IS DISTINCT FROM 'FMH';
UPDATE public.projects SET short_code='Awami' WHERE id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND short_code IS DISTINCT FROM 'Awami';

-- ── helper: "Fawad khan · FMH" (plain name when no tag is set) ───────────────
CREATE OR REPLACE FUNCTION public._su_label(p_sales_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT su.full_name ||
         COALESCE(' · ' || NULLIF(COALESCE(p.short_code, p.project_name),''), '')
    FROM public.sales_users su
    LEFT JOIN public.projects p ON p.id = su.home_project_id
   WHERE su.id = p_sales_user_id;
$function$;

REVOKE ALL ON FUNCTION public._su_label(uuid) FROM PUBLIC, anon;

-- ── seed the three we can prove from their own work ─────────────────────────
UPDATE public.sales_users SET home_project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855'  -- FMH
 WHERE id IN ('671a586d-0502-4e80-bdca-6ab564607a16',   -- Fayaz Bangash  (22 FMH sales)
              '1309ed37-a438-406c-882c-2965e2402a99');  -- Fawad khan 0300-9025113 (2 FMH sales)
UPDATE public.sales_users SET home_project_id='7f70ba90-130e-42b5-801b-4c9bafa82975'  -- KBH
 WHERE id = '7a89dec1-af53-40a6-817f-e2a6d2db23b6';     -- IQRA (3 KBH leads)

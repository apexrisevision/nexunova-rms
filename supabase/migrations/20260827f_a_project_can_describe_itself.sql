-- ============================================================================
-- A project can describe itself.
-- ----------------------------------------------------------------------------
-- The projects table holds what the business runs on: units, dates, area, the
-- numbers that receipts and reports are built from. It is deliberately not
-- touched here. What it has never held is what a person actually asks about a
-- building — how far the motorway is, how tall the ceilings are, whether there
-- is a mosque, how wide the corridor outside the door is.
--
-- That lives here instead, in one jsonb per project, read by the portal and by
-- nothing else. Keeping it out of projects means the owner can rewrite the
-- description of a building a hundred times without a single figure that a
-- receipt depends on moving.
--
-- Scope is the dealer group, which is the same rule the availability board
-- already uses: Awami Market, FMH and Fourteen Group of companies share one
-- group, so a person signed into the portal sees the group's projects and not
-- somebody else's.
--
-- The content below is Khushal Bagh Heights as its owner dictated it on
-- 2026-08-27. It is transcribed, not authored: figures, spellings of places and
-- the amenity list are his. Two things he said were ambiguous and are therefore
-- written exactly as given rather than resolved — the number of basement levels
-- ("2 basement car parking" against "2 floor car parking basement + ground
-- floor"), and the apartment total, which is left uncomputed because 30 a floor
-- with two floors of 26 does not obviously land on the 260 that projects.total_
-- units carries. Both were put back to him.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.project_profile (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  profile    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

COMMENT ON TABLE public.project_profile IS
  'What a project is like, for the portal to show. Never what it is worth - money and counts stay in projects/units.';

ALTER TABLE public.project_profile ENABLE ROW LEVEL SECURITY;
-- No policy: nothing reaches this table except the SECURITY DEFINER reader
-- below, which is the only thing that should.

INSERT INTO public.project_profile (project_id, profile)
SELECT p.id, $j${
  "headline": "Khushal Bagh Heights",
  "sub": "Warsak Road, Peshawar",
  "landowner": "Arbab Firdus",
  "builder": "14 Group of Companies",
  "highlights": [
    { "icon": "calendar", "label": "Started",  "value": "January 2024" },
    { "icon": "flag",     "label": "Delivery", "value": "30 June 2027" },
    { "icon": "ruler",    "label": "Height",   "value": "125 ft" },
    { "icon": "layers",   "label": "Land",     "value": "88 marla" }
  ],
  "sections": [
    {
      "key": "location", "icon": "map-pin", "title": "Location",
      "sub": "Warsak Road, Babu Ghari Stop",
      "items": [
        { "icon": "map-pin",  "title": "Address",           "detail": "Warsak Road, Babu Ghari Stop, opposite Khushal Bagh Park, Peshawar" },
        { "icon": "compass",  "title": "Link Road",         "detail": "Nearby" },
        { "icon": "car",      "title": "Peshawar Motorway", "detail": "10 minutes away" },
        { "icon": "car",      "title": "Ring Road",         "detail": "4 to 5 minutes away" },
        { "icon": "car",      "title": "Shami Road",        "detail": "8 to 10 minutes away" },
        { "icon": "droplet",  "title": "Canal",             "detail": "The project stands 20 feet back from the canal" }
      ]
    },
    {
      "key": "apartments", "icon": "home", "title": "Apartments",
      "sub": "Studio, one bed, two bed, three bed",
      "items": [
        { "icon": "home", "title": "Studio",    "detail": "100 sq ft of car parking with each" },
        { "icon": "home", "title": "One bed",   "detail": "100 sq ft of car parking with each" },
        { "icon": "home", "title": "Two bed",   "detail": "200 sq ft of car parking with each" },
        { "icon": "home", "title": "Three bed", "detail": "200 sq ft of car parking with each" }
      ]
    },
    {
      "key": "floors", "icon": "layers", "title": "Floors",
      "sub": "Basement and ground for parking, apartments above",
      "items": [
        { "icon": "car",    "title": "Basement",              "detail": "Car parking. Floor height 9 ft" },
        { "icon": "store",  "title": "Ground floor",          "detail": "Car parking, 7 commercial shops and one mart. Floor height 12 ft" },
        { "icon": "layers", "title": "Upper ground to 9th",   "detail": "Apartments. Floor height 11 ft each" },
        { "icon": "home",   "title": "Apartments per floor",  "detail": "30 on each floor, except the 3rd and the 6th which have 26 each" }
      ]
    },
    {
      "key": "structure", "icon": "ruler", "title": "Plot and structure",
      "sub": "88 marla, 74 marla covered",
      "items": [
        { "icon": "ruler",  "title": "Frontage",      "detail": "220 ft front, 220 ft back, 91 ft on each side" },
        { "icon": "layers", "title": "Area",          "detail": "Total 88 marla. Covered area 74 marla" },
        { "icon": "anchor", "title": "Raft",          "detail": "4 ft from the natural surface level" },
        { "icon": "ruler",  "title": "Total height",  "detail": "125 ft" },
        { "icon": "anchor", "title": "Piling",        "detail": "162 piles across the project" },
        { "icon": "columns","title": "Columns",       "detail": "50 columns, in three sizes including 2.6 x 2.6 and 3.9 x 3.6" }
      ]
    },
    {
      "key": "corridors", "icon": "corridor", "title": "Corridors",
      "sub": "Main corridor 7 ft",
      "items": [
        { "icon": "corridor", "title": "Main corridor",        "detail": "7 ft" },
        { "icon": "corridor", "title": "Ring Road side",       "detail": "6.6 ft" },
        { "icon": "corridor", "title": "Shami Road side",      "detail": "6.6 ft" },
        { "icon": "corridor", "title": "Park facing apartments","detail": "6.8 ft and 10.6 ft" }
      ]
    },
    {
      "key": "lifts", "icon": "elevator", "title": "Lifts",
      "sub": "Two lifts, 10 x 7 each",
      "items": [
        { "icon": "elevator", "title": "Lifts and elevators", "detail": "2 in number, 10 x 7 each" },
        { "icon": "elevator", "title": "Cargo and passenger", "detail": "Both cargo and passenger lifts" }
      ]
    },
    {
      "key": "amenities", "icon": "sparkle", "title": "Amenities",
      "sub": "12 in the building",
      "items": [
        { "icon": "car",       "title": "Two floors of car parking", "detail": "Basement and ground floor" },
        { "icon": "users",     "title": "Hujra",                     "detail": "A hujra for the residents" },
        { "icon": "mosque",    "title": "Mosque",                    "detail": "Inside the project" },
        { "icon": "trash",     "title": "Garbage chute",             "detail": "An individual chute on every floor" },
        { "icon": "zap",       "title": "EV charging station",       "detail": "Charging for electric cars" },
        { "icon": "cctv",      "title": "CCTV and security",         "detail": "Security system throughout" },
        { "icon": "washing",   "title": "Community and laundry room","detail": "Shared community room and laundry" },
        { "icon": "droplet",   "title": "Car wash bay",              "detail": "For residents' cars" },
        { "icon": "dumbbell",  "title": "Fitness gym",               "detail": "In the building" },
        { "icon": "power",     "title": "Backup generators",         "detail": "Standby power" },
        { "icon": "flame",     "title": "Fire fighting system",      "detail": "Fitted through the project" },
        { "icon": "elevator",  "title": "Cargo and passenger lifts", "detail": "Two lifts, 10 x 7 each" }
      ]
    },
    {
      "key": "approvals", "icon": "shield-check", "title": "Approvals and people",
      "sub": "NOC clear, basement to 9th floor",
      "items": [
        { "icon": "shield-check", "title": "NOC",       "detail": "Clear, from the basement to the 9th floor" },
        { "icon": "user",         "title": "Landowner", "detail": "Arbab Firdus" },
        { "icon": "building",     "title": "Builder",   "detail": "14 Group of Companies" },
        { "icon": "calendar",     "title": "Started",   "detail": "January 2024" },
        { "icon": "flag",         "title": "Delivery",  "detail": "30 June 2027" }
      ]
    }
  ]
}$j$::jsonb
FROM public.projects p
WHERE p.short_code = 'KBH'
ON CONFLICT (project_id) DO UPDATE
  SET profile = EXCLUDED.profile, updated_at = now();

-- ── what the portal reads ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_project_profiles(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_group uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;

  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;

  RETURN jsonb_build_object('success', true, 'projects', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'project_id',   p.id,
             'project_name', p.project_name,
             'short_code',   p.short_code,
             'city',         p.city,
             'location',     p.location,
             'status',       p.status,
             'profile',      pp.profile)
           ORDER BY p.project_name)
      FROM public.project_profile pp
      JOIN public.projects  p ON p.id = pp.project_id
      JOIN public.companies c ON c.id = p.company_id
     -- The dealer group, or this company alone when it belongs to no group.
     WHERE (v_group IS NOT NULL AND c.dealer_group_id = v_group)
        OR c.id = v_ses.company_id), '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.get_project_profiles(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_project_profiles(text) TO anon, authenticated, service_role;

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.project_profile;
  IF v_n = 0 THEN RAISE EXCEPTION 'the KBH profile did not land - is short_code KBH still right?'; END IF;
  IF has_function_privilege('public', 'public.get_project_profiles(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_project_profiles is reachable through PUBLIC';
  END IF;
  RAISE NOTICE 'project profiles: %', v_n;
END $$;

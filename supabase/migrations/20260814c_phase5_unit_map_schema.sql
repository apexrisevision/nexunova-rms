-- Phase 5 — Unit Map, part 1: SCHEMA ONLY. No UI, no editor, no data.
--
-- Owner decisions 2026-08-14:
--   * TWO master artworks, not eleven. A = split floors (X-10/X-17 are three units
--     each), B = unsplit (3rd + 6th, where X-17 / X-10 are still one 3-Bed).
--   * Eleven plan rows all the same — each floor takes its inventory from the DB.
--   * Polygons drawn twice, once per artwork.
--   * Only admin/owner may draw. Not director.
--   * Retired parents (X-10 / X-17 on split floors) are never drawn — only their
--     A/B/C children, carried together by zone_group.
--
-- Why geometry hangs off the ARTWORK and not off the plan: eight floors share one
-- shape. Storing it eight times means the day someone nudges a wall on the 4th
-- floor, seven other floors keep the old outline and nobody notices. One artwork,
-- one geometry, eleven floors resolving their own units against it.
--
-- The bridge is slot_code, not unit_id: a shape says "10A", and each floor resolves
-- that to its own unit — '1-10A' on the 1st, 'UG-10A' on Upper Ground. That is what
-- lets one drawing serve eight floors of different inventory.
--
-- This file creates no rows. Nothing appears anywhere until an artwork is uploaded
-- and plans are created, and plans start as 'draft'.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. unit_map_artworks — the image, and the owner of its geometry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.unit_map_artworks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  artwork_key  text NOT NULL,                   -- 'A' (split) | 'B' (unsplit) | 'G' (ground, later)
  name         text NOT NULL,
  image_path   text NOT NULL,                   -- storage bucket 'unit-maps'
  image_w      integer NOT NULL,                -- the artwork's NATURAL pixel size.
  image_h      integer NOT NULL,                -- Shapes are normalised against it.
  version      integer NOT NULL DEFAULT 1,
  created_by   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_map_artworks_dims_chk CHECK (image_w > 0 AND image_h > 0),
  CONSTRAINT unit_map_artworks_key_uq UNIQUE (project_id, artwork_key, version)
);

COMMENT ON TABLE public.unit_map_artworks IS
  'One row per master floor drawing. Geometry lives here, not on the plan, because '
  'several floors share one drawing — storing it per floor guarantees they drift apart.';

-- ---------------------------------------------------------------------------
-- 2. unit_map_plans — one row per floor; says which artwork that floor uses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.unit_map_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id)          ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id)           ON DELETE CASCADE,
  artwork_id   uuid NOT NULL REFERENCES public.unit_map_artworks(id)  ON DELETE RESTRICT,
  floor_label  text NOT NULL,                   -- must match units.floor_label exactly
  floor_no     integer,
  unit_prefix  text NOT NULL,                   -- '1' | 'UG' | 'G' — slot_code joins onto this
  status       text NOT NULL DEFAULT 'draft',   -- draft | published
  published_at timestamptz,
  sort_order   integer NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_map_plans_status_chk CHECK (status IN ('draft','published')),
  CONSTRAINT unit_map_plans_floor_uq   UNIQUE (project_id, floor_label)
);

COMMENT ON COLUMN public.unit_map_plans.unit_prefix IS
  'How this floor names its units. Shape slot "10A" + prefix "1" resolves to unit "1-10A". '
  'This is what lets one artwork serve eight floors of different inventory.';
COMMENT ON COLUMN public.unit_map_plans.status IS
  'draft = admin-only. A half-drawn floor must never reach a sales member.';

-- ---------------------------------------------------------------------------
-- 3. unit_map_shapes — the polygons, in normalised space
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.unit_map_shapes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id)         ON DELETE CASCADE,
  artwork_id  uuid NOT NULL REFERENCES public.unit_map_artworks(id) ON DELETE CASCADE,
  slot_code   text NOT NULL,                    -- '01' | '10A' | '17B'
  points      jsonb NOT NULL,                   -- [[x,y],…] each 0..1
  label_x     numeric,                          -- stored, NOT derived from the centroid:
  label_y     numeric,                          -- an L-shaped unit's centroid falls outside it
  zone_group  text,                             -- '10' or '17' — ties A/B/C children together
  z_index     integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_map_shapes_slot_uq   UNIQUE (artwork_id, slot_code),
  CONSTRAINT unit_map_shapes_points_chk CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) >= 3),
  CONSTRAINT unit_map_shapes_label_chk  CHECK (
    (label_x IS NULL AND label_y IS NULL) OR
    (label_x BETWEEN 0 AND 1 AND label_y BETWEEN 0 AND 1))
);

COMMENT ON COLUMN public.unit_map_shapes.points IS
  'Vertices normalised 0..1 against the artwork''s natural size. Pixel coordinates '
  'would break the moment the drawing is re-exported at another resolution.';

-- ---------------------------------------------------------------------------
-- RLS — deny_all_anon on all three; every read goes through a SECURITY DEFINER RPC
-- ---------------------------------------------------------------------------
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['unit_map_artworks','unit_map_plans','unit_map_shapes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS deny_all_anon ON public.%I', t);
    EXECUTE format('CREATE POLICY deny_all_anon ON public.%I AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_upd ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_upd BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_unit_map_shapes_artwork ON public.unit_map_shapes (artwork_id);
CREATE INDEX IF NOT EXISTS idx_unit_map_plans_project  ON public.unit_map_plans  (project_id, sort_order);

-- ---------------------------------------------------------------------------
-- _map_unit_state — the ONE definition of the three colours
-- ---------------------------------------------------------------------------
-- The legend has three colours. This returns a fourth value, 'retired', used only
-- to refuse to draw a split parent — it never reaches the legend.
--
-- Sold and reserved are read from the same tables the rest of RMS uses. Nothing is
-- cached onto the map, so a sale made in the sales module recolours the map with no
-- sync step, and reservations expire through cron_expire_reservations exactly as
-- they already do.
CREATE OR REPLACE FUNCTION public._map_unit_state(p_unit_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN u.id IS NULL THEN 'unknown'
    WHEN s.status_name = 'Dead / Cancelled' THEN 'retired'
    WHEN EXISTS (SELECT 1 FROM public.sales sl
                  WHERE sl.unit_id = u.id AND sl.status = 'active')            THEN 'sold'
    WHEN EXISTS (SELECT 1 FROM public.reservations r
                  WHERE r.unit_id = u.id AND r.status = 'active'
                    AND (r.expiry_date IS NULL OR r.expiry_date > now()))      THEN 'reserved'
    ELSE 'available'
  END
  FROM public.units u
  LEFT JOIN public.category_unit_statuses s ON s.id = u.status_id
  WHERE u.id = p_unit_id
$$;

COMMENT ON FUNCTION public._map_unit_state(uuid) IS
  'The single definition of a unit''s map colour: sold / reserved / available, plus '
  '"retired" for split parents which are never drawn. Never duplicate this in JS — '
  'a second definition is how a map ends up showing a unit as free that is already sold.';

COMMIT;

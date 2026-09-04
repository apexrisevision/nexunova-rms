-- ═══════════════════════════════════════════════════════════════════════════
-- The sheet gets its own typeface
-- ───────────────────────────────────────────────────────────────────────────
-- daily-closing-pdf embeds Inter when it can read `_assets/Inter-Regular.ttf`
-- and `_assets/Inter-SemiBold.ttf` from the private bucket, and falls back to
-- Helvetica when it cannot. Nothing had ever been put there, so every Director
-- sheet has rendered in Helvetica. Uploading the fonts was refused with
-- `invalid_mime_type`: the bucket's allow-list is jpg/png/pdf/txt.
--
-- This adds ONE type, `font/ttf`, and nothing else.
--
-- WHAT THIS DOES NOT WEAKEN. The allow-list is defence in depth, not the
-- boundary. User uploads go through supabase/functions/daily-closing-file,
-- which independently refuses anything that is not JPG, PNG or PDF —
--
--     const ext = ({ "image/jpeg": "jpg", "image/png": "png",
--                    "application/pdf": "pdf" })[body.mime] ?? null;
--     if (!ext) return json({ error: "INVALID_TRANSITION", … }, 400);
--
-- — and BUILDS THE KEY ITSELF as `${project_id}/${entry_id}/${uuid}.${ext}`,
-- so nothing reaching that door can land under `_assets/` whatever it claims
-- to be. A font can only be written here with the service key, which is the
-- renderer's and the maintenance script's. §A10's "inputs validated at the
-- boundary" is unaffected, and none of the eight invariants is touched.
--
-- The fonts are put in place by `node scripts/upload-inter-fonts.js`, which
-- takes them from the official rsms/inter v4.1 release (SIL OFL 1.1) and
-- uploads the licence text beside them so the bucket carries its own
-- provenance. No redeploy is needed: the next render picks them up.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
         'image/jpeg', 'image/jpg', 'image/png',   -- attachment photos (§A7)
         'application/pdf',                        -- attachment scans, and the Director sheet
         'text/plain',                             -- the font licence
         'font/ttf'                                -- NEW — Inter, read by the renderer only
       ]
 WHERE id = 'daily-closing';

DO $verify$
DECLARE v_types text[]; v_public boolean; v_limit bigint;
BEGIN
  SELECT allowed_mime_types, public, file_size_limit
    INTO v_types, v_public, v_limit
    FROM storage.buckets WHERE id = 'daily-closing';

  IF v_types IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: the daily-closing bucket does not exist';
  END IF;
  IF NOT ('font/ttf' = ANY (v_types)) THEN
    RAISE EXCEPTION 'VERIFY FAILED: font/ttf was not added';
  END IF;

  -- The three that matter for attachments are still there, and nothing else
  -- crept in: exactly six types, no wildcard, and the bucket is still PRIVATE
  -- at its original 10 MB ceiling.
  IF NOT ('image/jpeg' = ANY (v_types) AND 'image/png' = ANY (v_types)
          AND 'application/pdf' = ANY (v_types)) THEN
    RAISE EXCEPTION 'VERIFY FAILED: an attachment type was dropped: %', v_types;
  END IF;
  IF array_length(v_types, 1) <> 6 THEN
    RAISE EXCEPTION 'VERIFY FAILED: expected exactly 6 types, found %: %',
      array_length(v_types, 1), v_types;
  END IF;
  IF '*' = ANY (v_types) OR '*/*' = ANY (v_types) THEN
    RAISE EXCEPTION 'VERIFY FAILED: a wildcard reached the allow-list: %', v_types;
  END IF;
  IF v_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'VERIFY FAILED: the bucket is no longer private';
  END IF;
  IF v_limit IS DISTINCT FROM 10485760 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the size limit moved to %', v_limit;
  END IF;

  RAISE NOTICE 'daily-closing: private, 10 MB, types = %', v_types;
END
$verify$;

COMMIT;

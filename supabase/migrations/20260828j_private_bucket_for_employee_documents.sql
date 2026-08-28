-- ══ Employee documents leave the public bucket ══════════════════════════════
--
-- Leave attachments were being written to rms-documents, which is a PUBLIC
-- bucket: a medical certificate had a permanent address anybody with the link
-- could open. That is not acceptable for a document somebody hands their
-- employer in confidence.
--
-- Two things were wrong, not one:
--
--   THE BUCKET WAS PUBLIC. Fixed by a new bucket with public = false and,
--   deliberately, NO policy of any kind. anon cannot read it, write to it or
--   list it. Every read and every write goes through the bridge with the
--   service key, which knows who is asking.
--
--   THE PATH WAS NOT PERSONAL. The old scheme was leave/<upload token>/, and
--   that token belongs to the COMPANY, not the person — every employee shared
--   one folder. The new path is leave/<sales_user_id>/<uuid>, and the browser
--   never chooses it: it asks the bridge for somewhere to put a file and is
--   handed a path with its own id already in it, signed for a single upload.
--   A download is signed only when the path begins with the caller's own id,
--   so another employee's document is refused rather than merely hard to find.
--
-- Links last two minutes and nothing durable is written into the page.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('employee-private', 'employee-private', false, 5242880,
        ARRAY['image/jpeg','image/jpg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- The anon write path into the public bucket goes with it.
DROP POLICY IF EXISTS leave_anon_upload ON storage.objects;

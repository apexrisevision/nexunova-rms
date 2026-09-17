/* ══ THE ROOM REMEMBERS THE PHONE, NOT THE PASSWORD ══════════════════════
   "Ye director password mai save password ka option karo yaar, baar baar
   password dena parta hai."

   The obvious way to do this is to write the password into the phone. That is
   also the one way it must not be done: this is a PUBLIC link, the password is
   the only thing standing between an outsider and the whole building's
   position, and a password sitting in a phone's storage is a password anybody
   who picks the phone up — or anything that can read that storage — has.

   So the phone is given a key instead of the word.

     · it is random, minted here, and the phone holds only the key
     · only its sha256 is stored, exactly as the link's own token is
     · it opens ONE project's room, and dies with the link it was made on
     · it expires on its own after thirty days
     · it is killed the moment the password is changed, which is the entire
       point of changing a password
     · and the director can throw it away from the room itself

   Nothing about the password changes. What changes is that five functions
   which used to ask "does this word hash to the stored hash" now ask
   _availability_secret_hash() the same question, and that function answers
   with the project's own hash when it is handed a live key. A password still
   travels the same path it always did; a key just gets the same answer.

   The five are patched by replacing that ONE expression in their existing
   bodies — read out of the catalogue, replaced, put back — rather than being
   rewritten. A wholesale rewrite of one of these once took the directors'
   room down for a few minutes, and once is enough. ═══════════════════════ */

/* ── WHAT A REMEMBERED PHONE HOLDS ─────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.availability_room_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id      uuid NOT NULL REFERENCES public.availability_links(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  key_hash     text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '30 days',
  revoked      boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS availability_room_keys_project_idx
  ON public.availability_room_keys (project_id) WHERE NOT revoked;
/* on, with no policies: nothing reaches this table except the definer
   functions below, which is the same footing the links themselves stand on */
ALTER TABLE public.availability_room_keys ENABLE ROW LEVEL SECURITY;

/* ── THE ONE QUESTION ALL FIVE ASK ─────────────────────────────────────────
   Given a project and whatever the caller was handed, what hash should be
   compared against the project's stored one? For a password: what it always
   was. For a live key: the project's own hash, so the comparison succeeds
   without the password ever having been on the phone.

   It fails closed in every direction — an unknown key, an expired one, a
   revoked one, a key for another project, or no password set at all — because
   in each of those cases it falls through to hashing the secret itself, and a
   key never hashes to a password. */
CREATE OR REPLACE FUNCTION public._availability_secret_hash(p_project uuid, p_secret text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_h text;
BEGIN
  /* keys announce themselves, so a password is never looked up as one */
  IF p_secret IS NOT NULL AND left(p_secret, 2) = 'k.' THEN
    UPDATE public.availability_room_keys
       SET last_used_at = now()
     WHERE key_hash = public._availability_token_hash(p_secret)
       AND project_id = p_project
       AND NOT revoked
       AND expires_at > now();
    IF FOUND THEN
      SELECT report_password_hash INTO v_h FROM public.projects WHERE id = p_project;
      RETURN v_h;          -- NULL if the password was taken off: still shut
    END IF;
  END IF;
  RETURN public._availability_token_hash(COALESCE(p_secret, '') || ':' || p_project::text);
END $function$;

REVOKE ALL ON FUNCTION public._availability_secret_hash(uuid, text) FROM PUBLIC;

/* ── THE FIVE, PATCHED WHERE THEY ASK IT ──────────────────────────────────
   Read out of the catalogue, one expression replaced, put back. Nothing else
   about them moves, their grants ride through CREATE OR REPLACE, and if the
   expression is not where it is expected the whole migration stops rather than
   half-patching the gate on a public link. */
DO $do$
DECLARE
  f text; src text; out_src text;
  old_x constant text := $x$public._availability_token_hash(COALESCE(p_password,'') || ':' || v_pr::text)$x$;
  new_x constant text := $x$public._availability_secret_hash(v_pr, p_password)$x$;
BEGIN
  FOREACH f IN ARRAY ARRAY['get_availability_report', 'get_availability_price_log',
                           'get_availability_releases', 'release_availability_unit',
                           'update_availability_prices'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF src IS NULL THEN RAISE EXCEPTION 'no such function: %', f; END IF;
    IF position(new_x IN src) > 0 THEN CONTINUE; END IF;   -- already patched
    out_src := replace(src, old_x, new_x);
    IF out_src = src THEN
      RAISE EXCEPTION 'the gate is not where it was expected in %s — nothing changed', f;
    END IF;
    EXECUTE out_src;
  END LOOP;
END $do$;

/* ── A CHANGED PASSWORD THROWS EVERY PHONE OUT ────────────────────────────
   The reason anybody changes this password is to shut somebody out of it, so a
   key minted under the old word must not survive the new one. A trigger rather
   than a line inside set_availability_report_password(), so it holds no matter
   which road the column is changed by — including a hand on the database. */
CREATE OR REPLACE FUNCTION public._availability_keys_die_with_the_password()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.availability_room_keys
     SET revoked = true
   WHERE project_id = NEW.id AND NOT revoked;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS availability_keys_die_with_the_password ON public.projects;
CREATE TRIGGER availability_keys_die_with_the_password
  AFTER UPDATE OF report_password_hash ON public.projects
  FOR EACH ROW
  WHEN (OLD.report_password_hash IS DISTINCT FROM NEW.report_password_hash)
  EXECUTE FUNCTION public._availability_keys_die_with_the_password();

/* ── REMEMBER THIS PHONE ──────────────────────────────────────────────────
   Called once, straight after a password has opened the room, and only ever
   with that same password: the key is the reward for having known it. The
   caller is told the key exactly once — it is a hash from here on. */
CREATE OR REPLACE FUNCTION public.remember_availability_room(p_token text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_pr uuid; v_hash text; v_key text;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id;

  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;
  /* THE WORD ITSELF, NOT A KEY. A key cannot mint another key, or one stolen
     phone would quietly become a permanent one. */
  IF v_hash IS NULL OR p_password IS NULL OR left(p_password, 2) = 'k.'
     OR v_hash <> public._availability_token_hash(p_password || ':' || v_pr::text) THEN
    INSERT INTO public.availability_report_attempts (link_id, ok) VALUES (v_link.id, false);
    RETURN jsonb_build_object('success', false, 'error', 'no');
  END IF;

  v_key := 'k.' || encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.availability_room_keys (link_id, project_id, key_hash)
  VALUES (v_link.id, v_pr, public._availability_token_hash(v_key));

  RETURN jsonb_build_object('success', true, 'key', v_key,
                            'expires_at', now() + interval '30 days');
END $function$;

/* ── AND FORGET IT ────────────────────────────────────────────────────────
   Handed a key, it throws away that one phone. Handed the password, it throws
   away every phone on this project — the "I have lost it" button, without
   having to change the word everybody else is using. */
CREATE OR REPLACE FUNCTION public.forget_availability_room(p_token text, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_pr uuid; v_hash text; v_n int := 0;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id;

  IF p_secret IS NOT NULL AND left(p_secret, 2) = 'k.' THEN
    UPDATE public.availability_room_keys SET revoked = true
     WHERE project_id = v_pr AND NOT revoked
       AND key_hash = public._availability_token_hash(p_secret);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'forgot', v_n);
  END IF;

  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;
  IF v_hash IS NULL OR p_secret IS NULL
     OR v_hash <> public._availability_token_hash(p_secret || ':' || v_pr::text) THEN
    INSERT INTO public.availability_report_attempts (link_id, ok) VALUES (v_link.id, false);
    RETURN jsonb_build_object('success', false, 'error', 'no');
  END IF;
  UPDATE public.availability_room_keys SET revoked = true
   WHERE project_id = v_pr AND NOT revoked;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'forgot', v_n);
END $function$;

REVOKE ALL ON FUNCTION public.remember_availability_room(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forget_availability_room(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remember_availability_room(text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.forget_availability_room(text, text)
  TO anon, authenticated, service_role;

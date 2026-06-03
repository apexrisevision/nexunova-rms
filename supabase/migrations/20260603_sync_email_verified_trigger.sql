-- ════════════════════════════════════════════════════════════════════════
-- 2026-06-03  Email-confirm launch-blocker fix: server-side sync of
-- app_users.email_verified when GoTrue confirms an auth.users email.
-- Decouples confirmation from the brittle client chain (?code vs #hash, PKCE
-- verifier, landing page). confirm_user_email() stays as a redundant client path.
--
-- Safe re: signup auto-bridge order — at bridge time auth.users.email_confirmed_at
-- is NULL (email_verified=false), so the trigger no-ops; the later GoTrue confirm
-- (null -> non-null) is what flips app_users.email_verified. Admin-created users
-- (email_verified already true) no-op via the `email_verified IS NOT TRUE` guard.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._sync_app_user_email_verified()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER                 -- must update public.app_users when fired by supabase_auth_admin
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only act when email_confirmed_at transitions to non-null. Idempotent; safe if no app_users row.
  IF NEW.email_confirmed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.email_confirmed_at IS NULL) THEN
    UPDATE public.app_users
       SET email_verified    = true,
           email_verified_at = COALESCE(email_verified_at, now()),
           updated_at        = now()
     WHERE auth_user_id = NEW.id
       AND email_verified IS NOT TRUE;     -- no-op (0 rows) once already verified
  END IF;
  RETURN NULL;                              -- AFTER trigger
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_app_user_email_verified ON auth.users;
CREATE TRIGGER trg_sync_app_user_email_verified
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public._sync_app_user_email_verified();

-- One-time backfill: already-confirmed-but-unsynced users
UPDATE public.app_users a
   SET email_verified    = true,
       email_verified_at = now(),
       updated_at        = now()
  FROM auth.users u
 WHERE u.id = a.auth_user_id
   AND u.email_confirmed_at IS NOT NULL
   AND a.email_verified IS NOT TRUE;

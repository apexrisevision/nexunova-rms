-- ═══════════════════════════════════════════════════════════════════════════
-- Awami can see the Daily Closing switches
-- ───────────────────────────────────────────────────────────────────────────
-- One feature-flag row, for one tenant, so the owner can create the module's
-- two accounts from Users & Roles: it reveals the `cfo` role in the role
-- dropdown and the `dailyclosing` module tick, and nothing else.
--
-- This is the smallest possible slice of P8 brought forward on the owner's
-- instruction — "just enough that I can create the two accounts". The sidebar
-- branch, nav()'s allow-list and hasPermission()'s defaults stay in P8.
--
-- ⚠️ WHY A FLAG AND NOT JUST ADDING THEM. hasFeature() returns TRUE for a key
-- it has never seen (js/pages/company-branding.js:60-62), so gating on it the
-- usual way would have shown a CFO role and a Daily Closing checkbox to every
-- tenant on the platform. users.js therefore asks for an EXPLICIT true, and
-- this row is the only place one exists. Khushal Bagh and FMH open Users &
-- Roles to exactly the screen they saw yesterday — no new role, no new tick.
--
-- Scoped to company 96d210e7-… (Awami Market) alone. No other tenant's row is
-- read, written, or created.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.company_feature_flags (company_id, feature_key, is_enabled, override_note, set_by, set_at)
VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce'::uuid, 'daily_closing', true,
        'Daily Closing pilot — reveals the cfo role and the dailyclosing module tick in Users & Roles (P8 slice)',
        'migration 20260904i', now())
ON CONFLICT (company_id, feature_key) DO UPDATE
  SET is_enabled = true, set_at = now();

DO $verify$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.company_feature_flags
   WHERE feature_key = 'daily_closing' AND is_enabled;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAILED: daily_closing is enabled for % tenants, expected exactly 1', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.company_feature_flags
                  WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'::uuid
                    AND feature_key = 'daily_closing' AND is_enabled) THEN
    RAISE EXCEPTION 'VERIFY FAILED: the flag is not on for Awami Market';
  END IF;
  RAISE NOTICE 'daily_closing is on for Awami Market and no one else';
END
$verify$;

COMMIT;

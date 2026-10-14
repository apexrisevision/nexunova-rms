-- SALE APPROVAL: every Awami RMS login does the whole SAF job (Rashid,
-- 2026-10-14: "ye SAF wala system saaray logins mai karo Awami tenant k.
-- Naseer, Amar, Awami sab mai.")
--   awami (owner), amar, naseer, and any later Awami login: prepare, submit,
--   and make the sale. The directors still approve discounts only in the
--   Directors' Room on the reservation link, with their own approval password.
-- Other companies keep the role rule (accounts/finance prepare, the
-- saf_filing tick files, owner/admin read).

CREATE OR REPLACE FUNCTION public._saf_me()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users := public._rms_caller();
        v_awami constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
        v_all boolean; v_prep boolean; v_fil boolean;
BEGIN
  IF v_me.id IS NULL OR COALESCE(v_me.status, 'active') <> 'active' THEN RETURN NULL; END IF;
  -- Awami: every login makes the form and the sale
  v_all  := v_me.company_id = v_awami;
  v_prep := v_me.role IN ('accounts','finance') OR v_all;
  v_fil  := COALESCE((v_me.module_permissions->>'saf_filing')::boolean, false) OR v_all;
  RETURN jsonb_build_object(
    'user_id', v_me.id, 'company_id', v_me.company_id, 'role', v_me.role, 'name', v_me.full_name,
    'prepare', v_prep,
    'approve', v_me.role IN ('owner','admin') AND NOT v_prep AND NOT v_fil,
    'filing',  v_fil,
    'enabled', public._saf_on(v_me.company_id));
END $$;

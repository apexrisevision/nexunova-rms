-- Authz hardening — Batch 3b: gate upload_payment_screenshot (the flagged DEFER fn). Source: recon.
-- Approach A (no frontend change): caller is the BUYER (no app session) — NO _rms_caller, NO role.
-- Instead validate the payment_link itself so an upload only proceeds for a real, active, unexpired,
-- not-yet-processed link — blocks random/cross-tenant link-id probing.
--   Columns checked on public.payment_links: status (text), expires_at (timestamptz).
--   Guard raises 'invalid_link' (ERRCODE 42501) when: link not found, expired, or status != 'sent'
--   (status<>'sent' covers screenshot_received / verified / rejected = already-processed/cancelled).
-- Signature, return type, SECURITY DEFINER preserved. NO `SET search_path` in catalog — left as-found
-- (NOT inventing one). Original body (incl. its own status select + soft checks) kept intact below the
-- guard as defense-in-depth; only the guard block + two decls are added.

CREATE OR REPLACE FUNCTION public.upload_payment_screenshot(p_payment_link_id uuid, p_screenshot_url text, p_uploaded_by text, p_client_claimed_amount numeric DEFAULT NULL::numeric, p_client_claimed_method text DEFAULT NULL::text, p_client_claimed_ref text DEFAULT NULL::text, p_client_claimed_date date DEFAULT NULL::date, p_client_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_status        TEXT;
  v_link_status   TEXT;
  v_link_expires  TIMESTAMPTZ;
BEGIN
  -- link-validity guard (batch 3b): buyer caller — no app session, so validate the link itself.
  SELECT status, expires_at INTO v_link_status, v_link_expires
  FROM payment_links WHERE id = p_payment_link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_link' USING ERRCODE = '42501';
  END IF;
  IF v_link_expires IS NOT NULL AND v_link_expires < now() THEN
    RAISE EXCEPTION 'invalid_link' USING ERRCODE = '42501';
  END IF;
  IF v_link_status <> 'sent' THEN
    RAISE EXCEPTION 'invalid_link' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM payment_links WHERE id = p_payment_link_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment link not found');
  END IF;
  IF v_status != 'sent' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link must be in sent status');
  END IF;

  UPDATE payment_links SET
    status                 = 'screenshot_received',
    screenshot_url         = p_screenshot_url,
    screenshot_uploaded_by = p_uploaded_by,
    screenshot_received_at = NOW(),
    client_claimed_amount  = p_client_claimed_amount,
    client_claimed_method  = p_client_claimed_method,
    client_claimed_ref     = p_client_claimed_ref,
    client_claimed_date    = p_client_claimed_date,
    client_notes           = p_client_notes,
    updated_at             = NOW()
  WHERE id = p_payment_link_id;

  INSERT INTO payment_link_status_history
    (payment_link_id, from_status, to_status, changed_by, notes)
  VALUES
    (p_payment_link_id, 'sent', 'screenshot_received', p_uploaded_by, 'Screenshot uploaded');

  RETURN jsonb_build_object('success', true);
END;
$function$;

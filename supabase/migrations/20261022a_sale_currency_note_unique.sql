-- 20261022a: the allotment letter's currency note number is saved on the sale
-- and can belong to ONE sale only (per company).
--
-- Rashid: "duplication allowed na karo". The number is compared without
-- spaces, dashes or case, so "BT 4471923" and "bt-4471923" are the same note.
-- A reprint of the same sale keeps (or corrects) its own number; another sale
-- asking for that number is refused and told which sale holds it.

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS currency_note_no text;

CREATE UNIQUE INDEX IF NOT EXISTS sales_currency_note_unique
  ON public.sales (company_id, (regexp_replace(upper(currency_note_no), '[^A-Z0-9]', '', 'g')))
  WHERE currency_note_no IS NOT NULL;

-- p_note NULL: just read the sale's number. Otherwise save it (owner/admin).
CREATE OR REPLACE FUNCTION public.sale_currency_note(p_sale_id uuid, p_company_id uuid, p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_cur text; v_note text; v_key text; v_other text;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;

  SELECT currency_note_no INTO v_cur FROM public.sales WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;
  IF p_note IS NULL THEN RETURN jsonb_build_object('success', true, 'note', v_cur); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;

  v_note := NULLIF(regexp_replace(btrim(p_note), '\s+', ' ', 'g'), '');
  v_key  := regexp_replace(upper(COALESCE(v_note, '')), '[^A-Z0-9]', '', 'g');
  IF v_key = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'note_required',
      'message', 'Enter the currency note number.'); END IF;

  SELECT s.sale_number || COALESCE(' (' || NULLIF(s.unit_no, '') || ')', '') INTO v_other
    FROM (SELECT x.sale_number, u.unit_no FROM public.sales x LEFT JOIN public.units u ON u.id = x.unit_id
           WHERE x.company_id = p_company_id AND x.id <> p_sale_id AND x.currency_note_no IS NOT NULL
             AND regexp_replace(upper(x.currency_note_no), '[^A-Z0-9]', '', 'g') = v_key LIMIT 1) s;
  IF v_other IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'duplicate_note',
      'message', 'Currency note ' || v_note || ' is already used on sale ' || v_other || '.'); END IF;

  IF v_cur IS DISTINCT FROM v_note THEN
    UPDATE public.sales SET currency_note_no = v_note WHERE id = p_sale_id AND company_id = p_company_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'note', v_note);
END $function$;

REVOKE ALL ON FUNCTION public.sale_currency_note(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sale_currency_note(uuid, uuid, text) TO authenticated;

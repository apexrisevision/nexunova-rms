-- ══ The sale's money follows the sold price ═════════════════════════════════
--
-- Withholding a sold unit's rate from the admin but still handing over the
-- sale's net, paid and outstanding would be a lock on the front door with the
-- back door open — net_amount IS what it sold for. So the money rows follow the
-- same rule the rate follows: director and CFO only.
--
-- The buyer's NAME, PHONE, sale number and date are untouched and still travel
-- with v_priv (director, admin, cfo). An admin can still see who bought a unit
-- and reach them; what they no longer see is the figure it went for.

CREATE OR REPLACE FUNCTION public._sales_sees_sale_money(p_session_token text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT su.role IN ('director','cfo')
      FROM public.sales_sessions ss
      JOIN public.sales_users su ON su.id = ss.sales_user_id
     WHERE ss.session_token = p_session_token
       AND ss.expires_at > now()
     LIMIT 1), false);
$function$;

REVOKE ALL ON FUNCTION public._sales_sees_sale_money(text) FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE v_src text; v_old text; v_new text;
  v_gate CONSTANT text := 'public._sales_sees_sale_money(p_session_token)';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname = 'get_map_unit_detail' AND pronamespace = 'public'::regnamespace;

  v_old := '        ''net_amount'', v_sale.net_amount, ''paid'', v_sale.paid,';
  v_new := '        ''net_amount'', CASE WHEN ' || v_gate || ' THEN v_sale.net_amount END,'
        || ' ''paid'', CASE WHEN ' || v_gate || ' THEN v_sale.paid END,';
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'net_amount/paid are not built the way this expects — refusing to guess';
  END IF;
  v_src := replace(v_src, v_old, v_new);

  v_old := '        ''outstanding'', COALESCE(v_sale.net_amount,0) - v_sale.paid,';
  v_new := '        ''outstanding'', CASE WHEN ' || v_gate
        || ' THEN COALESCE(v_sale.net_amount,0) - v_sale.paid END,';
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'outstanding is not built the way this expects — refusing to guess';
  END IF;
  v_src := replace(v_src, v_old, v_new);

  -- overdue is a whole sub-select; open the CASE before it and close it after,
  -- in one replacement so the two halves cannot drift apart.
  v_old := '        ''overdue'', COALESCE((SELECT sum(i.amount_due - COALESCE(i.amount_paid,0))'
        || E'\n                               FROM public.installments i'
        || E'\n                              WHERE i.sale_id = v_sale.id AND i.due_date < current_date'
        || E'\n                                AND COALESCE(i.amount_paid,0) < i.amount_due),0)));';
  v_new := '        ''overdue'', CASE WHEN ' || v_gate || ' THEN COALESCE((SELECT sum(i.amount_due - COALESCE(i.amount_paid,0))'
        || E'\n                               FROM public.installments i'
        || E'\n                              WHERE i.sale_id = v_sale.id AND i.due_date < current_date'
        || E'\n                                AND COALESCE(i.amount_paid,0) < i.amount_due),0) END));';
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'overdue is not built the way this expects — refusing to guess';
  END IF;
  v_src := replace(v_src, v_old, v_new);

  EXECUTE v_src;
END $do$;

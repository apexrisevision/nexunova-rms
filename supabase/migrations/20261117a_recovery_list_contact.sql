-- ══ Recovery List: the client's number and C/O ═════════════════════════════
-- Rashid: show the client's contact number and C/O (who made the sale) on the
-- recovery list; the number opens Call / WhatsApp on the page.
--   RMS file:   clients.phone_primary; C/O = the sale's agent, else the hold's
--               requester.
--   Token only: reservations.client_phone; C/O = requested_by_name, else the
--               requesting sales user / agent.
-- Same function as 20261113a with two fields added; nothing else changes.

CREATE OR REPLACE FUNCTION public.get_recovery_list(p_token text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_link public.availability_links; v_pr uuid; v_hash text; v_tries int; v_ok boolean;
        v_rows jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id;
  SELECT recovery_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;

  /* no password sent: the page only asks whether this link has the list at
     all, to know whether to show the button. Not a try, not counted. */
  IF p_password IS NULL OR btrim(p_password) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'no', 'enabled', v_hash IS NOT NULL);
  END IF;

  SELECT count(*) INTO v_tries FROM public.recovery_list_attempts
   WHERE link_id = v_link.id AND NOT ok AND at > now() - interval '1 hour';
  IF v_tries >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many', 'enabled', true);
  END IF;

  v_ok := v_hash IS NOT NULL
          AND v_hash = public._availability_token_hash(p_password || ':recovery:' || v_pr::text);
  /* written down before it is judged */
  INSERT INTO public.recovery_list_attempts (link_id, ok) VALUES (v_link.id, v_ok);
  IF NOT v_ok THEN
    RETURN jsonb_build_object('success', false, 'error', 'no', 'enabled', v_hash IS NOT NULL);
  END IF;

  WITH sold AS (
    SELECT u.id AS unit_id, u.unit_no,
           COALESCE(NULLIF(u.floor_label, ''), 'Floor ' || COALESCE(u.floor_no::text, '-')) AS floor,
           COALESCE(f.sort_order, u.floor_no, 999) AS fsort,
           c.full_name AS client, NULLIF(btrim(c.phone_primary), '') AS phone,
           /* C/O: the agent on the sale, else whoever asked for the hold */
           COALESCE(NULLIF(btrim(a.full_name), ''),
                    (SELECT NULLIF(btrim(x.requested_by_name), '') FROM public.reservations x
                      WHERE x.converted_sale_id = s.id ORDER BY x.created_at DESC LIMIT 1)) AS co,
           s.sale_number,
           COALESCE(s.total_amount, 0) AS basic,
           COALESCE(s.discount, 0) AS discount,
           COALESCE(s.net_amount, 0) AS final,
           COALESCE(dp.due, s.down_payment, 0) AS dp,
           COALESCE(dp.paid, 0) AS received,
           COALESCE(dp.left_, GREATEST(COALESCE(s.down_payment, 0), 0)) AS dp_left,
           true AS in_rms
      FROM public.sales s
      JOIN public.units u ON u.id = s.unit_id
      LEFT JOIN public.floors f ON f.id = u.floor_id
      LEFT JOIN public.clients c ON c.id = s.client_id
      LEFT JOIN public.agents a ON a.id = s.agent_id
      LEFT JOIN LATERAL (
        SELECT sum(i.amount_due) AS due, sum(COALESCE(i.amount_paid, 0)) AS paid,
               sum(GREATEST(COALESCE(i.amount_due, 0) - COALESCE(i.amount_paid, 0), 0)) AS left_
          FROM public.installments i
         WHERE i.sale_id = s.id AND i.installment_type = 'down_payment') dp ON true
     WHERE u.project_id = v_pr AND s.status = 'active'
  ), tok AS (
    SELECT u.id AS unit_id, u.unit_no,
           COALESCE(NULLIF(u.floor_label, ''), 'Floor ' || COALESCE(u.floor_no::text, '-')) AS floor,
           COALESCE(f.sort_order, u.floor_no, 999) AS fsort,
           NULLIF(btrim(r.client_name), '') AS client, NULLIF(btrim(r.client_phone), '') AS phone,
           COALESCE(NULLIF(btrim(r.requested_by_name), ''), NULLIF(btrim(su.full_name), ''),
                    NULLIF(btrim(ag.full_name), '')) AS co,
           NULL::text AS sale_number,
           COALESCE(u.base_price, 0) AS basic, 0::numeric AS discount,
           COALESCE(u.base_price, 0) AS final,
           round(COALESCE(u.base_price, 0) * 0.30) AS dp,
           r.token_amount AS received,
           GREATEST(round(COALESCE(u.base_price, 0) * 0.30) - r.token_amount, 0) AS dp_left,
           false AS in_rms
      FROM public.reservations r
      JOIN public.units u ON u.id = r.unit_id
      LEFT JOIN public.floors f ON f.id = u.floor_id
      LEFT JOIN public.sales_users su ON su.id = r.requested_by_sales_user_id
      LEFT JOIN public.agents ag ON ag.id = r.requested_by_agent_id
     WHERE u.project_id = v_pr AND r.status = 'active'
       AND r.token_received AND COALESCE(r.token_amount, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM sold x WHERE x.unit_id = u.id)
  ), alls AS (SELECT * FROM sold UNION ALL SELECT * FROM tok)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit', unit_no, 'floor', floor, 'client', client, 'phone', phone, 'co', co, 'sale', sale_number,
           'basic', basic, 'discount', discount, 'final', final, 'dp', dp,
           'received', received, 'dp_left', dp_left, 'rms', in_rms)
         ORDER BY fsort, COALESCE(NULLIF(substring(unit_no FROM '([0-9]+)$'), '')::int, 0), unit_no), '[]'::jsonb)
    INTO v_rows FROM alls;

  RETURN jsonb_build_object(
    'success', true,
    'project', (SELECT project_name FROM public.projects WHERE id = v_pr),
    'company', (SELECT COALESCE(c.display_name, c.company_name)
                  FROM public.projects p JOIN public.companies c ON c.id = p.company_id WHERE p.id = v_pr),
    'as_of', now(),
    'rows', v_rows);
END
$function$;

REVOKE ALL ON FUNCTION public.get_recovery_list(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recovery_list(text, text) TO anon, authenticated;

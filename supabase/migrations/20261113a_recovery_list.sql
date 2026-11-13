-- ══ Recovery List on the reservation link ══════════════════════════════════
-- Rashid: a list for the recovery officer, behind its own password, on the
-- link beside Director's Login. Per unit: client, unit, basic price, discount,
-- final price, the down payment and how much of it is still to come. Units
-- whose file is already made in RMS (an active sale) are marked.
--
-- WHO IS ON IT
--   * every active RMS sale in the link's project: its own price, discount and
--     net, and its down-payment instalments (due - paid, never below zero)
--   * every unit with a received token and no RMS sale yet: the register
--     price, no discount (none is agreed in the system yet), the standard 30%
--     down payment, and the token as what has come in
--
-- ITS OWN PASSWORD. Not the Directors' Room password and not a room key: the
-- hash is sha256(password || ':recovery:' || project id), so a remembered
-- director phone does not open it and this password does not open the room.
-- Wrong tries are counted in a table of their own, so a recovery officer
-- mistyping can never lock the directors out of their room.
-- The plain password is not in this file, only its hash.

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS recovery_password_hash text;

CREATE TABLE IF NOT EXISTS public.recovery_list_attempts (
  id      bigserial PRIMARY KEY,
  link_id uuid NOT NULL,
  at      timestamptz NOT NULL DEFAULT now(),
  ok      boolean NOT NULL
);
ALTER TABLE public.recovery_list_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recovery_list_attempts FROM anon, authenticated, PUBLIC;
REVOKE ALL ON SEQUENCE public.recovery_list_attempts_id_seq FROM anon, authenticated, PUBLIC;
CREATE INDEX IF NOT EXISTS recovery_list_attempts_link_at ON public.recovery_list_attempts (link_id, at);

-- Awami Market
UPDATE public.projects
   SET recovery_password_hash = '8726ab682f2a49bd5e24e259b89bd949aa736a7369585e20c6f4887194dc9f79'
 WHERE id = '59ded55b-9bc2-45b2-a372-49fc31807fa9';

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
           c.full_name AS client, s.sale_number,
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
           NULLIF(btrim(r.client_name), '') AS client, NULL::text AS sale_number,
           COALESCE(u.base_price, 0) AS basic, 0::numeric AS discount,
           COALESCE(u.base_price, 0) AS final,
           round(COALESCE(u.base_price, 0) * 0.30) AS dp,
           r.token_amount AS received,
           GREATEST(round(COALESCE(u.base_price, 0) * 0.30) - r.token_amount, 0) AS dp_left,
           false AS in_rms
      FROM public.reservations r
      JOIN public.units u ON u.id = r.unit_id
      LEFT JOIN public.floors f ON f.id = u.floor_id
     WHERE u.project_id = v_pr AND r.status = 'active'
       AND r.token_received AND COALESCE(r.token_amount, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM sold x WHERE x.unit_id = u.id)
  ), alls AS (SELECT * FROM sold UNION ALL SELECT * FROM tok)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit', unit_no, 'floor', floor, 'client', client, 'sale', sale_number,
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

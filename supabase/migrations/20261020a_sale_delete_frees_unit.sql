-- 20261020a: deleting a sale puts its unit, hold and SAF back.
--
-- GF-253 (Awami): the dummy sale SAL-2026-0004 was deleted on 2026-10-17 by
-- hand. The hold came back, but the UNIT stayed on "Sold" with no sale behind
-- it, so the Sale Approval Form picker (and Add Sale) hid it and nobody could
-- sell it. No RPC deletes sales; only a hand DELETE does, so the fix lives on
-- the sales table itself, plus a picker that no longer hides an orphan.
--
-- 1. BEFORE DELETE on sales: if no other active sale holds the unit,
--    - the hold that this sale converted goes back to active;
--    - the SAF that made this sale is cancelled (the SAF lock lets exactly
--      this one change through, marked by rms.saf_sale_deleted);
--    - a unit left on a sold tag (SOLD / BOOKED / INSTALLMENT) goes back to
--      its project's RESERVED when a hold still stands, else to AVAILABLE.
-- 2. saf_list: the unit picker also lists SOLD units that have no active
--    sale (a desk can tag a hold Sold before the sale is made).

-- 1a. the SAF lock: one narrow door, opened only by the sale-delete trigger.
CREATE OR REPLACE FUNCTION public._saf_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE c_free constant text[] := ARRAY['status','superseded_by','sale_id','pdf_sha256','pdf_path',
                                        'filed_by','filed_by_name','filed_at','updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved','superseded') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', DETAIL = 'saf_locked',
        MESSAGE = 'Sale Approval Form ' || OLD.saf_no || ' is ' || OLD.status || ' and cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;
  -- 20261020a: the sale this form made is being deleted; the form may be
  -- cancelled and unlinked, and nothing else about it may change.
  IF OLD.status = 'approved' AND NEW.status = 'cancelled' AND NEW.sale_id IS NULL
     AND OLD.sale_id IS NOT NULL
     AND current_setting('rms.saf_sale_deleted', true) = OLD.sale_id::text
     AND (to_jsonb(NEW) - c_free) IS NOT DISTINCT FROM (to_jsonb(OLD) - c_free) THEN
    RETURN NEW;
  END IF;
  IF OLD.status NOT IN ('approved','superseded') THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - c_free) IS DISTINCT FROM (to_jsonb(OLD) - c_free)
     OR (OLD.status = 'superseded' AND NEW.status <> 'superseded')
     OR (OLD.status = 'approved'   AND NEW.status NOT IN ('approved','superseded'))
     OR (OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by)
     OR (NEW.status = 'superseded' AND NEW.superseded_by IS NULL)
     OR (OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256)
     OR (OLD.pdf_path   IS NOT NULL AND NEW.pdf_path   IS DISTINCT FROM OLD.pdf_path)
     OR (OLD.filed_at   IS NOT NULL AND (NEW.filed_at IS DISTINCT FROM OLD.filed_at
                                         OR NEW.filed_by IS DISTINCT FROM OLD.filed_by)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', DETAIL = 'saf_locked',
      MESSAGE = 'Sale Approval Form ' || OLD.saf_no || ' is ' || OLD.status
             || '. Any change needs a new SAF that supersedes it.';
  END IF;
  RETURN NEW;
END $function$;

-- 1b. the sale-delete trigger.
CREATE OR REPLACE FUNCTION public._sale_delete_frees_unit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_u public.units; v_code text; v_to uuid;
BEGIN
  -- Another active sale still owns the unit: leave everything as it is.
  IF EXISTS (SELECT 1 FROM public.sales s
              WHERE s.unit_id = OLD.unit_id AND s.id <> OLD.id AND s.status = 'active') THEN
    RETURN OLD;
  END IF;

  UPDATE public.reservations
     SET status = 'active', converted_sale_id = NULL, updated_at = now()
   WHERE converted_sale_id = OLD.id AND status = 'converted';

  PERFORM set_config('rms.saf_sale_deleted', OLD.id::text, true);
  UPDATE public.sale_approval_forms
     SET status = 'cancelled', sale_id = NULL, updated_at = now()
   WHERE sale_id = OLD.id AND status = 'approved';
  PERFORM set_config('rms.saf_sale_deleted', '', true);

  SELECT * INTO v_u FROM public.units WHERE id = OLD.unit_id;
  IF NOT FOUND THEN RETURN OLD; END IF;
  SELECT upper(status_code) INTO v_code FROM public.category_unit_statuses WHERE id = v_u.status_id;
  IF v_code IN ('SOLD','BOOKED','INSTALLMENT') THEN
    SELECT cs.id INTO v_to FROM public.category_unit_statuses cs
     WHERE cs.project_id = v_u.project_id AND cs.is_active
       AND upper(cs.status_code) = CASE WHEN EXISTS (
             SELECT 1 FROM public.reservations r WHERE r.unit_id = v_u.id AND r.status = 'active')
           THEN 'RESERVED' ELSE 'AVAILABLE' END
     ORDER BY cs.sort_order LIMIT 1;
    IF v_to IS NOT NULL THEN
      UPDATE public.units SET status_id = v_to WHERE id = v_u.id;
    END IF;
  END IF;
  RETURN OLD;
END $function$;

REVOKE ALL ON FUNCTION public._sale_delete_frees_unit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sale_delete_frees_unit ON public.sales;
CREATE TRIGGER trg_sale_delete_frees_unit
  BEFORE DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public._sale_delete_frees_unit();

-- 2. saf_list: SOLD joins the picker (still only units with no active sale).
CREATE OR REPLACE FUNCTION public.saf_list(p_status text DEFAULT NULL::text, p_agent uuid DEFAULT NULL::uuid, p_floor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c jsonb := public._saf_me(); v_co uuid;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT ((c->>'prepare')::boolean OR (c->>'approve')::boolean OR (c->>'filing')::boolean) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  v_co := (c->>'company_id')::uuid;
  RETURN jsonb_build_object('success', true, 'enabled', public._saf_on(v_co), 'me', c,
    'waiting', jsonb_build_object(
       'director', (SELECT count(*) FROM public.sale_approval_forms WHERE company_id = v_co AND status IN ('submitted','verified')),
       'filing',   (SELECT count(*) FROM public.sale_approval_forms WHERE company_id = v_co AND status = 'approved' AND (filed_at IS NULL OR sale_id IS NULL)),
       'accounts', (SELECT count(*) FROM public.sale_approval_forms WHERE company_id = v_co AND status IN ('draft','rejected'))),
    'counts', (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) FROM (
                 SELECT status, count(*) n FROM public.sale_approval_forms
                  WHERE company_id = v_co AND public._saf_visible(c, status) GROUP BY 1) s),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'saf_no', f.saf_no, 'status', f.status, 'unit_code', f.unit_code, 'floor_label', f.floor_label,
               'buyer_name', f.buyer_name, 'agent_name', f.agent_name, 'net_price', f.net_price,
               'total_received', f.total_received, 'prepared_by_name', f.prepared_by_name, 'updated_at', f.updated_at,
               'approved_at', f.approved_at, 'filed_at', f.filed_at,
               'sale_number', (SELECT s.sale_number FROM public.sales s WHERE s.id = f.sale_id),
               'flags', jsonb_array_length(public._saf_flags(to_jsonb(f))))
             ORDER BY f.updated_at DESC)
        FROM public.sale_approval_forms f
       WHERE f.company_id = v_co AND public._saf_visible(c, f.status)
         AND (p_status IS NULL OR f.status = p_status)
         AND (p_agent IS NULL OR f.agent_id = p_agent)
         AND (p_floor IS NULL OR f.floor_label = p_floor)), '[]'::jsonb),
    'agents', CASE WHEN (c->>'prepare')::boolean THEN COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.full_name) ORDER BY a.full_name)
                   FROM public.agents a WHERE a.company_id = v_co
                    AND COALESCE(a.status, 'active') NOT IN ('inactive','blocked')), '[]'::jsonb) ELSE '[]'::jsonb END,
    'directors', CASE WHEN (c->>'prepare')::boolean THEN COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('id', su.id, 'name', su.full_name) ORDER BY su.full_name)
                   FROM public.sales_users su WHERE su.company_id = v_co AND su.role = 'director'), '[]'::jsonb) ELSE '[]'::jsonb END,
    'units', CASE WHEN (c->>'prepare')::boolean THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', u.id, 'unit_code', COALESCE(NULLIF(u.unit_code, ''), u.unit_no),
               'floor_label', u.floor_label, 'status', cs.status_name, 'buyer', r.client_name)
             ORDER BY u.floor_label, u.unit_no)
        FROM public.units u
        JOIN public.category_unit_statuses cs ON cs.id = u.status_id
        LEFT JOIN LATERAL (SELECT r2.client_name FROM public.reservations r2
                            WHERE r2.unit_id = u.id AND r2.status = 'active' ORDER BY r2.created_at DESC LIMIT 1) r ON true
       WHERE u.company_id = v_co
         AND cs.status_code IN ('SOLD_ENTRY_PENDING','HOLD','RESERVED','BOOKED','RESALE_REVIEW','SOLD')
         AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.unit_id = u.id AND s.status = 'active')), '[]'::jsonb)
              ELSE '[]'::jsonb END);
END $function$;

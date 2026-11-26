-- ══ Awami Market: this week's holds put back (20261126b) ══
-- APPLIED 26-Nov-2026 as 20261126100258, on the owner's yes. Owner, 26-Nov-2026: "is week mai jo jo units reserve ya hold howay thay unhe wapis le kar aao unhe wapis
-- se reserve ya hold etc karo". 20261126a opened every no-token, non-Waqar hold, including three made in the last 7 days
-- whose time had not run out (GF-188 was approved by Sharose this morning and showed Available on the link).
-- The three cancelled holds come back exactly as they were: same row, requester, tag and expiry; the note loses the
-- "[Opened ...]" suffix; the unit takes the hold's tag again (GF-188 Reserved, GF-261 Hold, FF-279 Hold).
-- Each unit must still be free (Available, no active hold, no sale) or the whole migration stops.

DO $m$
DECLARE
  c_res uuid[] := ARRAY['132eb07a-45ef-4e59-b431-9cdd3b6a5ee6',   -- GF-188 Naeem Hussain, Reserved to 3-Dec
                        '7e3959a5-6db5-4f3f-b5f1-f92239cbbfdf',   -- GF-261 Fayaz Bangash, Hold to 2-Dec
                        '6dd2eb3c-e8ee-49ac-a8ae-51b3f90b02fa'];  -- FF-279 Naeem Hussain, Hold to 29-Nov
  x record; n int := 0;
BEGIN
  PERFORM public._rms_actor('Rashid Manzoor', 'desk');
  FOR x IN SELECT r.id, r.unit_id, r.unit_status_id, u.unit_no
             FROM public.reservations r JOIN public.units u ON u.id = r.unit_id
            WHERE r.id = ANY (c_res) AND r.status = 'cancelled'
              AND r.note LIKE '%[Opened 26-Nov-2026 before the expo, no token]%' LOOP
    IF NOT EXISTS (SELECT 1 FROM public.units u JOIN public.category_unit_statuses c ON c.id = u.status_id
                    WHERE u.id = x.unit_id AND c.is_available) THEN
      RAISE EXCEPTION '% is no longer Available', x.unit_no; END IF;
    IF EXISTS (SELECT 1 FROM public.reservations WHERE unit_id = x.unit_id AND status = 'active') THEN
      RAISE EXCEPTION '% has a new hold since', x.unit_no; END IF;
    IF EXISTS (SELECT 1 FROM public.sales WHERE unit_id = x.unit_id AND status <> 'cancelled') THEN
      RAISE EXCEPTION '% has a sale', x.unit_no; END IF;

    UPDATE public.reservations
       SET status = 'active', cancelled_by = NULL, cancelled_at = NULL, updated_at = now(),
           note = NULLIF(btrim(replace(note, '[Opened 26-Nov-2026 before the expo, no token]', '')), '')
     WHERE id = x.id;
    UPDATE public.units SET status_id = x.unit_status_id, updated_at = now() WHERE id = x.unit_id;
    IF NOT EXISTS (SELECT 1 FROM public.reservations WHERE id = x.id AND status = 'active') THEN
      RAISE EXCEPTION 'hold on % did not stay active', x.unit_no; END IF;
    n := n + 1;
  END LOOP;
  IF n <> 3 THEN RAISE EXCEPTION 'restored %, expected 3', n; END IF;
END $m$;

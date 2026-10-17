-- ─────────────────────────────────────────────────────────────────────────────
-- SALE APPROVAL FORM: NO DIRECTOR STEP  (2026-10-17)
--
-- Rashid: "in condition ko khatam kar do totally, bas direct filling wala file
-- banaye aur that's it if any discount or whatever. no approval needed."
-- Until now a form with any discount (or a lower price) went to the Directors'
-- Room and waited for a signed approval. Now EVERY submitted form is approved
-- on submit and makes the sale at once, exactly as the full-price path did.
--
--   saf_submit     — route is always 'plan'; approve + _saf_make_sale for all.
--                    The checks before submit are unchanged (buyer, photos,
--                    agent, plan, schedule = net price, and a REASON for a
--                    discount beyond the plan / a different commission / a
--                    different buyer name — those are notes, not approvals).
--   _saf_make_sale — the sale note no longer claims "at the list price" for a
--                    discounted sale; it says the discount and who submitted.
--   _saf_view      — carries the hold (who asked for it, when, tag, who held
--                    it at the desk) for the upgraded PDF.
-- The Directors' Room SAF functions stay; nothing new reaches them.
--
-- Bodies are patched from pg_get_functiondef() on live at fixed anchors; every
-- anchor must match exactly once or the block RAISES and nothing applies.
-- Re-runnable: a patch already present is skipped.
-- ─────────────────────────────────────────────────────────────────────────────

DO $mig$
DECLARE
  r record; v_def text; v_cur text; v_fn text := '';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    (1, 'saf_submit',
     E'approval_route = CASE WHEN v_full THEN ''plan'' ELSE ''director'' END,',
     E'approval_route = ''plan'',  -- 20261017a: no director step any more'),
    (2, 'saf_submit',
     E'  IF v_full THEN\n    SELECT * INTO v_row',
     E'  IF true THEN  -- 20261017a: every form, discount or not, makes the sale on submit\n'
     '    SELECT * INTO v_row'),
    (3, '_saf_make_sale',
     E'CASE WHEN f.approval_route = ''plan'' THEN '', at the list price (no director approval needed)'' ELSE '', approved by '' || f.approved_by_name END',
     E'CASE WHEN f.approval_route = ''director'' THEN '', approved by '' || f.approved_by_name\n'
     '                 WHEN COALESCE(f.discount_amount, 0) > 0\n'
     '                   THEN '', discount '' || to_char(f.discount_amount, ''FM999,999,999,990'') || '' given, submitted by '' || COALESCE(f.submitted_by_name, '''')\n'
     '                 ELSE '', at the list price'' END'),
    (4, '_saf_view',
     E'(SELECT p.project_name FROM public.projects p WHERE p.id = f.project_id))',
     E'(SELECT p.project_name FROM public.projects p WHERE p.id = f.project_id),\n'
     '              -- 20261017a: the hold the form was made from, for the PDF\n'
     '              ''hold'', (SELECT jsonb_build_object(\n'
     '                         ''requested_by'', rr.requested_by_name, ''held_at'', rr.created_at,\n'
     '                         ''expiry'', rr.expiry_date, ''status'', rr.status,\n'
     '                         ''tag'', COALESCE(NULLIF(btrim(cs.public_label), ''''), cs.status_name),\n'
     '                         ''reserved_by'', su.full_name)\n'
     '                         FROM public.reservations rr\n'
     '                         LEFT JOIN public.category_unit_statuses cs ON cs.id = rr.unit_status_id\n'
     '                         LEFT JOIN public.sales_users su ON su.id = rr.reserved_by\n'
     '                        WHERE rr.id = f.reservation_id\n'
     '                           OR (f.reservation_id IS NULL AND rr.unit_id = f.unit_id)\n'
     '                        ORDER BY (rr.id = f.reservation_id) DESC NULLS LAST, rr.created_at DESC\n'
     '                        LIMIT 1))')
  ) AS t(ord, fn, anchor, repl) ORDER BY fn, ord
  LOOP
    IF r.fn <> v_fn THEN
      IF v_fn <> '' AND v_def IS DISTINCT FROM v_cur THEN EXECUTE v_cur; END IF;
      SELECT pg_get_functiondef(p.oid) INTO v_def
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = r.fn;
      IF v_def IS NULL THEN RAISE EXCEPTION '% not found', r.fn; END IF;
      v_cur := v_def; v_fn := r.fn;
    END IF;
    IF position(r.repl IN v_cur) > 0 THEN CONTINUE; END IF;              -- already patched
    IF (length(v_cur) - length(replace(v_cur, r.anchor, ''))) / length(r.anchor) <> 1 THEN
      RAISE EXCEPTION 'anchor % not found exactly once in %', r.ord, r.fn; END IF;
    v_cur := replace(v_cur, r.anchor, r.repl);
  END LOOP;
  IF v_def IS DISTINCT FROM v_cur THEN EXECUTE v_cur; END IF;
END $mig$;

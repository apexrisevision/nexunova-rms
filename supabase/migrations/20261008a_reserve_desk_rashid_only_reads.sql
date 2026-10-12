-- ─────────────────────────────────────────────────────────────────────────────
-- THE RESERVE DESK IS RASHID'S, READS INCLUDED  (2026-10-08)
--
-- 20260928a gated every write that books, re-tags, releases or decides a hold.
-- What it left open: the desk's own reads and the link-payment pair still asked
-- only "is the caller a director". So another director (or, on the link's
-- desk door, an admin or cfo) signing in got the whole desk drawn — the
-- pending queue with Approve / Decline under it — and could Verify or Reject a
-- token paid on the link, which adds money to a unit's hold.
--
-- Rashid's instruction: none of this for anybody but his own login.
--   get_reserve_desk           · the desk itself
--   list_reservation_requests  · the pending queue           (was: director)
--   list_link_payments         · link tokens waiting/register (was: director)
--   decide_link_payment        · Verify / Reject / Reopen     (was: director)
-- all now ask _may_authorize_reservation, the one helper the writes use.
-- Refusal stays 'forbidden', which the desk's poll already stops on.
--
-- Patched from pg_get_functiondef() on live at a fixed anchor; RAISES if an
-- anchor is not there exactly once, so nothing half-applies. Re-runnable.
-- ─────────────────────────────────────────────────────────────────────────────

DO $mig$
DECLARE
  v_gate constant text := 'IF NOT public._may_authorize_reservation(p_session_token) THEN';
  r record; v_def text; v_new text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      -- swap the director test for the Rashid test
      ('list_reservation_requests', $a$IF COALESCE(public._sales_role_of(p_session_token),'') <> 'director' THEN$a$,  'swap'),
      ('list_link_payments',        $a$IF COALESCE(public._sales_role_of(p_session_token), '') <> 'director' THEN$a$, 'swap'),
      ('decide_link_payment',       $a$IF COALESCE(public._sales_role_of(p_session_token), '') <> 'director' THEN$a$, 'swap'),
      -- the desk had no gate at all: put one in front of its lead_entry check
      ('get_reserve_desk',          $a$  IF public._sales_role_of(p_session_token) = 'lead_entry' THEN$a$,          'insert')
    ) AS t(fn, anchor, how)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.fn;
    IF v_def IS NULL THEN RAISE EXCEPTION '% not found', r.fn; END IF;
    IF position(v_gate IN v_def) > 0 THEN CONTINUE; END IF;   -- already applied
    IF (length(v_def) - length(replace(v_def, r.anchor, ''))) / length(r.anchor) <> 1 THEN
      RAISE EXCEPTION 'anchor not found exactly once in %', r.fn; END IF;
    IF r.how = 'swap' THEN
      v_new := replace(v_def, r.anchor, v_gate);
    ELSE
      v_new := replace(v_def, r.anchor,
        '  ' || v_gate || E'\n'
        || $g$    RETURN jsonb_build_object('success',false,'error','forbidden',$g$ || E'\n'
        || $g$      'message','The Reserve Desk is not open on this sign-in.'); END IF;$g$ || E'\n'
        || r.anchor);
    END IF;
    EXECUTE v_new;
  END LOOP;
END
$mig$;

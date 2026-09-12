/* ══ THE DESK LEARNS WHICH HOLD IT IS LOOKING AT ═══════════════════════════
   Rashid: "release ka option reservation pe hee le kar aao k mai unit search
   karun aur jo unavailable ho us unit pe click karnay pe wahin aaye k
   release?" Today letting a unit go means leaving the desk for the daybook and
   scrolling a list that cannot be searched — to release a unit he has, a
   moment earlier, typed the number of.

   The desk already knows everything about a held unit except the one thing it
   would need to release it. Typing LG-12 already shows the hold, who asked for
   it and when it runs out; all of that comes from the active reservation row.
   This adds that row's id, which is what cancel_reservation takes.

   IT IS ONE FIELD AND IT OPENS NO DOOR. The id is only useful to
   cancel_reservation, which does its own session, role and scope checks and
   has done since it was written — this does not grant a release, it lets the
   screen ASK for one. And it appears only where an active reservation exists,
   so a unit marked sold with no reservation behind it still offers nothing to
   cancel, which is the correct boundary and not an oversight.

   Patched in place so that anything else this function has grown is kept, and
   the patch refuses to apply if the text it expects has moved.
   ═══════════════════════════════════════════════════════════════════════════ */

DO $patch$
DECLARE
  v_src text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname = 'get_reserve_desk';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'get_reserve_desk is not there to patch';
  END IF;

  /* LOOSELY, BECAUSE THE ALIGNMENT IS NOT THE POINT. Looking for the exact
     spacing of the line this inserts made a second run report that the
     function had changed underneath it, when all that had changed was that
     the line was already there. */
  IF position('''rid''' in v_src) > 0 THEN
    RAISE NOTICE 'already patched — nothing to do';
    RETURN;
  END IF;

  v_old := $old$           'h',  CASE WHEN r.id IS NOT NULL THEN jsonb_build_object(
                        'by',     COALESCE(NULLIF(TRIM(r.requested_by_name),''), su.full_name),$old$;

  v_new := $new$           'h',  CASE WHEN r.id IS NOT NULL THEN jsonb_build_object(
                        /* the hold's own id, so the desk can ask for it to be
                           let go without sending anyone to the daybook */
                        'rid',    r.id,
                        'by',     COALESCE(NULLIF(TRIM(r.requested_by_name),''), su.full_name),$new$;

  IF position(v_old in v_src) = 0 THEN
    RAISE EXCEPTION 'get_reserve_desk no longer contains the text this patch expects';
  END IF;

  EXECUTE replace(v_src, v_old, v_new);
END
$patch$;

/* CREATE OR REPLACE keeps the grants a function already had; these are
   restated only so the intended state is written where the next person looks. */
REVOKE ALL ON FUNCTION public.get_reserve_desk(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reserve_desk(text, uuid) TO anon, authenticated, service_role;

/* ══ THE UNIT'S OWN LINE, THE WAY THE ARCHITECT PRINTED IT ══════════════════
   The floor plan on the public link writes each shop's label itself, because
   the drawing's lettering is eleven megabytes of traced outlines and cannot be
   carried down a phone line. Writing it means having it: the number and the
   area were already on the wire, the TYPE was not.

   Additive only — one more key on a unit, nothing removed and nothing renamed,
   so a browser holding the old page keeps working exactly as before.

   Patched rather than rewritten: this function is long, live, and the parts
   that decide what an outsider may see are not worth retyping from memory.
   If the text below is not found, nothing is applied and the run fails loudly.
*/
DO $mig$
DECLARE
  src text := pg_get_functiondef('public.get_public_availability(text)'::regprocedure);
  out text;
BEGIN
  IF position($m$'a', u.area$m$ IN src) = 0 THEN
    RAISE EXCEPTION 'get_public_availability no longer carries the area the same way — read it before patching';
  END IF;
  IF position($m$LEFT JOIN public.category_unit_statuses cs ON cs.id = u.status_id$m$ IN src) = 0 THEN
    RAISE EXCEPTION 'the status join is not where this patch expects it';
  END IF;
  IF position($m$'t', ut.type_name$m$ IN src) > 0 THEN
    RAISE NOTICE 'already carries the type — nothing to do';
    RETURN;
  END IF;

  out := replace(src, $m$'a', u.area$m$,
                      $m$'a', u.area,
                        /* WHAT THE THING IS. The plan prints "SHOP" under the
                           number and a dealer reads the two together; the list
                           can say it in full. Public either way — a type is on
                           the printed sheet the office hands out. */
                        't', ut.type_name$m$);

  out := replace(out, $m$LEFT JOIN public.category_unit_statuses cs ON cs.id = u.status_id$m$,
                      $m$LEFT JOIN public.category_unit_statuses cs ON cs.id = u.status_id
      LEFT JOIN public.category_unit_types ut ON ut.id = u.unit_type_id$m$);

  EXECUTE out;

  /* A fresh CREATE hands EXECUTE to PUBLIC. This one is reached with an anon
     key and guards itself with the token, but the grant list still has to say
     what it meant to say. */
  EXECUTE 'REVOKE ALL ON FUNCTION public.get_public_availability(text) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_public_availability(text) TO anon, authenticated, service_role';
END
$mig$;

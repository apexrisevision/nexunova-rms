/* ══ A PROJECT MAY PUT ITS PRICES ON THE LINK ═══════════════════════════════
   The public availability link has never carried a price, on purpose: it is a
   URL that can be forwarded to anybody, and the suite has an assertion that
   searches the whole payload as raw text to keep it that way.

   Rashid wants Awami's on it. That is his to decide about his own building —
   but not about anybody else's. Khushal Bagh Heights and Fourteen Manzil
   Height have links of their own running on this same code, and neither of
   them asked for this. So it is a switch, per project, and it is OFF unless
   somebody turns it on.

   A project with the switch off carries no price key at all — its payload is
   byte for byte what it was — so the lock in the suite becomes two-sided
   rather than gone: off must still mean no price anywhere in the raw text, and
   on must mean the register's own number.
*/
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS public_show_price boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.projects.public_show_price IS
  'When true, the public availability link carries each unit''s total price. '
  'Off by default: that link can be forwarded to anybody.';

DO $mig$
DECLARE
  src text := pg_get_functiondef('public.get_public_availability(text)'::regprocedure);
  out text;
BEGIN
  IF position($m$'t', ut.type_name$m$ IN src) = 0 THEN
    RAISE EXCEPTION 'get_public_availability does not look the way this patch expects';
  END IF;
  IF position($m$public_show_price$m$ IN src) > 0 THEN
    RAISE NOTICE 'already carries the price switch — nothing to do';
    RETURN;
  END IF;

  /* The total, added to the unit only when the project publishes it. Not a
     rate and not a discount — the one number the office sells against, so a
     dealer reading the link and a dealer reading the desk see the same figure.
     Concatenated rather than built in, so a project with the switch off has no
     price key at all rather than a null one. */
  out := replace(src,
    $m$                        't', ut.type_name
                      )$m$,
    $m$                        't', ut.type_name
                      ) || CASE WHEN (SELECT p2.public_show_price
                                        FROM public.projects p2
                                       WHERE p2.id = v_link.project_id)
                                THEN jsonb_build_object('v', u.base_price)
                                ELSE '{}'::jsonb END$m$);

  IF out = src THEN
    RAISE EXCEPTION 'the unit object is not shaped the way this patch expects';
  END IF;

  /* and the page is told whether to expect one */
  out := replace(out, $m$    'area_unit', v_unit,$m$,
                      $m$    'area_unit', v_unit,
    'show_price', COALESCE(pr.public_show_price, false),$m$);

  EXECUTE out;

  /* A fresh CREATE hands EXECUTE to PUBLIC. This one is reached with an anon
     key and guards itself with the token, but the grant list still has to say
     what it meant to say. */
  EXECUTE 'REVOKE ALL ON FUNCTION public.get_public_availability(text) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_public_availability(text) TO anon, authenticated, service_role';
END
$mig$;

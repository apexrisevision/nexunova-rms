#!/usr/bin/env node
/* Builds supabase/migrations/20261125a_sale_own_nominee.sql from the LIVE definitions of _saf_make_sale and
   get_sale_detail (each change is an asserted, one-time insertion at an anchor). Read-only against the DB. */
const fs = require('fs'), path = require('path');
const { q } = require('./_sbq');
const OUT = path.join(__dirname, '..', 'supabase', 'migrations', '20261125a_sale_own_nominee.sql');
const once = (src, anchor, add, where) => {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error(`${where}: anchor found ${n} times`);
  return src.replace(anchor, anchor + add);
};
(async () => {
  const def = async f => (await q(`select pg_get_functiondef('public.${f}'::regproc) d`))[0].d.trim();
  let make = await def('_saf_make_sale');
  make = once(make, `  v_sale := (v_res->>'sale_id')::uuid;\n`,
`  -- the nominee belongs to the sale, not only to the client: one buyer with two units names a nominee per unit
  -- (20261125a — GF-250 / GF-251 both showed the second form's nominee)
  UPDATE public.sales SET nominee_name = NULLIF(btrim(f.nominee->>'name'), ''),
         nominee_cnic = NULLIF(btrim(f.nominee->>'cnic'), ''), nominee_relation = NULLIF(btrim(f.nominee->>'relation'), '')
   WHERE id = v_sale AND f.nominee IS NOT NULL;
`, '_saf_make_sale');
  let det = await def('get_sale_detail');
  det = once(det, `    'nominee_relation', s.nominee_relation,\n`,
`    'nominee_photo_url', (SELECT f.nominee_photo_url FROM public.sale_approval_forms f WHERE f.id = s.saf_id),
`, 'get_sale_detail');

  const sql = `-- ══ A sale keeps its own nominee (20261125a) ══
-- NOT APPLIED. Owner, 25-Nov-2026: "GF 250 aur GF251 … sale approval form banaya to us mai Nominee 250 mai aik dafa aur
-- 251 mai dosra Nominee tha magar jab dono units ki sale banai to us mai aik hee nominee aa raha hai dono units mai"
-- and "GF250 mai change the Zarbat Sair name to Zarafat Sair".
-- Cause: _saf_make_sale wrote the form's nominee only onto the CLIENT (next of kin), never onto the sale. Ali Haider is
-- one client with two units, so SAF-0026 (GF-251) overwrote SAF-0025's (GF-250) nominee, and the Application / Booking
-- Form prints the client's next of kin for both.
--   1. _saf_make_sale also writes the form's nominee onto the sale it makes (name, CNIC, relation).
--   2. get_sale_detail returns the nominee's photo from the sale's own form.
--   3. Every sale made from a form gets its form's nominee (19 sales, all with an empty nominee today).
--   4. Ali Haider (CLT-2026-0015): father's name Zarbat Sair -> Zarafat Sair; his next-of-kin photo was SAF-0026's
--      (Muhammad Asif Raza) under SAF-0025's name (Muhammad Ali Raza) — the photo goes back to SAF-0025's to match.
-- The approved forms SAF-0025 / SAF-0026 are signed records and are not edited.

${make};

${det};

UPDATE public.sales s
   SET nominee_name = NULLIF(btrim(f.nominee->>'name'), ''), nominee_cnic = NULLIF(btrim(f.nominee->>'cnic'), ''),
       nominee_relation = NULLIF(btrim(f.nominee->>'relation'), ''), updated_at = now()
  FROM public.sale_approval_forms f
 WHERE f.id = s.saf_id AND s.nominee_name IS NULL AND NULLIF(btrim(f.nominee->>'name'), '') IS NOT NULL;

DO $c$
DECLARE n int;
BEGIN
  UPDATE public.clients
     SET father_name = 'Zarafat Sair',
         notes = replace(notes, 'Zarbat Sair', 'Zarafat Sair'),
         next_of_kin_photo_url = (SELECT nominee_photo_url FROM public.sale_approval_forms WHERE saf_no = 'SAF-0025'
                                    AND company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'),
         updated_at = now()
   WHERE id = '10363ec2-fd80-42a0-b312-766cc2835a2c' AND father_name = 'Zarbat Sair';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Ali Haider (CLT-2026-0015) with father Zarbat Sair: % rows', n; END IF;
END $c$;
`;
  fs.writeFileSync(OUT, sql);
  console.log('written', OUT);
})();

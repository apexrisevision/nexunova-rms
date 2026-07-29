-- Proves the import performs ZERO writes to pre-existing client rows.
-- Compares a full-row md5 of each of the 5 already-present buyers,
-- captured before any import statement ran, against the same rows now.
DO $imm$
DECLARE t text; changed int;
BEGIN
  SELECT count(*) INTO changed
  FROM _cli_before b JOIN clients c ON c.id = b.id
  WHERE md5(c::text) <> b.rowhash;

  SELECT string_agg(
      rpad(b.client_code,13)
      || rpad(c.full_name,26)
      || 'rowhash_match=' || CASE WHEN md5(c::text)=b.rowhash THEN 'YES' ELSE 'NO ' END
      || '  updated_at_match=' || CASE WHEN c.updated_at=b.updated_at THEN 'YES' ELSE 'NO ' END
      || '  new_sales_attached=' || (SELECT count(*) FROM sales s
             WHERE s.client_id=c.id AND s.notes='2026-07-29 booking-record backfill')
    , E'\n' ORDER BY b.client_code)
  INTO t
  FROM _cli_before b JOIN clients c ON c.id = b.id;

  RAISE EXCEPTION E'\n%\n\nexisting client rows MODIFIED = % (must be 0)\nclients INSERTed by this run = %',
    t, changed,
    (SELECT count(*) FROM clients WHERE notes='2026-07-29 booking-record backfill');
END $imm$;

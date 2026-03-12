-- Remove duplicate HR Core epics — keep the earliest one
DO $$
DECLARE
  keep_id TEXT;
  del_count INT;
BEGIN
  -- Find the earliest HR Core epic
  SELECT id INTO keep_id FROM "Epic" WHERE title = 'HR Core' ORDER BY "createdAt" ASC LIMIT 1;

  IF keep_id IS NULL THEN
    RAISE NOTICE 'No HR Core epic found.';
    RETURN;
  END IF;

  -- Delete all others
  DELETE FROM "Epic"
  WHERE title = 'HR Core' AND id != keep_id;

  GET DIAGNOSTICS del_count = ROW_COUNT;
  RAISE NOTICE 'Kept epic %, deleted % duplicate(s).', keep_id, del_count;
END $$;

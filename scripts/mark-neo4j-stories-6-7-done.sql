DO $$
DECLARE epic_id TEXT;
BEGIN
  SELECT e.id INTO epic_id FROM "Epic" e WHERE e.title = 'Neo4j + Digital Product Backbone';
  IF epic_id IS NULL THEN RAISE EXCEPTION 'Epic not found'; END IF;
  UPDATE "BacklogItem" SET status = 'done', "updatedAt" = NOW()
  WHERE "epicId" = epic_id AND priority IN (6, 7);
  RAISE NOTICE 'Marked stories 6-7 done';
END $$;

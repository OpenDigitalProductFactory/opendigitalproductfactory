-- BI-00C68162: the input-provenance actor column holds an agent id (ai) or a
-- user id (human), so it can never be a foreign key; a bare "*Id" name trips
-- the FK index-coverage ratchet (BI-640B011D). Rename it for what it holds.
-- Idempotent and safe on any data state: renames only when the old column
-- exists and the new one does not; values are kept.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'BacklogItem' AND column_name = 'demandInputById'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'BacklogItem' AND column_name = 'demandInputActorRef'
  ) THEN
    ALTER TABLE "BacklogItem" RENAME COLUMN "demandInputById" TO "demandInputActorRef";
  END IF;
END $$;

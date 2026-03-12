-- Remove orphaned HR story duplicates left by the dedup operation.
-- The dedup deleted the second HR Core epic; its BacklogItems got epicId=NULL (SetNull).
-- These are exact duplicates of the items already inside the remaining HR Core epic.
DO $$
DECLARE
  del_count INT;
BEGIN
  DELETE FROM "BacklogItem"
  WHERE "epicId" IS NULL
    AND title LIKE 'EmployeeProfile model%'
     OR ("epicId" IS NULL AND title LIKE 'Employee lifecycle server actions%')
     OR ("epicId" IS NULL AND title LIKE 'Platform role assignment server actions%')
     OR ("epicId" IS NULL AND title LIKE 'Link EmployeeProfile to TaxonomyNode%')
     OR ("epicId" IS NULL AND title LIKE 'Employee directory read model%')
     OR ("epicId" IS NULL AND title LIKE 'Seed initial employee profiles%')
     OR ("epicId" IS NULL AND title LIKE '/employee route%')
     OR ("epicId" IS NULL AND title LIKE '/employee/[userId] detail page%');

  GET DIAGNOSTICS del_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % orphaned HR story duplicate(s).', del_count;
END $$;

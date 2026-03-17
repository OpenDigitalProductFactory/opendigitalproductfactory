-- Seed EP-REF-002: Admin Reference Data Management epic + backlog item
-- Run: psql $DATABASE_URL -f scripts/seed-refdata-admin-epic.sql

INSERT INTO "Epic" (id, title, status, "createdAt", "updatedAt")
VALUES (
  'ep-ref-002-admin-refdata',
  'Admin Reference Data Management',
  'done',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO "BacklogItem" (id, title, type, status, priority, "epicId", "completedAt", "createdAt", "updatedAt")
VALUES (
  'bi-ref-002-admin-page',
  'Admin page for managing geographic reference data and work location address linking',
  'product',
  'done',
  1,
  'ep-ref-002-admin-refdata',
  NOW(),
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

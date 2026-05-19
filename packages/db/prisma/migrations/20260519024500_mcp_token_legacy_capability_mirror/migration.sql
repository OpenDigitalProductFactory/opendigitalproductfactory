-- Keep the legacy read/write capability column as a compatibility mirror for
-- code, tests, and schema-regression policy while the new read/write/admin
-- scope column remains the source of truth.
ALTER TABLE "McpApiToken"
  ADD COLUMN "capability" TEXT NOT NULL DEFAULT 'read';

UPDATE "McpApiToken"
SET "capability" = CASE
  WHEN "scope" IN ('write', 'admin') THEN 'write'
  ELSE 'read'
END;

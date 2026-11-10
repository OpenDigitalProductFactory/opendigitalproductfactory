-- BI-763D6E01 (EP-07B49BD8): Workroom command receipts live in the Workroom's own
-- log. A command that carries an id writes one activity row (kind
-- command-accepted | command-rejected) with its scope and id; a retry with the
-- same pair replays that row. Design: docs/superpowers/specs/
-- 2026-10-07-durable-delegation-ledger-design.md §3-§4.3 ("WorkroomActivity
-- becomes the log", no parallel ledger).
--
-- Additive: two nullable columns and a unique index. Existing rows read NULL,
-- and Postgres never treats NULLs as equal in a unique index, so no existing row
-- can conflict. Safe against any data state and re-runnable.
ALTER TABLE "WorkCapsuleActivity" ADD COLUMN IF NOT EXISTS "commandScopeKey" TEXT;
ALTER TABLE "WorkCapsuleActivity" ADD COLUMN IF NOT EXISTS "commandKey" TEXT;
-- @migration-safety: data-safe: both columns are added by this migration, so every existing row holds NULL in them, and Postgres unique indexes never treat NULLs as equal; no existing row can violate the index.
CREATE UNIQUE INDEX IF NOT EXISTS "WorkCapsuleActivity_commandScopeKey_commandKey_key"
  ON "WorkCapsuleActivity"("commandScopeKey", "commandKey");

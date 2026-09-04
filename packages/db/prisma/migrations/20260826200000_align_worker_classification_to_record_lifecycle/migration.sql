-- Align the worker-classification models to two platform conventions they should
-- have used from the start (BI-C61CEEA9).
--
-- The preceding migration 20260826190000 is committed and applied, so it is
-- immutable — modifying it would corrupt Prisma's checksum tracking and break
-- every other environment on next migrate. This corrects it forward instead.
--
-- Two corrections, both caught by source policy guards rather than review:
--
-- 1. RECORD LIFECYCLE (BI-C357FA5A). The original modelled supersession as a
--    supersededAt timestamp plus a supersededById self-link. The platform
--    already has ONE record-lifecycle convention — lifecycle RecordLifecycle +
--    lifecycleAt + lifecycleReason — in which supersession is a STATE, not a
--    link. The original was a second home for a rule the platform already
--    states. The current determination for a worker is now the `active` row
--    with the newest determinedAt, and the self-relations disappear.
--
-- 2. IDENTITY KEY NAMING. determinationId and termId read as bare FK-shaped
--    columns to the FK-index coverage guard, which exempts a semantic key only
--    when it is named <lowerFirstModelName>Id and carries @unique. Renamed
--    rather than expanding a baseline the guard explicitly says not to expand
--    without an owned data-architecture decision.
--
-- SAFE ON POPULATED DATA. Both tables were created by the immediately preceding
-- migration in the same release and nothing writes them yet, so no row can hold
-- a supersession link to lose. The column renames preserve any rows that do
-- exist; the dropped columns carried no data.

-- Postgres truncates identifiers at 63 characters, so the unique-index name is
-- written pre-truncated here rather than letting the server silently shorten it
-- and leave the migration text disagreeing with what is actually stored.

-- ── 1. Identity key renames ───────────────────────────────────────────────────
ALTER TABLE "WorkerClassificationDetermination"
  RENAME COLUMN "determinationId" TO "workerClassificationDeterminationId";
ALTER INDEX "WorkerClassificationDetermination_determinationId_key"
  RENAME TO "WorkerClassificationDetermination_workerClassificationDetermi_k";

ALTER TABLE "WorkerEngagementTerm"
  RENAME COLUMN "termId" TO "workerEngagementTermId";
ALTER INDEX "WorkerEngagementTerm_termId_key"
  RENAME TO "WorkerEngagementTerm_workerEngagementTermId_key";

-- ── 2. Record-lifecycle convention ────────────────────────────────────────────
ALTER TABLE "WorkerClassificationDetermination"
  DROP CONSTRAINT IF EXISTS "WorkerClassificationDetermination_supersededById_fkey";
DROP INDEX IF EXISTS "WorkerClassificationDetermination_supersededById_key";
DROP INDEX IF EXISTS "WorkerClassificationDetermination_supersededAt_idx";
ALTER TABLE "WorkerClassificationDetermination"
  DROP COLUMN IF EXISTS "supersededById",
  DROP COLUMN IF EXISTS "supersededAt",
  ADD COLUMN "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
  ADD COLUMN "lifecycleAt" TIMESTAMP(3),
  ADD COLUMN "lifecycleReason" TEXT;
CREATE INDEX "WorkerClassificationDetermination_lifecycle_idx"
  ON "WorkerClassificationDetermination"("lifecycle");

ALTER TABLE "WorkerEngagementTerm"
  DROP CONSTRAINT IF EXISTS "WorkerEngagementTerm_supersededById_fkey";
DROP INDEX IF EXISTS "WorkerEngagementTerm_supersededById_key";
DROP INDEX IF EXISTS "WorkerEngagementTerm_supersededAt_idx";
ALTER TABLE "WorkerEngagementTerm"
  DROP COLUMN IF EXISTS "supersededById",
  DROP COLUMN IF EXISTS "supersededAt",
  ADD COLUMN "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
  ADD COLUMN "lifecycleAt" TIMESTAMP(3),
  ADD COLUMN "lifecycleReason" TEXT;
CREATE INDEX "WorkerEngagementTerm_lifecycle_idx"
  ON "WorkerEngagementTerm"("lifecycle");

-- `changeReason` is superseded by the convention's `lifecycleReason`, which
-- carries exactly the same fact — why this row stopped being current.
ALTER TABLE "WorkerEngagementTerm" DROP COLUMN IF EXISTS "changeReason";

-- BI-662254C6: five work-coordination relations on the WorkCapsule substrate.
-- Nesting is a join, not a parentWorkroomId column, because contains,
-- spawned-from, depends-on, blocks, and contributes-to are different facts.
--
-- @migration-safety: data-safe: additive enum + new table. Existing WorkCapsule
-- rows keep their columns. No stored relation JSON exists on live rooms to
-- copy, so backfill is a documented no-op rather than an invented graph.
--
-- Live-shaped: applies against the existing WorkCapsule population (currently
-- hundreds of development-session rooms plus standing business rooms). The
-- table is empty after apply; writers use assertWorkroomRelation so a contains
-- cycle and a portfolio-dependency alias cannot land.

-- CreateEnum
CREATE TYPE "WorkroomRelationKind" AS ENUM (
  'contains',
  'spawned-from',
  'depends-on',
  'blocks',
  'contributes-to'
);

-- CreateTable
CREATE TABLE "WorkCapsuleRelation" (
    "id" TEXT NOT NULL,
    "fromWorkroomId" TEXT NOT NULL,
    "toWorkroomId" TEXT NOT NULL,
    "relation" "WorkroomRelationKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkCapsuleRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkCapsuleRelation_fromWorkroomId_toWorkroomId_relation_key"
  ON "WorkCapsuleRelation"("fromWorkroomId", "toWorkroomId", "relation");

-- CreateIndex
CREATE INDEX "WorkCapsuleRelation_toWorkroomId_relation_idx"
  ON "WorkCapsuleRelation"("toWorkroomId", "relation");

-- CreateIndex
CREATE INDEX "WorkCapsuleRelation_relation_idx"
  ON "WorkCapsuleRelation"("relation");

-- AddForeignKey
ALTER TABLE "WorkCapsuleRelation"
  ADD CONSTRAINT "WorkCapsuleRelation_fromWorkroomId_fkey"
  FOREIGN KEY ("fromWorkroomId") REFERENCES "WorkCapsule"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCapsuleRelation"
  ADD CONSTRAINT "WorkCapsuleRelation_toWorkroomId_fkey"
  FOREIGN KEY ("toWorkroomId") REFERENCES "WorkCapsule"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: none. Live WorkCapsule rows do not carry a relation graph in
-- scopeClaims or workspaceState. Inventing contains/spawned-from edges from
-- title text or portfolio-role arrays would silently convert FPAW portfolio
-- dependencies into work-coordination relations — the defect this slice exists
-- to prevent.

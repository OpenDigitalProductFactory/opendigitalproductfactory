-- Phase 3 (typed output/deliverable forms). An obligation declares the FORM of
-- output that satisfies it, and a filing/deliverable can be tracked to a specific
-- obligation (not just a regulation).
ALTER TABLE "Obligation" ADD COLUMN "deliverableType" TEXT;

ALTER TABLE "RegulatorySubmission" ADD COLUMN "obligationId" TEXT;
CREATE INDEX "RegulatorySubmission_obligationId_idx" ON "RegulatorySubmission" ("obligationId");
-- @migration-safety: data-safe: obligationId is added NULL in this same migration, so every existing row is NULL and no row can violate the FK.
ALTER TABLE "RegulatorySubmission"
  ADD CONSTRAINT "RegulatorySubmission_obligationId_fkey"
  FOREIGN KEY ("obligationId") REFERENCES "Obligation" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Inline backfill (AGENTS.md: backfill for a data-moving migration goes inline):
-- the canonical "annual-report declaration" deliverable is the UK Provision 29
-- board declaration. Guarded on IS NULL; no-op on fresh installs (seeds set it).
UPDATE "Obligation"
   SET "deliverableType" = 'board-declaration'
 WHERE "reference" = 'ukcgc/p29-board-declaration' AND "deliverableType" IS NULL;

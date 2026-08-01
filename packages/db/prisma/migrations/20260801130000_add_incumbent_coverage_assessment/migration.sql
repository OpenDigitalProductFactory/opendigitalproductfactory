-- BI-548060D5 (D3) — per-customer incumbent coverage assessment.
--
-- Plan: docs/superpowers/plans/2026-08-01-incumbent-coverage-assessment.md §3.
-- Spec: docs/superpowers/specs/2026-07-23-incumbent-application-coverage-design.md §5.2.
--
-- The instantiated, evidenced coverage verdict for one customer's one incumbent
-- application. Distinct from the authored AbsorptionPosture (vendor-family
-- doctrine); this carries the per-org truth + provenance. Soft references
-- (plain nullable columns, no FK constraint) so an assessment can exist before
-- its referents are normalized — same pattern as AbsorptionPosture.
--
-- Purely additive: a new empty table with its indexes. No backfill, no column
-- rewrite, no constraint tightened on existing rows. Fleet-safe by construction
-- (data-safe per AGENTS.md §Migration-safety).

CREATE TABLE "IncumbentCoverageAssessment" (
  "id" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "digitalProductId" TEXT NOT NULL,
  "catalogIdentityId" TEXT,
  "verdict" TEXT NOT NULL,
  "coveringCapabilityKey" TEXT,
  "coveringBusinessCapabilityId" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "assessedVia" TEXT NOT NULL,
  "evidence" JSONB,
  "backlogItemId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IncumbentCoverageAssessment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncumbentCoverageAssessment_assessmentId_key"
  ON "IncumbentCoverageAssessment"("assessmentId");

CREATE INDEX "IncumbentCoverageAssessment_digitalProductId_idx"
  ON "IncumbentCoverageAssessment"("digitalProductId");
CREATE INDEX "IncumbentCoverageAssessment_verdict_idx"
  ON "IncumbentCoverageAssessment"("verdict");
CREATE INDEX "IncumbentCoverageAssessment_status_idx"
  ON "IncumbentCoverageAssessment"("status");
CREATE INDEX "IncumbentCoverageAssessment_assessedVia_idx"
  ON "IncumbentCoverageAssessment"("assessedVia");

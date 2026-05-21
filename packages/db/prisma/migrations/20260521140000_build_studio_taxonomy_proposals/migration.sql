-- Persist Build Studio taxonomy expansion proposals for architecture review.
CREATE TABLE "TaxonomyProposal" (
  "id" TEXT NOT NULL,
  "parentNodeId" TEXT NOT NULL,
  "proposedName" TEXT NOT NULL,
  "description" TEXT,
  "rationale" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "featureBuildId" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNotes" TEXT,
  "createdNodeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TaxonomyProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaxonomyProposal_status_idx" ON "TaxonomyProposal"("status");
CREATE INDEX "TaxonomyProposal_parentNodeId_idx" ON "TaxonomyProposal"("parentNodeId");
CREATE INDEX "TaxonomyProposal_featureBuildId_idx" ON "TaxonomyProposal"("featureBuildId");
CREATE INDEX "TaxonomyProposal_createdNodeId_idx" ON "TaxonomyProposal"("createdNodeId");

ALTER TABLE "TaxonomyProposal"
  ADD CONSTRAINT "TaxonomyProposal_parentNodeId_fkey"
  FOREIGN KEY ("parentNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxonomyProposal"
  ADD CONSTRAINT "TaxonomyProposal_createdNodeId_fkey"
  FOREIGN KEY ("createdNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaxonomyProposal"
  ADD CONSTRAINT "TaxonomyProposal_featureBuildId_fkey"
  FOREIGN KEY ("featureBuildId") REFERENCES "FeatureBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE;

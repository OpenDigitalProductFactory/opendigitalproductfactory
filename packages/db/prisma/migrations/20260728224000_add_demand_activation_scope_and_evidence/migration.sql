-- EP-ED496EB0 Phase 8 / BI-9E608678
-- @migration-safety: expand-first: nullable scope columns and a new evidence-link
-- table only. No historical BacklogItem is reclassified, scored, deleted, or
-- tightened. Every legacy null remains an explicit unclassified row.
-- @migration-safety: data-safe: BacklogItem scope columns are newly added and
-- null for every existing row, while DemandEvidenceLink is a newly empty table;
-- therefore the foreign keys and required fields cannot reject legacy data.

ALTER TABLE "BacklogItem"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "productLineId" TEXT,
  ADD COLUMN "businessProductId" TEXT;

CREATE TABLE "DemandEvidenceLink" (
  "id" TEXT NOT NULL,
  "evidenceLinkId" TEXT NOT NULL,
  "backlogItemId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceRef" TEXT NOT NULL,
  "wikiPageId" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "confidence" DOUBLE PRECISION,
  "reviewedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'active',
  "provenance" JSONB,
  "linkedByPrincipalId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DemandEvidenceLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DemandEvidenceLink_evidenceLinkId_key"
  ON "DemandEvidenceLink"("evidenceLinkId");
CREATE UNIQUE INDEX "DemandEvidenceLink_backlogItemId_sourceKind_sourceRef_key"
  ON "DemandEvidenceLink"("backlogItemId", "sourceKind", "sourceRef");
CREATE INDEX "DemandEvidenceLink_backlogItemId_status_idx"
  ON "DemandEvidenceLink"("backlogItemId", "status");
CREATE INDEX "DemandEvidenceLink_sourceKind_sourceRef_idx"
  ON "DemandEvidenceLink"("sourceKind", "sourceRef");
CREATE INDEX "DemandEvidenceLink_wikiPageId_idx"
  ON "DemandEvidenceLink"("wikiPageId");

CREATE INDEX "BacklogItem_organizationId_idx"
  ON "BacklogItem"("organizationId");
CREATE INDEX "BacklogItem_productLineId_idx"
  ON "BacklogItem"("productLineId");
CREATE INDEX "BacklogItem_businessProductId_idx"
  ON "BacklogItem"("businessProductId");

ALTER TABLE "BacklogItem"
  ADD CONSTRAINT "BacklogItem_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BacklogItem"
  ADD CONSTRAINT "BacklogItem_productLineId_organizationId_fkey"
  FOREIGN KEY ("productLineId", "organizationId")
  REFERENCES "ProductLine"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BacklogItem"
  ADD CONSTRAINT "BacklogItem_businessProductId_organizationId_fkey"
  FOREIGN KEY ("businessProductId", "organizationId")
  REFERENCES "Product"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DemandEvidenceLink"
  ADD CONSTRAINT "DemandEvidenceLink_backlogItemId_fkey"
  FOREIGN KEY ("backlogItemId") REFERENCES "BacklogItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemandEvidenceLink"
  ADD CONSTRAINT "DemandEvidenceLink_wikiPageId_fkey"
  FOREIGN KEY ("wikiPageId") REFERENCES "WikiPage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- MDM stewardship substrate (EP-4A12A7CB slice: BI-FEA49EC1 steward queue,
-- BI-28577CD1 staleness, BI-130EF887 attribute history, BI-37F52B70 match
-- config, plus the CustomerContact merge tombstone for BI-F71DBE84).
--
-- @migration-safety: data-safe: additive tables + one nullable column with a
-- self-referencing FK; no existing row can violate anything.

ALTER TABLE "CustomerContact" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "CustomerContact"
  ADD CONSTRAINT "CustomerContact_mergedIntoId_fkey"
  FOREIGN KEY ("mergedIntoId") REFERENCES "CustomerContact"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "CustomerContact_mergedIntoId_idx" ON "CustomerContact"("mergedIntoId");

CREATE TABLE "MdmStewardTask" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "subjectId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL DEFAULT '',
    "score" DOUBLE PRECISION,
    "reasons" JSONB,
    "note" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MdmStewardTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MdmStewardTask_taskId_key" ON "MdmStewardTask"("taskId");
CREATE UNIQUE INDEX "MdmStewardTask_domain_kind_subjectId_candidateId_key"
  ON "MdmStewardTask"("domain", "kind", "subjectId", "candidateId");
CREATE INDEX "MdmStewardTask_status_kind_idx" ON "MdmStewardTask"("status", "kind");
CREATE INDEX "MdmStewardTask_subjectId_idx" ON "MdmStewardTask"("subjectId");

CREATE TABLE "MdmAttributeChange" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "attribute" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "actorId" TEXT,
    "source" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MdmAttributeChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MdmAttributeChange_domain_entityId_changedAt_idx"
  ON "MdmAttributeChange"("domain", "entityId", "changedAt");
CREATE INDEX "MdmAttributeChange_attribute_idx" ON "MdmAttributeChange"("attribute");

CREATE TABLE "MdmMatchConfig" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MdmMatchConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MdmMatchConfig_domain_key" ON "MdmMatchConfig"("domain");

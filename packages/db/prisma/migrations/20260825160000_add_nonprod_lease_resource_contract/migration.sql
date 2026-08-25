-- BI-30EDD4B0: additive, nullable resource-admission metadata on the existing
-- durable lease authority. Existing rows retain their prior semantics.
ALTER TABLE "NonProductionEnvironmentLease"
  ADD COLUMN "resourceClass" TEXT,
  ADD COLUMN "expectedMemoryBytes" BIGINT,
  ADD COLUMN "ownerProcessId" INTEGER;

CREATE INDEX "NonProductionEnvironmentLease_resourceClass_status_idx"
  ON "NonProductionEnvironmentLease"("resourceClass", "status");

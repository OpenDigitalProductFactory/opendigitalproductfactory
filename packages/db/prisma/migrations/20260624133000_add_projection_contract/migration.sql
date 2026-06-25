-- EP-MSP-FEDERATION · B2 (BI-4F8F50FD) — scoped estate projection contract.
-- Per-link allow-list of exactly what crosses a FederationLink. Dedicated table
-- (not JSON on the link) so per-field allow/deny + CADA posture are queryable at
-- egress and the last negative-egress test result is auditable.
CREATE TABLE "ProjectionContract" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "federationLinkId" TEXT,
    "includeSlices" TEXT[],
    "excludeSlices" TEXT[],
    "fieldAllowList" JSONB,
    "retentionClass" TEXT NOT NULL DEFAULT 'standard',
    "cadaPosture" JSONB,
    "reviewCadenceDays" INTEGER,
    "lastTestResult" JSONB,
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectionContract_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectionContract_contractId_key" ON "ProjectionContract"("contractId");
CREATE INDEX "ProjectionContract_federationLinkId_idx" ON "ProjectionContract"("federationLinkId");

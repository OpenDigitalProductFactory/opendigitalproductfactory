-- BI-4512E7D2 / BI-BD88A142: break-glass informed-risk clearance override.
-- An operator's explicit, audited acceptance of the risk of letting a provider
-- serve a data sensitivity its account is NOT verified-safe for. Distinct from a
-- data-policy attestation; honored by the routing fence as a separate signal and
-- never widening ModelProvider.sensitivityClearance.
--
-- @migration-safety: data-safe: additive new table only. No existing table is
-- altered and no column is dropped, so every existing row is untouched. The
-- table is empty after apply (overrides default OFF — the safe path stays the
-- default), so there is nothing to backfill; every install behaves exactly as
-- before until an operator explicitly creates an override.
--
-- Live-shaped: applies against the existing Organization population (FK to
-- Organization with ON DELETE CASCADE, matching DataPolicyException).

-- CreateTable
CREATE TABLE "ProviderClearanceOverride" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "acceptedSensitivities" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "rationale" TEXT NOT NULL,
    "acknowledgedRisk" TEXT NOT NULL,
    "approverRef" TEXT,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByRef" TEXT,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderClearanceOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderClearanceOverride_organizationId_providerId_status_idx"
  ON "ProviderClearanceOverride"("organizationId", "providerId", "status");

-- CreateIndex
CREATE INDEX "ProviderClearanceOverride_providerId_idx"
  ON "ProviderClearanceOverride"("providerId");

-- CreateIndex
CREATE INDEX "ProviderClearanceOverride_expiresAt_idx"
  ON "ProviderClearanceOverride"("expiresAt");

-- AddForeignKey
ALTER TABLE "ProviderClearanceOverride"
  ADD CONSTRAINT "ProviderClearanceOverride_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderClearanceOverride"
  ADD CONSTRAINT "ProviderClearanceOverride_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ModelProvider"("providerId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Closed-set guard for `status` (AGENTS.md §8 / BI-817ED2D4). DB-enforced without
-- introducing an enum type, matching the sibling DataPolicyException.status shape.
-- NOT VALID so it binds new/updated rows without scanning a (here empty) table.
ALTER TABLE "ProviderClearanceOverride"
  ADD CONSTRAINT "ProviderClearanceOverride_status_closed_set"
  CHECK ("status" IN ('active', 'revoked', 'expired')) NOT VALID;

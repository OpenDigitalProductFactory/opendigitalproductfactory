-- BI-ECO-001 / BI-BF909CE6 (P1) — vendor ecosystem absorption matrix.
--
-- Plan: docs/superpowers/plans/2026-07-24-absorption-posture-matrix-vertical-provider-seed.md §3.
-- Kernel decision DI-A80D7C589EEB (shared-spine, config-driven): the absorption
-- matrix is the single classification the per-vertical boundary-maps, the
-- per-customer incumbent-coverage assessment, and the onboarding prefill all
-- consume.
--
-- DPF-authored doctrine, deliberately NOT a column on the registry-synced
-- McpIntegration (plan §2.1): a sync must never overwrite an authored verdict.
-- mcpIntegrationId / catalogIdentityId are soft references (plain nullable
-- columns, no FK constraint) so a posture can exist before the marketplace
-- catalog is populated.
--
-- Purely additive — a new empty table with its indexes. No backfill, no column
-- rewrite, no constraint tightened on existing rows. Fleet-safe by construction
-- (data-safe per AGENTS.md §Migration-safety).

CREATE TABLE "AbsorptionPosture" (
  "id" TEXT NOT NULL,
  "postureId" TEXT NOT NULL,
  "providerName" TEXT NOT NULL,
  "providerFamily" TEXT,
  "integrationCategory" TEXT NOT NULL,
  "connectorTier" TEXT NOT NULL,
  "archetypeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "verdict" TEXT NOT NULL DEFAULT 'gap',
  "coveringPrimitive" TEXT,
  "reason" TEXT NOT NULL DEFAULT '',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'seed',
  "mcpIntegrationId" TEXT,
  "catalogIdentityId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AbsorptionPosture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AbsorptionPosture_postureId_key"
  ON "AbsorptionPosture"("postureId");

-- One posture per (provider, category) — the authored classification is unique
-- per vendor system-kind.
CREATE UNIQUE INDEX "AbsorptionPosture_providerName_integrationCategory_key"
  ON "AbsorptionPosture"("providerName", "integrationCategory");

CREATE INDEX "AbsorptionPosture_verdict_idx" ON "AbsorptionPosture"("verdict");
CREATE INDEX "AbsorptionPosture_status_idx" ON "AbsorptionPosture"("status");
CREATE INDEX "AbsorptionPosture_integrationCategory_idx"
  ON "AbsorptionPosture"("integrationCategory");
CREATE INDEX "AbsorptionPosture_connectorTier_idx"
  ON "AbsorptionPosture"("connectorTier");

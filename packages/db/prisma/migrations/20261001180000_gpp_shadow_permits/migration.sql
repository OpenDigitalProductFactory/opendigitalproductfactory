-- GPP Phase 2 PR-C (BI-69415B68): shadow permits.
-- Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md
--
-- Forward-only and additive: three new enums, two new empty tables, and two
-- nullable columns on ToolExecution. No existing row is read, no column is
-- altered, renamed or dropped, and nothing is backfilled (NULL on an older
-- ToolExecution row honestly means "recorded before permits existed").
-- IF NOT EXISTS and the duplicate_object guards keep a re-run harmless, so it
-- applies on an empty schema, on live data and on a partially applied install.
-- Generated with `prisma migrate diff`, then wrapped in idempotence guards.

DO $$ BEGIN
  CREATE TYPE "GppPermitEnforcement" AS ENUM ('shadow', 'enforced', 'environment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GppPermitVerdict" AS ENUM ('ungoverned', 'valid', 'absent', 'expired', 'revoked', 'exhausted', 'tool_not_in_capabilities', 'unmediated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GppObservationPath" AS ENUM ('monitor', 'direct');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ToolExecution" ADD COLUMN IF NOT EXISTS "gppPermitRef" TEXT;
ALTER TABLE "ToolExecution" ADD COLUMN IF NOT EXISTS "gppPermitVerdict" "GppPermitVerdict";

CREATE TABLE IF NOT EXISTS "GppPermit" (
    "id" TEXT NOT NULL,
    "gppPermitId" TEXT NOT NULL,
    "bindingKey" TEXT NOT NULL,
    "bindingVersion" INTEGER NOT NULL,
    "shapeRef" TEXT,
    "stageKey" TEXT,
    "gateKey" TEXT NOT NULL,
    "authority" "DecisionScope" NOT NULL,
    "gateDecisionRef" TEXT,
    "authorityDecisionRef" TEXT,
    "envelopeId" TEXT,
    "actorGaid" TEXT,
    "actorUserRef" TEXT NOT NULL,
    "actorAgentRef" TEXT,
    "workroomRef" TEXT,
    "subjectScope" TEXT,
    "capabilities" JSONB NOT NULL,
    "paramHash" TEXT,
    "enforcement" "GppPermitEnforcement" NOT NULL DEFAULT 'shadow',
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "nonce" TEXT NOT NULL,
    "parentPermitId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "keyRef" TEXT,
    "mac" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GppPermit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GppPermitObservation" (
    "id" TEXT NOT NULL,
    "permitRowId" TEXT,
    "bindingKey" TEXT,
    "toolName" TEXT NOT NULL,
    "verdict" "GppPermitVerdict" NOT NULL,
    "enforcement" "GppPermitEnforcement" NOT NULL DEFAULT 'shadow',
    "path" "GppObservationPath" NOT NULL,
    "toolExecutionId" TEXT,
    "callerSite" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GppPermitObservation_pkey" PRIMARY KEY ("id")
);

-- @migration-safety: data-safe: GppPermit is created empty in this same migration, so no row can violate the unique gppPermitId.
CREATE UNIQUE INDEX IF NOT EXISTS "GppPermit_gppPermitId_key" ON "GppPermit"("gppPermitId");
CREATE INDEX IF NOT EXISTS "GppPermit_gateDecisionRef_idx" ON "GppPermit"("gateDecisionRef");
CREATE INDEX IF NOT EXISTS "GppPermit_authorityDecisionRef_idx" ON "GppPermit"("authorityDecisionRef");
CREATE INDEX IF NOT EXISTS "GppPermit_envelopeId_idx" ON "GppPermit"("envelopeId");
CREATE INDEX IF NOT EXISTS "GppPermit_parentPermitId_idx" ON "GppPermit"("parentPermitId");
CREATE INDEX IF NOT EXISTS "GppPermit_workroomRef_createdAt_idx" ON "GppPermit"("workroomRef", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "GppPermit_expiresAt_idx" ON "GppPermit"("expiresAt");
CREATE INDEX IF NOT EXISTS "GppPermit_createdAt_idx" ON "GppPermit"("createdAt");

CREATE INDEX IF NOT EXISTS "GppPermitObservation_verdict_createdAt_idx" ON "GppPermitObservation"("verdict", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "GppPermitObservation_bindingKey_createdAt_idx" ON "GppPermitObservation"("bindingKey", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "GppPermitObservation_toolName_createdAt_idx" ON "GppPermitObservation"("toolName", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "GppPermitObservation_permitRowId_idx" ON "GppPermitObservation"("permitRowId");
CREATE INDEX IF NOT EXISTS "GppPermitObservation_toolExecutionId_idx" ON "GppPermitObservation"("toolExecutionId");
CREATE INDEX IF NOT EXISTS "GppPermitObservation_createdAt_idx" ON "GppPermitObservation"("createdAt");

-- @migration-safety: data-safe: GppPermit is created empty in this same migration, and the FK sets NULL on delete.
DO $$ BEGIN
  ALTER TABLE "GppPermit" ADD CONSTRAINT "GppPermit_envelopeId_fkey"
    FOREIGN KEY ("envelopeId") REFERENCES "CoworkerActionEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- @migration-safety: data-safe: GppPermit is created empty in this same migration, and the FK sets NULL on delete.
DO $$ BEGIN
  ALTER TABLE "GppPermit" ADD CONSTRAINT "GppPermit_parentPermitId_fkey"
    FOREIGN KEY ("parentPermitId") REFERENCES "GppPermit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- @migration-safety: data-safe: GppPermitObservation is created empty in this same migration, and the FK sets NULL on delete.
DO $$ BEGIN
  ALTER TABLE "GppPermitObservation" ADD CONSTRAINT "GppPermitObservation_permitRowId_fkey"
    FOREIGN KEY ("permitRowId") REFERENCES "GppPermit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- @migration-safety: data-safe: GppPermitObservation is created empty in this same migration, and the FK sets NULL on delete.
DO $$ BEGIN
  ALTER TABLE "GppPermitObservation" ADD CONSTRAINT "GppPermitObservation_toolExecutionId_fkey"
    FOREIGN KEY ("toolExecutionId") REFERENCES "ToolExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

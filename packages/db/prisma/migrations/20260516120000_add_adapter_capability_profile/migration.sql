-- AdapterCapabilityProfile — coworker execution adapter substrate (Phase A1).
--
-- Captures observed adapter capabilities per (adapterKind, adapterVersion).
-- Replaces hand-maintained capability tables with probe-populated rows.
--
-- Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A1)
-- Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §4.1
--
-- Purely additive: creates one new table with one unique index and one
-- supporting index. No existing tables, columns, or enums are touched.

-- CreateTable
CREATE TABLE "AdapterCapabilityProfile" (
    "id" TEXT NOT NULL,
    "adapterKind" TEXT NOT NULL,
    "adapterVersion" TEXT NOT NULL,
    "probedAt" TIMESTAMP(3) NOT NULL,
    "probedBy" TEXT NOT NULL,
    "supportsStreamingEvents" BOOLEAN NOT NULL,
    "supportsMcpAttach" BOOLEAN NOT NULL,
    "supportsMcpAttachPerInvoke" BOOLEAN NOT NULL,
    "supportsSubagents" BOOLEAN NOT NULL,
    "supportsHooks" BOOLEAN NOT NULL,
    "supportsPlanState" BOOLEAN NOT NULL,
    "supportsTodoState" BOOLEAN NOT NULL,
    "supportsWebFetch" BOOLEAN NOT NULL,
    "supportsWebSearch" BOOLEAN NOT NULL,
    "supportsSessionResume" BOOLEAN NOT NULL,
    "supportsExtendedThinking" BOOLEAN NOT NULL,
    "supportsOutputSchema" BOOLEAN NOT NULL,
    "maxInteractiveLatencyMs" INTEGER NOT NULL,
    "supportedAuthModes" TEXT[],
    "knownDegradations" JSONB,

    CONSTRAINT "AdapterCapabilityProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdapterCapabilityProfile_adapterKind_probedAt_idx" ON "AdapterCapabilityProfile"("adapterKind", "probedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdapterCapabilityProfile_adapterKind_adapterVersion_key" ON "AdapterCapabilityProfile"("adapterKind", "adapterVersion");

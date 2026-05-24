-- Reduction Gear Phase 0 — GearInterface canonical observation envelope.
--
-- Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §3.1
-- BI:   BI-85CB31F0 (Phase 0 pilot)
-- Epic: EP-REDUCTION-GEAR-ARCH
--
-- One row per "transmission" at a ring interface in the agentic gear train.
-- Phase 0 emits at Ring 1→2 (Coworker → Workflow) only; outer rings get
-- contract stubs but no production dual-emission yet.
--
-- Authority model: existing source tables (ToolExecution, AdapterRunTelemetry,
-- BuildPhaseRun, FeatureBuild, RuntimeVerification, …) remain authoritative
-- write models. This table dual-emits alongside them — it never replaces them.

CREATE TABLE "GearInterface" (
    "id" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceEventAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "organizationId" TEXT,

    "interfaceClass" TEXT NOT NULL,
    "transmissionDirection" TEXT NOT NULL DEFAULT 'outward',
    "innerRing" INTEGER,
    "outerRing" INTEGER,
    "externalCounterpartyType" TEXT,
    "externalCounterpartyId" TEXT,

    "shaftSourceType" TEXT NOT NULL,
    "shaftSourceId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorPrincipalId" TEXT,
    "intent" TEXT NOT NULL,

    "capabilityName" TEXT NOT NULL,
    "capabilityVocabularyVersion" TEXT NOT NULL DEFAULT 'raw-v0',
    "archetypeContext" TEXT,
    "agentIdForTriple" TEXT NOT NULL,

    "torqueTechnical" DOUBLE PRECISION NOT NULL,
    "torqueValue" DOUBLE PRECISION,
    "torqueConfidence" DOUBLE PRECISION NOT NULL,
    "ratioConsumed" INTEGER NOT NULL,
    "outcomeType" TEXT NOT NULL,
    "slipDetected" BOOLEAN NOT NULL DEFAULT false,
    "slipReason" TEXT,

    "costUsd" DECIMAL(12, 6),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheCreationInputTokens" INTEGER,
    "cacheReadInputTokens" INTEGER,
    "reasoningOutputTokens" INTEGER,
    "durationMs" INTEGER,

    "graduationFromAutonomy" TEXT,
    "graduationToAutonomy" TEXT,
    "graduationSampleSize" INTEGER,
    "graduationGovernorRef" TEXT,

    "graderType" TEXT NOT NULL,
    "graderId" TEXT,
    "rationale" TEXT,

    "otelTraceId" TEXT,
    "otelSpanId" TEXT,

    CONSTRAINT "GearInterface_pkey" PRIMARY KEY ("id")
);

-- Idempotency / replay-safety: writer service derives a deterministic key per
-- (interfaceClass, ring direction, source event, outcome). Duplicates upsert.
CREATE UNIQUE INDEX "GearInterface_idempotencyKey_key" ON "GearInterface"("idempotencyKey");

-- Cockpit time-range queries by org
CREATE INDEX "GearInterface_organizationId_recordedAt_idx" ON "GearInterface"("organizationId", "recordedAt");

-- Cockpit by-interface drill-downs ("Ring 2→3 outward in last 7 days")
CREATE INDEX "GearInterface_innerRing_outerRing_transmissionDirection_recordedAt_idx"
    ON "GearInterface"("innerRing", "outerRing", "transmissionDirection", "recordedAt");

-- Capability×archetype rollups for the Calibrator (Phase 1) and wear queries
CREATE INDEX "GearInterface_capabilityName_archetypeContext_recordedAt_idx"
    ON "GearInterface"("capabilityName", "archetypeContext", "recordedAt");

-- Per-triple trust queries — the unit of trust per spec §3.3
CREATE INDEX "GearInterface_agentIdForTriple_capabilityName_archetypeContext_idx"
    ON "GearInterface"("agentIdForTriple", "capabilityName", "archetypeContext");

-- Drill from a GearInterface row back to its source event row
CREATE INDEX "GearInterface_shaftSourceType_shaftSourceId_idx"
    ON "GearInterface"("shaftSourceType", "shaftSourceId");

-- Outcome filtering ("show me all slips this week", "show me graduations today")
CREATE INDEX "GearInterface_outcomeType_recordedAt_idx" ON "GearInterface"("outcomeType", "recordedAt");

-- Invariant checks — kept as CHECK constraints because they encode the schema
-- contract from spec §3.1 and must hold for every row regardless of which
-- emitter wrote it. Writer service also validates pre-write for better errors.
ALTER TABLE "GearInterface"
    ADD CONSTRAINT "GearInterface_interfaceClass_check"
    CHECK ("interfaceClass" IN ('internal-adjacent', 'external-federated', 'external-bridged', 'external-customer'));

ALTER TABLE "GearInterface"
    ADD CONSTRAINT "GearInterface_transmissionDirection_check"
    CHECK ("transmissionDirection" IN ('outward', 'inward', 'lateral'));

-- internal-adjacent requires inner + outer ring with outer = inner + 1, both 1..5
ALTER TABLE "GearInterface"
    ADD CONSTRAINT "GearInterface_internal_adjacent_rings_check"
    CHECK (
        ("interfaceClass" <> 'internal-adjacent')
        OR (
            "innerRing" IS NOT NULL
            AND "outerRing" IS NOT NULL
            AND "innerRing" BETWEEN 1 AND 5
            AND "outerRing" BETWEEN 1 AND 5
            AND "outerRing" = "innerRing" + 1
        )
    );

-- lateral direction is reserved for external classes only
ALTER TABLE "GearInterface"
    ADD CONSTRAINT "GearInterface_lateral_external_only_check"
    CHECK (
        ("transmissionDirection" <> 'lateral')
        OR ("interfaceClass" LIKE 'external-%')
    );

-- external-* requires counterparty type
ALTER TABLE "GearInterface"
    ADD CONSTRAINT "GearInterface_external_counterparty_type_check"
    CHECK (
        ("interfaceClass" NOT LIKE 'external-%')
        OR ("externalCounterpartyType" IS NOT NULL)
    );

-- graduation outcome requires from/to autonomy + governor ref
ALTER TABLE "GearInterface"
    ADD CONSTRAINT "GearInterface_graduation_fields_check"
    CHECK (
        ("outcomeType" <> 'graduation')
        OR (
            "graduationFromAutonomy" IS NOT NULL
            AND "graduationToAutonomy" IS NOT NULL
            AND "graduationGovernorRef" IS NOT NULL
        )
    );

-- torque components are 0..1
ALTER TABLE "GearInterface"
    ADD CONSTRAINT "GearInterface_torque_ranges_check"
    CHECK (
        "torqueTechnical" >= 0 AND "torqueTechnical" <= 1
        AND "torqueConfidence" >= 0 AND "torqueConfidence" <= 1
        AND ("torqueValue" IS NULL OR ("torqueValue" >= 0 AND "torqueValue" <= 1))
    );

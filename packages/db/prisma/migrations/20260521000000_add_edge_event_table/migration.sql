-- Slice 0 of edge-node detection engine (PagerDuty-equivalent event coverage).
-- Spec: docs/superpowers/specs/2026-05-21-edge-event-envelope-design.md
-- BI:   BI-9FE9D48D
--
-- Canonical PD-CEF-style event row persisted from POST /api/v1/edge/events.
-- Dedup is (edgeNodeId, dedupKey) so the same condition collapses on replay
-- and the keyspace is isolated per edge node.

CREATE TABLE "EdgeEvent" (
    "id"              TEXT NOT NULL,
    "edgeNodeId"      TEXT NOT NULL,
    "dedupKey"        TEXT NOT NULL,
    "source"          TEXT NOT NULL,
    "component"       TEXT,
    "eventGroup"      TEXT,
    "eventClass"      TEXT,
    "severity"        TEXT NOT NULL DEFAULT 'warn',
    "status"          TEXT NOT NULL DEFAULT 'triggered',
    "action"          TEXT NOT NULL DEFAULT 'trigger',
    "summary"         TEXT NOT NULL,
    "customDetails"   JSONB,
    "occurredAt"      TIMESTAMP(3) NOT NULL,
    "firstSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"      TIMESTAMP(3),
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EdgeEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EdgeEvent_edgeNodeId_dedupKey_key" ON "EdgeEvent"("edgeNodeId", "dedupKey");
CREATE INDEX "EdgeEvent_edgeNodeId_status_idx" ON "EdgeEvent"("edgeNodeId", "status");
CREATE INDEX "EdgeEvent_severity_idx" ON "EdgeEvent"("severity");
CREATE INDEX "EdgeEvent_source_idx" ON "EdgeEvent"("source");
CREATE INDEX "EdgeEvent_occurredAt_idx" ON "EdgeEvent"("occurredAt");

ALTER TABLE "EdgeEvent"
    ADD CONSTRAINT "EdgeEvent_edgeNodeId_fkey"
    FOREIGN KEY ("edgeNodeId") REFERENCES "EdgeNode"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

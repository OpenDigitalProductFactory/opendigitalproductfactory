-- Slice 1 of the edge-node detection engine (BI-8405FDA5).
-- Spec: docs/superpowers/specs/2026-05-21-edge-change-events-design.md
--
-- Point-in-time change records (deploys, config pushes, feature flips)
-- persisted from POST /api/v1/edge/events when eventType="change". The
-- correlation engine (separate slice) joins alerts to changes within an
-- N-minute window. Distinct from EdgeEvent because changes have no
-- lifecycle: action / status / resolvedAt / occurrenceCount don't apply.

CREATE TABLE "ChangeEvent" (
    "id"            TEXT NOT NULL,
    "edgeNodeId"    TEXT NOT NULL,
    "changeKey"     TEXT NOT NULL,
    "source"        TEXT NOT NULL,
    "component"     TEXT,
    "eventGroup"    TEXT,
    "eventClass"    TEXT,
    "severity"      TEXT NOT NULL DEFAULT 'info',
    "summary"       TEXT NOT NULL,
    "customDetails" JSONB,
    "occurredAt"    TIMESTAMP(3) NOT NULL,
    "firstSeenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChangeEvent_edgeNodeId_changeKey_key" ON "ChangeEvent"("edgeNodeId", "changeKey");

-- Composite index powers the correlation engine's "changes for this node
-- in the last N minutes" join against alert events. Mirrors the
-- EdgeEvent.occurredAt index so both sides of the join are O(log n).
CREATE INDEX "ChangeEvent_edgeNodeId_occurredAt_idx" ON "ChangeEvent"("edgeNodeId", "occurredAt");
CREATE INDEX "ChangeEvent_source_idx" ON "ChangeEvent"("source");
CREATE INDEX "ChangeEvent_occurredAt_idx" ON "ChangeEvent"("occurredAt");

ALTER TABLE "ChangeEvent"
    ADD CONSTRAINT "ChangeEvent_edgeNodeId_fkey"
    FOREIGN KEY ("edgeNodeId") REFERENCES "EdgeNode"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- BI-23A65B81 (EP-8C706944 P3): shared multi-coworker effort working context.
-- New table only — no constraint touches existing data.
-- @migration-safety: data-safe: creates a new table; no existing row is affected.
CREATE TABLE "EffortContext" (
    "id" TEXT NOT NULL,
    "effortKey" TEXT NOT NULL,
    "title" TEXT,
    "epicId" TEXT,
    "backlogItemId" TEXT,
    "decisions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "openQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "participantAgentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EffortContext_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EffortContext_effortKey_key" ON "EffortContext"("effortKey");
CREATE INDEX "EffortContext_epicId_idx" ON "EffortContext"("epicId");
CREATE INDEX "EffortContext_backlogItemId_idx" ON "EffortContext"("backlogItemId");

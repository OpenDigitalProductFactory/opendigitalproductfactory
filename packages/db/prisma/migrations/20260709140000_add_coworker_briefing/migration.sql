-- BI-A9052DCB (EP-8C706944 P3): session-start projection briefing cache.
-- New table only — no constraint touches existing data.
-- @migration-safety: data-safe: creates a new table; no existing row is affected.
CREATE TABLE "CoworkerBriefing" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceDigest" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoworkerBriefing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoworkerBriefing_agentId_scope_scopeKey_key" ON "CoworkerBriefing"("agentId", "scope", "scopeKey");
CREATE INDEX "CoworkerBriefing_agentId_scope_idx" ON "CoworkerBriefing"("agentId", "scope");

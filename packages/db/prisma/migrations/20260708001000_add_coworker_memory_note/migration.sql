-- BI-F9025BA0 (EP-CLAUDE-INSIDE-OUT): per-coworker durable working memory. A
-- role-local notes layer (techniques, workspace context, cautions) that survives
-- across sessions, superseded-by-key on (agentId, noteKind, noteKey). Distinct
-- from the shared WWMD/WWWD corpus and the per-user UserFact store.
--
-- @migration-safety: data-safe: creates one new table with FK to Agent
-- (ON DELETE CASCADE) and no changes to existing tables or rows; nothing to
-- backfill and no existing row can violate the new indexes.

CREATE TABLE "CoworkerMemoryNote" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "noteKind" TEXT NOT NULL,
    "noteKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceRef" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "supersededById" TEXT,

    CONSTRAINT "CoworkerMemoryNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CoworkerMemoryNote_agentId_supersededAt_idx" ON "CoworkerMemoryNote"("agentId", "supersededAt");

CREATE INDEX "CoworkerMemoryNote_agentId_noteKind_noteKey_idx" ON "CoworkerMemoryNote"("agentId", "noteKind", "noteKey");

ALTER TABLE "CoworkerMemoryNote" ADD CONSTRAINT "CoworkerMemoryNote_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Profession corpus runtime (WSID Phase 3): persist coworker USAGE of the
-- per-profession corpus, distinct from coverage (pages seeded). Two additive
-- tables: a deduplicated growth-backlog of corpus gaps surfaced by real usage,
-- and a bounded per-profession/day usage counter (injected vs missed). Additive
-- only — no existing table or row is touched.

-- CreateTable
CREATE TABLE "ProfessionCorpusGap" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "professionKey" TEXT NOT NULL,
    "agentId" TEXT,
    "routeContext" TEXT,
    "query" TEXT NOT NULL,
    "missingTopic" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "suggestedSource" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'open',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionCorpusGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionCorpusUsageStat" (
    "id" TEXT NOT NULL,
    "professionKey" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "injectedCount" INTEGER NOT NULL DEFAULT 0,
    "missedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionCorpusUsageStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionCorpusGap_fingerprint_key" ON "ProfessionCorpusGap"("fingerprint");

-- CreateIndex
CREATE INDEX "ProfessionCorpusGap_professionKey_status_idx" ON "ProfessionCorpusGap"("professionKey", "status");

-- CreateIndex
CREATE INDEX "ProfessionCorpusGap_status_idx" ON "ProfessionCorpusGap"("status");

-- CreateIndex
CREATE INDEX "ProfessionCorpusGap_reason_idx" ON "ProfessionCorpusGap"("reason");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionCorpusUsageStat_professionKey_day_key" ON "ProfessionCorpusUsageStat"("professionKey", "day");

-- CreateIndex
CREATE INDEX "ProfessionCorpusUsageStat_professionKey_idx" ON "ProfessionCorpusUsageStat"("professionKey");

-- CreateIndex
CREATE INDEX "ProfessionCorpusUsageStat_day_idx" ON "ProfessionCorpusUsageStat"("day");

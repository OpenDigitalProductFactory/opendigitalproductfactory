-- Hive Contributions consent surface (spec §6.1)

-- PlatformDevConfig: device-fingerprint opt-in (default ON, PII-free) + master pause.
ALTER TABLE "PlatformDevConfig" ADD COLUMN "deviceFingerprintOptIn" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PlatformDevConfig" ADD COLUMN "hiveContributionsPaused" BOOLEAN NOT NULL DEFAULT false;

-- One contribution ledger for every type that flows to the hive.
CREATE TABLE "HiveContributionLedger" (
    "id" TEXT NOT NULL,
    "contributionType" TEXT NOT NULL,
    "contributor" TEXT NOT NULL,
    "ruleKey" TEXT,
    "summary" TEXT NOT NULL,
    "payloadHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "redactionStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiveContributionLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiveContributionLedger_contributionType_idx" ON "HiveContributionLedger"("contributionType");
CREATE INDEX "HiveContributionLedger_status_idx" ON "HiveContributionLedger"("status");
CREATE INDEX "HiveContributionLedger_contributor_idx" ON "HiveContributionLedger"("contributor");

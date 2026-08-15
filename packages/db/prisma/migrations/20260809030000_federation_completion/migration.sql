-- Queue-backed federation delivery + trusted-peer introduction candidates.
-- Additive/nullable defaults make this safe for every existing installation.

ALTER TABLE "WorkItem"
  ADD COLUMN "sourceKey" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT;

-- @migration-safety: data-safe: sourceKey is newly added and nullable, so every existing row is NULL and PostgreSQL unique indexes permit multiple NULL values.
CREATE UNIQUE INDEX "WorkItem_sourceKey_key" ON "WorkItem"("sourceKey");
CREATE INDEX "WorkItem_status_nextAttemptAt_idx" ON "WorkItem"("status", "nextAttemptAt");

ALTER TABLE "FederationLink"
  ADD COLUMN "offersIntroductions" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "acceptsIntroductions" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "peerDeviceId" TEXT;

CREATE INDEX "FederationLink_peerDeviceId_idx" ON "FederationLink"("peerDeviceId");

ALTER TABLE "FederationPairingSession"
  ADD COLUMN "offeredRole" TEXT NOT NULL DEFAULT 'same-org-peer';

CREATE TABLE "FederationIntroductionCandidate" (
  "id" TEXT NOT NULL,
  "introductionId" TEXT NOT NULL,
  "introducerLinkId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "authorityUrl" TEXT NOT NULL,
  "relationshipHint" TEXT NOT NULL,
  "introducedByPath" TEXT[],
  "hopCount" INTEGER NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "withdrawnAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "pairedFederationLinkId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FederationIntroductionCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FederationIntroductionCandidate_introductionId_key"
  ON "FederationIntroductionCandidate"("introductionId");
CREATE UNIQUE INDEX "FederationIntroductionCandidate_introducerLinkId_installationId_key"
  ON "FederationIntroductionCandidate"("introducerLinkId", "installationId");
CREATE INDEX "FederationIntroductionCandidate_expiresAt_withdrawnAt_dismissedAt_idx"
  ON "FederationIntroductionCandidate"("expiresAt", "withdrawnAt", "dismissedAt");
CREATE INDEX "FederationIntroductionCandidate_installationId_idx"
  ON "FederationIntroductionCandidate"("installationId");

ALTER TABLE "FederationIntroductionCandidate"
  ADD CONSTRAINT "FederationIntroductionCandidate_introducerLinkId_fkey"
  FOREIGN KEY ("introducerLinkId") REFERENCES "FederationLink"("linkId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- EP-MARKETING-EXEC Phase 2: external publish/send record.

CREATE TABLE IF NOT EXISTS "OutboundPublication" (
    "publicationId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "credentialId" TEXT,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByUserId" TEXT NOT NULL,
    "toolExecutionId" TEXT,
    "channelMetadata" JSONB,
    "lastMetricsPolledAt" TIMESTAMP(3),
    "lastMetricsSnapshot" JSONB,

    CONSTRAINT "OutboundPublication_pkey" PRIMARY KEY ("publicationId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OutboundPublication_channelId_externalId_key"
    ON "OutboundPublication"("channelId", "externalId");

CREATE INDEX IF NOT EXISTS "OutboundPublication_draftId_idx"
    ON "OutboundPublication"("draftId");

CREATE INDEX IF NOT EXISTS "OutboundPublication_channelId_publishedAt_idx"
    ON "OutboundPublication"("channelId", "publishedAt");

ALTER TABLE "OutboundPublication"
    ADD CONSTRAINT "OutboundPublication_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "OutboundDraft"("draftId")
    ON DELETE CASCADE ON UPDATE CASCADE;

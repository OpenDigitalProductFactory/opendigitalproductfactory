-- EP-MARKETING-EXEC Phase 3: inbound channel message substrate.

CREATE TABLE IF NOT EXISTS "InboundChannelMessage" (
    "inboundId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "fromAddress" TEXT,
    "fromDisplayName" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" TEXT,
    "routedEngagementId" TEXT,
    "draftedReplyId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "InboundChannelMessage_pkey" PRIMARY KEY ("inboundId")
);

CREATE INDEX IF NOT EXISTS "InboundChannelMessage_organizationId_domain_receivedAt_idx"
    ON "InboundChannelMessage"("organizationId", "domain", "receivedAt");

CREATE INDEX IF NOT EXISTS "InboundChannelMessage_channelId_externalThreadId_idx"
    ON "InboundChannelMessage"("channelId", "externalThreadId");

CREATE INDEX IF NOT EXISTS "InboundChannelMessage_classification_idx"
    ON "InboundChannelMessage"("classification");

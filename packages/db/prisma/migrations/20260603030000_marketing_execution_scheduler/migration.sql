-- EP-MARKETING-EXEC Phase 5: scheduler + bounded autopilot.

CREATE TABLE IF NOT EXISTS "ScheduledOutboundAction" (
    "scheduleId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "firedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "autopilotPolicyId" TEXT,
    "scheduledByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledOutboundAction_pkey" PRIMARY KEY ("scheduleId")
);

CREATE INDEX IF NOT EXISTS "ScheduledOutboundAction_status_scheduledFor_idx"
    ON "ScheduledOutboundAction"("status", "scheduledFor");

CREATE INDEX IF NOT EXISTS "ScheduledOutboundAction_organizationId_kind_status_idx"
    ON "ScheduledOutboundAction"("organizationId", "kind", "status");

CREATE INDEX IF NOT EXISTS "ScheduledOutboundAction_targetId_idx"
    ON "ScheduledOutboundAction"("targetId");

CREATE TABLE IF NOT EXISTS "OutboundAutopilotPolicy" (
    "policyId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT 'marketing',
    "channelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoApproveBelowWords" INTEGER,
    "autoPublishAfterMinutes" INTEGER,
    "weeklyCeiling" INTEGER NOT NULL,
    "enabledByUserId" TEXT NOT NULL,
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundAutopilotPolicy_pkey" PRIMARY KEY ("policyId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OutboundAutopilotPolicy_organizationId_channelId_key"
    ON "OutboundAutopilotPolicy"("organizationId", "channelId");

CREATE INDEX IF NOT EXISTS "OutboundAutopilotPolicy_channelId_enabled_idx"
    ON "OutboundAutopilotPolicy"("channelId", "enabled");

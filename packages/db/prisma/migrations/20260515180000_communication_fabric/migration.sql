-- CreateTable
CREATE TABLE "CommunicationChannelBinding" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "employeeProfileId" TEXT,
    "channelType" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "providerAccountId" TEXT,
    "externalSubject" TEXT NOT NULL,
    "displayLabel" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
    "allowedDirections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedUrgencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quietHours" JSONB,
    "preferences" JSONB,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastTestedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationChannelBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationChannelSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "providerAccountId" TEXT,
    "externalPeerId" TEXT NOT NULL,
    "trustLevel" TEXT NOT NULL DEFAULT 'unknown',
    "principalId" TEXT,
    "agentThreadId" TEXT,
    "workItemId" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationChannelSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "channelBindingId" TEXT,
    "channelType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "urgency" TEXT NOT NULL DEFAULT 'routine',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationChannelBinding_bindingId_key" ON "CommunicationChannelBinding"("bindingId");

-- CreateIndex
CREATE INDEX "CommunicationChannelBinding_principalId_idx" ON "CommunicationChannelBinding"("principalId");

-- CreateIndex
CREATE INDEX "CommunicationChannelBinding_employeeProfileId_idx" ON "CommunicationChannelBinding"("employeeProfileId");

-- CreateIndex
CREATE INDEX "CommunicationChannelBinding_channelType_isActive_idx" ON "CommunicationChannelBinding"("channelType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationChannelBinding_channelType_providerKey_provide_key" ON "CommunicationChannelBinding"("channelType", "providerKey", "providerAccountId", "externalSubject");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationChannelSession_sessionId_key" ON "CommunicationChannelSession"("sessionId");

-- CreateIndex
CREATE INDEX "CommunicationChannelSession_principalId_idx" ON "CommunicationChannelSession"("principalId");

-- CreateIndex
CREATE INDEX "CommunicationChannelSession_agentThreadId_idx" ON "CommunicationChannelSession"("agentThreadId");

-- CreateIndex
CREATE INDEX "CommunicationChannelSession_workItemId_idx" ON "CommunicationChannelSession"("workItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationChannelSession_channelType_providerKey_provide_key" ON "CommunicationChannelSession"("channelType", "providerKey", "providerAccountId", "externalPeerId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationDeliveryAttempt_attemptId_key" ON "CommunicationDeliveryAttempt"("attemptId");

-- CreateIndex
CREATE INDEX "CommunicationDeliveryAttempt_targetType_targetId_idx" ON "CommunicationDeliveryAttempt"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "CommunicationDeliveryAttempt_channelBindingId_idx" ON "CommunicationDeliveryAttempt"("channelBindingId");

-- CreateIndex
CREATE INDEX "CommunicationDeliveryAttempt_channelType_status_idx" ON "CommunicationDeliveryAttempt"("channelType", "status");

-- CreateIndex
CREATE INDEX "CommunicationDeliveryAttempt_createdAt_idx" ON "CommunicationDeliveryAttempt"("createdAt");

-- AddForeignKey
ALTER TABLE "CommunicationChannelBinding" ADD CONSTRAINT "CommunicationChannelBinding_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationChannelBinding" ADD CONSTRAINT "CommunicationChannelBinding_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationChannelSession" ADD CONSTRAINT "CommunicationChannelSession_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationDeliveryAttempt" ADD CONSTRAINT "CommunicationDeliveryAttempt_channelBindingId_fkey" FOREIGN KEY ("channelBindingId") REFERENCES "CommunicationChannelBinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

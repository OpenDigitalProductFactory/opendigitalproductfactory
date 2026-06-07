-- AlterTable
ALTER TABLE "PlatformDevConfig" ADD COLUMN     "upstreamFeedbackOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upstreamFeedbackOptInAt" TIMESTAMP(3),
ADD COLUMN     "upstreamFeedbackOptInById" TEXT,
ADD COLUMN     "upstreamRelayUrl" TEXT;

-- AddForeignKey
ALTER TABLE "PlatformDevConfig" ADD CONSTRAINT "PlatformDevConfig_upstreamFeedbackOptInById_fkey" FOREIGN KEY ("upstreamFeedbackOptInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

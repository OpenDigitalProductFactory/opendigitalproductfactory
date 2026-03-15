-- AlterTable
ALTER TABLE "BacklogItem" ADD COLUMN "source" TEXT;
ALTER TABLE "BacklogItem" ADD COLUMN "occurrenceCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BacklogItem" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DigitalProduct" ADD COLUMN "observationConfig" JSONB;

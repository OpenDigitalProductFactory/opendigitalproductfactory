-- AlterTable
ALTER TABLE "ModelProvider" ADD COLUMN     "catalogVisibility" TEXT NOT NULL DEFAULT 'visible',
ADD COLUMN     "catalogEntry" JSONB;

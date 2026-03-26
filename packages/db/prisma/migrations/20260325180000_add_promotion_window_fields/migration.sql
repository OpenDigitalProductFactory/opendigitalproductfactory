-- AlterTable: Add deployment window override and destructive operation acknowledgment to ChangePromotion
ALTER TABLE "ChangePromotion" ADD COLUMN "windowOverrideReason" TEXT;
ALTER TABLE "ChangePromotion" ADD COLUMN "destructiveAcknowledged" BOOLEAN NOT NULL DEFAULT false;

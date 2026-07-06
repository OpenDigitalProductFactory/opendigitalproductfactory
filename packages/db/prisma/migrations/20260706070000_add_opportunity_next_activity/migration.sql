-- Activity-based selling: every open opportunity should carry a planned next
-- step. Nullable add — purely additive, no backfill needed.

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "nextActivityAt" TIMESTAMP(3);

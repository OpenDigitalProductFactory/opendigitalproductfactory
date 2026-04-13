-- Make fitnessScore nullable
ALTER TABLE "RouteDecisionLog" ALTER COLUMN "fitnessScore" DROP NOT NULL;

-- Backfill: NaN → NULL
UPDATE "RouteDecisionLog" SET "fitnessScore" = NULL WHERE "fitnessScore" != "fitnessScore";

-- Backfill: value > 1.0 → value / 100
UPDATE "RouteDecisionLog" SET "fitnessScore" = "fitnessScore" / 100.0 WHERE "fitnessScore" > 1.0;

-- Backfill: value < 0.0 → NULL
UPDATE "RouteDecisionLog" SET "fitnessScore" = NULL WHERE "fitnessScore" < 0;

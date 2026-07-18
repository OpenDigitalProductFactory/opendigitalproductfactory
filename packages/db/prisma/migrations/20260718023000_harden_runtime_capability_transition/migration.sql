ALTER TABLE "RuntimeCapabilityTransition"
  ADD COLUMN "previousProfiles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "desiredProfiles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "previousStates" JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN "desiredStates" JSONB NOT NULL DEFAULT '{}'::JSONB;

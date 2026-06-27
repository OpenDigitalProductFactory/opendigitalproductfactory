-- Add context-economy telemetry to durable coworker turn metrics.
ALTER TABLE "CoworkerTurnMetric"
ADD COLUMN "ctxPeakTokens" INTEGER,
ADD COLUMN "ctxWindowTokens" INTEGER,
ADD COLUMN "toolSurfaceCount" INTEGER,
ADD COLUMN "toolDefinitionTokens" INTEGER,
ADD COLUMN "toolSurfaceExceedsLocalCliff" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "toolSurfaceWindowShare" DOUBLE PRECISION,
ADD COLUMN "toolSelectionAccuracy" DOUBLE PRECISION;

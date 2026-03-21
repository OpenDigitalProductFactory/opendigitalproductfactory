-- EP-INF-006: Add RouteOutcome and RecipePerformance tables for routing telemetry

CREATE TABLE "RouteOutcome" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "recipeId" TEXT,
    "contractFamily" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION,
    "schemaValid" BOOLEAN,
    "toolSuccess" BOOLEAN,
    "fallbackOccurred" BOOLEAN NOT NULL DEFAULT false,
    "graderScore" DOUBLE PRECISION,
    "humanScore" DOUBLE PRECISION,
    "providerErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteOutcome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RouteOutcome_requestId_key" ON "RouteOutcome"("requestId");
CREATE INDEX "RouteOutcome_recipeId_contractFamily_idx" ON "RouteOutcome"("recipeId", "contractFamily");
CREATE INDEX "RouteOutcome_providerId_modelId_idx" ON "RouteOutcome"("providerId", "modelId");

CREATE TABLE "RecipePerformance" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "contractFamily" TEXT NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "avgLatencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgGraderScore" DOUBLE PRECISION,
    "avgHumanScore" DOUBLE PRECISION,
    "avgSchemaValidRate" DOUBLE PRECISION,
    "avgToolSuccessRate" DOUBLE PRECISION,
    "ewmaReward" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastObservedAt" TIMESTAMP(3),

    CONSTRAINT "RecipePerformance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecipePerformance_recipeId_contractFamily_key" ON "RecipePerformance"("recipeId", "contractFamily");

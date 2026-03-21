-- EP-INF-005b: Add ExecutionRecipe table for contract-based routing pipeline
CREATE TABLE "ExecutionRecipe" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "contractFamily" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'champion',
    "origin" TEXT NOT NULL DEFAULT 'seed',
    "providerSettings" JSONB NOT NULL,
    "toolPolicy" JSONB NOT NULL DEFAULT '{}',
    "responsePolicy" JSONB NOT NULL DEFAULT '{}',
    "parentRecipeId" TEXT,
    "mutationSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "promotedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "ExecutionRecipe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExecutionRecipe_providerId_modelId_contractFamily_version_key" ON "ExecutionRecipe"("providerId", "modelId", "contractFamily", "version");
CREATE INDEX "ExecutionRecipe_contractFamily_status_idx" ON "ExecutionRecipe"("contractFamily", "status");

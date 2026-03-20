-- EP-INF-005a: Add contract template fields to TaskRequirement
ALTER TABLE "TaskRequirement" ADD COLUMN "reasoningDepthDefault" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "TaskRequirement" ADD COLUMN "budgetClassDefault" TEXT NOT NULL DEFAULT 'balanced';
ALTER TABLE "TaskRequirement" ADD COLUMN "interactionModeDefault" TEXT NOT NULL DEFAULT 'sync';
ALTER TABLE "TaskRequirement" ADD COLUMN "supportedInputModalities" JSONB NOT NULL DEFAULT '["text"]';
ALTER TABLE "TaskRequirement" ADD COLUMN "supportedOutputModalities" JSONB NOT NULL DEFAULT '["text"]';
ALTER TABLE "TaskRequirement" ADD COLUMN "residencyPolicy" TEXT;

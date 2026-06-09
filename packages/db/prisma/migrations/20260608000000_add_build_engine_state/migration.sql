-- CreateTable
CREATE TABLE "build_engine_state" (
    "engineId" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT false,
    "version" TEXT,
    "lastProbedAt" TIMESTAMP(3),
    "lastProvisionedAt" TIMESTAMP(3),
    "recipeApplied" TEXT,
    "desired" TEXT NOT NULL DEFAULT 'present',
    "provisionedBy" TEXT,

    CONSTRAINT "build_engine_state_pkey" PRIMARY KEY ("engineId")
);

-- AddForeignKey
ALTER TABLE "build_engine_state" ADD CONSTRAINT "build_engine_state_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "build_engine"("engineId") ON DELETE CASCADE ON UPDATE CASCADE;

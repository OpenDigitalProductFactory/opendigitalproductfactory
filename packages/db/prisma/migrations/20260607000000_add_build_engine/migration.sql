-- CreateTable
CREATE TABLE "build_engine" (
    "engineId" TEXT NOT NULL,
    "binary" TEXT NOT NULL,
    "verifyCommand" TEXT NOT NULL,
    "versionRegex" TEXT NOT NULL,
    "bakeInDefault" BOOLEAN NOT NULL DEFAULT false,
    "recipes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "build_engine_pkey" PRIMARY KEY ("engineId")
);

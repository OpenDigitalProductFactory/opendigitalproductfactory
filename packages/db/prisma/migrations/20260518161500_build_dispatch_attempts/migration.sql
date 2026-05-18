-- Persist codex-dispatch attempts so Build Studio and MCP observers can
-- surface exact execution failure axes without Docker log access.

CREATE TABLE "BuildDispatchAttempt" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "taskTitle" TEXT NOT NULL,
    "specialist" TEXT,
    "providerId" TEXT,
    "model" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "exitCode" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "failureAxis" TEXT NOT NULL DEFAULT 'unknown',
    "stdoutExcerpt" TEXT,
    "stderrExcerpt" TEXT,
    "rootCauseSummary" TEXT,
    "rootCauseHash" TEXT,

    CONSTRAINT "BuildDispatchAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BuildDispatchAttempt_buildId_startedAt_idx"
    ON "BuildDispatchAttempt"("buildId", "startedAt");

CREATE INDEX "BuildDispatchAttempt_buildId_taskTitle_startedAt_idx"
    ON "BuildDispatchAttempt"("buildId", "taskTitle", "startedAt");

CREATE INDEX "BuildDispatchAttempt_failureAxis_startedAt_idx"
    ON "BuildDispatchAttempt"("failureAxis", "startedAt");

ALTER TABLE "BuildDispatchAttempt" ADD CONSTRAINT "BuildDispatchAttempt_buildId_fkey"
    FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId") ON DELETE CASCADE ON UPDATE CASCADE;

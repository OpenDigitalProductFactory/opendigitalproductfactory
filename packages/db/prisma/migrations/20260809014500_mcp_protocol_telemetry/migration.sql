-- Privacy-safe MCP compatibility/resource observations. This table contains
-- bounded labels and counts only; request/task payloads and identities remain
-- in their canonical domain owners.
CREATE TYPE "McpProtocolEra" AS ENUM ('modern', 'legacy', 'unknown');
CREATE TYPE "McpTelemetryAuthSource" AS ENUM ('bearer', 'session-jwt', 'none');
CREATE TYPE "McpTelemetryResultClass" AS ENUM (
  'success',
  'task',
  'input-required',
  'auth-error',
  'protocol-error',
  'internal-error',
  'http-error'
);

CREATE TABLE "McpProtocolTelemetry" (
  "id" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "protocolVersion" TEXT NOT NULL,
  "protocolEra" "McpProtocolEra" NOT NULL,
  "clientKind" TEXT NOT NULL,
  "clientVersion" TEXT,
  "authSource" "McpTelemetryAuthSource" NOT NULL,
  "method" TEXT NOT NULL,
  "methodFamily" TEXT NOT NULL,
  "legacySessionUsed" BOOLEAN NOT NULL DEFAULT false,
  "tasksExtensionUsed" BOOLEAN NOT NULL DEFAULT false,
  "resultClass" "McpTelemetryResultClass" NOT NULL,
  "httpStatus" INTEGER NOT NULL,
  "latencyMs" INTEGER NOT NULL,
  "compatibilityFailure" TEXT,
  "activeRequestCount" INTEGER NOT NULL,
  "suspendedTaskCount" INTEGER,
  "sharedWatcherCount" INTEGER NOT NULL DEFAULT 0,
  "queuedResumptionCount" INTEGER NOT NULL DEFAULT 0,
  "processRssBytes" BIGINT,
  CONSTRAINT "McpProtocolTelemetry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "McpProtocolTelemetry_recordedAt_idx"
  ON "McpProtocolTelemetry"("recordedAt" DESC);
CREATE INDEX "McpProtocolTelemetry_protocolEra_recordedAt_idx"
  ON "McpProtocolTelemetry"("protocolEra", "recordedAt" DESC);
CREATE INDEX "McpProtocolTelemetry_clientKind_clientVersion_recordedAt_idx"
  ON "McpProtocolTelemetry"("clientKind", "clientVersion", "recordedAt" DESC);
CREATE INDEX "McpProtocolTelemetry_resultClass_recordedAt_idx"
  ON "McpProtocolTelemetry"("resultClass", "recordedAt" DESC);

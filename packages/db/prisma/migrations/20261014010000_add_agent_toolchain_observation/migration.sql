-- BI-54469E18: connection-observed agent toolchain copies (additive).
CREATE TYPE "AgentToolchainAuthMode" AS ENUM ('oauth', 'bearer', 'session');

CREATE TABLE "AgentToolchainObservation" (
    "id" TEXT NOT NULL,
    "credentialRef" TEXT NOT NULL,
    "loadedDigest" TEXT NOT NULL,
    "clientKind" TEXT NOT NULL,
    "probableClient" TEXT,
    "loadedPackVersion" TEXT,
    "authMode" "AgentToolchainAuthMode" NOT NULL,
    "clientInfoName" TEXT,
    "clientInfoVersion" TEXT,
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolchainObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentToolchainObservation_credentialRef_loadedDigest_key" ON "AgentToolchainObservation"("credentialRef", "loadedDigest");
CREATE INDEX "AgentToolchainObservation_lastObservedAt_idx" ON "AgentToolchainObservation"("lastObservedAt" DESC);

-- Closed set kept as text with a NOT VALID check (closed-set ratchet, BI-817ED2D4):
-- the values carry hyphens ("claude-code") that a Prisma enum would have to remap.
ALTER TABLE "AgentToolchainObservation" ADD CONSTRAINT "AgentToolchainObservation_clientKind_closed_set"
    CHECK ("clientKind" IN ('claude-code', 'codex', 'grok', 'antigravity', 'undeclared')) NOT VALID;

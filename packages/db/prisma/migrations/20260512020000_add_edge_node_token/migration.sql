-- Per-node rotating bearer token for the DPF Edge Node. dpfedge_<base32>
-- on the wire; sha256 hash stored at rest. Mirrors the McpApiToken
-- pattern with the differences the spec calls out: machine-bound (FK to
-- EdgeNode), shorter-lived, rotates per heartbeat.
--
-- Multiple rows per EdgeNode are expected (current + recently-rotated),
-- accepted within a grace window so heartbeat-race conditions don't
-- lock the node out.

-- CreateTable
CREATE TABLE "EdgeNodeToken" (
    "id" TEXT NOT NULL,
    "edgeNodeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "EdgeNodeToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EdgeNodeToken_tokenHash_key" ON "EdgeNodeToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EdgeNodeToken_edgeNodeId_revokedAt_expiresAt_idx" ON "EdgeNodeToken"("edgeNodeId", "revokedAt", "expiresAt");

-- AddForeignKey
ALTER TABLE "EdgeNodeToken" ADD CONSTRAINT "EdgeNodeToken_edgeNodeId_fkey" FOREIGN KEY ("edgeNodeId") REFERENCES "EdgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

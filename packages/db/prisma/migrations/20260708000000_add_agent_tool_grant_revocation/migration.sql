-- BI-4FA040D5: durable coworker tool-grant revocations. The boot seed re-applies
-- grants from HARDCODED_COWORKER_GRANTS/ONBOARDING_AGENT_GRANTS on every start
-- and reconciles hardcoded coworkers to their declared set, which silently
-- resurrected any seed grant an operator had revoked (and pruned operator-added
-- grants). This table is the durable delta: a revoke writes a tombstone here and
-- the seed/bootstrap paths skip any (agentId, grantKey) that carries one; a
-- (re-)grant deletes it. The reconcile is separately scoped to grantedBy = null
-- so operator-added grants survive. Additive-only.
--
-- @migration-safety: data-safe: creates one new table with FK to Agent
-- (ON DELETE CASCADE) and no changes to existing tables or rows; nothing to
-- backfill and no existing row can violate the new unique/index.

CREATE TABLE "AgentToolGrantRevocation" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "grantKey" TEXT NOT NULL,
    "revokedBy" TEXT,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolGrantRevocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentToolGrantRevocation_agentId_grantKey_key" ON "AgentToolGrantRevocation"("agentId", "grantKey");

CREATE INDEX "AgentToolGrantRevocation_grantKey_idx" ON "AgentToolGrantRevocation"("grantKey");

ALTER TABLE "AgentToolGrantRevocation" ADD CONSTRAINT "AgentToolGrantRevocation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

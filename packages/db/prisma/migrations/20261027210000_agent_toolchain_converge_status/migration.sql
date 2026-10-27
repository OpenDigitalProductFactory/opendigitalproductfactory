-- BI-3E66F76F: how the host convergence agent last fared, as each connection declares it.
CREATE TYPE "AgentToolchainConvergeStatus" AS ENUM ('ok', 'failed', 'needs_operator', 'opted_out', 'offline', 'ahead_of_portal', 'busy');

ALTER TABLE "AgentToolchainObservation"
  ADD COLUMN "convergeStatus" "AgentToolchainConvergeStatus",
  ADD COLUMN "convergeCode" TEXT,
  ADD COLUMN "convergeSince" TIMESTAMP(3);

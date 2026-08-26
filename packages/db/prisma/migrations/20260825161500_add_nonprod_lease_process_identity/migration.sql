-- PID alone is not a stable process identity because operating systems reuse it.
ALTER TABLE "NonProductionEnvironmentLease"
  ADD COLUMN "ownerProcessIdentity" TEXT;

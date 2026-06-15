-- BI-4F3B2FA9: mid-flight emergency escalation for an already-running drain.
-- Additive, nullable columns — existing rows remain valid with null values.
-- shipForceEscalatedAt / shipForceEscalatedBy record when/who promoted a drain
-- to forced mode via the "Force Now" operator action; the coordinator re-reads
-- shipForceEscalatedAt each wait tick and treats non-null as shipForce.
ALTER TABLE "QuiescenceRun" ADD COLUMN "shipForceEscalatedAt" TIMESTAMP(3);
ALTER TABLE "QuiescenceRun" ADD COLUMN "shipForceEscalatedBy" TEXT;

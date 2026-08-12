-- FederatedRecordMirror.version / acknowledgedVersion: Int -> BigInt. (BI-CC8021CE)
--
-- A demand envelope's originVersion is derived from the source record's updatedAt
-- epoch in MILLISECONDS (~1.7e12) so that re-projecting an unchanged record is
-- idempotent (same mtime -> same version -> same payload digest -> noop). That
-- value overflows Int (int4, max 2,147,483,647), so federatedRecordMirror.create
-- failed with P2020 "value out of range for type integer" and NO demand mirror was
-- ever written across a federation link. Widening to BigInt (int8) fixes it.
--
-- Widening Int -> BigInt is a safe, non-destructive in-place cast in Postgres.
ALTER TABLE "FederatedRecordMirror" ALTER COLUMN "version" SET DATA TYPE BIGINT;
ALTER TABLE "FederatedRecordMirror" ALTER COLUMN "acknowledgedVersion" SET DATA TYPE BIGINT;

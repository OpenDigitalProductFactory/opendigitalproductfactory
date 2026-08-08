-- FederatedRecordMirror.versionVector — per-installation causal-ordering vector. (BI-67315C4A)
--
-- Additive, nullable JSONB. When present on both peer + local mirrors, the demand
-- exchange uses it to tell a clean newer-than from a genuine concurrent conflict;
-- null on legacy rows / peers that predate it, where the exchange falls back to the
-- scalar `version`. Non-destructive: no existing row is rewritten.
ALTER TABLE "FederatedRecordMirror" ADD COLUMN "versionVector" JSONB;

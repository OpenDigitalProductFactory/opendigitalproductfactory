-- BI-706530B2: per-thread dispatch boundary.
--
-- Messages created before this instant are withheld from the payload sent to a
-- model. Nothing is deleted and nothing is hidden from the owner; this bounds
-- egress only. Null everywhere until an owner explicitly asks, so the column is
-- a strict no-op for every existing thread.
ALTER TABLE "AgentThread" ADD COLUMN IF NOT EXISTS "historyWithheldBefore" TIMESTAMP(3);

-- BI-706530B2: the coworker panel explains a local-only verdict by reading the
-- screen receipt on the route decision for a thread's latest assistant message.
-- That lookup is by agentMessageId, which had no index, so every panel load
-- would scan RouteDecisionLog. Concurrent-safe and idempotent: creating an
-- index applies cleanly against any existing data state.
CREATE INDEX IF NOT EXISTS "RouteDecisionLog_agentMessageId_createdAt_idx"
  ON "RouteDecisionLog" ("agentMessageId", "createdAt");

-- Clear stale hardcoded pinnedProviderId from onboarding-coo agent.
--
-- Root cause: bootstrap-first-run.ts was seeding pinnedProviderId: "local"
-- which prevented the router from automatically switching to better-tier providers
-- (Codex, Claude API, etc.) when available.
--
-- The fix: express capability requirements instead (minimumTier: "strong",
-- minimumCapabilities: { toolUse: true }) and let the router pick the best
-- available provider matching those requirements. This clears stale pins so the
-- new capability-based routing takes effect immediately on next seed.

UPDATE "AgentModelConfig"
SET "pinnedProviderId" = NULL
WHERE "agentId" = 'onboarding-coo' AND "pinnedProviderId" = 'local';

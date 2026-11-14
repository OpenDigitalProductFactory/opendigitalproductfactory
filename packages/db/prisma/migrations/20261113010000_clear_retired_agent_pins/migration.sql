-- Clear AgentModelConfig pins that reference a retired model.
--
-- Root cause: an agent can carry a hard pin (pinnedProviderId + pinnedModelId)
-- to a specific model. When that model's ModelProfile is later retired
-- (modelStatus = 'retired') or soft-retired (retiredAt set while modelStatus
-- still reads e.g. "active"), the pin keeps the router aimed at an endpoint
-- that no longer serves traffic. The COO, for example, still pins
-- chatgpt / gpt-6.1-sol after that profile was retired.
--
-- The fix: clear the stale pin so the router falls back to capability-based
-- selection (minimumTier / minimumCapabilities) and picks the best available
-- live endpoint. Both pin columns are cleared together — a provider pin with
-- no model, or a model pin with no provider, is not a meaningful route — matching
-- the precedent in 20260416010000_clear_onboarding_agent_pin.
--
-- The join is by (pinnedProviderId, pinnedModelId) → ModelProfile(providerId,
-- modelId), which is the ModelProfile unique key; ModelProfile.providerId is in
-- turn a ModelProvider.providerId. The retiredAt arm matters independently of
-- modelStatus: a profile can read modelStatus = "active" while retiredAt is set,
-- which hides it from routing (see seed.ts), so matching only on modelStatus
-- would leave those pins stale.
--
-- Data-only and idempotent: it clears columns on the matched rows and no-ops on
-- a second run once the pins are null (pinnedModelId IS NOT NULL guard).

-- @migration-safety: data-safe: sets nullable AgentModelConfig.pinnedModelId / pinnedProviderId to NULL only for rows whose pinned model profile is retired; no schema change, no constraint can be violated, re-runnable.
UPDATE "AgentModelConfig" AS amc
SET "pinnedModelId" = NULL,
    "pinnedProviderId" = NULL
WHERE amc."pinnedModelId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "ModelProfile" AS mp
    WHERE mp."providerId" = amc."pinnedProviderId"
      AND mp."modelId" = amc."pinnedModelId"
      AND (mp."modelStatus" = 'retired' OR mp."retiredAt" IS NOT NULL)
  );

-- Auto-derive ModelProvider.capabilityTier from max(ModelProfile.qualityTier)
-- across active, non-retired profiles for that provider.
--
-- Resolves BI-INST-005: ModelProvider.capabilityTier is seeded once
-- (default 'basic') and never re-evaluated when stronger-tier model
-- profiles are added. The TAK agent router filters by provider tier
-- (lib/tak/agent-router.ts:47), so a `local` provider hosting a
-- strong-tier qwen3:14B model still rejects `minimumTier=strong`
-- coworker requests as long as the provider row stays at `basic`.
--
-- A Postgres trigger handles propagation in one atomic spot rather
-- than threading the same update through every code path that mutates
-- ModelProfile (5 upsert sites in ai-provider-internals.ts plus the
-- retire path in eval-runner.ts). The trigger fires within the same
-- transaction as the ModelProfile mutation, so the provider tier is
-- always consistent with its active profiles.
--
-- Tier ordering (highest to lowest): frontier > strong > adequate > basic.
-- If a provider has zero active profiles (e.g. all retired), capabilityTier
-- falls back to 'basic' — the default for newly-seeded providers — so the
-- column never violates its NOT NULL constraint.
--
-- Spec: docs/superpowers/specs/2026-05-23-first-run-customer-experience-hardening-design.md §6.3

-- ── Helper: recompute one provider's tier from its active profiles ────────
CREATE OR REPLACE FUNCTION recompute_provider_capability_tier(p_provider_id text)
RETURNS void AS $$
DECLARE
  max_tier text;
BEGIN
  SELECT
    CASE
      WHEN bool_or(qt = 'frontier') THEN 'frontier'
      WHEN bool_or(qt = 'strong')   THEN 'strong'
      WHEN bool_or(qt = 'adequate') THEN 'adequate'
      ELSE 'basic'
    END
  INTO max_tier
  FROM (
    SELECT "qualityTier" AS qt
    FROM "ModelProfile"
    WHERE "providerId" = p_provider_id
      AND "modelStatus" = 'active'
      AND "retiredAt" IS NULL
      AND "qualityTier" IS NOT NULL
  ) AS active_profiles;

  -- If no active profiles match, max_tier comes back NULL from the CASE
  -- (bool_or over empty set returns NULL). Fall back to basic.
  IF max_tier IS NULL THEN
    max_tier := 'basic';
  END IF;

  UPDATE "ModelProvider"
  SET "capabilityTier" = max_tier
  WHERE "providerId" = p_provider_id
    AND "capabilityTier" IS DISTINCT FROM max_tier;
END;
$$ LANGUAGE plpgsql;

-- ── Trigger: propagate tier changes from ModelProfile to ModelProvider ────
CREATE OR REPLACE FUNCTION model_profile_tier_propagate()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_provider_capability_tier(OLD."providerId");
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only recompute if a tier-affecting field changed (qualityTier,
    -- modelStatus, retiredAt) OR if the providerId itself changed.
    -- Other column updates (description, pricing, etc.) don't affect
    -- the derived provider tier so we skip the recompute to keep the
    -- trigger cheap on high-frequency metadata updates.
    IF NEW."providerId" IS DISTINCT FROM OLD."providerId" THEN
      PERFORM recompute_provider_capability_tier(OLD."providerId");
      PERFORM recompute_provider_capability_tier(NEW."providerId");
    ELSIF NEW."qualityTier"  IS DISTINCT FROM OLD."qualityTier"
       OR NEW."modelStatus"  IS DISTINCT FROM OLD."modelStatus"
       OR NEW."retiredAt"    IS DISTINCT FROM OLD."retiredAt" THEN
      PERFORM recompute_provider_capability_tier(NEW."providerId");
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM recompute_provider_capability_tier(NEW."providerId");
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS model_profile_tier_propagate_trigger ON "ModelProfile";
CREATE TRIGGER model_profile_tier_propagate_trigger
  AFTER INSERT OR UPDATE OR DELETE ON "ModelProfile"
  FOR EACH ROW
  EXECUTE FUNCTION model_profile_tier_propagate();

-- ── Backfill: bring all existing providers in line with their profiles ────
-- This catches the case in the wild today where local provider hosts
-- strong-tier qwen3:14B-Q6_K but its capabilityTier is still 'basic'.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT DISTINCT "providerId" FROM "ModelProfile" LOOP
    PERFORM recompute_provider_capability_tier(p."providerId");
  END LOOP;
END $$;

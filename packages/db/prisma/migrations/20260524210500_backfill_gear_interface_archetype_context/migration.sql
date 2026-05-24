-- BI-44C34478 — GearInterface Ring 2+ archetypeContext must carry the
-- portable StorefrontArchetype.archetypeId slug, not an install-local FK.

-- One-time cleanup for rows emitted before the Ring 2→3 emitter resolved the
-- semantic slug. Only rows whose context exactly matches a StorefrontArchetype
-- primary key are rewritten.
UPDATE "GearInterface" gi
SET "archetypeContext" = sa."archetypeId"
FROM "StorefrontArchetype" sa
WHERE gi."interfaceClass" = 'internal-adjacent'
  AND gi."innerRing" >= 2
  AND gi."archetypeContext" = sa."id";

-- Preserve the Ring 2+ invariant at the database boundary. The only accepted
-- null context at Ring 2+ is the explicit observable setup/onboarding failure
-- path, which the Cockpit can surface through slip-by-reason.
ALTER TABLE "GearInterface"
  ADD CONSTRAINT "GearInterface_ring2_archetype_context_check"
  CHECK (
    "interfaceClass" <> 'internal-adjacent'
    OR "innerRing" IS NULL
    OR "innerRing" < 2
    OR "archetypeContext" IS NOT NULL
    OR (
      "outcomeType" = 'slip'
      AND "slipDetected" = true
      AND "slipReason" = 'archetype-unresolved'
    )
  );

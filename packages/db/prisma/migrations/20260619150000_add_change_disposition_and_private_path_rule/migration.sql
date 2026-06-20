-- Private/Public Change Segregation (EP-1A78BAE1): per-change disposition +
-- operator-managed private-path overrides. Additive — fail-closed default
-- "private" on every existing/in-flight FeatureBuild. Plan:
-- docs/superpowers/plans/2026-06-19-contribution-model-2state-suggest-confirm.md

-- 1. Per-change disposition on FeatureBuild.
ALTER TABLE "FeatureBuild"
  ADD COLUMN "disposition" TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN "dispositionReason" TEXT,
  ADD COLUMN "dispositionSource" TEXT,
  ADD COLUMN "dispositionDecidedAt" TIMESTAMP(3),
  ADD COLUMN "dispositionDecidedById" TEXT,
  ADD COLUMN "dispositionSuggested" TEXT,
  ADD COLUMN "dispositionSuggestionReason" TEXT;

-- 2. Operator-managed private-path overrides (merge with .dpf/private-paths).
CREATE TABLE "PrivatePathRule" (
  "id" TEXT NOT NULL,
  "pattern" TEXT NOT NULL,
  "reason" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrivatePathRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrivatePathRule_pattern_key" ON "PrivatePathRule"("pattern");

ALTER TABLE "PrivatePathRule"
  ADD CONSTRAINT "PrivatePathRule_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

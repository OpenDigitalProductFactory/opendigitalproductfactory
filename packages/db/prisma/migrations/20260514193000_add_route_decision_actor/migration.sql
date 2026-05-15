ALTER TABLE "RouteDecisionLog" ADD COLUMN "actorKind" TEXT;
ALTER TABLE "RouteDecisionLog" ADD COLUMN "actorId" TEXT;

UPDATE "RouteDecisionLog"
SET
  "actorKind" = CASE
    WHEN "agentId" IS NOT NULL AND length(trim("agentId")) > 0 THEN 'agent'
    ELSE 'legacy_unattributed'
  END,
  "actorId" = CASE
    WHEN "agentId" IS NOT NULL AND length(trim("agentId")) > 0 THEN "agentId"
    ELSE 'legacy-route-decision-log'
  END;

ALTER TABLE "RouteDecisionLog" ALTER COLUMN "actorKind" SET NOT NULL;
ALTER TABLE "RouteDecisionLog" ALTER COLUMN "actorId" SET NOT NULL;

ALTER TABLE "RouteDecisionLog"
  ADD CONSTRAINT "RouteDecisionLog_actor_attribution_chk"
  CHECK (
    (
      "actorKind" = 'agent'
      AND "agentId" IS NOT NULL
      AND "actorId" = "agentId"
    )
    OR (
      "actorKind" IN ('scheduler', 'system', 'user')
      AND "agentId" IS NULL
      AND length(trim("actorId")) > 0
    )
    OR (
      "actorKind" = 'legacy_unattributed'
      AND "agentId" IS NULL
      AND "actorId" = 'legacy-route-decision-log'
    )
  );

CREATE INDEX "RouteDecisionLog_actorKind_actorId_createdAt_idx"
  ON "RouteDecisionLog"("actorKind", "actorId", "createdAt");

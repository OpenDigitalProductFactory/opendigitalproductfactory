-- BI-74B2A8CD: additive route evidence. Existing rows deliberately stay NULL.
-- No historical route inference, backfill, default, or destructive rollback.
CREATE TYPE "DecisionEscalationRoute" AS ENUM ('decided', 'human', 'independent_review');

ALTER TABLE "DecisionInteraction"
  ADD COLUMN "escalationRoute" "DecisionEscalationRoute",
  ADD COLUMN "escalationReason" TEXT,
  ADD COLUMN "escalationFollowOn" TEXT;

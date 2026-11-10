-- BI-801313EB: durable, resumable async inference lifecycle.
--
-- Existing AsyncInferenceOp rows predate exact TaskRun/Workroom authority.
-- They remain identityVersion=0 audit/read-history rows. Every new durable
-- admission is identityVersion=1 and is constrained to one exact authority.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AsyncInferenceOp"
    WHERE "status" NOT IN (
      'pending', 'start_indeterminate', 'running', 'completed',
      'failed', 'cancelled', 'expired'
    )
  ) THEN
    RAISE EXCEPTION 'AsyncInferenceOp contains an unknown legacy status; refusing status constraint';
  END IF;
END $$;

ALTER TABLE "AsyncInferenceOp"
  ADD COLUMN "identityVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "authorityScopeKey" TEXT,
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "requestDigest" TEXT,
  ADD COLUMN "bindingDigest" TEXT,
  ADD COLUMN "taskRunId" TEXT,
  ADD COLUMN "workroomId" TEXT,
  ADD COLUMN "checkpointSequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "transitionSequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "startClaimFence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "startAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
  ADD COLUMN "nextPollAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Keep the database default at legacy version 0 for rolling compatibility:
-- an older process does not send the new authority fields. Durable admission
-- opts into version 1 explicitly after binding validation succeeds.

ALTER TABLE "AsyncInferenceOp"
  ADD CONSTRAINT "AsyncInferenceOp_status_check" CHECK (
    "status" IN (
      'pending', 'start_indeterminate', 'running', 'completed',
      'failed', 'cancelled', 'expired'
    )
  ) NOT VALID,
  ADD CONSTRAINT "AsyncInferenceOp_taskRunId_fkey"
    FOREIGN KEY ("taskRunId") REFERENCES "TaskRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AsyncInferenceOp_workroomId_fkey"
    FOREIGN KEY ("workroomId") REFERENCES "WorkCapsule"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AsyncInferenceOp_durable_identity_check" CHECK (
    "identityVersion" = 0 OR (
      "identityVersion" = 1
      AND "authorityScopeKey" IS NOT NULL
      AND "requestKey" IS NOT NULL
      AND "requestDigest" ~ '^[a-f0-9]{64}$'
      AND "bindingDigest" ~ '^[a-f0-9]{64}$'
      AND (("taskRunId" IS NOT NULL)::int + ("workroomId" IS NOT NULL)::int) = 1
    )
  ),
  ADD CONSTRAINT "AsyncInferenceOp_sequence_check" CHECK (
    "checkpointSequence" >= 0
    AND "transitionSequence" >= 0
    AND "startClaimFence" >= 0
  ),
  ADD CONSTRAINT "AsyncInferenceOp_provider_handle_check" CHECK (
    "identityVersion" = 0 OR "status" <> 'running' OR "operationId" IS NOT NULL
  );

ALTER TABLE "AsyncInferenceOp"
  VALIDATE CONSTRAINT "AsyncInferenceOp_status_check";

CREATE UNIQUE INDEX "AsyncInferenceOp_authorityScopeKey_requestKey_key"
  ON "AsyncInferenceOp"("authorityScopeKey", "requestKey");
CREATE INDEX "AsyncInferenceOp_taskRunId_status_idx"
  ON "AsyncInferenceOp"("taskRunId", "status");
CREATE INDEX "AsyncInferenceOp_workroomId_status_idx"
  ON "AsyncInferenceOp"("workroomId", "status");
CREATE INDEX "AsyncInferenceOp_status_nextPollAt_idx"
  ON "AsyncInferenceOp"("status", "nextPollAt");
CREATE INDEX "AsyncInferenceOp_leaseExpiresAt_idx"
  ON "AsyncInferenceOp"("leaseExpiresAt");
CREATE INDEX "AsyncInferenceOp_authorityScopeKey_createdAt_id_idx"
  ON "AsyncInferenceOp"("authorityScopeKey", "createdAt", "id");

CREATE TABLE "AsyncInferenceOperationTransition" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "checkpoint" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  "deliveredAt" TIMESTAMP(3),

  CONSTRAINT "AsyncInferenceOperationTransition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AsyncInferenceOperationTransition_operationId_fkey"
    FOREIGN KEY ("operationId") REFERENCES "AsyncInferenceOp"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AsyncInferenceOperationTransition_sequence_check" CHECK ("sequence" >= 0)
);

ALTER TABLE "AsyncInferenceOperationTransition"
  ADD CONSTRAINT "AsyncInferenceOperationTransition_status_closed_set" CHECK (
    "status" IN (
      'pending', 'start_indeterminate', 'running', 'completed',
      'failed', 'cancelled', 'expired'
    )
  ) NOT VALID;

ALTER TABLE "AsyncInferenceOperationTransition"
  VALIDATE CONSTRAINT "AsyncInferenceOperationTransition_status_closed_set";

CREATE UNIQUE INDEX "AsyncInferenceOperationTransition_operationId_sequence_key"
  ON "AsyncInferenceOperationTransition"("operationId", "sequence");
CREATE INDEX "AsyncInferenceOperationTransition_operationId_occurredAt_idx"
  ON "AsyncInferenceOperationTransition"("operationId", "occurredAt");
CREATE INDEX "AsyncInferenceOperationTransition_deliveredAt_occurredAt_idx"
  ON "AsyncInferenceOperationTransition"("deliveredAt", "occurredAt");

-- Establish the durable history boundary for legacy rows without inventing
-- authority or request provenance that did not exist.
INSERT INTO "AsyncInferenceOperationTransition" (
  "id", "operationId", "sequence", "status", "checkpoint", "occurredAt",
  "deliveryAttempts", "deliveredAt"
)
SELECT
  'legacy-' || "id",
  "id",
  0,
  "status",
  jsonb_build_object('identityVersion', 0, 'backfilled', true),
  "createdAt",
  0,
  "createdAt"
FROM "AsyncInferenceOp";

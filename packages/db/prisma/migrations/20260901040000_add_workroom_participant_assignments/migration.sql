-- BI-4CB2EF76: persist Workroom participant and coordinator assignments on the
-- canonical WorkCapsule substrate. Explicit policy-named roster is distinguishable
-- from legacy WorkItem assignment. Derived Process Overseer membership is never
-- written.
--
-- @migration-safety: data-safe: additive enums + new table; existing WorkCapsule
-- and WorkItem rows are unchanged. Backfill is idempotent (ON CONFLICT DO NOTHING)
-- and only copies named policy participants plus assigned user/agent aliases that
-- already resolve to a Principal. No coordinator role is invented from an
-- accountable assignment.
--
-- Live-shaped: applies against the existing WorkCapsule population and the
-- WorkItem.evidence JSON those rooms already carry, not only a clean schema.

-- CreateEnum
CREATE TYPE "WorkroomParticipantRole" AS ENUM (
  'accountable',
  'coordinator',
  'contributor',
  'specialist',
  'approver',
  'reviewer',
  'observer'
);

-- CreateEnum
CREATE TYPE "WorkroomParticipantAssignmentSource" AS ENUM (
  'explicit',
  'legacy'
);

-- CreateTable
CREATE TABLE "WorkCapsuleParticipant" (
    "id" TEXT NOT NULL,
    "workroomId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "roles" "WorkroomParticipantRole"[] NOT NULL,
    "assignmentSource" "WorkroomParticipantAssignmentSource" NOT NULL,
    "enteredReason" TEXT,
    "currentWorkSummary" TEXT,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkCapsuleParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkCapsuleParticipant_workroomId_principalId_key"
  ON "WorkCapsuleParticipant"("workroomId", "principalId");

-- CreateIndex
CREATE INDEX "WorkCapsuleParticipant_principalId_idx"
  ON "WorkCapsuleParticipant"("principalId");

-- CreateIndex
CREATE INDEX "WorkCapsuleParticipant_workroomId_lifecycle_idx"
  ON "WorkCapsuleParticipant"("workroomId", "lifecycle");

-- CreateIndex
CREATE INDEX "WorkCapsuleParticipant_assignmentSource_idx"
  ON "WorkCapsuleParticipant"("assignmentSource");

-- AddForeignKey
ALTER TABLE "WorkCapsuleParticipant"
  ADD CONSTRAINT "WorkCapsuleParticipant_workroomId_fkey"
  FOREIGN KEY ("workroomId") REFERENCES "WorkCapsule"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCapsuleParticipant"
  ADD CONSTRAINT "WorkCapsuleParticipant_principalId_fkey"
  FOREIGN KEY ("principalId") REFERENCES "Principal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill explicit assignments from the latest workroomPolicy snapshot on the
-- linked WorkItem. Coordinator is copied only when the policy already named it.
INSERT INTO "WorkCapsuleParticipant" (
  "id",
  "workroomId",
  "principalId",
  "roles",
  "assignmentSource",
  "enteredReason",
  "currentWorkSummary",
  "lifecycle",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  wc.id,
  pr.id,
  CASE
    WHEN cardinality(mapped.roles) = 0 THEN ARRAY['observer']::"WorkroomParticipantRole"[]
    ELSE mapped.roles
  END,
  'explicit'::"WorkroomParticipantAssignmentSource",
  mapped.entered_reason,
  mapped.current_work_summary,
  'active'::"RecordLifecycle",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "WorkCapsule" wc
JOIN "WorkItem" wi ON wi.id = wc."workItemId"
JOIN LATERAL (
  SELECT elem AS policy
  FROM jsonb_array_elements(
    CASE
      WHEN wi.evidence IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(wi.evidence::jsonb) = 'array' THEN wi.evidence::jsonb
      ELSE jsonb_build_array(wi.evidence::jsonb)
    END
  ) WITH ORDINALITY AS t(elem, ord)
  WHERE elem ? 'workroomPolicy'
  ORDER BY ord DESC
  LIMIT 1
) latest ON true
JOIN LATERAL jsonb_array_elements(COALESCE(latest.policy->'workroomPolicy'->'participants', '[]'::jsonb)) p ON true
JOIN "Principal" pr ON pr."principalId" = btrim(p->>'principalRef') AND pr.status = 'active'
CROSS JOIN LATERAL (
  SELECT
    ARRAY(
      SELECT r::"WorkroomParticipantRole"
      FROM jsonb_array_elements_text(COALESCE(p->'roles', '[]'::jsonb)) r
      WHERE r IN (
        'accountable',
        'coordinator',
        'contributor',
        'specialist',
        'approver',
        'reviewer',
        'observer'
      )
    ) AS roles,
    NULLIF(btrim(p->>'enteredReason'), '') AS entered_reason,
    NULLIF(btrim(p->>'currentWorkSummary'), '') AS current_work_summary
) mapped
ON CONFLICT ("workroomId", "principalId") DO NOTHING;

-- Backfill legacy WorkItem assignees that are not already on the roster.
INSERT INTO "WorkCapsuleParticipant" (
  "id",
  "workroomId",
  "principalId",
  "roles",
  "assignmentSource",
  "enteredReason",
  "currentWorkSummary",
  "lifecycle",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  wc.id,
  pr.id,
  ARRAY['accountable']::"WorkroomParticipantRole"[],
  'legacy'::"WorkroomParticipantAssignmentSource",
  'Assigned to this room''s work',
  wi.title,
  'active'::"RecordLifecycle",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "WorkCapsule" wc
JOIN "WorkItem" wi ON wi.id = wc."workItemId"
JOIN "PrincipalAlias" pa
  ON pa."aliasType" = 'user'
 AND pa."aliasValue" = wi."assignedToUserId"
 AND pa.issuer = ''
JOIN "Principal" pr ON pr.id = pa."principalId"
WHERE wi."assignedToUserId" IS NOT NULL
ON CONFLICT ("workroomId", "principalId") DO NOTHING;

INSERT INTO "WorkCapsuleParticipant" (
  "id",
  "workroomId",
  "principalId",
  "roles",
  "assignmentSource",
  "enteredReason",
  "currentWorkSummary",
  "lifecycle",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  wc.id,
  pr.id,
  CASE
    WHEN wi."assignedToUserId" IS NOT NULL THEN ARRAY['contributor']::"WorkroomParticipantRole"[]
    ELSE ARRAY['accountable']::"WorkroomParticipantRole"[]
  END,
  'legacy'::"WorkroomParticipantAssignmentSource",
  'Assigned to this room''s work',
  wi.title,
  'active'::"RecordLifecycle",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "WorkCapsule" wc
JOIN "WorkItem" wi ON wi.id = wc."workItemId"
JOIN "PrincipalAlias" pa
  ON pa."aliasType" = 'agent'
 AND pa."aliasValue" = wi."assignedToAgentId"
 AND pa.issuer = ''
JOIN "Principal" pr ON pr.id = pa."principalId"
WHERE wi."assignedToAgentId" IS NOT NULL
ON CONFLICT ("workroomId", "principalId") DO NOTHING;

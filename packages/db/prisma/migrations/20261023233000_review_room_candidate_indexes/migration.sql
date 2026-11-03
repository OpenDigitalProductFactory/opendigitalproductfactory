-- @migration-safety: data-safe: non-unique indexes only; bounded string predicates
-- exclude oversized/malformed historical JSON locators without changing records.
-- The read-only Workroom projection uses these exact predicates for ordered,
-- per-room probes of the existing immutable review bindings. It does not create
-- another relationship carrier or treat the JSON locator as qualified identity.
CREATE INDEX "TaskRun_active_semantic_review_room_created_idx"
ON "TaskRun" (("a2aMetadata"->>'capsuleId'), "createdAt" DESC, id DESC)
WHERE "archivedAt" IS NULL
  AND "a2aMetadata"->>'gateKind' = 'semantic-review'
  AND jsonb_typeof("a2aMetadata"->'capsuleId') = 'string'
  AND octet_length("a2aMetadata"->>'capsuleId') <= 256;

CREATE INDEX "TaskRun_active_initiative_review_room_created_idx"
ON "TaskRun" (("a2aMetadata" #>> '{initiativeReviewBinding,workroomRef,workroomId}'), "createdAt" DESC, id DESC)
WHERE "archivedAt" IS NULL
  AND jsonb_typeof("a2aMetadata" #> '{initiativeReviewBinding,workroomRef,workroomId}') = 'string'
  AND octet_length("a2aMetadata" #>> '{initiativeReviewBinding,workroomRef,workroomId}') <= 256;

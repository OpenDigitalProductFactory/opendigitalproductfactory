-- Typed initiative gate lanes. Existing activity rows remain valid with a null gate.
CREATE TYPE "InitiativeGateKey" AS ENUM (
  'classification',
  'research',
  'design-spec',
  'spec-approval',
  'architecture-review',
  'data-review',
  'ux-fit-review',
  'security-review',
  'compliance-review',
  'domain-review',
  'plan-review',
  'dependency-disposition',
  'archetype-provisioning',
  'archetype-completeness'
);

CREATE TYPE "InitiativeArtifactSourceKind" AS ENUM (
  'build-artifact-revision',
  'document-version',
  'repository-blob-archive'
);

ALTER TABLE "BacklogItemActivity"
  ADD COLUMN "gateKey" "InitiativeGateKey";

CREATE INDEX "BacklogItemActivity_backlogItemId_gateKey_recordedAt_id_idx"
  ON "BacklogItemActivity"("backlogItemId", "gateKey", "recordedAt" DESC, "id" DESC);

CREATE INDEX "WorkCapsuleActivity_workCapsuleId_kind_recordedAt_id_idx"
  ON "WorkCapsuleActivity"("workCapsuleId", "kind", "recordedAt" DESC, "id" DESC);

CREATE TABLE "InitiativeArtifactRetentionPin" (
  "id" TEXT NOT NULL,
  "baselineActivityId" TEXT NOT NULL,
  "sourceKind" "InitiativeArtifactSourceKind" NOT NULL,
  "artifactDigest" TEXT NOT NULL,
  "artifactLocator" JSONB NOT NULL,
  "buildArtifactRevisionId" TEXT,
  "documentVersionId" TEXT,
  "documentBlobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InitiativeArtifactRetentionPin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "initiative_artifact_retention_pin_shape" CHECK (
    ("sourceKind" = 'build-artifact-revision'
      AND "buildArtifactRevisionId" IS NOT NULL
      AND "documentVersionId" IS NULL
      AND "documentBlobId" IS NULL)
    OR
    ("sourceKind" = 'document-version'
      AND "buildArtifactRevisionId" IS NULL
      AND "documentVersionId" IS NOT NULL)
    OR
    ("sourceKind" = 'repository-blob-archive'
      AND "buildArtifactRevisionId" IS NULL
      AND "documentVersionId" IS NOT NULL
      AND "documentBlobId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "InitiativeArtifactRetentionPin_baselineActivityId_key"
  ON "InitiativeArtifactRetentionPin"("baselineActivityId");
CREATE INDEX "InitiativeArtifactRetentionPin_buildArtifactRevisionId_idx"
  ON "InitiativeArtifactRetentionPin"("buildArtifactRevisionId");
CREATE INDEX "InitiativeArtifactRetentionPin_documentVersionId_idx"
  ON "InitiativeArtifactRetentionPin"("documentVersionId");
CREATE INDEX "InitiativeArtifactRetentionPin_documentBlobId_idx"
  ON "InitiativeArtifactRetentionPin"("documentBlobId");
CREATE INDEX "InitiativeArtifactRetentionPin_sourceKind_createdAt_idx"
  ON "InitiativeArtifactRetentionPin"("sourceKind", "createdAt" DESC);

ALTER TABLE "InitiativeArtifactRetentionPin"
  ADD CONSTRAINT "InitiativeArtifactRetentionPin_baselineActivityId_fkey"
  FOREIGN KEY ("baselineActivityId") REFERENCES "BacklogItemActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InitiativeArtifactRetentionPin_buildArtifactRevisionId_fkey"
  FOREIGN KEY ("buildArtifactRevisionId") REFERENCES "BuildArtifactRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InitiativeArtifactRetentionPin_documentVersionId_fkey"
  FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InitiativeArtifactRetentionPin_documentBlobId_fkey"
  FOREIGN KEY ("documentBlobId") REFERENCES "DocumentBlob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_initiative_retention_pin_shape()
RETURNS TRIGGER AS $$
DECLARE
  dv "DocumentVersion"%ROWTYPE;
BEGIN
  IF NEW."documentVersionId" IS NOT NULL THEN
    SELECT * INTO STRICT dv FROM "DocumentVersion" WHERE "id" = NEW."documentVersionId";
    IF dv."contentBlobId" IS NOT DISTINCT FROM NEW."documentBlobId" THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'initiative retention pin document/blob mismatch';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "BacklogItemActivity"
    WHERE "id" = NEW."baselineActivityId" AND "kind" = 'initiative_scope_baseline'
  ) THEN
    RAISE EXCEPTION 'initiative retention pin requires an initiative_scope_baseline activity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER initiative_retention_pin_shape_guard
  BEFORE INSERT ON "InitiativeArtifactRetentionPin"
  FOR EACH ROW EXECUTE FUNCTION enforce_initiative_retention_pin_shape();

CREATE OR REPLACE FUNCTION refuse_initiative_retention_pin_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'initiative artifact retention pins are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER initiative_retention_pin_immutable
  BEFORE UPDATE OR DELETE ON "InitiativeArtifactRetentionPin"
  FOR EACH ROW EXECUTE FUNCTION refuse_initiative_retention_pin_mutation();

CREATE OR REPLACE FUNCTION refuse_pinned_initiative_artifact_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'BuildArtifactRevision' AND EXISTS (
    SELECT 1 FROM "InitiativeArtifactRetentionPin" WHERE "buildArtifactRevisionId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'pinned initiative build artifact revisions are immutable';
  END IF;
  IF TG_TABLE_NAME = 'DocumentVersion' AND EXISTS (
    SELECT 1 FROM "InitiativeArtifactRetentionPin" WHERE "documentVersionId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'pinned initiative document versions are immutable';
  END IF;
  IF TG_TABLE_NAME = 'DocumentBlob' AND EXISTS (
    SELECT 1 FROM "InitiativeArtifactRetentionPin" WHERE "documentBlobId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'pinned initiative document blobs are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER initiative_build_artifact_revision_immutable
  BEFORE UPDATE OR DELETE ON "BuildArtifactRevision"
  FOR EACH ROW EXECUTE FUNCTION refuse_pinned_initiative_artifact_mutation();

CREATE TRIGGER initiative_document_version_immutable
  BEFORE UPDATE OR DELETE ON "DocumentVersion"
  FOR EACH ROW EXECUTE FUNCTION refuse_pinned_initiative_artifact_mutation();

CREATE TRIGGER initiative_document_blob_immutable
  BEFORE UPDATE OR DELETE ON "DocumentBlob"
  FOR EACH ROW EXECUTE FUNCTION refuse_pinned_initiative_artifact_mutation();

CREATE OR REPLACE FUNCTION refuse_initiative_governance_activity_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'initiative governance activities are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER initiative_governance_activity_immutable
  BEFORE UPDATE OR DELETE ON "BacklogItemActivity"
  FOR EACH ROW
  WHEN (OLD."kind" IN (
    'initiative_gate_receipt',
    'initiative_scope_baseline',
    'initiative_objective_mapping',
    'initiative_readiness_decision'
  ))
  EXECUTE FUNCTION refuse_initiative_governance_activity_mutation();

CREATE OR REPLACE FUNCTION guard_initiative_backlog_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "BacklogItemActivity"
    WHERE "backlogItemId" = OLD."id"
      AND "kind" IN (
        'initiative_gate_receipt',
        'initiative_scope_baseline',
        'initiative_objective_mapping',
        'initiative_readiness_decision'
      )
  ) THEN
    RAISE EXCEPTION 'backlog item with initiative governance evidence cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER initiative_backlog_delete_guard
  BEFORE DELETE ON "BacklogItem"
  FOR EACH ROW EXECUTE FUNCTION guard_initiative_backlog_delete();

CREATE OR REPLACE FUNCTION guard_initiative_epic_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "BacklogItemActivity"
    WHERE "kind" IN (
      'initiative_gate_receipt',
      'initiative_scope_baseline',
      'initiative_objective_mapping',
      'initiative_readiness_decision'
    )
      AND "payload" #>> '{subject,kind}' = 'epic'
      AND "payload" #>> '{subject,id}' = OLD."epicId"
  ) THEN
    RAISE EXCEPTION 'epic with initiative governance evidence cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER initiative_epic_delete_guard
  BEFORE DELETE ON "Epic"
  FOR EACH ROW EXECUTE FUNCTION guard_initiative_epic_delete();

CREATE TRIGGER initiative_work_intent_immutable
  BEFORE UPDATE OR DELETE ON "WorkCapsuleActivity"
  FOR EACH ROW
  WHEN (OLD."kind" = 'work-intent-declared')
  EXECUTE FUNCTION refuse_initiative_governance_activity_mutation();

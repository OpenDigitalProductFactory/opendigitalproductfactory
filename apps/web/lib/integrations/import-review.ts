import type { NextStepPointer } from "@/lib/backlog/next-step-pointer";
import { createHash } from "crypto";
import type {
  IntegrationImportDisplayField,
  IntegrationImportStagingRecord,
} from "@/lib/integrations/import-staging";

export const INTEGRATION_IMPORT_REVIEW_STATUSES = [
  "candidate",
  "linked",
  "blocked",
  "ignored",
] as const;

export type IntegrationImportReviewStatus =
  (typeof INTEGRATION_IMPORT_REVIEW_STATUSES)[number];

export interface IntegrationImportReviewRecord {
  entityFamily: string;
  externalId: string;
  sourceProvider: string;
  sourceTimestamp: string | null;
  ownerSide: IntegrationImportStagingRecord["ownerSide"];
  reviewStatus: IntegrationImportReviewStatus;
  proposedLocalEntityType: string;
  proposedLocalId: string | null;
  proposedLocalStatus: IntegrationImportStagingRecord["proposedLocalLink"]["status"];
  proposedLocalConfidence: IntegrationImportStagingRecord["proposedLocalLink"]["confidence"];
  proposedLocalReason: string;
  displayFields: IntegrationImportDisplayField[];
  sourceFingerprint: string;
  readOnly: true;
}

export interface IntegrationImportReviewBatch {
  batchId: string;
  sourceProvider: string;
  providerEnvironment: string | null;
  sourceTimestamp: string | null;
  status: "reviewing";
  records: IntegrationImportReviewRecord[];
}

export interface IntegrationImportReviewPosture {
  status: "not-started" | "ready-to-review" | "blocked";
  sourceProvider: string;
  readOnly: true;
  nextStep: NextStepPointer;
  families: string[];
  guardrail: string;
}

export function buildIntegrationImportReviewBatch({
  batchId,
  sourceProvider,
  providerEnvironment = null,
  sourceTimestamp = null,
  stagedRecords,
}: {
  batchId: string;
  sourceProvider: string;
  providerEnvironment?: string | null;
  sourceTimestamp?: string | null;
  stagedRecords: IntegrationImportStagingRecord[];
}): IntegrationImportReviewBatch {
  return {
    batchId,
    sourceProvider,
    providerEnvironment,
    sourceTimestamp,
    status: "reviewing",
    records: stagedRecords
      .filter((record) => record.sourceProvider === sourceProvider)
      .map(toReviewRecord),
  };
}

export function fingerprintImportStagingRecord(record: IntegrationImportStagingRecord): string {
  const fingerprintInput = {
    entityFamily: record.entityFamily,
    externalId: record.externalId,
    sourceProvider: record.sourceProvider,
    sourceTimestamp: record.sourceTimestamp,
    ownerSide: record.ownerSide,
    proposedLocalLink: record.proposedLocalLink,
    displayFields: sanitizeDisplayFields(record.displayFields),
  };

  return createHash("sha256")
    .update(JSON.stringify(fingerprintInput))
    .digest("hex");
}

function toReviewRecord(record: IntegrationImportStagingRecord): IntegrationImportReviewRecord {
  return {
    entityFamily: record.entityFamily,
    externalId: record.externalId,
    sourceProvider: record.sourceProvider,
    sourceTimestamp: record.sourceTimestamp,
    ownerSide: record.ownerSide,
    reviewStatus: "candidate",
    proposedLocalEntityType: record.proposedLocalLink.entityType,
    proposedLocalId: record.proposedLocalLink.localId,
    proposedLocalStatus: record.proposedLocalLink.status,
    proposedLocalConfidence: record.proposedLocalLink.confidence,
    proposedLocalReason: record.proposedLocalLink.reason,
    displayFields: sanitizeDisplayFields(record.displayFields),
    sourceFingerprint: fingerprintImportStagingRecord(record),
    readOnly: true,
  };
}

function sanitizeDisplayFields(
  displayFields: IntegrationImportDisplayField[],
): IntegrationImportDisplayField[] {
  return displayFields.filter((field) => !isSensitiveDisplayField(field));
}

function isSensitiveDisplayField(field: IntegrationImportDisplayField): boolean {
  const normalized = `${field.label} ${field.value}`.toLowerCase();
  return ["access token", "refresh token", "secret", "password", "credential"].some((token) =>
    normalized.includes(token),
  );
}

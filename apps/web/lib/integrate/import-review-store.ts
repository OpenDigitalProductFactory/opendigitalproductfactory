import type {
  IntegrationImportReviewBatch,
  IntegrationImportReviewRecord,
} from "./import-review";

type IntegrationImportBatchDelegate = {
  upsert(args: {
    where: { batchRef: string };
    create: IntegrationImportBatchMutation;
    update: Omit<IntegrationImportBatchMutation, "batchRef"> & {
      records: {
        deleteMany: Record<string, never>;
        create: IntegrationImportRecordMutation[];
      };
    };
    include: { records: true };
  }): Promise<unknown>;
};

export type IntegrationImportReviewPersistenceClient = {
  integrationImportBatch: IntegrationImportBatchDelegate;
};

type IntegrationImportBatchMutation = {
  batchRef: string;
  sourceProvider: string;
  providerEnvironment: string | null;
  sourceTimestamp: Date | null;
  status: IntegrationImportReviewBatch["status"];
  records: {
    create: IntegrationImportRecordMutation[];
  };
};

type IntegrationImportRecordMutation = {
  entityFamily: string;
  externalId: string;
  sourceProvider: string;
  sourceTimestamp: Date | null;
  ownerSide: IntegrationImportReviewRecord["ownerSide"];
  reviewStatus: IntegrationImportReviewRecord["reviewStatus"];
  proposedLocalEntityType: string;
  proposedLocalId: string | null;
  proposedLocalStatus: IntegrationImportReviewRecord["proposedLocalStatus"];
  proposedLocalConfidence: IntegrationImportReviewRecord["proposedLocalConfidence"];
  proposedLocalReason: string;
  displayFields: IntegrationImportReviewRecord["displayFields"];
  sourceFingerprint: string;
  readOnly: true;
};

export async function saveIntegrationImportReviewBatch(
  db: IntegrationImportReviewPersistenceClient,
  batch: IntegrationImportReviewBatch,
): Promise<unknown> {
  const recordCreates = batch.records.map(toRecordMutation);

  return db.integrationImportBatch.upsert({
    where: { batchRef: batch.batchId },
    create: {
      batchRef: batch.batchId,
      sourceProvider: batch.sourceProvider,
      providerEnvironment: batch.providerEnvironment,
      sourceTimestamp: parseOptionalDate(batch.sourceTimestamp),
      status: batch.status,
      records: {
        create: recordCreates,
      },
    },
    update: {
      sourceProvider: batch.sourceProvider,
      providerEnvironment: batch.providerEnvironment,
      sourceTimestamp: parseOptionalDate(batch.sourceTimestamp),
      status: batch.status,
      records: {
        deleteMany: {},
        create: recordCreates,
      },
    },
    include: { records: true },
  });
}

function toRecordMutation(record: IntegrationImportReviewRecord): IntegrationImportRecordMutation {
  return {
    entityFamily: record.entityFamily,
    externalId: record.externalId,
    sourceProvider: record.sourceProvider,
    sourceTimestamp: parseOptionalDate(record.sourceTimestamp),
    ownerSide: record.ownerSide,
    reviewStatus: record.reviewStatus,
    proposedLocalEntityType: record.proposedLocalEntityType,
    proposedLocalId: record.proposedLocalId,
    proposedLocalStatus: record.proposedLocalStatus,
    proposedLocalConfidence: record.proposedLocalConfidence,
    proposedLocalReason: record.proposedLocalReason,
    displayFields: record.displayFields,
    sourceFingerprint: record.sourceFingerprint,
    readOnly: true,
  };
}

function parseOptionalDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

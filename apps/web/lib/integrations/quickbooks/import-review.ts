import {
  buildIntegrationImportReviewBatch,
  type IntegrationImportReviewBatch,
} from "@/lib/integrations/import-review";
import {
  stageQuickBooksCoreAccountingRecords,
  type QuickBooksCoreAccountingRecordsInput,
} from "./import-staging";

export function buildQuickBooksImportReviewBatch({
  batchId,
  providerEnvironment = null,
  sourceTimestamp = null,
  records,
}: {
  batchId: string;
  providerEnvironment?: string | null;
  sourceTimestamp?: string | null;
  records: QuickBooksCoreAccountingRecordsInput;
}): IntegrationImportReviewBatch {
  const stagedRecords = stageQuickBooksCoreAccountingRecords({
    sourceTimestamp,
    ...records,
  });

  return buildIntegrationImportReviewBatch({
    batchId,
    sourceProvider: "quickbooks",
    providerEnvironment,
    sourceTimestamp,
    stagedRecords,
  });
}

import { buildIntegrationImportReviewBatch } from "@/lib/integrations/import-review";
import { saveIntegrationImportReviewBatch, type IntegrationImportReviewPersistenceClient } from "@/lib/integrations/import-review-store";
import type { IntegrationImportStagingRecord } from "@/lib/integrations/import-staging";

import type { WordPressSyncCheckpoints } from "./sync";

const PREFIX = "wordpress-sync";

function batchRef(connectionId: string, checkpoints: WordPressSyncCheckpoints): string {
  return `${PREFIX}:${connectionId}:${Buffer.from(JSON.stringify(checkpoints), "utf8").toString("base64url")}`;
}

function parseBatchRef(value: string): WordPressSyncCheckpoints | null {
  const match = value.match(/^wordpress-sync:[^:]+:([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")) as WordPressSyncCheckpoints;
    for (const value of Object.values(parsed)) {
      if (!value || typeof value.modifiedGmt !== "string" || !Number.isSafeInteger(value.id)) return null;
    }
    return parsed;
  } catch { return null; }
}

type SyncStore = {
  $transaction<T>(operation: (transaction: IntegrationImportReviewPersistenceClient) => Promise<T>): Promise<T>;
  integrationImportBatch: {
    findFirst(args: {
      where: { sourceProvider: string; providerEnvironment: string };
      orderBy: { updatedAt: "desc" };
      select: { batchRef: true };
    }): Promise<{ batchRef: string } | null>;
  };
};

export async function persistWordPressSyncResult(db: SyncStore, input: {
  connectionId: string;
  checkpoints: WordPressSyncCheckpoints;
  records: IntegrationImportStagingRecord[];
}): Promise<void> {
  const batch = buildIntegrationImportReviewBatch({
    batchId: batchRef(input.connectionId, input.checkpoints),
    sourceProvider: "wordpress-self-hosted",
    providerEnvironment: input.connectionId,
    sourceTimestamp: latestTimestamp(input.checkpoints),
    stagedRecords: input.records,
  });
  await db.$transaction((transaction) => saveIntegrationImportReviewBatch(transaction, batch).then(() => undefined));
}

export async function loadWordPressCheckpoint(db: Pick<SyncStore, "integrationImportBatch">, connectionId: string): Promise<WordPressSyncCheckpoints | null> {
  const batch = await db.integrationImportBatch.findFirst({
    where: { sourceProvider: "wordpress-self-hosted", providerEnvironment: connectionId },
    orderBy: { updatedAt: "desc" },
    select: { batchRef: true },
  });
  return batch ? parseBatchRef(batch.batchRef) : null;
}

function latestTimestamp(checkpoints: WordPressSyncCheckpoints): string | null {
  const latest = Object.values(checkpoints).map((value) => value?.modifiedGmt).filter((value): value is string => Boolean(value)).sort().at(-1);
  return latest ? `${latest}Z` : null;
}

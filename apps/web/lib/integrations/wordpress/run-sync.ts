import { prisma } from "@dpf/db";

import { decryptJson } from "@/lib/govern/credential-crypto";

import { createWordPressClient } from "./client";
import type { WordPressCredential } from "./connector";
import { stageWordPressDiscovery, syncWordPressReadModels, type WordPressReadKind } from "./sync";
import { loadWordPressCheckpoint, persistWordPressSyncResult } from "./sync-store";
import { readStoredWordPressCredential } from "./stored-credential";

type SyncDb = {
  integrationCredential: { findUnique(args: { where: { integrationId: string } }): Promise<{ status: string; fieldsEnc: string; tokenCacheEnc: string | null } | null> };
  integrationImportBatch: { findFirst(args: unknown): Promise<{ batchRef: string } | null> };
  $transaction<T>(operation: (transaction: unknown) => Promise<T>): Promise<T>;
};

export async function runWordPressContentSync(input: {
  connectionId?: string;
  db?: SyncDb;
  decrypt?: (stored: string) => unknown;
  createClient?: (input: { credential: WordPressCredential }) => Pick<ReturnType<typeof createWordPressClient>, "list"> & Partial<Pick<ReturnType<typeof createWordPressClient>, "probe">>;
  kinds?: WordPressReadKind[];
  maxPages?: number;
}) {
  const connectionId = input.connectionId ?? "wordpress-self-hosted";
  const db = input.db ?? prisma as unknown as SyncDb;
  const credentialRow = await db.integrationCredential.findUnique({ where: { integrationId: connectionId } });
  if (!credentialRow || credentialRow.status !== "connected") throw new Error("WordPress integration is not connected.");
  const credential = readStoredWordPressCredential((input.decrypt ?? decryptJson)(credentialRow.fieldsEnc));
  if (!credential) throw new Error("Stored WordPress credential could not be read safely; reconnect the integration.");
  const client = (input.createClient ?? ((value) => createWordPressClient(value)))({ credential });
  const checkpoints = await loadWordPressCheckpoint(db as never, connectionId) ?? {};
  const result = await syncWordPressReadModels({
    list: (kind, page) => client.list(kind, page),
    kinds: input.kinds ?? ["post", "page", "media"],
    checkpoints,
    maxPages: input.maxPages,
  });
  const discovery = client.probe ? stageWordPressDiscovery(await client.probe()) : [];
  const records = [...discovery, ...result.records];
  if (records.length > 0) {
    await persistWordPressSyncResult(db as never, { connectionId, checkpoints: result.checkpoints, records });
  }
  return { resultCount: records.length, checkpoints: result.checkpoints, truncated: result.truncated };
}

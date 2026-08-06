// Greenhouse import orchestrator (BRIDGE): pull the Harvest collections, map
// them to read-only staging records, and persist a review batch via the
// existing import-review store. Nothing here writes a domain row — staged
// records are readOnly and await operator review.

import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { buildIntegrationImportReviewBatch } from "@/lib/integrate/import-review";
import {
  saveIntegrationImportReviewBatch,
  type IntegrationImportReviewPersistenceClient,
} from "@/lib/integrate/import-review-store";
import { harvestGetPaged, type HarvestFetch, type HarvestPageOptions } from "./harvest-client";
import { GREENHOUSE_INTEGRATION_ID } from "./connect-action";
import {
  mapHarvestImportSet,
  type HarvestApplication,
  type HarvestCandidate,
  type HarvestJob,
  type HarvestOffer,
  type HarvestScorecard,
} from "./harvest-to-staging";

export const GREENHOUSE_SOURCE_PROVIDER = "greenhouse";

/** Injectable Harvest readers so tests exercise the orchestrator without network. */
export interface GreenhouseReaders {
  listJobs(opts: HarvestPageOptions): Promise<HarvestJob[]>;
  listCandidates(opts: HarvestPageOptions): Promise<HarvestCandidate[]>;
  listApplications(opts: HarvestPageOptions): Promise<HarvestApplication[]>;
  listOffers(opts: HarvestPageOptions): Promise<HarvestOffer[]>;
  listScorecards(opts: HarvestPageOptions): Promise<HarvestScorecard[]>;
}

export const defaultGreenhouseReaders: GreenhouseReaders = {
  listJobs: (opts) => harvestGetPaged<HarvestJob>("/jobs", opts),
  listCandidates: (opts) => harvestGetPaged<HarvestCandidate>("/candidates", opts),
  listApplications: (opts) => harvestGetPaged<HarvestApplication>("/applications", opts),
  listOffers: (opts) => harvestGetPaged<HarvestOffer>("/offers", opts),
  listScorecards: (opts) => harvestGetPaged<HarvestScorecard>("/scorecards", opts),
};

export interface GreenhouseImportCounts {
  jobs: number;
  candidates: number;
  applications: number;
  offers: number;
  scorecards: number;
  total: number;
}

export interface ImportGreenhouseArgs {
  batchId: string;
  apiToken: string;
  fetchImpl?: HarvestFetch;
  sleepImpl?: (ms: number) => Promise<void>;
  readers?: GreenhouseReaders;
}

/**
 * Core orchestrator — decoupled from credential storage and prisma so it is
 * unit-testable with injected readers + an in-memory persistence client.
 */
export async function importGreenhouseFromReaders(
  db: IntegrationImportReviewPersistenceClient,
  args: ImportGreenhouseArgs,
): Promise<GreenhouseImportCounts> {
  const readers = args.readers ?? defaultGreenhouseReaders;
  const opts: HarvestPageOptions = {
    apiToken: args.apiToken,
    fetchImpl: args.fetchImpl,
    sleepImpl: args.sleepImpl,
  };

  const [jobs, candidates, applications, offers, scorecards] = await Promise.all([
    readers.listJobs(opts),
    readers.listCandidates(opts),
    readers.listApplications(opts),
    readers.listOffers(opts),
    readers.listScorecards(opts),
  ]);

  const stagedRecords = mapHarvestImportSet({ jobs, candidates, applications, offers, scorecards });

  const batch = buildIntegrationImportReviewBatch({
    batchId: args.batchId,
    sourceProvider: GREENHOUSE_SOURCE_PROVIDER,
    stagedRecords,
  });

  await saveIntegrationImportReviewBatch(db, batch);

  return {
    jobs: jobs.length,
    candidates: candidates.length,
    applications: applications.length,
    offers: offers.length,
    scorecards: scorecards.length,
    total: stagedRecords.length,
  };
}

/** Read + decrypt the stored Harvest API key for this install. */
export async function readGreenhouseApiToken(): Promise<string | null> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: GREENHOUSE_INTEGRATION_ID },
  });
  if (!record || record.status !== "connected") return null;
  const decoded = decryptJson<{ apiToken?: string }>(record.fieldsEnc);
  return decoded?.apiToken ?? null;
}

/** Read + decrypt the stored inbound-webhook signing secret, if configured. */
export async function readGreenhouseWebhookSecret(): Promise<string | null> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: GREENHOUSE_INTEGRATION_ID },
  });
  if (!record) return null;
  const decoded = decryptJson<{ webhookSecret?: string }>(record.fieldsEnc);
  return decoded?.webhookSecret ?? null;
}

/** Production entry point: read the stored key and import into a named batch. */
export async function runGreenhouseImport(batchId: string): Promise<GreenhouseImportCounts> {
  const apiToken = await readGreenhouseApiToken();
  if (!apiToken) {
    throw new Error("Greenhouse is not connected — add a Harvest API key first.");
  }
  // Prisma's generic upsert overload is wider than the store's narrow
  // (test-friendly) delegate type; bridge it at this single call site.
  const db = prisma as unknown as IntegrationImportReviewPersistenceClient;
  return importGreenhouseFromReaders(db, { batchId, apiToken });
}

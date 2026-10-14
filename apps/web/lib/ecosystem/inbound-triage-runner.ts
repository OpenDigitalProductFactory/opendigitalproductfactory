/**
 * Inbound ecosystem triage runner (BI-F47386ED) — the impure edge.
 *
 * Reads both inbound transports, maps them through the pure mappers, and files
 * everything via the existing backlog front door. Kept separate from the cron so
 * the cron stays a thin trigger and this stays callable from a tool or a test.
 */

import { getErrorMessage } from "@/lib/shared/get-error-message";
import { INSTALLATION_OPERATING_INTENT_KEY } from "@/lib/installation-journey/operating-intent";
import {
  mapPeerDemandMirrors,
  mapUpstreamIssues,
  runInboundIssueTriage,
  type InboundEcosystemItem,
  type InboundTriageResult,
} from "./inbound-issue-triage";

export type InboundTriageOutcome =
  | ({ ran: true; complete: boolean; sourceErrors: InboundSourceError[] } & InboundTriageResult)
  | { ran: false; reason: string };

export interface InboundSourceError {
  source: "upstream-issue" | "peer-demand";
  error: string;
}

export interface InboundTriageRunnerDeps {
  /** Injected wholesale so the runner is testable without Prisma or fetch. */
  loadPurpose?: () => Promise<string | null>;
  readIssues?: () => Promise<{ ok: boolean; issues?: unknown[]; error?: string }>;
  readPeerDemand?: () => Promise<Array<{ mirrorId: string; payload: unknown }>>;
  ingest?: (input: unknown) => Promise<{ itemId: string; created: boolean }>;
  onFailure?: (item: InboundEcosystemItem, error: unknown) => void;
}

/** Only a platform-development install has anywhere to put ecosystem submissions.
 *  On an operate-organization install this sweep is not merely useless — it would
 *  fill a customer's backlog with other installs' defects. */
const TRIAGING_PURPOSE = "evolve-dpf";

async function defaultLoadPurpose(): Promise<string | null> {
  const { prisma } = await import("@dpf/db");
  const row = await prisma.platformConfig.findUnique({
    where: { key: INSTALLATION_OPERATING_INTENT_KEY },
    select: { value: true },
  });
  const value = row?.value as { primaryPurpose?: unknown } | null | undefined;
  return typeof value?.primaryPurpose === "string" ? value.primaryPurpose : null;
}

export async function runEcosystemInboundTriage(
  deps: InboundTriageRunnerDeps = {},
): Promise<InboundTriageOutcome> {
  const purpose = await (deps.loadPurpose ?? defaultLoadPurpose)();
  if (purpose !== TRIAGING_PURPOSE) {
    return { ran: false, reason: `installation purpose is ${purpose ?? "undeclared"}, not ${TRIAGING_PURPOSE}` };
  }

  const items: InboundEcosystemItem[] = [];
  const sourceErrors: InboundSourceError[] = [];

  // Transport 1 — upstream issues filed by the relay.
  const readIssues = deps.readIssues ?? (async () => {
    const { readUpstreamIssues } = await import("./upstream-issue-reader");
    return readUpstreamIssues({ state: "open" });
  });
  try {
    const issueResult = await readIssues();
    if (!issueResult.ok || !Array.isArray(issueResult.issues)) {
      sourceErrors.push({ source: "upstream-issue", error: ("error" in issueResult ? issueResult.error : null) ?? "Issue read returned no valid issue list" });
    } else {
      items.push(...mapUpstreamIssues(issueResult.issues as Parameters<typeof mapUpstreamIssues>[0]));
    }
  } catch (error) {
    sourceErrors.push({ source: "upstream-issue", error: getErrorMessage(error) });
  }

  // Transport 2 — peer-side federated demand envelopes.
  const readPeerDemand = deps.readPeerDemand ?? (async () => {
    const { prisma } = await import("@dpf/db");
    return prisma.federatedRecordMirror.findMany({
      where: { recordType: "demand-envelope", canonicalSide: "peer" },
      orderBy: { lastSyncedAt: "desc" },
      select: { mirrorId: true, payload: true },
    });
  });
  try {
    const { decodeDemandMirrorPayload } = await import("@/lib/federation/demand-exchange");
    items.push(...mapPeerDemandMirrors(
      await readPeerDemand(),
      decodeDemandMirrorPayload as Parameters<typeof mapPeerDemandMirrors>[1],
    ));
  } catch (error) {
    sourceErrors.push({ source: "peer-demand", error: getErrorMessage(error) });
  }

  const ingest = deps.ingest ?? (async (input: unknown) => {
    const { ingestBacklogItem } = await import("@/lib/operate/backlog-ingest");
    const filed = await ingestBacklogItem(input as Parameters<typeof ingestBacklogItem>[0]);
    return { itemId: filed.itemId, created: filed.created };
  });

  const result = await runInboundIssueTriage({
    items,
    ingest: ingest as Parameters<typeof runInboundIssueTriage>[0]["ingest"],
    onFailure: deps.onFailure ?? ((item, err) => {
      console.warn(
        `[ecosystem-inbound-triage] skipped ${item.sourceKind}:${item.sourceId}: `
        + getErrorMessage(err),
      );
    }),
  });

  // Keep partial work, but never project a failed source as a quiet, complete scan.
  return { ran: true, ...result, complete: sourceErrors.length === 0 && result.failed === 0, sourceErrors };
}

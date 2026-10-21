/**
 * Inbound ecosystem triage runner (BI-F47386ED) — the impure edge.
 *
 * Reads both inbound transports, maps them through the pure mappers, and files
 * everything via the existing backlog front door. Kept separate from the cron so
 * the cron stays a thin trigger and this stays callable from a tool or a test.
 */

import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { RepoIdentity } from "@/lib/contributor-change-lanes/github-rest-reader";
import type { IntakeControllerVerdict } from "./intake-controller-authority";
import {
  mapPeerDemandMirrors,
  mapUpstreamIssues,
  runInboundIssueTriage,
  type InboundEcosystemItem,
  type InboundIngestOutcome,
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
  /** Injected wholesale so the runner is testable without Prisma or fetch.
   *  Resolves the repository-controller commission (BI-FD40397B AC-1). */
  loadCommission?: () => Promise<IntakeControllerVerdict>;
  /** Reads issues from the commissioned repository — never a fallback one. */
  readIssues?: (repo: RepoIdentity) => Promise<{ ok: boolean; issues?: unknown[]; error?: string }>;
  readPeerDemand?: () => Promise<Array<{ mirrorId: string; payload: unknown }>>;
  ingest?: (input: unknown) => Promise<InboundIngestOutcome>;
  onFailure?: (item: InboundEcosystemItem, error: unknown) => void;
}

/** Only the commissioned repository-controller installation may sweep: on any
 *  other install this would fill a backlog with other installs' defects, and a
 *  development peer must not become a competing controller (spec §6.1). The
 *  purpose-only gate this replaces could not tell the two apart. */
async function defaultLoadCommission(): Promise<IntakeControllerVerdict> {
  const { loadIntakeControllerCommission } = await import("./intake-controller-authority");
  return loadIntakeControllerCommission();
}

export async function runEcosystemInboundTriage(
  deps: InboundTriageRunnerDeps = {},
): Promise<InboundTriageOutcome> {
  let commission: IntakeControllerVerdict;
  try {
    commission = await (deps.loadCommission ?? defaultLoadCommission)();
  } catch (error) {
    // Could not prove the commission: refuse, never run on an unverified controller.
    return { ran: false, reason: `not commissioned: commission check failed: ${getErrorMessage(error)}` };
  }
  if (!commission.commissioned) return { ran: false, reason: commission.reason };
  const { repo } = commission;

  const items: InboundEcosystemItem[] = [];
  const sourceErrors: InboundSourceError[] = [];

  // Transport 1 — upstream issues filed by the relay.
  const readIssues = deps.readIssues ?? (async (target: RepoIdentity) => {
    const { readUpstreamIssues } = await import("./upstream-issue-reader");
    return readUpstreamIssues({ state: "open", repo: target });
  });
  try {
    const issueResult = await readIssues(repo);
    if (!issueResult.ok || !Array.isArray(issueResult.issues)) {
      sourceErrors.push({ source: "upstream-issue", error: ("error" in issueResult ? issueResult.error : null) ?? "Issue read returned no valid issue list" });
    } else {
      items.push(...mapUpstreamIssues(issueResult.issues as Parameters<typeof mapUpstreamIssues>[0], repo));
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
    return {
      itemId: filed.itemId,
      created: filed.created,
      outcome: filed.outcome,
      reviewCandidates: filed.reviewCandidates,
    };
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

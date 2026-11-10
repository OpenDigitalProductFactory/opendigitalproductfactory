/**
 * Inbound ecosystem triage runner (BI-F47386ED) — the impure edge.
 *
 * Reads issues, security alerts and peer demand through the pure mappers, and files
 * everything via the existing backlog front door. Kept separate from the cron so
 * the cron stays a thin trigger and this stays callable from a tool or a test.
 */

import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { RepoIdentity } from "@/lib/contributor-change-lanes/github-rest-reader";
import type { IntakeControllerVerdict } from "./intake-controller-authority";
import {
  mapPeerDemandMirrors,
  mapDependabotAlerts,
  mapUpstreamIssues,
  runInboundIssueTriage,
  type InboundEcosystemItem,
  type InboundIngestOutcome,
  type InboundTriageResult,
} from "./inbound-issue-triage";
import type { RepositoryAlertRead } from "./dependabot-reader";

export type InboundTriageOutcome =
  | ({ ran: true; complete: boolean; sourceErrors: InboundSourceError[]; scannedAt?: string; issueReadComplete?: boolean } & InboundTriageResult)
  | { ran: false; reason: string };

export interface InboundSourceError {
  source: "upstream-issue" | "peer-demand" | "dependabot";
  error: string;
}

export interface InboundTriageRunnerDeps {
  /** Injected wholesale so the runner is testable without Prisma or fetch.
   *  Resolves the repository-controller commission (BI-FD40397B AC-1). */
  loadCommission?: () => Promise<IntakeControllerVerdict>;
  /** Reads issues from the commissioned repository — never a fallback one. */
  readIssues?: (repo: RepoIdentity) => Promise<{ ok: boolean; issues?: unknown[]; error?: string }>;
  readAlerts?: (repo: RepoIdentity) => Promise<RepositoryAlertRead>;
  readPeerDemand?: () => Promise<Array<{ mirrorId: string; payload: unknown }>>;
  ingest?: (input: unknown) => Promise<InboundIngestOutcome>;
  onFailure?: (item: InboundEcosystemItem, error: unknown) => void;
}

export interface IntakePeerDemandDb {
  federationLink: {
    findMany(args: unknown): Promise<Array<{ linkId: string }>>;
  };
  federatedRecordMirror: {
    findMany(args: unknown): Promise<Array<{ mirrorId: string; payload: unknown }>>;
  };
}

/** Peer demand the intake may file (BI-F4866228). A same-organization peer
 *  sends its whole backlog as demand envelopes, and work sync already mirrors
 *  that backlog here, so filing those envelopes copies every item a second
 *  time: the first commissioned production run filed about 4,000 duplicates.
 *  A revoked or quarantined link's envelopes are no longer live demand. Only a
 *  live link to another organization carries demand the intake files. */
export async function readIntakePeerDemand(
  db: IntakePeerDemandDb,
): Promise<Array<{ mirrorId: string; payload: unknown }>> {
  const links = await db.federationLink.findMany({
    where: {
      linkState: "trusted",
      revokedAt: null,
      quarantinedAt: null,
      role: { not: "same-org-peer" },
    },
    select: { linkId: true },
  });
  if (links.length === 0) return [];
  return db.federatedRecordMirror.findMany({
    where: {
      recordType: "demand-envelope",
      canonicalSide: "peer",
      federationLinkId: { in: links.map((link) => link.linkId) },
    },
    orderBy: { lastSyncedAt: "desc" },
    select: { mirrorId: true, payload: true },
  });
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
  const scannedAt = new Date().toISOString();
  let issueReadComplete = false;

  const items: InboundEcosystemItem[] = [];
  const sourceErrors: InboundSourceError[] = [];

  // Transport 1 — upstream issues filed by the relay.
  const readIssues = deps.readIssues ?? (async (target: RepoIdentity) => {
    const { readControllerIssues } = await import("./upstream-issue-reader");
    const { prisma } = await import("@dpf/db");
    const job = await prisma.scheduledJob.findUnique({ where: { jobId: "ecosystem-inbound-issue-triage" }, select: { runCursor: true } });
    return readControllerIssues(target, job?.runCursor ?? null);
  });
  try {
    const issueResult = await readIssues(repo);
    if (!issueResult.ok || !Array.isArray(issueResult.issues)) {
      sourceErrors.push({ source: "upstream-issue", error: ("error" in issueResult ? issueResult.error : null) ?? "Issue read returned no valid issue list" });
    } else {
      issueReadComplete = true;
      items.push(...mapUpstreamIssues(issueResult.issues as Parameters<typeof mapUpstreamIssues>[0], repo));
    }
  } catch (error) {
    sourceErrors.push({ source: "upstream-issue", error: getErrorMessage(error) });
  }

  // Independent coverage: a security permission failure cannot erase issue work
  // or be reported as a clean repository. The same commission owns both reads.
  try {
    const readAlerts = deps.readAlerts ?? (async (target: RepoIdentity) => {
      const { readDependabotAlerts } = await import("./dependabot-reader");
      return readDependabotAlerts({ repo: target });
    });
    const alerts = await readAlerts(repo);
    if (!alerts.ok) sourceErrors.push({ source: "dependabot", error: alerts.error });
    else items.push(...mapDependabotAlerts(alerts.alerts, repo));
  } catch (error) {
    sourceErrors.push({ source: "dependabot", error: getErrorMessage(error) });
  }

  // Transport 2 — peer-side federated demand envelopes from live
  // cross-organization links only (BI-F4866228).
  const readPeerDemand = deps.readPeerDemand ?? (async () => {
    const { prisma } = await import("@dpf/db");
    return readIntakePeerDemand(prisma as unknown as IntakePeerDemandDb);
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
  return { ran: true, ...result, complete: sourceErrors.length === 0 && result.failed === 0 && result.needsReview === 0,
    sourceErrors, scannedAt, issueReadComplete: issueReadComplete && result.failed === 0 };
}

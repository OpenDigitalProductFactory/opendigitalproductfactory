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
  mapUpstreamIssues,
  runInboundIssueTriage,
  type InboundEcosystemItem,
  type InboundIngestOutcome,
  type InboundTriageResult,
} from "./inbound-issue-triage";
import type { RepositoryAlertRead } from "./dependabot-reader";
import type { AlertPageRead } from "./github-alert-pager";
import type { CodeScanningAlert } from "./code-scanning-reader";
import type { SecretScanningAlert } from "./secret-scanning-reader";
import {
  groupCodeScanningAlerts,
  groupDependabotAlerts,
  groupSecretScanningAlerts,
  type SecurityGroupKind,
} from "./security-finding-groups";
import type { SecurityLifecycleResult, SecurityLifecycleStore } from "./security-finding-lifecycle";

/** Per-surface security coverage for the run summary (BI-C67E5CCB). Absent = unreadable this run. */
export type SecuritySurfaceCounts = Partial<Record<SecurityGroupKind, { alerts: number; groups: number }>>;

export type InboundTriageOutcome =
  | ({ ran: true; complete: boolean; sourceErrors: InboundSourceError[]; scannedAt?: string; issueReadComplete?: boolean;
      security?: { surfaces: SecuritySurfaceCounts; lifecycle: SecurityLifecycleResult | null } } & InboundTriageResult)
  | { ran: false; reason: string };

export interface InboundSourceError {
  source: "upstream-issue" | "peer-demand" | "dependabot" | "code-scanning" | "secret-scanning" | "security-lifecycle";
  error: string;
}

export interface InboundTriageRunnerDeps {
  /** Injected wholesale so the runner is testable without Prisma or fetch.
   *  Resolves the repository-controller commission (BI-FD40397B AC-1). */
  loadCommission?: () => Promise<IntakeControllerVerdict>;
  /** Reads issues from the commissioned repository — never a fallback one. */
  readIssues?: (repo: RepoIdentity) => Promise<{ ok: boolean; issues?: unknown[]; error?: string }>;
  readAlerts?: (repo: RepoIdentity) => Promise<RepositoryAlertRead>;
  readCodeScanning?: (repo: RepoIdentity) => Promise<AlertPageRead<CodeScanningAlert>>;
  readSecretScanning?: (repo: RepoIdentity) => Promise<AlertPageRead<SecretScanningAlert>>;
  /** Moves resolved groups to awaiting-acceptance (BI-C67E5CCB). Prisma-backed when omitted. */
  lifecycleStore?: () => Promise<SecurityLifecycleStore>;
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

async function defaultLifecycleStore(): Promise<SecurityLifecycleStore> {
  const { prisma } = await import("@dpf/db");
  const { prismaSecurityLifecycleStore } = await import("./security-finding-lifecycle");
  const { peerOwnedStatusRefusal } = await import("@/lib/backlog/peer-owned-item");
  return prismaSecurityLifecycleStore(prisma as unknown as Parameters<typeof prismaSecurityLifecycleStore>[0],
    (itemId, body) => peerOwnedStatusRefusal(itemId, body) !== null);
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

  // Independent coverage per surface: a permission failure on one surface can
  // neither erase issue work nor be reported as a clean repository, and it
  // never lets the lifecycle treat that surface's items as resolved (AC-5).
  const securityGroups: InboundEcosystemItem[] = [];
  const surfaces: SecuritySurfaceCounts = {};
  const completeKinds: SecurityGroupKind[] = [];
  const readSurface = async <T,>(
    source: InboundSourceError["source"], kind: SecurityGroupKind,
    read: () => Promise<{ ok: true; alerts: T[] } | { ok: false; error: string }>,
    group: (alerts: T[]) => InboundEcosystemItem[],
  ) => {
    try {
      const result = await read();
      if (!result.ok) { sourceErrors.push({ source, error: result.error }); return; }
      const groups = group(result.alerts);
      securityGroups.push(...groups);
      surfaces[kind] = { alerts: result.alerts.length, groups: groups.length };
      completeKinds.push(kind);
    } catch (error) {
      sourceErrors.push({ source, error: getErrorMessage(error) });
    }
  };
  await readSurface("dependabot", "dependabot-package",
    () => (deps.readAlerts ?? (async (target: RepoIdentity) => {
      const { readDependabotAlerts } = await import("./dependabot-reader");
      return readDependabotAlerts({ repo: target });
    }))(repo),
    (alerts) => groupDependabotAlerts(alerts, repo));
  await readSurface("code-scanning", "code-scanning-rule",
    () => (deps.readCodeScanning ?? (async (target: RepoIdentity) => {
      const { readCodeScanningAlerts } = await import("./code-scanning-reader");
      return readCodeScanningAlerts({ repo: target });
    }))(repo),
    (alerts) => groupCodeScanningAlerts(alerts, repo));
  await readSurface("secret-scanning", "secret-scanning-alert",
    () => (deps.readSecretScanning ?? (async (target: RepoIdentity) => {
      const { readSecretScanningAlerts } = await import("./secret-scanning-reader");
      return readSecretScanningAlerts({ repo: target });
    }))(repo),
    (alerts) => groupSecretScanningAlerts(alerts, repo));
  // Most urgent first, so a run that is cut short has filed the secrets and criticals.
  items.push(...[...securityGroups].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)));

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

  // Resolution and priority run after ingest, only for surfaces read completely.
  let lifecycle: SecurityLifecycleResult | null = null;
  if (completeKinds.length > 0) {
    try {
      const store = await (deps.lifecycleStore ?? defaultLifecycleStore)();
      const { reconcileSecurityLifecycle } = await import("./security-finding-lifecycle");
      lifecycle = await reconcileSecurityLifecycle({ completeKinds, groups: securityGroups, store, now: new Date(scannedAt) });
    } catch (error) {
      sourceErrors.push({ source: "security-lifecycle", error: getErrorMessage(error) });
    }
  }

  // Keep partial work, but never project a failed source as a quiet, complete scan.
  return { ran: true, ...result, complete: sourceErrors.length === 0 && result.failed === 0 && result.needsReview === 0,
    sourceErrors, scannedAt, issueReadComplete: issueReadComplete && result.failed === 0,
    security: { surfaces, lifecycle } };
}

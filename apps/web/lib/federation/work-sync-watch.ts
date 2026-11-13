// Work-sync watch (BI-85DE8EBD).
//
// WHY THIS EXISTS: from 2026-11-08 to 2026-11-13 every pull from the paired
// installation failed with "fetch failed" and nobody was told; 341 mirrored items
// sat frozen in awaiting-acceptance. Runs after each work-sync pull (five-minute
// federation cadence):
//   1. Reads the health record work sync just wrote (lastSuccessAt, failingSince
//      and errorClass carried across cycles by work-sync-health.ts).
//   2. A link that has not pulled successfully for over 6 hours gets ONE
//      `work_sync_failure` monitor row naming the peer, the last success, the
//      kind of failure (revoked or refused, network, TLS, outdated peer,
//      unreadable answer) and plain next steps. A new row rings the bell.
//   3. The row resolves on the next successful pull, or once the link is no longer
//      one this installation syncs with (revoked or removed here).
// The rows reach Needs-you through the platform-continuity attention source.
//
// Because each installation runs this watch, the paired installation also hears
// when THIS one goes silent: the off-host signal for BI-3E2F87FA (WWMD
// DI-452922A2126A).

import { formatInstant } from "@/lib/datetime";
import { openMonitorIssue, resolveMonitorIssuesExcept, type MonitorIssueDb } from "@/lib/observability/monitor-issue-writer";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import { WORK_SYNC_HEALTH_KEY, type WorkSyncHealthRecordV1 } from "./work-sync";
import { staleFrom, type WorkSyncErrorClass, type WorkSyncHealthLink } from "./work-sync-health";

export const WORK_SYNC_FAILURE_ISSUE_TYPE = "work_sync_failure" as const;
export const WORK_SYNC_FAILURE_THRESHOLD_MS = 6 * 60 * 60_000;
export const WORK_SYNC_HREF = "/ops/installation";

export function workSyncIssueKey(linkId: string): string {
  return `work-sync:link:${linkId}`;
}

export interface WatchedLink {
  linkId: string;
  peerLabel: string;
  peerAuthorityUrl: string;
  /** Newest mirror lastSyncedAt for the link: evidence of the last success before this record existed. */
  lastMirrorSyncAt: Date | null;
}

export interface WorkSyncAlert {
  issueKey: string;
  summary: string;
  details: {
    linkId: string;
    peerLabel: string;
    peerAuthorityUrl: string;
    lastSuccessAt: string | null;
    failingSince: string | null;
    errorClass: WorkSyncErrorClass;
    detail: string | null;
    explanation: string;
    nextSteps: string[];
    actionLabel: string;
    href: string;
  };
}

const REPAIR_PLACE = "Operations, Installation, under \"Change what this installation is\"";

function explain(errorClass: WorkSyncErrorClass, link: WatchedLink): { explanation: string; nextSteps: string[] } {
  switch (errorClass) {
    case "revoked":
      return {
        explanation: `${link.peerLabel} no longer accepts this installation's connection. It was revoked or the pairing was replaced on one side.`,
        nextSteps: [`Pair the two installations again from ${REPAIR_PLACE}.`],
      };
    case "tls":
      return {
        explanation: `${link.peerLabel} answered, but its secure connection was not accepted. Its address or certificate has probably changed.`,
        nextSteps: [`Check that ${link.peerAuthorityUrl} is still the other installation's address. If it moved, pair again from ${REPAIR_PLACE}.`],
      };
    case "peer-outdated":
      return {
        explanation: `${link.peerLabel} is running a release that does not share its work yet.`,
        nextSteps: [`Upgrade ${link.peerLabel} to the current release.`],
      };
    case "protocol":
      return {
        explanation: `${link.peerLabel} answered with something this installation could not read.`,
        nextSteps: [`Upgrade both installations to the same release.`],
      };
    case "network":
      return {
        explanation: `${link.peerLabel} could not be reached at ${link.peerAuthorityUrl}.`,
        nextSteps: [
          `Check that the computer running ${link.peerLabel} is switched on, awake and on the same network, and that its platform is running.`,
          "Work sync resumes by itself once it can be reached; nothing is lost.",
        ],
      };
  }
}

/** Pure: which links need a Needs-you row now. */
export function planWorkSyncAlerts(input: {
  record: WorkSyncHealthRecordV1 | null;
  links: ReadonlyArray<WatchedLink>;
  now: Date;
  thresholdMs?: number;
}): WorkSyncAlert[] {
  const threshold = input.thresholdMs ?? WORK_SYNC_FAILURE_THRESHOLD_MS;
  if (!input.record) return [];
  return input.links.flatMap((link) => {
    const health: WorkSyncHealthLink | undefined = input.record!.links.find((entry) => entry.linkId === link.linkId);
    if (!health || health.outcome === "synced") return [];
    const stale = staleFrom(health, link.lastMirrorSyncAt);
    if (!stale || input.now.getTime() - stale.getTime() <= threshold) return [];
    const errorClass = health.errorClass ?? "network";
    const lastSuccess = health.lastSuccessAt ?? link.lastMirrorSyncAt?.toISOString() ?? null;
    const since = formatInstant(stale, { timeZone: "UTC", withZone: true });
    const { explanation, nextSteps } = explain(errorClass, link);
    return [{
      issueKey: workSyncIssueKey(link.linkId),
      summary: `Work sync with ${link.peerLabel} has not worked since ${since}`,
      details: {
        linkId: link.linkId,
        peerLabel: link.peerLabel,
        peerAuthorityUrl: link.peerAuthorityUrl,
        lastSuccessAt: lastSuccess,
        failingSince: health.failingSince ?? null,
        errorClass,
        detail: health.detail,
        explanation: lastSuccess
          ? `${explanation} Its items shown here are stale since the last successful sync.`
          : explanation,
        nextSteps,
        actionLabel: "Review the paired installation",
        href: WORK_SYNC_HREF,
      },
    }];
  });
}

export interface WorkSyncWatchDb extends MonitorIssueDb {
  platformConfig: { findUnique(args: unknown): Promise<{ value: unknown } | null> };
  federationLink: { findMany(args: unknown): Promise<Array<{ linkId: string; peerAuthorityUrl: string; principal: { displayName: string } | null }>> };
  federatedRecordMirror: { findFirst(args: unknown): Promise<{ lastSyncedAt: Date | null } | null> };
  portfolioQualityIssue: MonitorIssueDb["portfolioQualityIssue"] & {
    findMany(args: unknown): Promise<Array<{ issueKey: string }>>;
  };
}

export interface WorkSyncNotice {
  itemKey: string;
  title: string;
  body: string;
  deepLink: string;
  riskClass: "bounded-write";
}

function parseRecord(value: unknown): WorkSyncHealthRecordV1 | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Partial<WorkSyncHealthRecordV1>;
  return record.schemaVersion === 1 && Array.isArray(record.links) ? (record as WorkSyncHealthRecordV1) : null;
}

/** One watch cycle over the live store. Opens, refreshes and resolves `work_sync_failure` rows. */
export async function runWorkSyncWatch(
  db: WorkSyncWatchDb,
  deps: { now?: () => Date; notify?: (notice: WorkSyncNotice) => Promise<void> } = {},
): Promise<{ open: string[]; opened: string[]; resolved: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const [row, links, alreadyOpen] = await Promise.all([
    db.platformConfig.findUnique({ where: { key: WORK_SYNC_HEALTH_KEY }, select: { value: true } }),
    db.federationLink.findMany({
      where: { role: "same-org-peer", linkState: "trusted", revokedAt: null, quarantinedAt: null },
      select: { linkId: true, peerAuthorityUrl: true, principal: { select: { displayName: true } } },
    }),
    db.portfolioQualityIssue.findMany({ where: { issueType: WORK_SYNC_FAILURE_ISSUE_TYPE, status: "open" }, select: { issueKey: true } }),
  ]);
  const watched: WatchedLink[] = [];
  for (const link of links) {
    const newest = await db.federatedRecordMirror.findFirst({
      where: { federationLinkId: link.linkId, canonicalSide: "peer", lastSyncedAt: { not: null } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    });
    watched.push({
      linkId: link.linkId,
      peerLabel: link.principal?.displayName ?? "the paired installation",
      peerAuthorityUrl: link.peerAuthorityUrl,
      lastMirrorSyncAt: newest?.lastSyncedAt ?? null,
    });
  }

  const alerts = planWorkSyncAlerts({ record: parseRecord(row?.value), links: watched, now });
  const before = new Set(alreadyOpen.map((issue) => issue.issueKey));
  const opened: string[] = [];
  for (const alert of alerts) {
    await openMonitorIssue(db, {
      issueKey: alert.issueKey,
      issueType: WORK_SYNC_FAILURE_ISSUE_TYPE,
      severity: "warn",
      summary: alert.summary,
      details: alert.details,
      now: () => now,
    });
    if (before.has(alert.issueKey)) continue;
    opened.push(alert.issueKey);
    if (deps.notify) {
      try {
        await deps.notify({
          itemKey: alert.issueKey,
          title: alert.summary,
          body: [alert.details.explanation, ...alert.details.nextSteps].join(" "),
          deepLink: alert.details.href,
          riskClass: "bounded-write",
        });
      } catch (error) {
        console.warn(`[work-sync-watch] notification failed: ${getErrorMessage(error)}`);
      }
    }
  }
  const resolved = await resolveMonitorIssuesExcept(db, {
    issueType: WORK_SYNC_FAILURE_ISSUE_TYPE,
    activeKeys: alerts.map((alert) => alert.issueKey),
    now: () => now,
  });
  return { open: alerts.map((alert) => alert.issueKey), opened, resolved };
}

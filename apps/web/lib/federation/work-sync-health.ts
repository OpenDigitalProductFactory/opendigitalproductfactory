// Work-sync health memory (BI-85DE8EBD).
//
// From 2026-11-08 to 2026-11-13 every pull from the paired installation failed
// with "fetch failed" and nobody was told. The health record kept only the last
// cycle's outcome, with `lastPullAt: null` on failure, so neither the last good
// pull nor when the failure began survived a cycle. This module carries both
// forward, classifies the failure in words the operator can act on, and says
// since when the mirrored items here are stale. Pure: no database access.

import type { WorkSyncHealthRecordV1, WorkSyncLinkResult } from "./work-sync";

/** What kind of failure, as the operator would fix it. */
export type WorkSyncErrorClass = "revoked" | "network" | "tls" | "peer-outdated" | "protocol";

export type WorkSyncHealthLink = WorkSyncHealthRecordV1["links"][number];

const TLS_PATTERN = /certificate|cert_|ssl|tls|self[- ]signed|unable to verify|eproto/i;
const REFUSED_PATTERN = /^Peer responded (401|403)\b/;
const OUTDATED_PATTERN = /does not serve work sync/i;

/** Pure: read a stored health record; anything that is not a version-1 record is null. One parser for every reader. */
export function parseWorkSyncHealthRecord(value: unknown): WorkSyncHealthRecordV1 | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Partial<WorkSyncHealthRecordV1>;
  return record.schemaVersion === 1 && Array.isArray(record.links) ? (record as WorkSyncHealthRecordV1) : null;
}

/** Pure: classify one failed pull. Revocation is told apart from network and TLS failure. */
export function classifyWorkSyncFailure(outcome: WorkSyncLinkResult["outcome"], detail: string | null): WorkSyncErrorClass {
  const text = detail ?? "";
  if (outcome === "no-token") return "revoked";
  if (outcome === "invalid-page" || outcome === "identity-mismatch") return "protocol";
  if (REFUSED_PATTERN.test(text)) return "revoked";
  if (OUTDATED_PATTERN.test(text)) return "peer-outdated";
  if (TLS_PATTERN.test(text)) return "tls";
  return "network";
}

/**
 * Pure: the next health record. A link that pulled now records its success and
 * clears its failure; a link that failed keeps its last success and the time it
 * first failed. `lastPullAt` keeps its old meaning for existing readers.
 */
export function mergeWorkSyncHealth(
  previous: WorkSyncHealthRecordV1 | null,
  results: ReadonlyArray<Pick<WorkSyncLinkResult, "linkId" | "outcome" | "detail">>,
  now: Date,
): WorkSyncHealthRecordV1 {
  const at = now.toISOString();
  return {
    schemaVersion: 1,
    observedAt: at,
    links: results.map((result) => {
      const before = previous?.links.find((link) => link.linkId === result.linkId);
      if (result.outcome === "synced") {
        return { linkId: result.linkId, outcome: result.outcome, detail: result.detail, lastPullAt: at, lastSuccessAt: at, failingSince: null, errorClass: null };
      }
      return {
        linkId: result.linkId,
        outcome: result.outcome,
        detail: result.detail,
        lastPullAt: null,
        lastSuccessAt: before?.lastSuccessAt ?? before?.lastPullAt ?? null,
        failingSince: before?.failingSince ?? at,
        errorClass: classifyWorkSyncFailure(result.outcome, result.detail),
      };
    }),
  };
}

/** When the link's mirrors stopped being current: its last success, else when it began failing. */
export function staleFrom(link: WorkSyncHealthLink, lastMirrorSyncAt: Date | null = null): Date | null {
  if (link.outcome === "synced") return null;
  const time = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN);
  const successes = [time(link.lastSuccessAt), lastMirrorSyncAt?.getTime() ?? Number.NaN].filter((value) => !Number.isNaN(value));
  if (successes.length > 0) return new Date(Math.max(...successes));
  const failing = time(link.failingSince);
  return Number.isNaN(failing) ? null : new Date(failing);
}

/** The earliest moment any failing link's mirrors went stale; null when every link is current. */
export function mirrorsStaleSince(record: WorkSyncHealthRecordV1 | null): Date | null {
  if (!record) return null;
  const times = record.links.flatMap((link) => {
    const from = staleFrom(link);
    return from ? [from.getTime()] : [];
  });
  return times.length > 0 ? new Date(Math.min(...times)) : null;
}

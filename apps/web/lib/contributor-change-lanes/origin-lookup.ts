// apps/web/lib/contributor-change-lanes/origin-lookup.ts
//
// Answer "which client, and which thread, produced this change?" from the
// governed records the pregate already writes (BI-3A34D7A9).
//
// Why SHA and not branch: a branch name is neither unique nor durable. Branches
// get reused across threads (`fix/local-ci-dead-waiter-reconciliation` was
// gated by three different sessions; `feat/product-management-playbooks` by
// four) and deleted on merge — while the commits live forever. So the commit
// SHA is the primary key here and the branch is only a fallback for a change
// that never reached the gate.
//
// Nothing about this lookup is published to the PR. The PR number stays the one
// public identifier; the correlation happens on the operator's own install.

import { prisma } from "@dpf/db";

export type ChangeOriginMatch = {
  /** How this record was matched — an exact SHA match outranks a branch guess. */
  matchedOn: "sha" | "branch";
  /** Which agent client: `claude`, `codex`, `build-studio`, … */
  provider: string | null;
  /** The client THREAD id, so repeated gates from one thread roll up. */
  sessionId: string | null;
  /** Parent/host thread when the client exposed one (sub-thread rollup). */
  rootSessionId: string | null;
  /** Whether the gate could actually identify its caller. */
  attribution: string | null;
  branch: string | null;
  sha: string | null;
  worktreePath: string | null;
  leaseId: string | null;
  evidenceRecordId: string | null;
  gatePassed: boolean | null;
  recordedAt: Date;
};

export type ChangeOriginResult = {
  /** Best single answer, or null when nothing in the install matched. */
  origin: ChangeOriginMatch | null;
  /** Every match, newest first — a branch gated by several threads shows them all. */
  matches: ChangeOriginMatch[];
  /**
   * True when the change is known to the install but no record could name its
   * client — distinct from "no records at all", which usually means an outside
   * contributor whose work never touched this install.
   */
  unattributed: boolean;
};

type OriginLookupDb = {
  externalEvidenceRecord: { findMany: (args: unknown) => Promise<unknown[]> };
  nonProductionEnvironmentLease: { findMany: (args: unknown) => Promise<unknown[]> };
};

type EvidenceRowLike = {
  id: string;
  provider: string | null;
  target: string | null;
  createdAt: Date;
  details: unknown;
};

type LeaseRowLike = {
  leaseId: string;
  ownerProvider: string | null;
  ownerSessionId: string | null;
  branchName: string | null;
  worktreePath: string | null;
  purpose: string | null;
  createdAt: Date;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function evidenceToMatch(row: EvidenceRowLike, matchedOn: "sha" | "branch"): ChangeOriginMatch {
  const details = asRecord(row.details);
  const evidence = asRecord(details?.["evidence"]);
  const origin = asRecord(evidence?.["origin"]);
  const gatePassed = evidence?.["gatePassed"];
  return {
    matchedOn,
    provider: stringOrNull(row.provider),
    sessionId: stringOrNull(details?.["externalSessionId"]),
    rootSessionId: stringOrNull(origin?.["rootSessionId"]),
    // Records written before the attribution block existed carry no marker;
    // report that as unknown rather than asserting they were attributed.
    attribution: stringOrNull(origin?.["attribution"]),
    branch: stringOrNull(evidence?.["branch"]) ?? stringOrNull(row.target),
    sha: stringOrNull(evidence?.["sha"]),
    worktreePath: null,
    leaseId: stringOrNull(evidence?.["leaseId"]),
    evidenceRecordId: row.id,
    gatePassed: typeof gatePassed === "boolean" ? gatePassed : null,
    recordedAt: row.createdAt,
  };
}

function leaseToMatch(row: LeaseRowLike, matchedOn: "sha" | "branch"): ChangeOriginMatch {
  // The gate writes `... for <branch> @ <sha>` into purpose, so a lease that
  // never produced an evidence record (cancelled, expired, still queued) can
  // still be attributed.
  const shaFromPurpose = row.purpose?.match(/\b([0-9a-f]{40})\b/i)?.[1] ?? null;
  return {
    matchedOn,
    provider: stringOrNull(row.ownerProvider),
    sessionId: stringOrNull(row.ownerSessionId),
    rootSessionId: null,
    attribution: null,
    branch: stringOrNull(row.branchName),
    sha: shaFromPurpose,
    worktreePath: stringOrNull(row.worktreePath),
    leaseId: row.leaseId,
    evidenceRecordId: null,
    gatePassed: null,
    recordedAt: row.createdAt,
  };
}

/** A session id the gate itself flagged as un-identifiable. */
export function isUnattributedSession(sessionId: string | null): boolean {
  if (!sessionId) return true;
  // `unattributed-<pid>` is the current marker; `gate-<pid>` is the legacy
  // pre-BI-3A34D7A9 default that looked like a real id but never was.
  return /^unattributed-/.test(sessionId) || /^gate-\d+$/.test(sessionId);
}

/**
 * Look up the origin of a change by commit SHA(s), falling back to branch.
 *
 * Pass every SHA the PR contains (head plus commits): a PR that was gated
 * before a rebase matches on an earlier SHA, and matching any of them is still
 * an exact match.
 */
export async function lookupChangeOrigin(
  input: { shas?: string[]; branchName?: string | null; limit?: number },
  deps: { db?: OriginLookupDb } = {},
): Promise<ChangeOriginResult> {
  const db = (deps.db ?? prisma) as OriginLookupDb;
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const shas = (input.shas ?? []).filter((s) => /^[0-9a-f]{40}$/i.test(s));
  const branchName = stringOrNull(input.branchName ?? null);

  if (shas.length === 0 && !branchName) {
    return { origin: null, matches: [], unattributed: false };
  }

  const [evidenceRows, leaseRows] = await Promise.all([
    branchName || shas.length > 0
      ? (db.externalEvidenceRecord.findMany({
          where: {
            operationType: "local_integration_ci",
            ...(branchName ? { target: branchName } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }) as Promise<EvidenceRowLike[]>)
      : Promise.resolve([] as EvidenceRowLike[]),
    branchName
      ? (db.nonProductionEnvironmentLease.findMany({
          where: { branchName },
          orderBy: { createdAt: "desc" },
          take: 200,
        }) as Promise<LeaseRowLike[]>)
      : Promise.resolve([] as LeaseRowLike[]),
  ]);

  const shaSet = new Set(shas.map((s) => s.toLowerCase()));
  const matches: ChangeOriginMatch[] = [];

  for (const row of evidenceRows) {
    const match = evidenceToMatch(row, "branch");
    if (match.sha && shaSet.has(match.sha.toLowerCase())) {
      matches.push({ ...match, matchedOn: "sha" });
    } else if (branchName && match.branch === branchName) {
      matches.push(match);
    }
  }

  for (const row of leaseRows) {
    const match = leaseToMatch(row, "branch");
    if (match.sha && shaSet.has(match.sha.toLowerCase())) {
      matches.push({ ...match, matchedOn: "sha" });
    } else if (branchName && match.branch === branchName) {
      matches.push(match);
    }
  }

  // Exact SHA matches first, then most recent. Within that, a record that
  // actually names a thread beats one that admits it could not.
  matches.sort((a, b) => {
    if (a.matchedOn !== b.matchedOn) return a.matchedOn === "sha" ? -1 : 1;
    const aNamed = isUnattributedSession(a.sessionId) ? 1 : 0;
    const bNamed = isUnattributedSession(b.sessionId) ? 1 : 0;
    if (aNamed !== bNamed) return aNamed - bNamed;
    return b.recordedAt.getTime() - a.recordedAt.getTime();
  });

  const trimmed = matches.slice(0, limit);
  const origin = trimmed[0] ?? null;
  return {
    origin,
    matches: trimmed,
    unattributed: origin !== null && isUnattributedSession(origin.sessionId),
  };
}

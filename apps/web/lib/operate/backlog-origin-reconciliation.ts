// ─── Origin reconciliation for the backlog front door (BI-952F08BA) ─────────
// Sources that re-deliver the same record on every poll (upstream GitHub
// issues) need identity, not recurrence: one repository-qualified origin maps
// to one canonical item through repeat polls and terminal states, and only a
// real source change is recorded. Split from backlog-ingest.ts, which calls
// `reconcileOrigin` when an ingest opts in with `reconcile`.
//
// See docs/superpowers/specs/2026-09-16-ecosystem-issue-intake-and-arbitration-design.md §6.1.

import { isRecord } from "@/lib/shared/coerce";

import type { BacklogIngestResult, IngestBacklogStore } from "@/lib/operate/backlog-ingest";

/** Source identity and state for a reconciled origin (spec §6.1). */
export interface OriginReconciliation {
  /** Lowercased `owner/repo` the qualified origin id belongs to. */
  repository: string;
  /** Canonical link to the source record. */
  sourceUrl: string | null;
  /** Source state as the origin reports it (e.g. "open" / "closed"). */
  state: string;
  /** Content/state fingerprint; a different value is a source change. */
  fingerprint: string;
  /** Legacy unqualified origin id to dual-read (the bare issue number). */
  legacyId?: string;
}

/**
 * What one ingest call did. `recurred` is the legacy recurrence path (count
 * bumped); the other three non-create values belong to reconciled origins.
 */
export type BacklogIngestOutcome = "created" | "recurred" | "unchanged" | "changed" | "needs-review";

/** Stable, queryable, human-readable provenance marker embedded in the body. */
export function backlogOriginMarker(kind: string, id: string): string {
  return `[origin:${kind}:${id}]`;
}

/**
 * Repository-qualified origin id for a GitHub issue: `owner/repo#<number>`,
 * lowercased because GitHub repository names are case-insensitive. The issue
 * number alone is not an identity: two repositories reuse every number
 * (BI-952F08BA, spec §6.1).
 */
export function qualifiedIssueOriginId(repository: string, number: number | string): string {
  return `${repository.trim().toLowerCase()}#${String(number).trim()}`;
}

const GITHUB_ISSUE_URL = /https?:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/issues\/(\d+)/gi;

/** Parse a GitHub issue URL into its lowercased repository and number. */
export function parseGithubIssueUrl(url: string | null | undefined): { repository: string; number: number } | null {
  if (!url) return null;
  const match = new RegExp(GITHUB_ISSUE_URL.source, "i").exec(url.trim());
  if (!match) return null;
  return { repository: `${match[1]}/${match[2]}`.toLowerCase(), number: Number(match[3]) };
}

/**
 * The repositories a legacy (unqualified) intake's stored source links name
 * for this issue number. Read from the item body (where composeInboundBody
 * wrote the URL) and from any `source.url` an intake_origin payload carries.
 */
function storedIssueRepositories(texts: Array<string | null | undefined>, issueNumber: string): Set<string> {
  const repos = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(GITHUB_ISSUE_URL)) {
      if (match[3] === issueNumber) repos.add(`${match[1]}/${match[2]}`.toLowerCase());
    }
  }
  return repos;
}

/** What an intake_origin payload records about the source at that moment. */
export function sourceSnapshot(r: OriginReconciliation): Record<string, string | null> {
  return { repository: r.repository, url: r.sourceUrl, state: r.state, fingerprint: r.fingerprint };
}

type CandidateRow = { id?: string; itemId: string; body: string | null; status: string };

interface OriginHistory {
  /** Newest recorded source snapshot, or null when none was ever recorded. */
  latest: { fingerprint: string; state: string | null } | null;
  /** Whether a legacy → qualified mapping has already been recorded. */
  mapped: boolean;
  /** Source URLs any intake_origin payload recorded. */
  urls: string[];
}

function readOriginHistory(rows: Array<{ payload: unknown }>, qualifiedId: string): OriginHistory {
  let latest: OriginHistory["latest"] = null;
  let mapped = false;
  const urls: string[] = [];
  // Rows arrive newest first.
  for (const row of rows) {
    const payload = isRecord(row.payload) ? row.payload : null;
    if (!payload) continue;
    const source = isRecord(payload.source) ? payload.source : null;
    if (source) {
      if (typeof source.url === "string") urls.push(source.url);
      if (!latest && typeof source.fingerprint === "string") {
        latest = { fingerprint: source.fingerprint, state: typeof source.state === "string" ? source.state : null };
      }
    }
    const mapping = isRecord(payload.mapping) ? payload.mapping : null;
    const to = mapping && isRecord(mapping.to) ? mapping.to : null;
    if (to && to.id === qualifiedId) mapped = true;
  }
  return { latest, mapped, urls };
}

function changeKind(fromState: string | null, toState: string): "reopened" | "closed" | "edited" {
  if (fromState && fromState !== toState) {
    if (toState === "open") return "reopened";
    if (toState === "closed") return "closed";
  }
  return "edited";
}

/**
 * Resolve a reconciled origin to its one canonical item, or to a review stop.
 * Returns null only when no item claims the origin, so the caller creates one.
 *
 * Dual-read: the qualified marker matches by itself; a legacy unqualified
 * marker is accepted only when the item's stored source URL names the same
 * repository. An unresolvable legacy item, or more than one claimant, stops
 * for review — no work is created and no status changes.
 */
export async function reconcileOrigin(
  store: IngestBacklogStore,
  origin: { kind: string; id: string },
  reconcile: OriginReconciliation,
  actor: { submittedById: string | null; agentId: string | null },
): Promise<BacklogIngestResult | null> {
  const findItems = store.backlogItem.findMany;
  const findActivities = store.backlogItemActivity.findMany;
  if (!findItems || !findActivities) {
    throw new Error("[backlog-ingest] origin reconciliation needs backlogItem.findMany and backlogItemActivity.findMany.");
  }
  const select = { id: true, itemId: true, body: true, status: true };
  const history = async (id: string) => readOriginHistory(
    await findActivities({
      where: { backlogItemId: id, kind: "intake_origin" },
      select: { payload: true },
      orderBy: { recordedAt: "desc" },
    }),
    origin.id,
  );

  const qualifiedMarker = backlogOriginMarker(origin.kind, origin.id);
  const qualified = (await findItems({ where: { body: { contains: qualifiedMarker } }, select })) as CandidateRow[];

  const accepted = new Map<string, { row: CandidateRow; viaLegacy: boolean }>();
  for (const row of qualified) if (row.id) accepted.set(row.id, { row, viaLegacy: false });

  const unresolved: CandidateRow[] = [];
  const repository = reconcile.repository.toLowerCase();
  if (reconcile.legacyId) {
    const legacyMarker = backlogOriginMarker(origin.kind, reconcile.legacyId);
    const legacy = (await findItems({ where: { body: { contains: legacyMarker } }, select })) as CandidateRow[];
    for (const row of legacy) {
      if (!row.id || accepted.has(row.id)) continue;
      const repos = storedIssueRepositories([row.body, ...(await history(row.id)).urls], reconcile.legacyId);
      if (repos.size === 1 && repos.has(repository)) accepted.set(row.id, { row, viaLegacy: true });
      else if (repos.size !== 1) unresolved.push(row);
      // Exactly one OTHER repository: a different issue that shares the number.
    }
  }

  if (accepted.size > 1 || unresolved.length > 0) {
    return {
      itemId: "",
      id: "",
      created: false,
      outcome: "needs-review",
      reviewCandidates: [...[...accepted.values()].map((a) => a.row.itemId), ...unresolved.map((r) => r.itemId)],
      implementationCandidates: [],
    };
  }
  const match = [...accepted.values()][0];
  if (!match?.row.id) return null;

  const itemCuid = match.row.id;
  const past = await history(itemCuid);
  const snapshot = sourceSnapshot(reconcile);
  const recordedBy = {
    ...(actor.submittedById ? { recordedById: actor.submittedById } : {}),
    ...(actor.agentId ? { recordedByAgentId: actor.agentId } : {}),
  };

  if (match.viaLegacy && !past.mapped) {
    // Audited, once: the legacy identity now resolves to the qualified one.
    // The snapshot doubles as the change baseline for a legacy item.
    await store.backlogItemActivity.create({
      data: {
        backlogItemId: itemCuid,
        kind: "intake_origin",
        summary: `Origin ${origin.kind} ${reconcile.legacyId} resolved to ${origin.id}`,
        payload: {
          origin,
          created: false,
          createdBy: "backlog-ingest",
          mapping: { from: { kind: origin.kind, id: reconcile.legacyId }, to: origin, resolvedBy: "stored-source-url" },
          source: snapshot,
        },
        ...recordedBy,
      },
    });
  }

  let outcome: BacklogIngestOutcome = "unchanged";
  if (past.latest && past.latest.fingerprint !== reconcile.fingerprint) {
    const kind = changeKind(past.latest.state, reconcile.state);
    await store.backlogItemActivity.create({
      data: {
        backlogItemId: itemCuid,
        kind: "intake_origin",
        summary: `Source ${kind}: ${origin.kind} ${origin.id}`,
        payload: {
          origin,
          created: false,
          createdBy: "backlog-ingest",
          change: { kind, fromState: past.latest.state, toState: reconcile.state },
          source: snapshot,
        },
        ...recordedBy,
      },
    });
    outcome = "changed";
  }

  return {
    itemId: match.row.itemId,
    id: itemCuid,
    created: false,
    outcome,
    implementationCandidates: [],
  };
}

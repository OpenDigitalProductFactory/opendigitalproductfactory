import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { SEMANTIC_REVIEW_MAX_ATTEMPTS } from "./semantic-review-recovery-policy";
import { FailureReadinessPublicationError } from "./failure-readiness-publication-error";

/**
 * Retained status publication for a completed native review (BI-2A8A8FC8).
 *
 * The review's verdict is saved before anything is posted to GitHub. Posting
 * the `dpf/failure-readiness` status is a separate, durable obligation kept on
 * the same TaskRun's `semanticReview.publication`: the worker makes the first
 * attempt, and the existing two-minute dispatch-reconciliation job resumes any
 * that did not land. Each attempt re-reads the server's own verdict for the
 * reviewed commit. Nothing here calls a model, re-runs the review, or changes
 * the review's status, receipt or completion time.
 *
 * GitHub commit statuses carry no idempotency key, but the latest status for a
 * context wins. Re-posting after a lost response therefore settles on the same
 * server verdict rather than creating a second, different one.
 */

export const PUBLICATION_OWNER = "delivery-coordinator" as const;
/** An attempt still marked in flight after this long belongs to a worker that died. */
export const PUBLICATION_CLAIM_LEASE_MS = 5 * 60_000;
/** After this long the obligation stops; the PR delivery reconciler still refreshes ready PRs. */
export const PUBLICATION_WINDOW_MS = 24 * 3_600_000;
const BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000];
const BATCH = 25;

export type PublicationState = "pending" | "publishing" | "published" | "held";
export type SemanticReviewPublication = {
  schemaVersion: 1;
  state: PublicationState;
  capsuleId: string;
  sourceHeadSha: string;
  attempts: number;
  firstRecordedAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  publishedAt: string | null;
  reason: string | null;
  owner: typeof PUBLICATION_OWNER;
  nextAction: string;
  claim: string | null;
};

const ACTIONS: Record<string, string> = {
  pending: "The server retries the status post on its own; no resend or new review is needed.",
  published: "The reviewed verdict is on the commit. GitHub checks and the merge queue take it from here.",
  "source-changed": "The room moved to a new commit. That commit needs its own review; this verdict is not posted for it.",
  "workroom-missing": "The review's Workroom no longer exists; nothing is posted.",
  "submitting-authority-no-longer-valid": "The reviewer's authority was withdrawn. Restore it, then submit a fresh review.",
  "review-request-unavailable": "The saved review request cannot be read back, so its binding cannot be rechecked; nothing is posted.",
  "publication-denied": "GitHub refused the status post. Fix the platform's GitHub access; the saved verdict is kept.",
  "repository-mismatch": "The room points at a different repository than this install publishes to; nothing is posted.",
  "no-source-commit": "The room has no commit to attach a status to; the ship lane posts it once one is bound.",
  "publication-attempts-exhausted": "Retries are used up. Restore GitHub status posting; the PR delivery reconciler refreshes ready PRs from the saved verdict.",
  "publication-window-elapsed": "The retry window passed. The PR delivery reconciler refreshes ready PRs from the saved verdict.",
};
const action = (key: string) => ACTIONS[key] ?? ACTIONS.pending!;

export function newSemanticReviewPublication(binding: { capsuleId: string; sourceHeadSha: string }, now: Date): SemanticReviewPublication {
  return { schemaVersion: 1, state: "pending", capsuleId: binding.capsuleId, sourceHeadSha: binding.sourceHeadSha,
    attempts: 0, firstRecordedAt: now.toISOString(), lastAttemptAt: null, nextAttemptAt: null, publishedAt: null,
    reason: null, owner: PUBLICATION_OWNER, nextAction: action("pending"), claim: null };
}

/** A marker that does not validate is not guessed at; the caller treats it as absent. */
export function readSemanticReviewPublication(progressPayload: unknown): SemanticReviewPublication | null {
  const review = isRecord(progressPayload) && isRecord(progressPayload.semanticReview) ? progressPayload.semanticReview : null;
  const value = review && isRecord(review.publication) ? review.publication : null;
  if (!value || value.schemaVersion !== 1) return null;
  const states: PublicationState[] = ["pending", "publishing", "published", "held"];
  const time = (v: unknown) => v === null || (typeof v === "string" && Number.isFinite(Date.parse(v)));
  if (!states.includes(value.state as PublicationState) || typeof value.capsuleId !== "string"
    || typeof value.sourceHeadSha !== "string" || !/^[a-f0-9]{40}$/i.test(value.sourceHeadSha)
    || typeof value.attempts !== "number" || !Number.isSafeInteger(value.attempts) || value.attempts < 0
    || typeof value.firstRecordedAt !== "string" || !time(value.firstRecordedAt)
    || !time(value.lastAttemptAt) || !time(value.nextAttemptAt) || !time(value.publishedAt)) return null;
  return value as unknown as SemanticReviewPublication;
}

/** Fixed reason classes only: provider text never reaches the saved record. */
export function classifyPublicationFailure(error: unknown): { reason: string; retry: boolean } {
  if (error instanceof FailureReadinessPublicationError) {
    if (error.code === "credential-unavailable") return { reason: "publication-credential-unavailable", retry: true };
    if (error.code !== "http-status") return { reason: error.code, retry: false };
    if (error.rateLimited) return { reason: "publication-rate-limited", retry: true };
    if (error.httpStatus !== null && error.httpStatus >= 400 && error.httpStatus < 500) return { reason: "publication-denied", retry: false };
    return { reason: "publication-provider-error", retry: true };
  }
  return { reason: "publication-transport-failed", retry: true };
}

type Row = { taskRunId: string; updatedAt: Date; progressPayload: unknown; a2aMetadata?: unknown; id?: string; userId?: string };
export type PublicationDeps = {
  db: {
    taskRun: {
      findUnique(args: unknown): Promise<Row | null>;
      findMany(args: unknown): Promise<Row[]>;
      updateMany(args: unknown): Promise<{ count: number }>;
    };
    workroom: { findUnique(args: unknown): Promise<{ headSha: string | null; repositoryFullName: string | null } | null> };
  };
  publish(capsuleId: string, expectedHeadSha: string): Promise<void>;
  /** The submitting actor's current authority over the original review request. */
  authority(row: Row): Promise<"allowed" | "denied" | "unavailable" | "request-unavailable">;
  now(): Date;
};

const select = { id: true, taskRunId: true, userId: true, updatedAt: true, progressPayload: true, a2aMetadata: true };

async function write(deps: PublicationDeps, row: Row, publication: SemanticReviewPublication, fence: Record<string, unknown>) {
  const payload = isRecord(row.progressPayload) ? row.progressPayload : {};
  const review = isRecord(payload.semanticReview) ? payload.semanticReview : {};
  return (await deps.db.taskRun.updateMany({ where: { taskRunId: row.taskRunId, ...fence },
    data: { progressPayload: { ...payload, semanticReview: { ...review, publication } } as Prisma.InputJsonValue } })).count === 1;
}

export type PublicationOutcome = { state: PublicationState | "contended" | "absent"; reason: string | null };

/**
 * One bounded step of a retained publication. Safe to call from the worker
 * and the reconciler at once: the CAS reservation lets exactly one post.
 */
export async function publishRetainedReview(taskRunId: string, deps: PublicationDeps = defaultDeps()): Promise<PublicationOutcome> {
  const row = await deps.db.taskRun.findUnique({ where: { taskRunId }, select });
  const current = row ? readSemanticReviewPublication(row.progressPayload) : null;
  if (!row || !current) return { state: "absent", reason: null };
  if (current.state === "published" || current.state === "held") return { state: current.state, reason: current.reason };
  const now = deps.now();
  if (current.state === "publishing" && current.lastAttemptAt
    && now.getTime() - Date.parse(current.lastAttemptAt) < PUBLICATION_CLAIM_LEASE_MS) return { state: "contended", reason: current.reason };

  const settle = async (state: PublicationState, reason: string | null, patch: Partial<SemanticReviewPublication> = {},
    fence: Record<string, unknown> = { updatedAt: row.updatedAt }): Promise<PublicationOutcome> => {
    const saved = await write(deps, row, { ...current, state, reason, nextAction: action(state === "held" ? reason ?? "" : state),
      claim: null, ...patch }, fence);
    return saved ? { state, reason } : { state: "contended", reason: current.reason };
  };
  const hold = (reason: string) => settle("held", reason, { nextAttemptAt: null });

  if (now.getTime() - Date.parse(current.firstRecordedAt) > PUBLICATION_WINDOW_MS) return hold("publication-window-elapsed");
  if (current.attempts >= SEMANTIC_REVIEW_MAX_ATTEMPTS) return hold("publication-attempts-exhausted");
  const room = await deps.db.workroom.findUnique({ where: { capsuleId: current.capsuleId }, select: { headSha: true, repositoryFullName: true } });
  if (!room) return hold("workroom-missing");
  if (room.headSha?.toLowerCase() !== current.sourceHeadSha.toLowerCase()) return hold("source-changed");
  const authority = await deps.authority(row).catch(() => "unavailable" as const);
  if (authority === "denied") return hold("submitting-authority-no-longer-valid");
  if (authority === "request-unavailable") return hold("review-request-unavailable");
  if (authority !== "allowed") {
    // Unknown is not denial: wait without spending an attempt; the window still bounds it.
    return settle("pending", "review-authority-unavailable", { nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[0]!).toISOString() });
  }

  const claim = randomUUID();
  const attempts = current.attempts + 1;
  const reserved = await write(deps, row, { ...current, state: "publishing", attempts, lastAttemptAt: now.toISOString(),
    nextAttemptAt: null, claim }, { updatedAt: row.updatedAt });
  if (!reserved) return { state: "contended", reason: current.reason };
  const claimed = await deps.db.taskRun.findUnique({ where: { taskRunId }, select });
  if (!claimed) return { state: "contended", reason: current.reason };
  const claimFence = { progressPayload: { path: ["semanticReview", "publication", "claim"], equals: claim } };
  const finish = async (state: PublicationState, reason: string | null, patch: Partial<SemanticReviewPublication>) => {
    const saved = await write(deps, claimed, { ...current, attempts, lastAttemptAt: now.toISOString(), state, reason,
      nextAction: action(state === "held" ? reason ?? "" : state), claim: null, ...patch }, claimFence);
    return saved ? { state, reason } : { state: "contended" as const, reason };
  };
  try {
    await deps.publish(current.capsuleId, current.sourceHeadSha);
  } catch (error) {
    const failure = classifyPublicationFailure(error);
    if (!failure.retry) return finish("held", failure.reason, { nextAttemptAt: null });
    if (attempts >= SEMANTIC_REVIEW_MAX_ATTEMPTS) return finish("held", "publication-attempts-exhausted", { nextAttemptAt: null });
    return finish("pending", failure.reason, { nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[attempts - 1]!).toISOString() });
  }
  return finish("published", null, { publishedAt: now.toISOString(), nextAttemptAt: null });
}

/** Bounded batch for the existing dispatch-reconciliation job. Selection never depends on PR check state. */
export async function reconcileSemanticReviewPublications(deps: PublicationDeps = defaultDeps()) {
  const rows = await deps.db.taskRun.findMany({ where: {
    a2aMetadata: { path: ["gateKind"], equals: "semantic-review" },
    OR: [{ progressPayload: { path: ["semanticReview", "publication", "state"], equals: "pending" } },
      { progressPayload: { path: ["semanticReview", "publication", "state"], equals: "publishing" } }],
  }, select, orderBy: { updatedAt: "asc" }, take: BATCH });
  const now = deps.now().getTime();
  const tally = { scanned: rows.length, published: 0, pending: 0, held: 0 };
  for (const row of rows) {
    const marker = readSemanticReviewPublication(row.progressPayload);
    if (!marker) continue;
    if (marker.state === "pending" && marker.nextAttemptAt && Date.parse(marker.nextAttemptAt) > now) continue;
    if (marker.state === "publishing" && marker.lastAttemptAt && now - Date.parse(marker.lastAttemptAt) < PUBLICATION_CLAIM_LEASE_MS) continue;
    const outcome = await publishRetainedReview(row.taskRunId, deps);
    if (outcome.state === "published") tally.published += 1;
    else if (outcome.state === "held") tally.held += 1;
    else if (outcome.state === "pending") tally.pending += 1;
  }
  return tally;
}

function defaultDeps(): PublicationDeps {
  return {
    db: prisma as unknown as PublicationDeps["db"],
    publish: async (capsuleId, expectedHeadSha) =>
      (await import("./failure-readiness-status")).publishFailureReadinessStatus(capsuleId, { expectedHeadSha }),
    authority: async (row) => {
      const { readPersistedSemanticReviewRequest } = await import("./semantic-review-request-store");
      const packet = row.id && row.userId ? await readPersistedSemanticReviewRequest(row as Parameters<typeof readPersistedSemanticReviewRequest>[0]) : null;
      if (!packet) return "request-unavailable";
      const { inspectSemanticReviewAuthority } = await import("./semantic-review-authority");
      const observed = await inspectSemanticReviewAuthority(packet, row.taskRunId);
      return observed.state === "allowed" ? "allowed" : observed.state === "denied" ? "denied" : "unavailable";
    },
    now: () => new Date(),
  };
}

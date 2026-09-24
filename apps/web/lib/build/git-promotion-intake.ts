import crypto from "crypto";
import { prisma, type Prisma } from "@dpf/db";
import { readPullRequestMergedSignal, type PullRequestMergedSignal } from "./pull-request-merged-signal";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export type GitProvider = "github";

export type GitUpdateCandidateStatus =
  /**
   * Recorded, but the events this delivery owes have not been confirmed sent.
   * A redelivery of the same delivery id announces them again (BI-C26D5DC5).
   */
  | "emit-pending"
  | "queued"
  | "ignored"
  | "sandbox-verification-running"
  | "sandbox-verification-complete"
  | "failed";

export const EMIT_PENDING_STATUS = "emit-pending" satisfies GitUpdateCandidateStatus;

export type GitHubPushPayload = {
  ref?: string;
  before?: string;
  after?: string;
  repository?: {
    full_name?: string;
    clone_url?: string;
    default_branch?: string;
  };
  pusher?: {
    name?: string;
    email?: string;
  };
};

export type GitPromotionCandidateInput = {
  provider: GitProvider;
  eventName: string;
  deliveryId: string;
  payload: GitHubPushPayload;
  /** Set when the delivery is a merged pull request; owes `build/pr-merged.received`. */
  pullRequestMerged?: PullRequestMergedSignal | null;
};

export type RecordedGitPromotionCandidate = {
  candidateId: string;
  status: GitUpdateCandidateStatus;
  duplicate: boolean;
  queued: boolean;
  /** A duplicate delivery whose earlier announce never completed, announced now. */
  reemitted: boolean;
  reason: string | null;
};

export type GitIntakeEventName = "build/git-update.received" | "build/pr-merged.received";

export type GitIntakeEvent = {
  id: string;
  name: GitIntakeEventName;
  data: Record<string, unknown>;
};

/** The candidate row exists, but the events it owes were not sent. Retryable. */
export class GitIntakeEmitError extends Error {
  constructor(candidateId: string, cause: unknown) {
    super(
      `Git update ${candidateId} was recorded but its events were not sent; ` +
        `redeliver it to retry (${getErrorMessage(cause)})`,
    );
    this.name = "GitIntakeEmitError";
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyGitHubSignature(rawBody: string, signatureHeader: string | null, secret: string | null): boolean {
  if (!secret) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const received = signatureHeader.slice("sha256=".length);
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqualHex(received, expected);
}

export function parseGitHubWebhookPayload(rawBody: string): GitHubPushPayload {
  const parsed = JSON.parse(rawBody) as GitHubPushPayload;
  return parsed;
}

export function branchFromRef(ref: string | undefined): string | null {
  const prefix = "refs/heads/";
  if (!ref?.startsWith(prefix)) return null;
  return ref.slice(prefix.length);
}

export function isDeletedRef(afterSha: string | undefined): boolean {
  return !!afterSha && /^0+$/.test(afterSha);
}

export function evaluateGitHubPushForSandbox(payload: GitHubPushPayload): {
  status: GitUpdateCandidateStatus;
  reason: string | null;
  branch: string | null;
} {
  const branch = branchFromRef(payload.ref);
  if (!branch) return { status: "ignored", reason: "Only branch push events can trigger sandbox verification.", branch: null };

  const defaultBranch = payload.repository?.default_branch ?? "main";
  if (branch !== defaultBranch) {
    return { status: "ignored", reason: `Push was for ${branch}, not default branch ${defaultBranch}.`, branch };
  }

  if (isDeletedRef(payload.after)) {
    return { status: "ignored", reason: "Deleted refs do not trigger sandbox verification.", branch };
  }

  if (!payload.after) {
    return { status: "ignored", reason: "Push payload did not include an after SHA.", branch };
  }

  if (!payload.repository?.full_name) {
    return { status: "ignored", reason: "Push payload did not include a repository full_name.", branch };
  }

  if (!payload.repository?.clone_url) {
    return { status: "ignored", reason: "Push payload did not include a repository clone_url.", branch };
  }

  return { status: "queued", reason: null, branch };
}

export function buildCandidateId(input: Pick<GitPromotionCandidateInput, "provider" | "deliveryId">): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${input.provider}:${input.deliveryId}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `GPC-${digest}`;
}

/**
 * The Inngest event id for one event of one delivery.
 *
 * Deterministic, so a second send of the same event (a redelivery racing a
 * send that actually landed) is dropped by Inngest's id dedupe rather than
 * running every subscriber twice.
 */
export function intakeEventId(deliveryKey: string, name: GitIntakeEventName): string {
  return `${name}:${deliveryKey}`;
}

/** The events one delivery owes its subscribers. Pure. */
export function intakeEventsOwed(input: {
  deliveryKey: string;
  candidateId: string;
  sandboxStatus: GitUpdateCandidateStatus;
  pullRequestMerged: PullRequestMergedSignal | null;
}): GitIntakeEvent[] {
  const events: GitIntakeEvent[] = [];
  if (input.sandboxStatus === "queued") {
    events.push({
      id: intakeEventId(input.deliveryKey, "build/git-update.received"),
      name: "build/git-update.received",
      data: { candidateId: input.candidateId },
    });
  }
  // A merged pull request is the delivery fact this platform previously had
  // to POLL for (BI-A6E4D205). Only a genuine merge owes it: a closed-unmerged
  // pull request carries the same `action`, and treating it as delivery would
  // reap the worktree holding the only copy of an abandoned branch.
  if (input.pullRequestMerged) {
    events.push({
      id: intakeEventId(input.deliveryKey, "build/pr-merged.received"),
      name: "build/pr-merged.received",
      data: { candidateId: input.candidateId, ...input.pullRequestMerged },
    });
  }
  return events;
}

/**
 * Send the owed events, then record that they were sent.
 *
 * The row is written BEFORE the send so a subscriber can always load it. If
 * the send throws, the row stays `emit-pending` and the error surfaces, so
 * GitHub records a failed delivery and a redelivery can finish the job.
 *
 * The settle is a compare-and-set on `emit-pending`: a subscriber that already
 * picked the row up (sandbox verification moves it to running) keeps its
 * answer.
 */
async function announce(
  candidateId: string,
  events: readonly GitIntakeEvent[],
  settledStatus: GitUpdateCandidateStatus,
): Promise<void> {
  if (events.length > 0) {
    const { inngest } = await import("@/lib/queue/inngest-client");
    try {
      await inngest.send([...events]);
    } catch (err) {
      throw new GitIntakeEmitError(candidateId, err);
    }
  }
  await prisma.gitPromotionCandidate.updateMany({
    where: { candidateId, status: EMIT_PENDING_STATUS },
    data: { status: settledStatus },
  });
}

export async function recordGitPromotionCandidate(
  input: GitPromotionCandidateInput,
): Promise<RecordedGitPromotionCandidate> {
  const deliveryKey = `${input.provider}:${input.deliveryId}`;
  const evaluation = evaluateGitHubPushForSandbox(input.payload);
  const pullRequestMerged = input.pullRequestMerged ?? null;

  const existing = await prisma.gitPromotionCandidate.findUnique({
    where: { deliveryKey },
    select: { candidateId: true, status: true, statusReason: true },
  });
  if (existing) {
    // A duplicate whose events were confirmed sent is NOT re-announced: that
    // would make every subscriber idempotent-or-wrong rather than simply
    // idempotent. Rows written before `emit-pending` existed carry no receipt
    // and are treated as sent, which is what the old code assumed.
    if (existing.status !== EMIT_PENDING_STATUS) {
      return {
        candidateId: existing.candidateId,
        status: existing.status as GitUpdateCandidateStatus,
        duplicate: true,
        queued: false,
        reemitted: false,
        reason: existing.statusReason,
      };
    }
    // The earlier delivery was recorded and its send failed. Without this the
    // event is lost for good: the unique delivery key turns every retry into a
    // silent 200. The redelivered payload is the same delivery, so it owes the
    // same events under the same ids.
    const events = intakeEventsOwed({
      deliveryKey,
      candidateId: existing.candidateId,
      sandboxStatus: evaluation.status,
      pullRequestMerged,
    });
    await announce(existing.candidateId, events, evaluation.status);
    return {
      candidateId: existing.candidateId,
      status: evaluation.status,
      duplicate: true,
      queued: evaluation.status === "queued",
      reemitted: events.length > 0,
      reason: existing.statusReason,
    };
  }

  const candidateId = buildCandidateId(input);
  const owesEvents =
    intakeEventsOwed({ deliveryKey, candidateId, sandboxStatus: evaluation.status, pullRequestMerged }).length > 0;
  const created = await prisma.gitPromotionCandidate.create({
    data: {
      candidateId,
      provider: input.provider,
      deliveryKey,
      eventName: input.eventName,
      repositoryFullName: input.payload.repository?.full_name ?? "unknown",
      repositoryCloneUrl: input.payload.repository?.clone_url ?? null,
      ref: input.payload.ref ?? null,
      branch: evaluation.branch,
      beforeSha: input.payload.before ?? null,
      afterSha: input.payload.after ?? null,
      status: owesEvents ? EMIT_PENDING_STATUS : evaluation.status,
      statusReason: evaluation.reason,
      payload: input.payload as Prisma.InputJsonValue,
    },
    select: { candidateId: true, status: true, statusReason: true },
  });

  if (owesEvents) {
    const events = intakeEventsOwed({
      deliveryKey,
      candidateId: created.candidateId,
      sandboxStatus: evaluation.status,
      pullRequestMerged,
    });
    await announce(created.candidateId, events, evaluation.status);
  }

  return {
    candidateId: created.candidateId,
    status: evaluation.status,
    duplicate: false,
    queued: evaluation.status === "queued",
    reemitted: false,
    reason: created.statusReason,
  };
}

export async function handleGitHubWebhook(input: {
  rawBody: string;
  eventName: string;
  deliveryId: string;
  signature: string | null;
  secret: string | null;
}): Promise<RecordedGitPromotionCandidate> {
  if (!verifyGitHubSignature(input.rawBody, input.signature, input.secret)) {
    throw new Error("Invalid GitHub webhook signature");
  }

  const payload = parseGitHubWebhookPayload(input.rawBody);
  // Read from the payload as GitHub sent it. The candidate row defaults a
  // missing repository to "unknown", and that placeholder must never pass as
  // the identity of a merge.
  const verdict = readPullRequestMergedSignal(input.eventName, payload);
  // The merge event (BI-A6E4D205) and the push event are both owed by the
  // candidate row, so one record of "sent" covers them and a redelivery can
  // finish a send that failed (BI-C26D5DC5).
  const recorded = await recordGitPromotionCandidate({
    provider: "github",
    eventName: input.eventName,
    deliveryId: input.deliveryId,
    payload: input.eventName !== "push"
      ? { ...payload, repository: payload.repository ?? { full_name: "unknown" } }
      : payload,
    pullRequestMerged: verdict.merged ? verdict.signal : null,
  });

  if (input.eventName === "pull_request") {
    try {
      const { applyGitHubPullRequestToBacklog } = await import(
        "@/lib/backlog/pr-submit-awaiting-acceptance"
      );
      await applyGitHubPullRequestToBacklog(JSON.parse(input.rawBody) as unknown);
    } catch (err) {
      console.error("[git-promotion-intake] awaiting-acceptance actuator failed", err);
    }
  }

  return recorded;
}

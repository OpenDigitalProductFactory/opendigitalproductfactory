import crypto from "crypto";
import { prisma, type Prisma } from "@dpf/db";

export type GitProvider = "github";

export type GitUpdateCandidateStatus =
  | "queued"
  | "ignored"
  | "sandbox-verification-running"
  | "sandbox-verification-complete"
  | "failed";

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
};

export type RecordedGitPromotionCandidate = {
  candidateId: string;
  status: GitUpdateCandidateStatus;
  duplicate: boolean;
  queued: boolean;
  reason: string | null;
};

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

export async function recordGitPromotionCandidate(
  input: GitPromotionCandidateInput,
): Promise<RecordedGitPromotionCandidate> {
  const deliveryKey = `${input.provider}:${input.deliveryId}`;
  const existing = await prisma.gitPromotionCandidate.findUnique({
    where: { deliveryKey },
    select: { candidateId: true, status: true, statusReason: true },
  });
  if (existing) {
    return {
      candidateId: existing.candidateId,
      status: existing.status as GitUpdateCandidateStatus,
      duplicate: true,
      queued: false,
      reason: existing.statusReason,
    };
  }

  const evaluation = evaluateGitHubPushForSandbox(input.payload);
  const candidateId = buildCandidateId(input);
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
      status: evaluation.status,
      statusReason: evaluation.reason,
      payload: input.payload as Prisma.InputJsonValue,
    },
    select: { candidateId: true, status: true, statusReason: true },
  });

  if (evaluation.status === "queued") {
    const { inngest } = await import("@/lib/queue/inngest-client");
    await inngest.send({
      name: "build/git-update.received",
      data: { candidateId: created.candidateId },
    });
  }

  return {
    candidateId: created.candidateId,
    status: created.status as GitUpdateCandidateStatus,
    duplicate: false,
    queued: evaluation.status === "queued",
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

  if (input.eventName !== "push") {
    const payload = parseGitHubWebhookPayload(input.rawBody);
    return recordGitPromotionCandidate({
      provider: "github",
      eventName: input.eventName,
      deliveryId: input.deliveryId,
      payload: {
        ...payload,
        repository: payload.repository ?? { full_name: "unknown" },
      },
    });
  }

  return recordGitPromotionCandidate({
    provider: "github",
    eventName: input.eventName,
    deliveryId: input.deliveryId,
    payload: parseGitHubWebhookPayload(input.rawBody),
  });
}

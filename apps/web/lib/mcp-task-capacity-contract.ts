import { createHash } from "node:crypto";
import type { RemoteTaskSubmitParams } from "./mcp-task-submit";

export type ResourceWaitFailureKind = "capacity" | "busy";

export type ResourceWaitProjection = {
  schemaVersion: 1;
  kind: "provider-capacity";
  failureKind: ResourceWaitFailureKind;
  resumeMode: "same-taskrun";
  attempt: number;
  observedAt: string;
  /** When the next attempt is due: bounded exponential backoff (BI-D25F867D). Absent on older rows. */
  nextAttemptAt?: string;
};

/** Waits before a capacity-parked task is failed honestly as busy: about half an hour in all. */
export const RESOURCE_WAIT_MAX_ATTEMPTS = 5;

/** 1, 2, 4, 8, then 15 minutes between attempts. */
export function resourceWaitBackoffMs(attempt: number): number {
  return Math.min(2 ** Math.max(0, attempt - 1), 15) * 60_000;
}

/** Whether a parked task may be dispatched again now. A wait without a due time is due. */
export function resourceWaitDue(wait: ResourceWaitProjection, now: Date): boolean {
  const due = wait.nextAttemptAt ? Date.parse(wait.nextAttemptAt) : Number.NaN;
  return !Number.isFinite(due) || due <= now.getTime();
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function preInferenceResourceWait(input: {
  failure?: { kind?: string } | null;
  executedTools?: readonly unknown[] | null;
}): ResourceWaitFailureKind | null {
  if ((input.executedTools?.length ?? 0) !== 0) return null;
  return input.failure?.kind === "capacity" || input.failure?.kind === "busy"
    ? input.failure.kind
    : null;
}

export function createResourceWaitProjection(
  failureKind: ResourceWaitFailureKind,
  attempt: number,
  now: Date = new Date(),
): ResourceWaitProjection {
  return {
    schemaVersion: 1,
    kind: "provider-capacity",
    failureKind,
    resumeMode: "same-taskrun",
    attempt,
    observedAt: now.toISOString(),
    nextAttemptAt: new Date(now.getTime() + resourceWaitBackoffMs(attempt)).toISOString(),
  };
}

export function parseResourceWaitProjection(value: unknown): ResourceWaitProjection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const progress = value as Record<string, unknown>;
  const candidate = progress["resourceWait"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const wait = candidate as Record<string, unknown>;
  if (
    wait["schemaVersion"] !== 1
    || wait["kind"] !== "provider-capacity"
    || (wait["failureKind"] !== "capacity" && wait["failureKind"] !== "busy")
    || wait["resumeMode"] !== "same-taskrun"
    || !Number.isInteger(wait["attempt"])
    || Number(wait["attempt"]) < 1
    || !nonEmptyString(wait["observedAt"])
  ) return null;
  return wait as ResourceWaitProjection;
}

function remoteTaskRequestPacket(parsed: RemoteTaskSubmitParams, version: 1 | 2) {
  const packet = {
    agentId: parsed.agentId,
    routeContext: parsed.routeContext,
    title: parsed.title,
    objective: parsed.objective,
    prompt: parsed.prompt,
    riskClass: parsed.riskClass,
    authorityScope: [...(parsed.authorityScope ?? [])].sort(),
    collaborationKind: parsed.collaborationKind ?? null,
    ...(version === 2 ? { threadId: parsed.threadId ?? null } : {}),
    ...(parsed.initiativeReviewBinding
      ? { initiativeReviewBinding: parsed.initiativeReviewBinding }
      : {}),
    ...(parsed.recipeId ? { recipeId: parsed.recipeId } : {}),
  };
  return packet;
}

export const REMOTE_TASK_REQUEST_DIGEST_VERSION = 2;

export function remoteTaskRequestDigest(parsed: RemoteTaskSubmitParams): string {
  return createHash("sha256")
    .update(JSON.stringify(remoteTaskRequestPacket(parsed, 2)))
    .digest("hex");
}

function legacyRemoteTaskRequestDigest(parsed: RemoteTaskSubmitParams): string {
  return createHash("sha256")
    .update(JSON.stringify(remoteTaskRequestPacket(parsed, 1)))
    .digest("hex");
}

/**
 * Verify new versioned digests and preserve exact replay of historical rows.
 * Legacy rows did not hash threadId, so their separately persisted server
 * snapshot must match before the old digest can be accepted.
 */
export function remoteTaskRequestMatches(
  metadataValue: unknown,
  parsed: RemoteTaskSubmitParams,
): boolean {
  return matchingRemoteTaskRequestDigest(metadataValue, parsed) !== null;
}

/** Return the exact persisted digest after version-aware packet validation. */
export function matchingRemoteTaskRequestDigest(
  metadataValue: unknown,
  parsed: RemoteTaskSubmitParams,
): string | null {
  if (!metadataValue || typeof metadataValue !== "object" || Array.isArray(metadataValue)) return null;
  const metadata = metadataValue as Record<string, unknown>;
  const storedDigest = nonEmptyString(metadata["requestDigest"]);
  if (!storedDigest) return null;
  if (metadata["requestDigestVersion"] === REMOTE_TASK_REQUEST_DIGEST_VERSION) {
    return storedDigest === remoteTaskRequestDigest(parsed) ? storedDigest : null;
  }
  if (metadata["requestDigestVersion"] !== undefined && metadata["requestDigestVersion"] !== 1) {
    return null;
  }
  const requestedThreadId = nonEmptyString(metadata["requestedThreadId"]);
  return requestedThreadId === (parsed.threadId ?? null)
    && storedDigest === legacyRemoteTaskRequestDigest(parsed)
    ? storedDigest
    : null;
}

export function deterministicExternalTaskRunId(tokenId: string, idempotencyKey: string): string {
  // `tokenId` is a server-owned row id, not the bearer secret. The reversible
  // namespace keeps per-token isolation while the caller key is bounded.
  const tokenNamespace = Buffer.from(tokenId, "utf8").toString("base64url");
  const suffix = createHash("sha256")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `TR-MCP-${tokenNamespace}-${suffix}`;
}

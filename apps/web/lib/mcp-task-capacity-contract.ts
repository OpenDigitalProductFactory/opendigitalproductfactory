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
};

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
): ResourceWaitProjection {
  return {
    schemaVersion: 1,
    kind: "provider-capacity",
    failureKind,
    resumeMode: "same-taskrun",
    attempt,
    observedAt: new Date().toISOString(),
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

export function remoteTaskRequestDigest(parsed: RemoteTaskSubmitParams): string {
  const packet = {
    agentId: parsed.agentId,
    routeContext: parsed.routeContext,
    title: parsed.title,
    objective: parsed.objective,
    prompt: parsed.prompt,
    riskClass: parsed.riskClass,
    authorityScope: [...(parsed.authorityScope ?? [])].sort(),
    collaborationKind: parsed.collaborationKind ?? null,
    ...(parsed.initiativeReviewBinding
      ? { initiativeReviewBinding: parsed.initiativeReviewBinding }
      : {}),
  };
  return createHash("sha256").update(JSON.stringify(packet)).digest("hex");
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

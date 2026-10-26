import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { loadPersistedRemoteTask, reconstructPersistedRemoteTask } from "@/lib/mcp-task-persisted-request";
import { parseResourceWaitProjection, resourceWaitDue, RESOURCE_WAIT_MAX_ATTEMPTS } from "@/lib/mcp-task-capacity-contract";
import { hasExecutionUncertainty } from "@/lib/shared/execution-uncertainty";
import type { RemoteTaskSubmitAuth } from "@/lib/mcp-task-submit-types";
import type { EngagementTaskBinding } from "./engagement-task-binding";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Explicit identical fulfillment wakes only a known pre-inference capacity wait.
 * The existing outbox owns backoff, attempt limits, CAS and duplicate dispatch. */
export async function resumeCapacityWaitingEngagementTask(input: {
  taskRunId: string; binding: EngagementTaskBinding; token: RemoteTaskSubmitAuth;
}): Promise<boolean> {
  const saved = await loadPersistedRemoteTask(input.taskRunId);
  if (!saved || saved.status !== "submitted" || hasExecutionUncertainty(saved.progressPayload)) return false;
  const wait = parseResourceWaitProjection(saved.progressPayload);
  if (!wait || wait.attempt >= RESOURCE_WAIT_MAX_ATTEMPTS || !resourceWaitDue(wait, new Date())
    || record(saved.progressPayload).executedToolCount !== 0) return false;
  const reconstructed = reconstructPersistedRemoteTask(saved);
  if (!reconstructed.ok || !reconstructed.data.parsed.engagementBinding
    || canonicalJson(reconstructed.data.parsed.engagementBinding) !== canonicalJson(input.binding)) {
    throw new Error("engagement_capacity_packet_refused: preserve the original immutable request");
  }
  const { token: origin, parsed } = reconstructed.data;
  const { resolveMcpTaskAuthorityKey } = await import("@/lib/auth/oauth-task-authority");
  const [currentKey, originKey] = await Promise.all([
    resolveMcpTaskAuthorityKey(input.token), resolveMcpTaskAuthorityKey(origin),
  ]);
  if (input.token.userId !== saved.userId || input.token.capability !== "write"
    || input.token.source !== origin.source || !currentKey || currentKey !== originKey
    || currentKey !== record(saved.a2aMetadata).taskAuthorityKey) {
    throw new Error("engagement_capacity_original_family_required: reconnect with the original request authority");
  }
  const { validateEngagementTask } = await import("./engagement-fulfillment");
  const validation = { binding: input.binding, taskRunId: saved.taskRunId,
    authorityScope: parsed.authorityScope ?? [], requireAssociation: true, request: parsed };
  await validateEngagementTask({ ...validation, token: input.token });
  await validateEngagementTask({ ...validation, token: origin });
  const { reconcilePersistedRemoteTaskDispatches } = await import("@/lib/mcp-task-background-dispatch");
  const result = await reconcilePersistedRemoteTaskDispatches({ taskRunId: saved.taskRunId, includeOrdinary: false });
  return result.enqueued === 1;
}

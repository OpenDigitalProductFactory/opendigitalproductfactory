import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { Prisma } from "@dpf/db";
import { reconstructPersistedRemoteTask, loadPersistedRemoteTask, type PersistedRemoteTask } from "@/lib/mcp-task-persisted-request";
import { deterministicExternalTaskRunId } from "@/lib/mcp-task-capacity-contract";
import type { RemoteTaskSubmitAuth } from "@/lib/mcp-task-submit-types";
import type { EngagementTaskBinding } from "./engagement-task-binding";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type Task = PersistedRemoteTask & { completedAt: Date | null; lastHeartbeatAt: Date | null };

/** This exact failure is written by the worker BEFORE reservation/provider entry.
 * Extra progress, claims, evidence or generations are a refusal, never inferred safe. */
export function planEngagementDigestContinuation(task: Task, binding: EngagementTaskBinding, now = new Date()) {
  const meta = record(task.a2aMetadata), progress = record(task.progressPayload), dispatch = record(progress.dispatch);
  if (task.status !== "failed" || !task.completedAt || task.lastHeartbeatAt !== null
    || meta.trigger !== "external-mcp" || meta.tokenSource !== "oauth" || meta.tokenCapability !== "write"
    || typeof meta.apiTokenId !== "string" || typeof meta.taskAuthorityKey !== "string" || !meta.taskAuthorityKey.startsWith("oauth-family:")
    || meta.idempotencyKey !== `coworker-engagement:${binding.engagementId}`
    || deterministicExternalTaskRunId(meta.taskAuthorityKey, String(meta.idempotencyKey)) !== task.taskRunId
    || meta.engagementReadEvidence !== undefined || meta.engagementReadFailure !== undefined
    || canonicalJson(meta.engagementBinding) !== canonicalJson(binding)
    || progress.errorCode !== "request_digest_mismatch" || progress.error !== "Persisted remote task request does not match its immutable digest."
    || Object.keys(progress).some(key => !["error", "errorCode", "dispatch"].includes(key))
    || dispatch.schemaVersion !== 1 || dispatch.kind !== "external-mcp-task" || dispatch.state !== "enqueued" || dispatch.attempt !== 1
    || dispatch.eventId !== `mcp-task-run:${task.taskRunId}:execute:1`
    || Object.keys(dispatch).some(key => !["schemaVersion", "kind", "state", "attempt", "eventId", "requestedAt", "enqueuedAt"].includes(key))
    || !Number.isFinite(Date.parse(String(dispatch.requestedAt))) || !Number.isFinite(Date.parse(String(dispatch.enqueuedAt)))) return null;
  const reconstructed = reconstructPersistedRemoteTask(task);
  if (!reconstructed.ok || !reconstructed.data.parsed.engagementBinding) return null;
  return { parsed: reconstructed.data.parsed, originalToken: reconstructed.data.token,
    progress: {
      dispatch: { schemaVersion: 1, kind: "external-mcp-task", state: "pending", attempt: 2,
        eventId: `mcp-task-run:${task.taskRunId}:execute:2`, requestedAt: now.toISOString() },
      engagementPreAdmissionContinuation: { schemaVersion: 1, normalizationVersion: 1,
        requestDigest: meta.requestDigest, originTokenId: meta.apiTokenId,
        priorUpdatedAt: task.updatedAt.toISOString(), priorCompletedAt: task.completedAt.toISOString(),
        priorProgress: progress, recordedAt: now.toISOString() },
    },
  };
}

/** Explicit identical fulfillment only. No new TaskRun, credential transfer or unknown replay. */
export async function resumeUnstartedEngagementTask(input: { taskRunId: string; binding: EngagementTaskBinding; token: RemoteTaskSubmitAuth }) {
  const [{ prisma }, { resolveMcpTaskAuthorityKey }, { validateEngagementTask }, { sendMcpTaskRunExecutionEvent }] = await Promise.all([
    import("@dpf/db"), import("@/lib/auth/oauth-task-authority"), import("./engagement-fulfillment"), import("@/lib/queue/mcp-task-run-events"),
  ]);
  const saved = await loadPersistedRemoteTask(input.taskRunId);
  if (!saved || saved.status !== "failed") return false;
  const terminal = await prisma.taskRun.findUnique({ where: { taskRunId: input.taskRunId }, select: { updatedAt: true, completedAt: true, lastHeartbeatAt: true } });
  if (!terminal || terminal.updatedAt.getTime() !== saved.updatedAt.getTime()) return false;
  const plan = planEngagementDigestContinuation({ ...saved, ...terminal }, input.binding);
  if (!plan) return false;
  const [currentKey, originalKey] = await Promise.all([resolveMcpTaskAuthorityKey(input.token), resolveMcpTaskAuthorityKey(plan.originalToken)]);
  if (input.token.source !== "oauth" || input.token.capability !== "write" || input.token.userId !== saved.userId
    || !currentKey || currentKey !== originalKey || currentKey !== record(saved.a2aMetadata).taskAuthorityKey) throw new Error("engagement_continuation_current_original_family_required");
  const validation = { binding: input.binding, authorityScope: plan.parsed.authorityScope ?? [], taskRunId: saved.taskRunId,
    requireAssociation: true, request: { objective: plan.parsed.objective, prompt: plan.parsed.prompt }, allowPreAdmissionRecovery: true };
  const { engagement } = await validateEngagementTask({ ...validation, token: input.token });
  await validateEngagementTask({ ...validation, token: plan.originalToken });
  if (record(engagement.metadata).result !== undefined) throw new Error("engagement_continuation_result_already_present");
  const reserved = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${saved.taskRunId} FOR UPDATE`;
    const counts = await Promise.all([
      tx.toolExecution.count({ where: { taskRunId: saved.taskRunId } }),
      tx.asyncInferenceOp.count({ where: { taskRunId: saved.id } }),
      tx.coworkerActionEnvelope.count({ where: { taskRunId: saved.taskRunId } }),
      tx.taskNode.count({ where: { taskRunId: saved.id } }), tx.taskArtifact.count({ where: { taskRunId: saved.id } }),
      tx.taskMessage.count({ where: { taskRunId: saved.id, role: { not: "user" } } }),
    ]);
    if (counts.some(count => count !== 0)) throw new Error("engagement_continuation_execution_evidence_present");
    const written = await tx.taskRun.updateMany({ where: { taskRunId: saved.taskRunId, userId: saved.userId, status: "failed", updatedAt: saved.updatedAt, lastHeartbeatAt: null, completedAt: terminal.completedAt },
      data: { status: "submitted", completedAt: null, progressPayload: plan.progress as Prisma.InputJsonValue } });
    if (written.count !== 1) return false;
    const metadata = record(engagement.metadata), association = record(metadata.fulfillment);
    const projected = await tx.coworkerEngagement.updateMany({ where: { id: engagement.id, status: engagement.status, updatedAt: engagement.updatedAt }, data: {
      status: "accepted", completedAt: null, metadata: { ...metadata, fulfillment: { ...association, state: "accepted", taskStatus: "submitted", nextAction: "Observe the original task continuation; do not submit another request." } } as Prisma.InputJsonValue,
    } });
    if (projected.count !== 1) throw new Error("engagement_continuation_projection_raced");
    return true;
  });
  if (!reserved) return false;
  // Existing durable outbox reconciles a failed/lost send; subsequent fulfillment
  // sees submitted/working and never reserves the failed generation twice.
  try { await sendMcpTaskRunExecutionEvent(saved.taskRunId, plan.progress.dispatch.eventId); }
  catch { console.error("Engagement continuation dispatch pending; original task outbox will reconcile."); }
  return true;
}

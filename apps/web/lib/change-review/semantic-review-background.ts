import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { reserveSubmittedTaskRunWorking, withHeartbeatTicker } from "@/lib/observability/heartbeat";
import { recordExternalEvidenceInStore } from "@/lib/observability/external-evidence-store";
import { sendMcpTaskRunExecutionEvent } from "@/lib/queue/mcp-task-run-events";
import { recordWorkCapsuleEvidence } from "@/lib/work-capsules/work-capsule-store";
import { publishRecordedWorkCapsuleActivity } from "@/lib/work-capsules/activity-events";
import { revalidatePortalContext } from "@/lib/portal-context/invalidation";
import { parseSemanticReviewRequest, type SemanticReviewRequest } from "./semantic-review-request";
import { verifySemanticReviewAuthority } from "./semantic-review-authority";
import { dispatchRoutedSemanticReview } from "./routed-semantic-review";
import { runSemanticChangeReview } from "./semantic-change-review-operation";
import { parseSemanticReviewResponse, type SemanticReviewResult } from "./semantic-change-review";

const STALE_MS = 3 * 60_000;
const MAX_DISPATCH_ATTEMPTS = 3;
const json = (value: unknown) => value as Prisma.InputJsonValue;
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const select = { id: true, taskRunId: true, userId: true, status: true, updatedAt: true,
  lastHeartbeatAt: true, progressPayload: true, a2aMetadata: true } satisfies Prisma.TaskRunSelect;
type Run = Prisma.TaskRunGetPayload<{ select: typeof select }>;
function native(row: Run): boolean { return object(row.a2aMetadata).gateKind === "semantic-review"; }
function state(row: Run) { return object(object(row.progressPayload).semanticReview); }
function progress(row: Run, patch: Record<string, unknown>) {
  return json({ ...object(row.progressPayload), semanticReview: { ...state(row), ...patch } });
}
function fence(taskRunId: string, generation: string): Prisma.TaskRunWhereInput {
  return { taskRunId, status: { equals: "working" }, progressPayload: { path: ["semanticReview", "generation"], equals: generation } };
}
async function assertFence(db: Prisma.TransactionClient, taskRunId: string, generation: string) {
  const owned = await db.taskRun.updateMany({ where: fence(taskRunId, generation), data: { lastHeartbeatAt: new Date() } });
  if (owned.count !== 1) throw new Error("semantic-review-generation-no-longer-owned");
}
async function settle(row: Run, status: "failed" | "auth-required" | "input-required", reason: string) {
  const changed = await prisma.taskRun.updateMany({ where: { taskRunId: row.taskRunId, status: row.status, updatedAt: row.updatedAt },
    data: { status, ...(status === "failed" ? { completedAt: new Date() } : {}),
      progressPayload: progress(row, { state: status, reason }) } });
  const current = changed.count === 1 ? status
    : (await prisma.taskRun.findUnique({ where: { taskRunId: row.taskRunId }, select: { status: true } }))?.status ?? "unknown";
  return { taskRunId: row.taskRunId, status: current, changed: changed.count === 1 };
}

/** The TaskRun is the outbox; event delivery is advisory and duplicate-safe. */
export async function enqueueSemanticReview(taskRunId: string): Promise<boolean> {
  const row = await prisma.taskRun.findUnique({ where: { taskRunId }, select });
  if (!row || !native(row) || row.status !== "submitted" || state(row).schemaVersion !== 1) return false;
  const prior = state(row);
  const priorAttempt = prior.dispatchAttempt ?? 0;
  if (typeof priorAttempt !== "number" || !Number.isSafeInteger(priorAttempt) || priorAttempt < 0) {
    await settle(row, "input-required", "dispatch-counter-invalid"); return false;
  }
  const attempt = priorAttempt + 1;
  if (attempt > MAX_DISPATCH_ATTEMPTS) { await settle(row, "failed", "dispatch-attempts-exhausted"); return false; }
  const eventId = `semantic-review:${taskRunId}:${attempt}`;
  const reserved = await prisma.taskRun.updateMany({ where: { taskRunId, status: row.status, updatedAt: row.updatedAt },
    data: { progressPayload: progress(row, { state: "enqueued", dispatchAttempt: attempt,
      eventId, lastEnqueuedAt: new Date().toISOString() }) } });
  if (reserved.count !== 1) return false;
  try { await sendMcpTaskRunExecutionEvent(taskRunId, eventId); return true; }
  catch { return false; } // Persisted intent remains eligible for bounded reconciliation.
}

async function requestFor(row: Run): Promise<SemanticReviewRequest | null> {
  const artifact = await prisma.taskArtifact.findUnique({
    where: { artifactId: `semantic-review-request:${row.taskRunId}` }, select: { taskRunId: true, parts: true },
  });
  if (!artifact || artifact.taskRunId !== row.id || !Array.isArray(artifact.parts)) return null;
  const packet = parseSemanticReviewRequest(object(artifact.parts[0]).data);
  const metadata = object(row.a2aMetadata);
  return packet && packet.actor.userId === row.userId && packet.gateKey === metadata.gateKey
    && packet.input.identity.capsuleId === metadata.capsuleId && packet.digest === state(row).requestDigest ? packet : null;
}

async function checkpointBranch(row: Run, packet: SemanticReviewRequest, generation: string,
  agentId: string, execute: () => Promise<SemanticReviewResult>): Promise<SemanticReviewResult> {
  const taskNodeId = `semantic-review:${row.taskRunId}:${agentId}`;
  const prior = await prisma.$transaction(async (tx) => {
    await assertFence(tx, row.taskRunId, generation);
    const node = await tx.taskNode.findUnique({ where: { taskNodeId } });
    if (node) {
      const output = object(node.outputSnapshot);
      if (node.status === "completed" && output.requestDigest === packet.digest) {
        return parseSemanticReviewResponse(JSON.stringify(output.result));
      }
      throw new Error("semantic-review-provider-outcome-uncertain");
    }
    if (Date.now() >= Date.parse(packet.deadlineAt)) throw new Error("semantic-review-deadline-exhausted");
    await tx.taskNode.create({ data: { taskNodeId, taskRunId: row.id, nodeType: "review", workerRole: "reviewer",
      title: `Semantic review: ${agentId}`, objective: packet.input.title, status: "running", startedAt: new Date(),
      requestContract: { requestDigest: packet.digest, generation, agentId },
    } });
    return null;
  });
  if (prior) return prior;
  // A running node is durable before the provider call. If the process dies,
  // reconciliation exposes uncertainty instead of silently repeating the call.
  const result = await execute();
  await prisma.$transaction(async (tx) => {
    await assertFence(tx, row.taskRunId, generation);
    await tx.taskNode.update({ where: { taskNodeId }, data: { status: "completed", completedAt: new Date(),
      outputSnapshot: json({ requestDigest: packet.digest, result }) } });
  });
  return result;
}

/** Returns null only for a different TaskRun family, allowing the shared worker to route it. */
export async function executePersistedSemanticReview(taskRunId: string) {
  const row = await prisma.taskRun.findUnique({ where: { taskRunId }, select });
  if (!row || !native(row)) return null;
  if (row.status !== "submitted") return { taskRunId, status: row.status, duplicate: true };
  const packet = await requestFor(row);
  if (!packet) return settle(row, "input-required", "immutable-review-request-unavailable");
  if (Date.now() >= Date.parse(packet.deadlineAt)) {
    return settle(row, "failed", "review-deadline-exhausted");
  }
  if (!(await verifySemanticReviewAuthority(packet, taskRunId))) {
    return settle(row, "auth-required", "submitting-authority-no-longer-valid");
  }
  const generation = randomUUID();
  const owned = await reserveSubmittedTaskRunWorking({ taskRunId, updatedAt: row.updatedAt,
    progressPayload: progress(row, { state: "executing", generation }) });
  if (!owned) return { taskRunId, status: "duplicate" };
  return withHeartbeatTicker(taskRunId, async () => {
    const outcome = await runSemanticChangeReview(packet.input, { dispatch: (prompt, context) =>
      dispatchRoutedSemanticReview(prompt, context, async (agentId, execute) => {
        try { return await checkpointBranch(row, packet, generation, agentId, execute); }
        catch (error) {
          await prisma.taskRun.updateMany({ where: fence(taskRunId, generation),
            data: { status: "input-required", progressPayload: progress(row, { state: "input-required", generation,
              reason: "provider-outcome-uncertain", action: "Reconcile the recorded branch before authorizing recovery." }) } });
          throw error;
        }
      }) });
    const persisted = await prisma.$transaction(async (tx) => {
      if (Date.now() >= Date.parse(packet.deadlineAt)) {
        await tx.taskRun.updateMany({ where: fence(taskRunId, generation), data: {
          status: "input-required", progressPayload: progress(row, { state: "input-required", generation,
            reason: "review-result-arrived-after-deadline" }),
        } });
        return null;
      }
      const terminalStatus = outcome.receipt.result.decision === "inconclusive" ? "failed" : "completed";
      const accepted = await tx.taskRun.updateMany({ where: fence(taskRunId, generation),
        data: { status: terminalStatus, completedAt: new Date() } });
      if (accepted.count !== 1) return null; // Cancellation or another generation wins.
      const capsule = await tx.workroom.findUnique({ where: { capsuleId: packet.input.identity.capsuleId }, select: { id: true } });
      if (!capsule) throw new Error("semantic-review-workroom-missing");
      const evidence = await recordExternalEvidenceInStore({
        actorUserId: row.userId, ...outcome.evidence.externalEvidence,
        details: json(outcome.evidence.externalEvidence.details), taskRunId, workCapsuleId: capsule.id,
        executorKind: packet.actor.agentId ?? packet.input.authorSurface, recordedByAgentId: packet.actor.agentId ?? undefined,
      }, tx);
      const activity = await recordWorkCapsuleEvidence({ db: tx, capsuleId: packet.input.identity.capsuleId,
        evidence: { kind: "verification", summary: outcome.evidence.activity.summary, targetId: evidence.id,
          result: outcome.evidence.activity.payload },
        actor: { userId: row.userId, agentId: packet.actor.agentId, principalId: null }, deferPublication: true,
      });
      await tx.taskRun.update({ where: { taskRunId }, data: { progressPayload: json({
        ...object(row.progressPayload), evidenceRecordId: evidence.id, resultClass: outcome.receipt.result.decision,
        semanticReview: { ...state(row), generation, state: terminalStatus, requestDigest: packet.digest,
          evidenceRecordId: evidence.id, mayPublish: outcome.mayPublish, nextAction: outcome.nextAction },
      }) } });
      return { evidenceRecordId: evidence.id, status: terminalStatus, capsuleId: capsule.id, activityId: activity.id };
    });
    if (!persisted) {
      const current = await prisma.taskRun.findUnique({ where: { taskRunId }, select: { status: true } });
      return { taskRunId, status: current?.status ?? "unknown", finalized: false };
    }
    publishRecordedWorkCapsuleActivity(persisted.capsuleId, persisted.activityId);
    revalidatePortalContext();
    return { taskRunId, status: persisted.status, evidenceRecordId: persisted.evidenceRecordId };
  });
}

/** Reconcile only persisted native requests. Legacy inline requests cannot be reconstructed. */
export async function reconcileSemanticReviews(now = new Date()) {
  const rows = await prisma.taskRun.findMany({ where: {
    status: { in: ["submitted", "working", "stalled"] }, a2aMetadata: { path: ["gateKind"], equals: "semantic-review" },
    progressPayload: { path: ["semanticReview", "schemaVersion"], equals: 1 },
    OR: [{ updatedAt: { lt: new Date(now.getTime() - STALE_MS) } },
      { progressPayload: { path: ["semanticReview", "deadlineAt"], lt: now.toISOString() } }],
  }, select, orderBy: { updatedAt: "asc" }, take: 50 });
  let enqueued = 0;
  let waiting = 0;
  for (const row of rows) {
    if (state(row).schemaVersion !== 1) continue;
    const deadline = Date.parse(String(state(row).deadlineAt));
    if (!Number.isFinite(deadline)) {
      if ((await settle(row, "input-required", "review-deadline-invalid")).changed) waiting += 1;
      continue;
    }
    if (now.getTime() >= deadline) {
      if ((await settle(row, row.status === "submitted" ? "failed" : "input-required", "review-deadline-exhausted")).changed) waiting += 1;
      continue;
    }
    if (row.status !== "submitted") {
      if (row.lastHeartbeatAt && now.getTime() - row.lastHeartbeatAt.getTime() < STALE_MS) continue;
      const unfinished = await prisma.taskNode.findFirst({ where: { taskRunId: row.id, status: { not: "completed" } }, select: { id: true } });
      if (unfinished) {
        if ((await settle(row, "input-required", "provider-outcome-uncertain-after-restart")).changed) waiting += 1;
        continue;
      }
      const priorRecovery = state(row).recoveryAttempt ?? 0;
      if (typeof priorRecovery !== "number" || !Number.isSafeInteger(priorRecovery) || priorRecovery < 0) {
        if ((await settle(row, "input-required", "recovery-counter-invalid")).changed) waiting += 1;
        continue;
      }
      const recoveryAttempt = priorRecovery + 1;
      if (recoveryAttempt > MAX_DISPATCH_ATTEMPTS) {
        if ((await settle(row, "failed", "restart-recovery-attempts-exhausted")).changed) waiting += 1;
        continue;
      }
      const reserved = await prisma.taskRun.updateMany({ where: { taskRunId: row.taskRunId, status: row.status, updatedAt: row.updatedAt },
        data: { status: "submitted", progressPayload: progress(row, { state: "pending", generation: null,
          recoveryReason: "restart-from-persisted-checkpoints", recoveryAttempt, dispatchAttempt: 0 }) } });
      if (reserved.count !== 1) continue;
    }
    if (await enqueueSemanticReview(row.taskRunId)) enqueued += 1;
  }
  return { scanned: rows.length, enqueued, waiting };
}

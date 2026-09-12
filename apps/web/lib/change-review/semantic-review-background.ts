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
import { resolveFailureAnalysisEvidence } from "./failure-analysis-evidence";
import { validateFailureAnalysis } from "./failure-analysis";

import { SEMANTIC_REVIEW_HEARTBEAT_STALE_MS as STALE_MS } from "./semantic-review-request";
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
async function settle(row: Run, status: "failed" | "auth-required" | "input-required", reason: string,
  details: Record<string, unknown> = {}) {
  const changed = await prisma.taskRun.updateMany({ where: { taskRunId: row.taskRunId, status: row.status, updatedAt: row.updatedAt },
    data: { status, ...(status === "failed" ? { completedAt: new Date() } : {}),
      progressPayload: progress(row, { state: status, reason, ...details }) } });
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
  const recoveryAttempt = prior.recoveryAttempt ?? 0;
  if (typeof recoveryAttempt !== "number" || !Number.isSafeInteger(recoveryAttempt) || recoveryAttempt < 0 || recoveryAttempt > MAX_DISPATCH_ATTEMPTS) {
    await settle(row, "input-required", "recovery-counter-invalid"); return false;
  }
  const eventId = `semantic-review:${taskRunId}${recoveryAttempt ? `:recovery-${recoveryAttempt}` : ""}:${attempt}`;
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
  const recoveryAttempt = state(row).recoveryAttempt ?? 0;
  if (typeof recoveryAttempt !== "number" || !Number.isSafeInteger(recoveryAttempt) || recoveryAttempt < 0 || recoveryAttempt > MAX_DISPATCH_ATTEMPTS) {
    throw new Error("semantic-review-recovery-counter-invalid");
  }
  const nodeId = (attempt: number) => `semantic-review:${row.taskRunId}:${agentId}${attempt ? `:recovery-${attempt}` : ""}`;
  const taskNodeId = nodeId(recoveryAttempt);
  const prior = await prisma.$transaction(async (tx) => {
    await assertFence(tx, row.taskRunId, generation);
    const superseded: Array<{ taskNodeId: string; output: Record<string, unknown> }> = [];
    for (let attempt = recoveryAttempt; attempt >= 0; attempt -= 1) {
      const node = await tx.taskNode.findUnique({ where: { taskNodeId: nodeId(attempt) } });
      if (!node) continue;
      const output = object(node.outputSnapshot);
      if (node.status === "completed" && output.requestDigest === packet.digest) {
        return parseSemanticReviewResponse(JSON.stringify(output.result));
      }
      if (attempt === recoveryAttempt || node.status === "completed") throw new Error("semantic-review-provider-outcome-uncertain");
      if (node.status !== "superseded") superseded.push({ taskNodeId: node.taskNodeId, output });
    }
    if (Date.now() >= Date.parse(packet.deadlineAt)) throw new Error("semantic-review-deadline-exhausted");
    const created = await tx.taskNode.create({ data: { taskNodeId, taskRunId: row.id, nodeType: "review", workerRole: "reviewer",
      title: `Semantic review: ${agentId}`, objective: packet.input.title, status: "running", startedAt: new Date(),
      requestContract: { requestDigest: packet.digest, generation, agentId },
    } });
    for (const previous of superseded) await tx.taskNode.update({ where: { taskNodeId: previous.taskNodeId }, data: {
      status: "superseded", supersededByNodeId: created.id,
      outputSnapshot: json({ ...previous.output, requestDigest: packet.digest, providerOutcome: "unknown", recoveryAttempt }),
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

/** Existing operator Retry adapter; never replays a tool or resets the request budget. */
export async function retryPersistedSemanticReview(taskRunId: string, operatorUserId: string, confirmed: boolean) {
  const row = await prisma.taskRun.findUnique({ where: { taskRunId }, select });
  if (!row || !native(row)) return null;
  if (row.userId !== operatorUserId) throw new Error("semantic-review-recovery-authority-denied");
  if (!confirmed) throw new Error("semantic-review-recovery-confirmation-required: replacing uncertain inference can incur another provider charge");
  if (!["input-required", "stalled"].includes(row.status)) throw new Error("semantic-review-not-awaiting-recovery");
  const packet = await requestFor(row);
  if (!packet) throw new Error("semantic-review-request-unavailable");
  if (Date.now() >= Date.parse(packet.deadlineAt)) throw new Error("semantic-review-deadline-exhausted");
  const previousAttempt = state(row).recoveryAttempt ?? 0;
  if (typeof previousAttempt !== "number" || !Number.isSafeInteger(previousAttempt) || previousAttempt < 0 || previousAttempt >= MAX_DISPATCH_ATTEMPTS) throw new Error("semantic-review-recovery-exhausted");
  const attempt = previousAttempt + 1;
  if (!(await verifySemanticReviewAuthority(packet, taskRunId))) throw new Error("semantic-review-recovery-authority-denied");
  const { getQuiescenceLevel } = await import("@/lib/self-upgrade/quiescence");
  if (await getQuiescenceLevel() !== "normal") throw new Error("semantic-review-recovery-quiescing");
  const publication = await prisma.$transaction(async (tx) => {
    const changed = await tx.taskRun.updateMany({ where: { taskRunId, status: row.status, updatedAt: row.updatedAt },
      data: { status: "submitted", progressPayload: progress(row, { state: "pending", generation: null,
        recoveryAttempt: attempt, dispatchAttempt: 0, recoveryReason: "operator-authorized-inference-replacement",
        recoveryAuthorizedBy: operatorUserId, recoveryAuthorizedAt: new Date().toISOString() }) } });
    if (changed.count !== 1) throw new Error("semantic-review-recovery-state-changed");
    const capsule = await tx.workroom.findUnique({ where: { capsuleId: packet.input.identity.capsuleId }, select: { id: true } });
    if (!capsule) throw new Error("semantic-review-workroom-missing");
    const activity = await recordWorkCapsuleEvidence({ db: tx, capsuleId: packet.input.identity.capsuleId,
      evidence: { kind: "note", summary: `Authorized reviewer recovery ${attempt}; previous provider outcome remains unknown.`,
        targetId: taskRunId, result: { recoveryAttempt: attempt, requestDigest: packet.digest, deadlineAt: packet.deadlineAt } },
      actor: { userId: operatorUserId, agentId: null, principalId: null }, deferPublication: true });
    return { capsuleId: capsule.id, activityId: activity.id };
  });
  publishRecordedWorkCapsuleActivity(publication.capsuleId, publication.activityId);
  await enqueueSemanticReview(taskRunId);
  revalidatePortalContext();
  return { newTaskRunId: taskRunId, strategy: "resume-review-checkpoints" };
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
  const reviewRoom = await prisma.workroom.findUnique({ where: { capsuleId: packet.input.identity.capsuleId }, select: { id: true } });
  const currentEvidence = reviewRoom ? await resolveFailureAnalysisEvidence(packet.input.failureAnalysis, reviewRoom.id) : [];
  const currentAnalysis = validateFailureAnalysis(packet.input.failureAnalysis, packet.input.identity, currentEvidence);
  if (!currentAnalysis.valid || currentAnalysis.digest !== packet.input.identity.failureAnalysisDigest) {
    // The persisted packet is immutable, so changed evidence cannot be repaired
    // by resuming this TaskRun. Terminalize the stale attempt: the next
    // submission resolves current evidence into a new gate identity instead of
    // subscribing forever to an unrecoverable input-required run.
    return settle(row, "failed", "failure-analysis-evidence-changed", {
      action: "Submit a refreshed immutable review request with current failure evidence.",
    });
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
    const { publishFailureReadinessStatus } = await import("./failure-readiness-status");
    try { await publishFailureReadinessStatus(packet.input.identity.capsuleId); }
    catch (error) {
      // Review is durable. Do not repeat inference because a GitHub response was lost.
      return { taskRunId, status: persisted.status, evidenceRecordId: persisted.evidenceRecordId,
        publicationPending: true, publicationReason: error instanceof Error ? error.message : "GitHub status unavailable" };
    }
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
      const unfinished = await prisma.taskNode.findFirst({ where: { taskRunId: row.id, status: { notIn: ["completed", "superseded"] } }, select: { id: true } });
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

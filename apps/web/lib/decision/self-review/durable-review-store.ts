import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { createHash, randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { getInstallationDeviceId } from "@/lib/agent-toolchain/served-toolchain";
import { createAutonomousWorkRun } from "@/lib/tak/autonomous-work-run";
import { createTaskArtifact } from "@/lib/tak/task-records";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { readBootIdentity } from "@/lib/deployment-skew";
import { reserveTaskRunGenerationWorking } from "@/lib/observability/heartbeat";
import { isRolledBackPostgresConflict } from "@/lib/shared/postgres-transaction-conflict";
import { captureTaskExecutionFence, taskExecutionEligible } from "@/lib/shared/task-execution-fence";
import { lockCurrentScheduledTask, withCurrentScheduledTask } from "@/lib/actions/agent-task-claim";
import { runFrozenReview, type FrozenMeasurement } from "./durable-review";
import type { ReviewLine } from "./measures";
import type { DecisionEngineReviewTask } from "./decision-engine-review-task";
import type { RoutingSummary } from "./route-review-findings";

// Bump only for an intentional measurement-definition successor. An ordinary
// retry keeps the original cutoff and never recomputes frozen history.
export const REVIEW_DEFINITION = "weekly-review.v2";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function executeDurableReview(input: {
  task: DecisionEngineReviewTask;
  commission: Record<string, unknown>;
  periodKey: string;
  now: Date;
  measure: (cutoff: Date) => Promise<ReviewLine[] | FrozenMeasurement<ReviewLine>>;
  route: (line: ReviewLine, periodKey: string, tx: Prisma.TransactionClient, destination: unknown) => Promise<RoutingSummary>;
  afterRoutingCommit?: () => void;
  prepare: (line: ReviewLine) => Promise<unknown>;
  reconcile: (line: ReviewLine, intent: unknown) => Promise<RoutingSummary | undefined>;
}): Promise<boolean> {
  const installation = await getInstallationDeviceId();
  if (!installation) throw new Error("Weekly review installation identity unavailable");
  const family = digest(JSON.stringify([installation, input.task.ownerUserId, input.task.taskId, input.periodKey]));
  const publicId = `TR-REVIEW-${family}-${digest(REVIEW_DEFINITION).slice(0, 16)}`;
  let createdHere = false;
  let run = await prisma.taskRun.findUnique({ where: { taskRunId: publicId } });
  if (!run) {
    const predecessor = await prisma.taskRun.findFirst({
      where: { taskRunId: { startsWith: `TR-REVIEW-${family}-` }, userId: input.task.ownerUserId },
      orderBy: { createdAt: "desc" }, select: { id: true },
    });
    try { await createAutonomousWorkRun({
      trigger: "scheduled", taskRunId: publicId, userId: input.task.ownerUserId,
      agentId: input.task.agentId, routeContext: "decision-engine-review",
      title: `Decision engine review ${input.periodKey}`, objective: "Measure and durably route weekly decision-engine findings",
      prompt: "Deterministic review; no inference", parentTaskRunId: predecessor?.id,
      sourceRef: { kind: "scheduled-task", id: input.task.taskId },
      admissionGuard: async tx => {
        if (!await lockCurrentScheduledTask(tx, input.commission, typeof input.commission.taskRunId === "string" ? input.commission.taskRunId : null)) throw new Error("Weekly review commission superseded before admission");
      },
      afterTaskCreated: async tx => { await tx.scheduledAgentTask.update({ where: { taskId: input.task.taskId }, data: { taskRunId: publicId } }); },
      metadata: { reviewDefinition: REVIEW_DEFINITION, cutoff: input.now.toISOString(), periodKey: input.periodKey, installation, sourceIdentity: readBootIdentity() ?? "unknown", requestDigest: digest(publicId) },
    }); createdHere = true; input.commission.taskRunId = publicId; } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
      if (!await prisma.taskRun.findUnique({ where: { taskRunId: publicId } })) throw error;
    }
    run = await prisma.taskRun.findUniqueOrThrow({ where: { taskRunId: publicId } });
  }
  const metadata = run.a2aMetadata as Record<string, unknown>;
  if (run.userId !== input.task.ownerUserId || metadata.reviewDefinition !== REVIEW_DEFINITION || metadata.installation !== installation) {
    throw new Error("Weekly review identity/content conflict");
  }
  const cutoff = new Date(String(metadata.cutoff));
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Weekly review cutoff invalid");
  const recordId = run.id;
  const artifactId = (key: string) => `ta-review-${digest(`${publicId}:${key}`)}`;
  const intentId = (key: string, producer: string) => artifactId(`${key}:${producer}`);
  if (run.status === "completed") {
    const result = await prisma.taskArtifact.findUnique({ where: { artifactId: artifactId("result") } });
    if (!result || result.taskRunId !== recordId) throw new Error("Completed review result unavailable");
    return true;
  }
  const node = await withCurrentScheduledTask(prisma, input.commission, typeof input.commission.taskRunId === "string" ? input.commission.taskRunId : null, async tx => {
    await tx.$queryRaw`SELECT id FROM "TaskRun" WHERE id = ${recordId} FOR UPDATE`;
    const current = await tx.taskRun.findUniqueOrThrow({ where: { id: recordId } });
    if (!["working", "failed", "stalled", "submitted"].includes(current.status)) return null;
    const progress = current.progressPayload as { dispatch?: { claimedAt?: string } } | null;
    if (current.status === "working" && progress?.dispatch?.claimedAt) {
      const active = await tx.taskNode.findUnique({ where: { taskNodeId: progress.dispatch.claimedAt } });
      if (active?.status === "running") return null;
    }
    const attempt = await tx.taskNode.create({ data: {
      taskNodeId: `TN-REVIEW-${randomUUID()}`, taskRunId: recordId, nodeType: "execute",
      title: "Measure and route review", objective: "Publish one frozen review result",
      status: "running", workerRole: "executor", startedAt: new Date(),
    } });
    if (!await reserveTaskRunGenerationWorking({ taskRunId: publicId, expectedStatus: current.status, updatedAt: current.updatedAt,
      progressPayload: json({ dispatch: { claimedAt: attempt.taskNodeId }, routingCoverage: "unknown" }) }, tx)) throw new Error("Weekly review generation superseded");
    await tx.scheduledAgentTask.update({ where: { taskId: input.task.taskId }, data: { taskRunId: publicId } });
    return attempt;
  });
  if (!node) {
    if (!createdHere) return false;
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "TaskRun" WHERE id = ${recordId} FOR UPDATE`;
      const current = await tx.taskRun.findUniqueOrThrow({ where: { id: recordId } });
      if (current.status === "working" && !await tx.taskNode.findFirst({ where: { taskRunId: recordId } })) {
        await tx.taskRun.update({ where: { id: recordId }, data: { status: "submitted", progressPayload: json({ reason: "commission superseded before attempt; awaiting current authorized dispatch", routingCoverage: "unrun" }) } });
      }
    });
    return false;
  }
  input.commission.taskRunId = publicId;
  const progress = { dispatch: { claimedAt: node.taskNodeId } };
  const fence = captureTaskExecutionFence(progress, digest(publicId));
  const withWrite = async <T>(write: (tx: Prisma.TransactionClient) => Promise<T>, onRollback?: (error: unknown) => Promise<void>): Promise<T> => {
    let entered = false, returned = false;
    try {
      const result = await withCurrentScheduledTask(prisma, input.commission, publicId, async tx => {
        entered = true;
        await tx.$queryRaw`SELECT id FROM "TaskRun" WHERE id = ${recordId} FOR UPDATE`;
        const current = await tx.taskRun.findUniqueOrThrow({ where: { id: recordId } });
        if (!taskExecutionEligible({ status: current.status, progressPayload: current.progressPayload,
          requestDigest: digest(publicId), executionFence: fence })) throw new Error("Weekly review execution superseded");
        const currentNode = await tx.taskNode.findUniqueOrThrow({ where: { id: node.id } });
        if (currentNode.status !== "running") throw new Error("Weekly review attempt no longer running");
        const value = await write(tx);
        returned = true; // Only after this can the transaction request COMMIT.
        return value;
      });
      if (result === null) throw new Error("Weekly review commission superseded");
      return result;
    } catch (error) {
      if (onRollback && (entered && !returned || isRolledBackPostgresConflict(error))) {
        // No COMMIT was requested, or Postgres explicitly reported rollback.
        // Failure to persist this proof remains uncertainty, never retry authority.
        await onRollback(error).catch(() => console.warn("Review rollback provenance unavailable"));
      }
      throw error;
    }
  };
  const read = async (key: string): Promise<unknown> => {
    const artifact = key.startsWith("intent:")
      ? await prisma.taskArtifact.findFirst({ where: { taskRunId: recordId, name: key }, orderBy: [{ createdAt: "desc" }, { artifactId: "desc" }] })
      : await prisma.taskArtifact.findUnique({ where: { artifactId: artifactId(key) } });
    if (!artifact) return undefined;
    if (artifact.taskRunId !== recordId) throw new Error("Weekly review artifact owner conflict");
    const data = (artifact.parts as Array<{ data: unknown }>)[0]?.data;
    return key.startsWith("intent:") ? { ...(data as object), producerNodeId: artifact.producerNodeId, intentArtifactId: artifact.artifactId } : data;
  };
  const publishArtifact = (tx: Prisma.TransactionClient, key: string, content: unknown, predecessorArtifactId: string | null = null) => createTaskArtifact({
    taskRunId: publicId, taskRunRecordId: recordId,
    artifactId: key.startsWith("intent:") ? intentId(key, node.id) : artifactId(key),
    artifactType: "decision-engine-review.v1", name: key, content,
    metadata: { schemaVersion: 1, cutoff: cutoff.toISOString(), definition: REVIEW_DEFINITION,
      sourceIdentity: metadata.sourceIdentity ?? "unknown", contentDigest: digest(canonicalJson(content)), predecessorArtifactId },
    producerAgentId: input.task.agentId, producerNodeId: node.id,
  }, tx);
  try {
    await runFrozenReview({
      read,
      write: async (key, value) => {
        const predecessor = key.startsWith("intent:") ? await read(key) as { intentArtifactId?: string } | undefined : undefined;
        await withWrite(tx => publishArtifact(tx, key, value, predecessor?.intentArtifactId ?? null));
      },
      complete: async () => {
        await withWrite(async (tx) => {
          const result = await tx.taskArtifact.findUniqueOrThrow({ where: { artifactId: artifactId("result") } });
          await tx.taskRun.update({ where: { id: recordId }, data: {
            status: "completed", completedAt: new Date(), progressPayload: json({ artifactId: result.artifactId, correctionCoverage: "unverified" }),
          } });
          await tx.taskNode.update({ where: { id: node.id }, data: { status: "completed", completedAt: new Date(), outputSnapshot: json({ artifactId: result.artifactId }) } });
        });
      },
    }, async () => {
      const measured = await input.measure(cutoff);
      const lines = (Array.isArray(measured) ? measured : measured.lines).map(line => ({ ...line, key: line.lineKey }));
      return Array.isArray(measured) ? lines : { ...measured, lines };
    }, async (line) => {
      const intent = await read(`intent:${line.key}`) as { destination: unknown };
      const result = await withWrite(async tx => {
        const routed = await input.route(line, input.periodKey, tx, intent.destination);
        if (routed.routed.some(entry => entry.outcome === "error" || entry.outcome === "reported:error" || entry.outcome === "reported:nomination unavailable")) {
          throw new Error(`Weekly review routing failed: ${line.lineKey}`);
        }
        await publishArtifact(tx, `routed:${line.key}`, { result: routed });
        return routed;
      }, async error => {
        await withWrite(tx => publishArtifact(tx, `rollback:${line.key}:${node.id}`, { confirmedRollback: true, reason: getErrorMessage(error) }));
      });
      input.afterRoutingCommit?.();
      return result;
    }, {
      prepare: input.prepare,
      retryAfterRollback: async line => {
        const intent = await read(`intent:${line.key}`) as { producerNodeId?: string };
        if (!intent?.producerNodeId) return false;
        const proof = await read(`rollback:${line.key}:${intent.producerNodeId}`) as { confirmedRollback?: boolean } | undefined;
        return proof?.confirmedRollback === true;
      },
      reconcile: async line => input.reconcile(line, await read(`intent:${line.key}`)),
    });
    return true;
  } catch (error) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "TaskRun" WHERE id = ${recordId} FOR UPDATE`;
      await tx.taskNode.updateMany({ where: { id: node.id, status: "running" }, data: { status: "failed", completedAt: new Date(), outputSnapshot: json({ error: getErrorMessage(error) }) } });
      const current = await tx.taskRun.findUniqueOrThrow({ where: { id: recordId } });
      if (taskExecutionEligible({ status: current.status, progressPayload: current.progressPayload, requestDigest: digest(publicId), executionFence: fence })) {
        await tx.taskRun.update({ where: { id: recordId }, data: { status: "failed", progressPayload: json({ ...progress, measurementArtifactId: artifactId("measurement"), routingCoverage: "incomplete", correctionCoverage: "unverified" }) } });
      }
    });
    throw error;
  }
}

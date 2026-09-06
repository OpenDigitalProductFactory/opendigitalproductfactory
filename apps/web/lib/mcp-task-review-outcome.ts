import { prisma, type Prisma } from "@dpf/db";
import { projectBacklogItemReadiness } from "./backlog/initiative-readiness/entry-adapter";
import { loadInheritedInitiativeScope } from "./backlog/initiative-readiness/parent-scope-inheritance";
import type { InitiativeReviewBinding } from "./mcp-task-review-contract";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export async function reconcilePersistedReviewStatus(
  taskRunId: string, progressPayload: unknown,
  outcome: NonNullable<Awaited<ReturnType<typeof loadInitiativeReviewOutcome>>>,
) {
  const progress = { ...record(progressPayload) };
  for (const key of ["terminalWriterWait", "terminalWriterDispatchFailure", "terminalWriterEscalation", "terminalWriterContextFailure", "resourceWait", "approvalEnvelopeId"])
    delete progress[key];
  await prisma.taskRun.update({ where: { taskRunId }, data: {
    status: "completed", completedAt: new Date(),
    progressPayload: { ...progress, summary: outcome.summary, reviewOutcome: outcome, requiresApproval: false } as Prisma.InputJsonValue,
  } });
}

export async function loadTaskInitiativeReviewOutcome(taskRunId: string, binding: InitiativeReviewBinding) {
  const execution = await prisma.toolExecution.findFirst({
    where: { taskRunId, toolName: binding.writerToolName, success: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { result: true },
  });
  const result = record(execution?.result);
  const data = record(result?.data);
  return typeof data?.receiptId === "string" ? loadInitiativeReviewOutcome(binding, data.receiptId) : null;
}

/** Read the canonical receipt, never infer one from model prose or tool success. */
export async function loadInitiativeReviewOutcome(binding: InitiativeReviewBinding, receiptId: string) {
  const item = await prisma.backlogItem.findUnique({
    where: { itemId: binding.itemId },
    include: { activeBuild: { select: { kind: true } }, activities: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }] } },
  });
  if (!item) return null;
  const receiptRow = item.activities.find((row) => row.id === receiptId && row.kind === "initiative_gate_receipt");
  const receipt = record(receiptRow?.payload);
  const artifact = record(receipt?.artifactRef);
  const subject = record(receipt?.subject);
  if (!receipt || receipt.receiptId !== receiptId || receipt.gate !== binding.gate
    || (receipt.decision !== "pass" && receipt.decision !== "fail" && receipt.decision !== "not-applicable")
    || subject?.id !== binding.itemId || subject.kind !== "backlog-item"
    || !artifact || Object.entries(binding.artifactRef).some(([key, value]) => artifact[key] !== value)) return null;
  const inheritedScope = await loadInheritedInitiativeScope(prisma, { childItemId: item.itemId, childRowId: item.id });
  const readiness = projectBacklogItemReadiness({
    item: { ...item, activeBuildKind: item.activeBuild?.kind ?? null },
    activities: item.activities,
    inheritedScope,
    target: "implementation",
    transitionObject: { kind: "backlog-item", id: item.itemId, expectedVersion: "read-projection", targetState: "implementation" },
    authorization: "pass", capsuleIdentity: "pass", evaluatedAt: new Date().toISOString(),
  }).decision;
  const remaining = [...readiness.unmet, ...readiness.blockers].map((entry) => `${entry.code}: ${entry.nextAction ?? entry.state}`);
  return {
    receiptId, gate: binding.gate, decision: String(receipt.decision),
    artifactRef: binding.artifactRef, readiness,
    summary: `${binding.gate} receipt ${receiptId} persisted with decision=${String(receipt.decision)} for artifact ${binding.artifactRef.commitSha}. `
      + `Implementation readiness: ${readiness.verdict}. `
      + (remaining.length ? remaining.join(" ") : "Recheck Workroom identity and authority at the implementation transition."),
  };
}

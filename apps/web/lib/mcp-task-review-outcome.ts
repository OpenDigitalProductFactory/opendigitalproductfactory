import { immutableArtifactIdentity } from "@/lib/mcp-task-review-contract";
import { prisma, type Prisma } from "@dpf/db";
import { projectBacklogItemReadiness } from "./backlog/initiative-readiness/entry-adapter";
import { loadInheritedInitiativeScope } from "./backlog/initiative-readiness/parent-scope-inheritance";
import type { InitiativeReviewBinding } from "./mcp-task-review-contract";
import { TASK_IN_FLIGHT_STATES } from "./tak/task-states";
import { hasExecutionUncertainty } from "./shared/execution-uncertainty";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

type PersistedReviewOutcome = NonNullable<Awaited<ReturnType<typeof loadInitiativeReviewOutcome>>>;

/** The completed-TaskRun write a verified receipt settles a review to; waits and stale approvals are dropped. */
export function persistedReviewCompletionData(progressPayload: unknown, outcome: PersistedReviewOutcome) {
  const progress = { ...record(progressPayload) };
  if (hasExecutionUncertainty(progress)) {
    // The exact receipt resolves the review result, not every remote effect.
    // Retain the original uncertainty and attempt evidence as history.
    progress.executionUncertaintyResolution = { schemaVersion: 1, reviewReceiptId: outcome.receiptId,
      artifactRef: outcome.artifactRef, prior: {
        executionUncertainty: progress.executionUncertainty ?? null,
        terminalWriterWait: progress.terminalWriterWait ?? null,
        terminalWriterEscalation: progress.terminalWriterEscalation ?? null,
      } };
    delete progress.executionUncertainty;
  }
  for (const key of ["terminalWriterWait", "terminalWriterDispatchFailure", "terminalWriterEscalation", "terminalWriterContextFailure", "resourceWait", "approvalEnvelopeId"])
    delete progress[key];
  return {
    status: "completed", completedAt: new Date(),
    progressPayload: { ...progress, summary: outcome.summary, reviewOutcome: outcome, requiresApproval: false } as Prisma.InputJsonValue,
  };
}

/** A receipt completes the review, but cannot revive cancellation or displace a newer attempt. */
export async function reconcilePersistedReviewStatus(
  taskRunId: string,
  progressPayload: unknown,
  outcome: PersistedReviewOutcome,
  expected: { status: string; updatedAt: Date },
): Promise<boolean> {
  if (expected.status !== "completed" && !(TASK_IN_FLIGHT_STATES as readonly string[]).includes(expected.status)) return false;
  const written = await prisma.taskRun.updateMany({
    where: { taskRunId, status: expected.status, updatedAt: expected.updatedAt },
    data: persistedReviewCompletionData(progressPayload, outcome),
  });
  return written.count === 1;
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

/** The keys that name an immutable artifact. A receipt may omit the others. */
const ARTIFACT_IDENTITY_KEYS: Record<InitiativeReviewBinding["artifactRef"]["kind"], readonly string[]> = {
  "repo-blob-at-commit": ["kind", "commitSha", "path", "providerBlobId"],
  "feature-build-revision": ["kind", "revisionId"],
  "document-version": ["kind", "versionId"],
};

/**
 * A receipt matches its binding when every identity key is equal and no key
 * the receipt does store contradicts the binding. Revision and document receipts keep
 * only kind + their version id, while the binding also carries
 * repositoryFullName and valueDigest (BI-2E479619).
 */
function receiptArtifactMatches(bound: InitiativeReviewBinding["artifactRef"], stored: Record<string, unknown>): boolean {
  const boundFields = bound as Record<string, unknown>;
  const identity = ARTIFACT_IDENTITY_KEYS[bound.kind] ?? Object.keys(boundFields);
  if (identity.some((key) => stored[key] !== boundFields[key])) return false;
  return Object.entries(boundFields).every(([key, value]) => !(key in stored) || stored[key] === value);
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
    || !artifact || !receiptArtifactMatches(binding.artifactRef, artifact)) return null;
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
    summary: `${binding.gate} receipt ${receiptId} persisted with decision=${String(receipt.decision)} for artifact ${immutableArtifactIdentity(binding.artifactRef).version}. `
      + `Implementation readiness: ${readiness.verdict}. `
      + (remaining.length ? remaining.join(" ") : "Recheck Workroom identity and authority at the implementation transition."),
  };
}

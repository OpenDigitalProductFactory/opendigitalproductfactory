import "server-only";

// BI-9FD11E5E — approving a request an external task parked resumes that task.
//
// A coworker task submitted over MCP (tasks/submit) parks its writer on an
// approval card and waits `input-required`. Until now only the client could
// continue it, by replaying the task's immutable packet before the approval
// window closed. When the client had restarted or moved on, the approval
// lapsed and the person was asked again for the identical action (envelopes
// cmti1rjbd0o8x01lhqen6cxhd and cmti1dvjj0g5301lh1ibwi626 on 2026-09-01; four
// more, cmudl2t811oe201s17y63rjsc among them, on 2026-09-23).
//
// On approval the platform now resumes the task itself, from what the task
// stored when it was submitted: the same person, coworker, route and
// credential. It runs the same resume as the client's replay
// (resumeApprovedTask), which reserves the task with a compare-and-set on its
// waiting state, so a racing replay and this resume can never both run the
// writer; the governed gate then spends the approval once. It does not mark the
// task working first: that made the reservation unmatchable (#4796, reverted).
//
// A task the platform runs for itself has no external credential and is left
// to its own continuation.
import { prisma } from "@dpf/db";

import { currentUserContext } from "@/lib/govern/current-user-context";
import { normalizeTokenScope } from "@/lib/mcp/token-tool-scope";
import type { ExistingRemoteTask } from "@/lib/mcp-task-submit";
import { resumeApprovedTask } from "@/lib/mcp-task-submit-approval-recovery";

import {
  verifyApprovalCredential,
  type ApprovalCredentialDb,
  type ApprovalCredentialRefusal,
} from "./approved-request-credential";

export type ApprovedTaskOutcome =
  | { status: "executed" | "failed"; message: string }
  | { status: "not-run"; reason: "task-bound" | "task-not-waiting" | "task-waiting-again" | ApprovalCredentialRefusal };

type StoredTask = ExistingRemoteTask & { routeContext: string | null };

export type ApprovedTaskDb = ApprovalCredentialDb & {
  taskRun: { findUnique(args: unknown): Promise<StoredTask | null> };
};

type ApprovedTaskEnvelope = {
  taskRunId: string;
  delegatingUserId: string;
  manifestActionId: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

export async function runApprovedTaskRequest(
  envelope: ApprovedTaskEnvelope,
  deps: { db?: ApprovedTaskDb; resume?: typeof resumeApprovedTask } = {},
): Promise<ApprovedTaskOutcome> {
  const db = deps.db ?? (prisma as unknown as ApprovedTaskDb);
  const task = await db.taskRun.findUnique({
    where: { taskRunId: envelope.taskRunId },
    select: {
      id: true, taskRunId: true, userId: true, threadId: true, contextId: true, status: true,
      progressPayload: true, a2aMetadata: true, lastHeartbeatAt: true, completedAt: true, updatedAt: true,
      routeContext: true,
    },
  });
  const metadata = record(task?.a2aMetadata);
  const tokenId = text(metadata["apiTokenId"]);
  const agentId = text(metadata["requestedAgentId"]);
  if (!task || !tokenId || !agentId || task.userId !== envelope.delegatingUserId) {
    return { status: "not-run", reason: "task-bound" };
  }
  if (task.status !== "input-required") return { status: "not-run", reason: "task-not-waiting" };

  const credential = await verifyApprovalCredential(db, tokenId, {
    delegatingUserId: envelope.delegatingUserId,
    assistantAgentId: null,
    manifestActionId: envelope.manifestActionId,
  });
  if (typeof credential === "string") return { status: "not-run", reason: credential };

  const userContext = await currentUserContext(envelope.delegatingUserId).catch(() => null)
    ?? { userId: envelope.delegatingUserId, platformRole: null, isSuperuser: false };
  const outcome = await (deps.resume ?? resumeApprovedTask)({
    existing: task,
    userId: envelope.delegatingUserId,
    tokenId,
    tokenScope: normalizeTokenScope(credential) === "read" ? "read" : "write",
    userContext,
    routeContext: task.routeContext ?? "",
    agentId,
    riskClass: text(metadata["riskClass"]) ?? "bounded-write",
    reviewWriterToolName: text(record(metadata["initiativeReviewBinding"])["writerToolName"]),
  });
  // Null: a replay reserved the task first, or its approval moved on.
  if (!outcome || outcome.kind !== "result") return { status: "not-run", reason: "task-not-waiting" };
  const result = outcome.result as { status?: string; content?: Array<{ text?: string }> };
  const message = result.content?.[0]?.text ?? "";
  if (result.status === "completed") return { status: "executed", message: message || "Done." };
  if (result.status === "input-required") return { status: "not-run", reason: "task-waiting-again" };
  return { status: "failed", message: message || "The task did not complete." };
}

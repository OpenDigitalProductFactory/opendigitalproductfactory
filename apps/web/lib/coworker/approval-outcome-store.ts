import "server-only";
import { prisma } from "@dpf/db";
import { projectApprovalOutcome, type ApprovalOutcome, type ApprovalOutcomeRow } from "./approval-outcome";
import type { ApprovedRequestRun } from "./approved-request-run-types";

type Db = typeof prisma;

const select = {
  id: true, status: true, createdAt: true, expiresAt: true,
  toolExecutions: {
    where: { executionMode: "approval-outcome" },
    orderBy: { createdAt: "desc" as const }, take: 1,
    select: { executionMode: true, success: true, result: true },
  },
} as const;

/** Audit the runner's result, including refusals before governed execution.
 * Distinct audit verb prevents this receipt from being replayed as a tool result.
 * This never changes the envelope's authority, expiry, or execution reservation. */
export async function recordApprovalOutcome(
  envelopeId: string, userId: string, outcome: ApprovedRequestRun, db: Db = prisma,
): Promise<void> {
  const envelope = await db.coworkerActionEnvelope.findFirst({ where: { id: envelopeId, delegatingUserId: userId } });
  if (!envelope) throw new Error("Approval request not available.");
  await db.toolExecution.create({ data: {
    threadId: envelope.threadId, agentId: envelope.coworkerAgentId,
    userId, delegatingUserId: userId, envelopeId, taskRunId: envelope.taskRunId,
    toolName: "approval_outcome", executionMode: "approval-outcome",
    parameters: {}, success: outcome.status === "executed",
    // Raw handler messages can contain private task data; the shared projection
    // supplies safe, actionable copy from the bounded status and refusal reason.
    result: { status: outcome.status, ...(outcome.status === "not-run" ? { reason: outcome.reason } : {}) },
  } });
}

/** Exact caller identity comes from the authenticated MCP context, never params. */
export async function readApprovalOutcome(
  envelopeId: string, userId: string, agentId: string | undefined, db: Db = prisma, now = new Date(),
): Promise<ApprovalOutcome | null> {
  if (!userId || !agentId) return null;
  const row = await db.coworkerActionEnvelope.findFirst({
    where: { id: envelopeId, delegatingUserId: userId, coworkerAgentId: agentId }, select,
  });
  return row ? projectApprovalOutcome(row as ApprovalOutcomeRow, now) : null;
}

/** Recent history is separate from the actionable Inbox and never inflates its count.
 * An exact deep link may read older requests, with the same owner predicate. */
export async function loadApprovalOutcomes(
  userId: string, envelopeId?: string, db: Db = prisma, now = new Date(),
): Promise<ApprovalOutcome[]> {
  if (!userId) return [];
  const rows = await db.coworkerActionEnvelope.findMany({
    where: {
      delegatingUserId: userId,
      ...(envelopeId ? { id: envelopeId } : {
        createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
        OR: [{ status: { not: "proposed" } }, { expiresAt: { lte: now } }],
      }),
    },
    orderBy: { createdAt: "desc" }, take: envelopeId ? 1 : 10, select,
  });
  return rows.map((row) => projectApprovalOutcome(row as ApprovalOutcomeRow, now));
}

import "server-only";
import { prisma } from "@dpf/db";
import { projectApprovalOutcome, type ApprovalOutcome, type ApprovalOutcomeRow } from "./approval-outcome";
import { labelOnBehalfDecision } from "./on-behalf-decision";
import type { ApprovedRequestRun } from "./approved-request-run-types";

type Db = typeof prisma;

const select = {
  id: true, status: true, createdAt: true, expiresAt: true, argsJson: true,
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
  /** BI-7BCC87BB: an admin who decided on `userId`'s behalf; the request stays `userId`'s. */
  decidedByUserId?: string,
): Promise<void> {
  const envelope = await db.coworkerActionEnvelope.findFirst({ where: { id: envelopeId, delegatingUserId: userId } });
  if (!envelope) throw new Error("Approval request not available.");
  await db.toolExecution.create({ data: {
    threadId: envelope.threadId, agentId: envelope.coworkerAgentId,
    userId: decidedByUserId ?? userId, delegatingUserId: userId, envelopeId, taskRunId: envelope.taskRunId,
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
  const outcomes = rows.map((row) => projectApprovalOutcome(row as ApprovalOutcomeRow, now));
  return labelOnBehalfOutcomes(outcomes, db);
}

/** BI-7BCC87BB: name the admin and the owner of an on-behalf decision by email. */
async function labelOnBehalfOutcomes(outcomes: ApprovalOutcome[], db: Db): Promise<ApprovalOutcome[]> {
  const ids = [...new Set(outcomes.flatMap((o) => (o.decidedOnBehalf ? [o.decidedOnBehalf.by, o.decidedOnBehalf.onBehalfOf] : [])))];
  if (ids.length === 0) return outcomes;
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }).catch(() => []);
  const labels = new Map(users.map((user) => [user.id, user.email]));
  return outcomes.map((o) => (o.decidedOnBehalf ? { ...o, decidedOnBehalf: labelOnBehalfDecision(o.decidedOnBehalf, labels) } : o));
}

import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { deterministicExternalTaskRunId, remoteTaskRequestMatches } from "@/lib/mcp-task-capacity-contract";
import { parseRemoteTaskSubmitParams } from "@/lib/mcp-task-submit-params";
import { parseTerminalWriterWait } from "@/lib/mcp-task-replay-projection";
import { recoverTerminalWriterEscalation } from "@/lib/mcp-task-terminal-writer-escalation";

export type PlanReviewTaskAuthority = { userId: string; taskAuthorityKey: string };
type Packet = InitiativeReviewerRecovery["reviewerRoutes"][number]["requestCoworker"];
type HistoryDb = { taskRun: { findFirst(args: unknown): Promise<unknown> } };
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** A deterministic owned task is evidence of exhaustion, never an authorization grant. */
export function createExhaustedPlanReviewPredicate(authority: PlanReviewTaskAuthority | null, db: HistoryDb) {
  return async (packet: Packet): Promise<boolean> => {
    if (!authority || packet.initiativeReviewBinding?.gate !== "plan-review") return false;
    const taskRunId = deterministicExternalTaskRunId(authority.taskAuthorityKey, packet.requestKey);
    const row = record(await db.taskRun.findFirst({ where: { taskRunId, userId: authority.userId },
      select: { taskRunId: true, userId: true, currentAgentId: true, status: true,
        authorityScope: true, a2aMetadata: true, progressPayload: true } }));
    const metadata = record(row?.a2aMetadata);
    const progress = record(row?.progressPayload);
    if (!row || row.taskRunId !== taskRunId || row.userId !== authority.userId
      || row.currentAgentId !== packet.targetAgent || row.status !== "input-required"
      || metadata?.taskAuthorityKey !== authority.taskAuthorityKey
      || metadata.idempotencyKey !== packet.requestKey || metadata.requestedAgentId !== packet.targetAgent
      || !progress || progress.approvalEnvelopeId
      || !Array.isArray(row.authorityScope) || row.authorityScope.some(x => typeof x !== "string")) return false;
    const wait = parseTerminalWriterWait(progress);
    const escalation = recoverTerminalWriterEscalation(progress);
    if (!wait || wait.capacityDeferred || wait.writerRejection
      || wait.writerToolName !== packet.initiativeReviewBinding.writerToolName
      || escalation?.code !== "terminal_writer_retry_exhausted"
      || escalation.writerToolName !== wait.writerToolName || escalation.attempt !== wait.attempt) return false;
    const submitted = parseRemoteTaskSubmitParams({
      agentId: packet.targetAgent, routeContext: "/build", title: packet.questionPacketSummary,
      objective: packet.objective, prompt: packet.objective, idempotencyKey: packet.requestKey,
      riskClass: "bounded-write", authorityScope: row.authorityScope, collaborationKind: "handoff",
      initiativeReviewBinding: packet.initiativeReviewBinding,
    });
    return typeof submitted !== "string" && remoteTaskRequestMatches(metadata, submitted);
  };
}

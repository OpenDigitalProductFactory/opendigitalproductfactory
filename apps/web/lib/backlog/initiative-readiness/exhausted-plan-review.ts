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

/** A deterministic owned task is evidence of exhaustion, never an authorization grant.
 * The export name remains compatible with the original plan-review callers;
 * the same immutable proof applies to independent design and architecture reviews.
 */
export function createExhaustedPlanReviewPredicate(authority: PlanReviewTaskAuthority | null, db: HistoryDb) {
  const matchingTask = async (packet: Packet) => {
    if (!authority || !packet.initiativeReviewBinding
      || !["design-spec", "spec-approval", "architecture-review", "plan-review"].includes(packet.initiativeReviewBinding.gate)) return null;
    let requestKey = packet.requestKey;
    const read = async (key: string) => record(await db.taskRun.findFirst({ where: {
      taskRunId: deterministicExternalTaskRunId(authority.taskAuthorityKey, key), userId: authority.userId },
      select: { taskRunId: true, userId: true, currentAgentId: true, status: true,
        authorityScope: true, a2aMetadata: true, progressPayload: true } }));
    let row = await read(requestKey);
    // An alternate's prior legacy request still owns its exhausted budget.
    // Only fall back when no exact new request exists; a live/uncertain new
    // request must never be replaced on the strength of older history.
    const legacyKey = requestKey.replace(/:reviewer:[a-f0-9]{64}$/, "");
    if (!row && legacyKey !== requestKey) {
      requestKey = legacyKey;
      row = await read(requestKey);
    }
    const taskRunId = deterministicExternalTaskRunId(authority.taskAuthorityKey, requestKey);
    const metadata = record(row?.a2aMetadata);
    if (!row || row.taskRunId !== taskRunId || row.userId !== authority.userId
      || row.currentAgentId !== packet.targetAgent
      || metadata?.taskAuthorityKey !== authority.taskAuthorityKey
      || metadata.idempotencyKey !== requestKey || metadata.requestedAgentId !== packet.targetAgent
      || !Array.isArray(row.authorityScope) || row.authorityScope.some(x => typeof x !== "string")) return null;
    const submitted = parseRemoteTaskSubmitParams({
      agentId: packet.targetAgent, routeContext: "/build", title: packet.questionPacketSummary,
      objective: packet.objective, prompt: packet.objective, idempotencyKey: requestKey,
      riskClass: "bounded-write", authorityScope: row.authorityScope, collaborationKind: "handoff",
      initiativeReviewBinding: packet.initiativeReviewBinding,
    });
    return typeof submitted !== "string" && remoteTaskRequestMatches(metadata, submitted) ? { row, requestKey } : null;
  };
  const exhausted = async (packet: Packet): Promise<boolean> => {
    const match = await matchingTask(packet);
    const progress = record(match?.row.progressPayload);
    if (!match || match.row.status !== "input-required" || !progress || progress.approvalEnvelopeId) return false;
    const wait = parseTerminalWriterWait(progress);
    const escalation = recoverTerminalWriterEscalation(progress);
    return Boolean(wait && !wait.capacityDeferred && !wait.writerRejection
      && wait.writerToolName === packet.initiativeReviewBinding?.writerToolName
      && escalation?.code === "terminal_writer_retry_exhausted"
      && escalation.writerToolName === wait.writerToolName && escalation.attempt === wait.attempt);
  };
  // Keep the predicate callable for existing consumers while exposing the same
  // exact history proof to packet issuance; no client-supplied alias is trusted.
  return Object.assign(exhausted, { resolvePacket: async (packet: Packet): Promise<Packet> => {
    const match = await matchingTask(packet);
    return match ? { ...packet, requestKey: match.requestKey } : packet;
  } });
}

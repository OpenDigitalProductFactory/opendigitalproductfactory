import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { deterministicExternalTaskRunId, remoteTaskRequestMatches } from "@/lib/mcp-task-capacity-contract";
import { parseRemoteTaskSubmitParams } from "@/lib/mcp-task-submit-params";
import { parseTerminalWriterWait } from "@/lib/mcp-task-replay-projection";
import { recoverTerminalWriterEscalation } from "@/lib/mcp-task-terminal-writer-escalation";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

export type PlanReviewTaskAuthority = { userId: string; taskAuthorityKey: string };
type Packet = InitiativeReviewerRecovery["reviewerRoutes"][number]["requestCoworker"];
type HistoryDb = { taskRun: { findFirst(args: unknown): Promise<unknown>; findMany?(args: unknown): Promise<unknown[]> } };
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** A candidate key is a locator, not authority to resume or exclude a task.
 * The original-review guard still checks all matching tasks, the saved request,
 * current authority, settlement and generation before it can issue recovery. */
async function pendingOriginalLegacyKey(packet: Packet, authority: PlanReviewTaskAuthority, db: HistoryDb): Promise<string | null> {
  const key = packet.requestKey.replace(/:reviewer:[a-f0-9]{64}$/, "");
  if (key === packet.requestKey || !db.taskRun.findMany || !packet.initiativeReviewBinding) return null;
  const rows = await db.taskRun.findMany({ where: { userId: authority.userId,
    status: { notIn: ["completed", "canceled", "rejected", "archived"] },
    AND: [{ a2aMetadata: { path: ["idempotencyKey"], equals: key } },
      { a2aMetadata: { path: ["tokenSource"], equals: "oauth" } }],
  }, take: 2, select: { taskRunId: true, userId: true, status: true, a2aMetadata: true } });
  if (!rows.length || rows.length > 2) return null;
  for (const value of rows) {
    const row = record(value), metadata = record(row?.a2aMetadata);
    const family = metadata?.taskAuthorityKey;
    if (!row || row.userId !== authority.userId || typeof family !== "string"
      || !family.startsWith("oauth-family:") || family === authority.taskAuthorityKey
      || metadata?.tokenSource !== "oauth" || metadata.idempotencyKey !== key
      || !["submitted", "working", "input-required", "auth-required", "stalled", "failed"].includes(String(row.status))
      || row.taskRunId !== deterministicExternalTaskRunId(family, key)
      || !record(metadata.initiativeReviewBinding)
      || canonicalJson(metadata.initiativeReviewBinding) !== canonicalJson(packet.initiativeReviewBinding)) return null;
  }
  // Ambiguity intentionally reaches the original guard under the original
  // key; choosing a reviewer-scoped key would hide it and create a sibling.
  return key;
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
    if (!row) return null;
    const taskRunId = deterministicExternalTaskRunId(authority.taskAuthorityKey, requestKey);
    const metadata = record(row?.a2aMetadata);
    if (row.taskRunId !== taskRunId || row.userId !== authority.userId
      || row.currentAgentId !== packet.targetAgent
      || metadata?.taskAuthorityKey !== authority.taskAuthorityKey
      || metadata.idempotencyKey !== requestKey || metadata.requestedAgentId !== packet.targetAgent
      || !Array.isArray(row.authorityScope) || row.authorityScope.some(x => typeof x !== "string")) return false;
    const submitted = parseRemoteTaskSubmitParams({
      agentId: packet.targetAgent, routeContext: "/build", title: packet.questionPacketSummary,
      objective: packet.objective, prompt: packet.objective, idempotencyKey: requestKey,
      riskClass: "bounded-write", authorityScope: row.authorityScope, collaborationKind: "handoff",
      initiativeReviewBinding: packet.initiativeReviewBinding,
    });
    return typeof submitted !== "string" && remoteTaskRequestMatches(metadata, submitted) ? { row, requestKey } : false;
  };
  const exhausted = async (packet: Packet): Promise<boolean> => {
    const match = await matchingTask(packet);
    if (!match) return false;
    const progress = record(match.row.progressPayload);
    if (match.row.status !== "input-required" || !progress || progress.approvalEnvelopeId) return false;
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
    if (match) return { ...packet, requestKey: match.requestKey };
    if (match === false || !authority) return packet;
    const originalKey = await pendingOriginalLegacyKey(packet, authority, db);
    return originalKey ? { ...packet, requestKey: originalKey } : packet;
  } });
}

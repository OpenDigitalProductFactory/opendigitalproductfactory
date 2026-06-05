/**
 * EP-A2A — Coworker collaboration core (2026-06-04 spec, Slice 1).
 *
 * Shared logic behind the governed `request_coworker` (coworker-initiated
 * handoff) and `summon_coworker` (user/UI-initiated) surfaces. Reuses the
 * existing `spawnWorkThread` machinery and emits a VISIBLE `collaboration:*`
 * event on the parent thread's channel so the user's coworker panel renders the
 * handoff/summon inline (closing G1/G2). Depth/fan-out caps are inherited from
 * `spawnWorkThread` (depth-1, max-5 children) — so tier-2 is supported now;
 * tier-3 awaits depth-2 spawn support (tracked for Slice 2+).
 *
 * Authority note: Slice 1 makes collaboration VISIBLE and (for the coworker
 * path) proposal-eligible. Hard delegatesTo/escalatesTo denial + DelegationChain
 * hop writes are Slice 2, layered on the existing `delegation-authority.ts`.
 */
import { agentEventBus } from "@/lib/agent-event-bus";
import { resolveAgent } from "@/lib/tak/agent-resolution";
import { spawnWorkThread } from "@/lib/actions/agent-coworker";

export type CollaborationResult = {
  childThreadId: string;
  taskRunId: string;
  targetAgentId: string;
  targetLabel: string;
};

export type RequestCoworkerInput = {
  parentThreadId: string;
  /** Target coworker by canonical agentId (AGT-*) or slug alias. */
  targetAgent: string;
  objective: string;
  tier?: 2 | 3;
  enteredVia?: "handoff" | "escalation" | "spawn";
  /** The requesting coworker's agentId, for handoff attribution. */
  callerAgentId?: string | null;
  questionPacketSummary?: string;
  routeContext?: string;
};

export type SummonCoworkerInput = {
  parentThreadId: string;
  targetAgent: string;
  objective: string;
  tier?: 2 | 3;
  byUserId?: string;
  routeContext?: string;
};

async function resolveTargetOrThrow(targetAgent: string) {
  const target = await resolveAgent(targetAgent);
  if (!target) throw new Error(`UNKNOWN_AGENT: ${targetAgent}`);
  return target;
}

/**
 * Coworker A asks coworker B to take a scoped sub-task. Spawns a targeted child
 * thread and emits `collaboration:handoff` so the user sees the handoff inline.
 */
export async function requestCoworker(
  input: RequestCoworkerInput,
  userId: string,
): Promise<CollaborationResult> {
  const objective = input.objective?.trim();
  if (!objective) throw new Error("OBJECTIVE_REQUIRED");
  const target = await resolveTargetOrThrow(input.targetAgent);

  const { child, taskRunId } = await spawnWorkThread(
    {
      parentThreadId: input.parentThreadId,
      objective,
      routeContext: input.routeContext,
      agentId: target.agentId,
    },
    userId,
  );

  agentEventBus.emit(input.parentThreadId, {
    type: "collaboration:handoff",
    parentThreadId: input.parentThreadId,
    childThreadId: child.id,
    fromAgentId: input.callerAgentId ?? "",
    toAgentId: target.agentId,
    taskRunId,
    tier: input.tier ?? 2,
    enteredVia: input.enteredVia ?? "handoff",
    questionPacketSummary: input.questionPacketSummary,
  });

  return { childThreadId: child.id, taskRunId, targetAgentId: target.agentId, targetLabel: target.name };
}

/**
 * The user (or a coworker on the user's behalf) brings a specific coworker into
 * the conversation as a tier-2 participant. Spawns a targeted child thread and
 * emits `collaboration:summon`.
 */
export async function summonCoworker(
  input: SummonCoworkerInput,
  userId: string,
): Promise<CollaborationResult> {
  const objective = input.objective?.trim();
  if (!objective) throw new Error("OBJECTIVE_REQUIRED");
  const target = await resolveTargetOrThrow(input.targetAgent);

  const { child, taskRunId } = await spawnWorkThread(
    {
      parentThreadId: input.parentThreadId,
      objective,
      routeContext: input.routeContext,
      agentId: target.agentId,
    },
    userId,
  );

  agentEventBus.emit(input.parentThreadId, {
    type: "collaboration:summon",
    parentThreadId: input.parentThreadId,
    childThreadId: child.id,
    summonedAgentId: target.agentId,
    tier: input.tier ?? 2,
    byUserId: input.byUserId ?? userId,
  });

  return { childThreadId: child.id, taskRunId, targetAgentId: target.agentId, targetLabel: target.name };
}

/**
 * EP-A2A — Coworker collaboration core (2026-06-04 spec, Slice 1).
 *
 * Shared logic behind the governed `request_coworker` (delegate a scoped
 * sub-task to a peer) and `summon_coworker` (bring a peer into the conversation)
 * surfaces. BOTH are coworker-initiated: the active coworker decides which peers
 * to bring in and what to task them with — the human never picks or tasks peers
 * (corrected 2026-06-06). Reuses the existing `spawnWorkThread` machinery and
 * emits a VISIBLE `collaboration:*` event on the parent thread's channel so the
 * user's coworker panel renders the handoff/summon inline as visibility only
 * (closing G1/G2). Depth/fan-out caps are inherited from
 * `spawnWorkThread` (depth-1, max-5 children) — so tier-2 is supported now;
 * tier-3 awaits depth-2 spawn support (tracked for Slice 2+).
 *
 * Authority note: Slice 1 makes collaboration VISIBLE and proposal-eligible.
 * Hard delegatesTo/escalatesTo denial + DelegationChain hop writes are Slice 2,
 * layered on the existing `delegation-authority.ts`.
 */
import { randomUUID } from "crypto";
import { prisma } from "@dpf/db";
import { agentEventBus } from "@/lib/agent-event-bus";
import { resolveAgent } from "@/lib/tak/agent-resolution";
import { spawnWorkThread } from "@/lib/actions/agent-coworker";
import { isHandoffPermitted } from "@/lib/tak/collaboration-authority";
import { coerceDataSensitivity } from "@dpf/db/principal-sensitivity";
import {
  decideConveneClearance,
  clearanceForPrincipal,
  conveneDenialAuditReason,
  CONVENE_DENIED_MESSAGE,
} from "./convene-clearance";
import type { CollaborationProvenance } from "@/lib/tak/conversation-participants-core";

/** Raised when a convene is refused because the peer outranks the asking human's clearance. */
export class ConveneDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConveneDeniedError";
  }
}

/** Raised when a coworker-initiated handoff is denied by delegation authority. */
export class HandoffDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffDeniedError";
  }
}

/**
 * Record a delegation hop for chain-of-custody (Slice 2). Best-effort: a hop
 * write failure must not change the spawn/deny decision already made.
 */
async function recordDelegationHop(p: {
  fromAgentId: string;
  toAgentId: string;
  status: "active" | "blocked";
  reason: string;
  originUserId: string;
}): Promise<void> {
  try {
    await prisma.delegationChain.create({
      data: {
        chainId: randomUUID(),
        depth: 0,
        fromAgentId: p.fromAgentId,
        toAgentId: p.toAgentId,
        status: p.status,
        reason: p.reason,
        authorityScope: [],
        originUserId: p.originUserId,
        originAuthority: [],
      },
    });
  } catch {
    // non-fatal — audit row only.
  }
}

/**
 * Enforce delegatesTo/escalatesTo for a coworker-initiated handoff. Throws
 * HandoffDeniedError (after recording a blocked hop) when the caller agent is
 * not permitted to reach the target. No-op when there is no caller agent
 * (user-initiated summon authority is gated separately).
 */
async function enforceHandoffAuthority(
  callerAgentId: string | null | undefined,
  target: { agentId: string; slugId: string | null },
  userId: string,
): Promise<void> {
  if (!callerAgentId) return;
  const caller = await prisma.agent.findFirst({
    where: { OR: [{ agentId: callerAgentId }, { slugId: callerAgentId }] },
    select: { agentId: true, delegatesTo: true, escalatesTo: true },
  });
  if (!caller) return; // unknown caller — nothing to enforce against
  const targetIds = [target.agentId, target.slugId].filter((v): v is string => Boolean(v));
  const permitted = isHandoffPermitted({
    delegatesTo: caller.delegatesTo ?? [],
    escalatesTo: caller.escalatesTo ?? null,
    targetIds,
  });
  if (!permitted) {
    await recordDelegationHop({
      fromAgentId: caller.agentId,
      toAgentId: target.agentId,
      status: "blocked",
      reason: `${caller.agentId} is not permitted to delegate or escalate to ${target.agentId}`,
      originUserId: userId,
    });
    throw new HandoffDeniedError(
      `${caller.agentId} is not permitted to hand off to ${target.agentId}.`,
    );
  }
}

/**
 * Persist collaboration provenance on the child TaskRun so cards + accurate
 * enteredVia survive refresh (spec A1). Best-effort: a provenance write failure
 * must not fail the spawn that already succeeded.
 */
async function persistProvenance(taskRunId: string, provenance: CollaborationProvenance): Promise<void> {
  try {
    await prisma.taskRun.update({
      where: { taskRunId },
      data: { a2aMetadata: { collaboration: provenance } },
    });
  } catch {
    // non-fatal: the live SSE card + roster still render; reload reconstruction
    // is the only thing degraded.
  }
}

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
  /** The active coworker that summoned the peer, for attribution. */
  callerAgentId?: string | null;
  byUserId?: string;
  routeContext?: string;
};

/**
 * BI-154DAA7E: refuse to convene a peer classified above the asking human's
 * clearance. Placed in the shared target resolver rather than at each call site
 * so a future third convene path inherits it instead of forgetting it.
 *
 * Clearance resolves through `clearanceForPrincipal`, which delegates to the
 * same `normalizePrincipalSensitivities` the principal-linking and seed paths
 * use, so this clamp cannot drift from the clearance a principal is actually
 * granted — and an unlinked user is never treated as MORE cleared than a linked
 * one with nothing explicit.
 */
async function enforceConveneClearance(
  target: { agentId: string; slugId: string | null },
  userId: string,
): Promise<void> {
  const [agentRow, alias] = await Promise.all([
    prisma.agent.findFirst({
      where: { OR: [{ agentId: target.agentId }, { slugId: target.agentId }] },
      select: { sensitivity: true },
    }),
    prisma.principalAlias.findFirst({
      where: { aliasType: "user", aliasValue: userId, issuer: "" },
      include: { principal: { select: { sensitivityClearance: true } } },
    }),
  ]);

  const decision = decideConveneClearance({
    askingHumanClearance: clearanceForPrincipal(alias?.principal.sensitivityClearance),
    targetAgentSensitivity: agentRow?.sensitivity,
  });
  if (decision.permitted) return;

  await recordDelegationHop({
    fromAgentId: target.agentId,
    toAgentId: target.agentId,
    status: "blocked",
    reason: conveneDenialAuditReason({
      targetAgentId: target.agentId,
      requiredSensitivity: coerceDataSensitivity(agentRow?.sensitivity),
    }),
    originUserId: userId,
  });
  throw new ConveneDeniedError(CONVENE_DENIED_MESSAGE);
}

async function resolveTargetOrThrow(targetAgent: string, userId: string) {
  const target = await resolveAgent(targetAgent);
  if (!target) throw new Error(`UNKNOWN_AGENT: ${targetAgent}`);
  // Lifecycle gate (EP-COWORKER-LIFECYCLE Phase 3): a draft/retired coworker —
  // and, under strict mode, one that failed certification — cannot be the
  // target of a summon or handoff. The MCP handler surfaces the thrown message.
  const { evaluateLifecycleGate } = await import("@/lib/coworker-lifecycle/lifecycle-gate");
  const verdict = await evaluateLifecycleGate(target.agentId, { purpose: "summon" });
  if (!verdict.allowed) {
    throw new Error(`COWORKER_NOT_SUMMONABLE: ${verdict.reason}`);
  }

  // BI-154DAA7E: disclosure clamp. Runs AFTER the lifecycle gate so an
  // unsummonable coworker still reports as unsummonable rather than as a
  // clearance refusal, which would let the generic refusal hint at a
  // restricted matter that does not exist.
  await enforceConveneClearance(target, userId);
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
  const target = await resolveTargetOrThrow(input.targetAgent, userId);

  // Slice 2: enforce the caller's declared delegatesTo / escalatesTo before any
  // child thread is spawned. Throws HandoffDeniedError (and records a blocked
  // DelegationChain hop) when the target is out of scope.
  await enforceHandoffAuthority(input.callerAgentId, target, userId);

  const { child, taskRunId } = await spawnWorkThread(
    {
      parentThreadId: input.parentThreadId,
      objective,
      routeContext: input.routeContext,
      agentId: target.agentId,
    },
    userId,
  );

  // Record the accepted hop for chain-of-custody.
  if (input.callerAgentId) {
    await recordDelegationHop({
      fromAgentId: input.callerAgentId,
      toAgentId: target.agentId,
      status: "active",
      reason: "coworker handoff",
      originUserId: userId,
    });
  }

  const tier = input.tier ?? 2;
  const enteredVia = input.enteredVia ?? "handoff";
  await persistProvenance(taskRunId, {
    kind: "handoff",
    fromAgentId: input.callerAgentId ?? null,
    toAgentId: target.agentId,
    enteredVia,
    tier,
    summary: input.questionPacketSummary,
  });

  agentEventBus.emit(input.parentThreadId, {
    type: "collaboration:handoff",
    parentThreadId: input.parentThreadId,
    childThreadId: child.id,
    fromAgentId: input.callerAgentId ?? "",
    toAgentId: target.agentId,
    taskRunId,
    tier,
    enteredVia,
    questionPacketSummary: input.questionPacketSummary,
  });

  return { childThreadId: child.id, taskRunId, targetAgentId: target.agentId, targetLabel: target.name };
}

/**
 * The active coworker brings a specific peer into the conversation as a tier-2
 * participant to address part of the work. Spawns a targeted child thread and
 * emits `collaboration:summon` so the user SEES the peer being brought in
 * (visibility only — the human does not initiate summons).
 */
export async function summonCoworker(
  input: SummonCoworkerInput,
  userId: string,
): Promise<CollaborationResult> {
  const objective = input.objective?.trim();
  if (!objective) throw new Error("OBJECTIVE_REQUIRED");
  const target = await resolveTargetOrThrow(input.targetAgent, userId);

  const { child, taskRunId } = await spawnWorkThread(
    {
      parentThreadId: input.parentThreadId,
      objective,
      routeContext: input.routeContext,
      agentId: target.agentId,
    },
    userId,
  );

  const tier = input.tier ?? 2;
  const byUserId = input.byUserId ?? userId;
  await persistProvenance(taskRunId, {
    kind: "summon",
    fromAgentId: input.callerAgentId ?? null,
    toAgentId: target.agentId,
    enteredVia: "summon",
    tier,
    byUserId,
  });

  agentEventBus.emit(input.parentThreadId, {
    type: "collaboration:summon",
    parentThreadId: input.parentThreadId,
    childThreadId: child.id,
    ...(input.callerAgentId ? { fromAgentId: input.callerAgentId } : {}),
    summonedAgentId: target.agentId,
    tier,
    byUserId,
  });

  return { childThreadId: child.id, taskRunId, targetAgentId: target.agentId, targetLabel: target.name };
}

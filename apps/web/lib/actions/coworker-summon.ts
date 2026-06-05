"use server";

/**
 * EP-A2A — User-facing coworker summon (2026-06-04 spec, Slice 1).
 *
 * Server actions for the CoworkerSummonPicker: list the coworkers a user can
 * summon, and summon one into the current conversation as a tier-2 participant.
 * Reuses the governed collaboration core (`coworker-collaboration.ts`).
 */
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { projectParticipants, type ConversationParticipant } from "@/lib/tak/conversation-participants";

export type SummonableCoworker = {
  agentId: string;
  name: string;
  tier: number | null;
  valueStream: string | null;
  description: string | null;
};

type SummonUser = { userId: string; platformRole: string | null; isSuperuser: boolean };

async function requireUser(): Promise<SummonUser> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");
  return {
    userId: user.id,
    platformRole: user.platformRole ?? null,
    isSuperuser: user.isSuperuser === true,
  };
}

async function requireUserId(): Promise<string> {
  return (await requireUser()).userId;
}

/**
 * List active coworkers a user can summon, ordered by tier. Slice 1 returns the
 * full active registry; archetype/value-stream scoping is a tracked refinement
 * (spec Open Question #2).
 */
export async function listSummonableCoworkers(): Promise<SummonableCoworker[]> {
  await requireUserId();
  const agents = await prisma.agent.findMany({
    where: { archived: false },
    orderBy: [{ tier: "asc" }, { name: "asc" }],
    select: { agentId: true, name: true, tier: true, valueStream: true, description: true },
  });
  return agents;
}

/**
 * Project the live participant roster for a conversation (owner + spawned
 * sub-agents / summoned peers). Read-only; safe to poll.
 */
export async function getConversationParticipants(
  rootThreadId: string,
  ownerAgentId?: string | null,
): Promise<ConversationParticipant[]> {
  await requireUserId();
  const id = rootThreadId?.trim();
  if (!id) return [];
  return projectParticipants(id, { ownerAgentId: ownerAgentId ?? null });
}

export type SummonCoworkerActionResult =
  | { ok: true; childThreadId: string; targetAgentId: string; targetLabel: string }
  | { ok: false; error: string };

/**
 * Summon a coworker into `parentThreadId` to address `objective`. Returns a
 * discriminated result so the picker can render success/failure without throwing.
 */
export async function summonCoworkerAction(input: {
  parentThreadId: string;
  targetAgent: string;
  objective: string;
  tier?: 2 | 3;
  routeContext?: string;
}): Promise<SummonCoworkerActionResult> {
  const user = await requireUser();
  const parentThreadId = input.parentThreadId?.trim();
  const targetAgent = input.targetAgent?.trim();
  const objective = input.objective?.trim();
  if (!parentThreadId || !targetAgent || !objective) {
    return { ok: false, error: "parentThreadId, targetAgent, and objective are required." };
  }
  // User gate: a summon is a side-effecting spawn — require a real platform
  // identity, not an anonymous/role-less session. (Per-target delegatesTo /
  // escalatesTo enforcement is Slice 2.)
  if (!user.isSuperuser && !user.platformRole) {
    return { ok: false, error: "Your account is not permitted to summon coworkers." };
  }

  // Route through the SAME governed execution path as the MCP tool (audit +
  // pre-tool hooks + capability checks) rather than calling the collaboration
  // core directly. No context.agentId is passed: a user-initiated summon is
  // gated by the user above, not by a route coworker's tool grant (route owners
  // do not hold thread_write), so owner-grant gating would wrongly deny it.
  const result = await governedExecuteTool({
    toolName: "summon_coworker",
    rawParams: { targetAgent, objective, tier: input.tier ?? 2 },
    userId: user.userId,
    userContext: { userId: user.userId, platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    context: { threadId: parentThreadId, routeContext: input.routeContext },
    source: "internal-mcp-session",
  });

  if (result.governance?.rejected) {
    return { ok: false, error: "This summon was blocked by platform policy." };
  }
  if (!result.success) {
    return { ok: false, error: typeof result.message === "string" ? result.message : "Summon failed." };
  }

  const data = (result.data ?? {}) as {
    childThreadId?: string;
    targetAgentId?: string;
    targetLabel?: string;
  };
  return {
    ok: true,
    childThreadId: data.childThreadId ?? (typeof result.entityId === "string" ? result.entityId : ""),
    targetAgentId: data.targetAgentId ?? targetAgent,
    targetLabel: data.targetLabel ?? targetAgent,
  };
}

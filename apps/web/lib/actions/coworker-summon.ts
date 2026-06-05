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
import { summonCoworker } from "@/lib/tak/coworker-collaboration";
import { projectParticipants, type ConversationParticipant } from "@/lib/tak/conversation-participants";

export type SummonableCoworker = {
  agentId: string;
  name: string;
  tier: number | null;
  valueStream: string | null;
  description: string | null;
};

async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");
  return userId;
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
  const userId = await requireUserId();
  const parentThreadId = input.parentThreadId?.trim();
  const targetAgent = input.targetAgent?.trim();
  const objective = input.objective?.trim();
  if (!parentThreadId || !targetAgent || !objective) {
    return { ok: false, error: "parentThreadId, targetAgent, and objective are required." };
  }
  try {
    const result = await summonCoworker(
      {
        parentThreadId,
        targetAgent,
        objective,
        tier: input.tier ?? 2,
        byUserId: userId,
        routeContext: input.routeContext,
      },
      userId,
    );
    return {
      ok: true,
      childThreadId: result.childThreadId,
      targetAgentId: result.targetAgentId,
      targetLabel: result.targetLabel,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Summon failed." };
  }
}

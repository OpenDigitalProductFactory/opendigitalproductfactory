"use server";

/**
 * EP-A2A — Conversation participant projection (2026-06-04 spec; corrected
 * 2026-06-06).
 *
 * Read-only server action that projects the live participant roster for a
 * conversation (the owner coworker + the peers/sub-agents the owner has brought
 * in). This backs the visibility-only `CollaborationActivityPanel`.
 *
 * Deliberate non-goal: there is NO user-facing "summon a coworker" action here.
 * Choosing and tasking other coworkers is the sole responsibility of the active
 * coworker (via the `request_coworker` / `summon_coworker` MCP tools); the human
 * does not pick or task peers. The portal only SHOWS what the active coworker is
 * tasking and a summary of what each peer is doing.
 */
import { auth } from "@/lib/auth";
import { projectParticipants, type ConversationParticipant } from "@/lib/tak/conversation-participants";

async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

/**
 * Project the live participant roster for a conversation (owner + the
 * sub-agents / peers the owner coworker brought in). Read-only; safe to poll.
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

// apps/web/lib/build/phase-compaction-wire.ts
//
// EP-COST Phase 3: wiring helper for phase-boundary compaction.
//
// Called at phase transition points (ideate→plan, plan→build) to:
//   1. Fetch the last N messages from the coworker thread
//   2. Call compactPhase() to summarize them
//   3. Persist the summary as a "system" AgentMessage so the next
//      specialist sees it at the top of the new phase context
//
// Fire-and-forget from all callsites — errors are swallowed so a DB
// hiccup never blocks the phase transition.

import { prisma } from "@dpf/db";
import type { ChatMessage } from "@/lib/ai-inference";

/** Maximum number of thread messages to include in the phase summary. */
const PHASE_WINDOW_SIZE = 40;

/**
 * Summarize the coworker thread for the completed phase and persist the
 * result as a system message so the next specialist's first turn carries
 * a concise handoff rather than the raw full history.
 *
 * @param threadId  - Active coworker thread ID
 * @param phase     - Phase that just COMPLETED (e.g. "ideate" when going ideate→plan)
 */
export async function persistPhaseHandoffSummary(
  threadId: string,
  phase: string,
): Promise<void> {
  try {
    const { compactPhase } = await import("@/lib/build/phase-compaction");

    // Fetch the most recent messages from this thread for the summary window
    const rows = await prisma.agentMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: "desc" },
      take: PHASE_WINDOW_SIZE,
      select: { role: true, content: true },
    });

    if (rows.length === 0) return;

    // Reverse to chronological order and map to ChatMessage[]
    const messages: ChatMessage[] = rows.reverse().map((r) => ({
      role: r.role as ChatMessage["role"],
      content: r.content,
    }));

    const handoff = await compactPhase(phase, messages);

    // Persist the handoff summary as a system message in the thread.
    // Role "system" is used so it appears as a context injection rather
    // than a user turn — the coworker's history loader includes it.
    await prisma.agentMessage.create({
      data: {
        threadId,
        role: "system",
        content: typeof handoff.content === "string"
          ? handoff.content
          : JSON.stringify(handoff.content),
      },
    });
  } catch (err) {
    console.warn("[phase-compaction-wire] Failed to persist phase handoff:", { threadId, phase }, err);
  }
}

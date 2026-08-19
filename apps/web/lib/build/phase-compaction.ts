// apps/web/lib/build/phase-compaction.ts
// Build Studio phase-boundary summarization — EP-COST Phase 3.
//
// After each Build Studio phase completes (ideate → design → implement →
// review → ship), the full phase transcript is condensed into a concise
// bullet-point summary before it is handed to the next specialist.
// This prevents unbounded context growth as phases chain together.
//
// The summary call uses taskType "analysis" (routes to a routine-tier model).

import type { ChatMessage } from "@/lib/ai-inference";

export type PhaseName = "ideate" | "design" | "implement" | "review" | "ship" | string;

/** Maximum characters of phase transcript to include in the summary prompt. */
const MAX_TRANSCRIPT_CHARS = 6_000;

/**
 * Summarizes a build phase's message transcript into a concise handoff note.
 *
 * Returns a ChatMessage with role "user" and a [PHASE HANDOFF] prefix so it
 * is valid for all provider APIs. The next specialist receives this as prior
 * context rather than the raw, unbounded phase thread.
 */
export async function compactPhase(
  phase: PhaseName,
  phaseMessages: ChatMessage[],
): Promise<ChatMessage> {
  try {
    const { routeAndCall } = await import("@/lib/inference/routed-inference");

    const transcript = phaseMessages
      .map((m) => {
        const role = m.role === "assistant" ? "Agent" : "User";
        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return `${role}: ${text.slice(0, 1_200)}`;
      })
      .join("\n\n")
      .slice(0, MAX_TRANSCRIPT_CHARS);

    const result = await routeAndCall(
      [
        {
          role: "user",
          content:
            `You are summarizing the ${phase} phase of a Build Studio session for handoff to the next phase. ` +
            `Write 3–5 concise bullet points covering:\n` +
            `• Decisions made\n` +
            `• Artifacts produced (files, schemas, specs)\n` +
            `• Open questions or blockers\n` +
            `• What the next phase must know\n\n` +
            `Be concrete — omit pleasantries and filler.\n\n` +
            `Phase transcript:\n${transcript}`,
        },
      ],
      "You are a Build Studio phase summarizer. Output only the bullet-point summary.",
      "internal",
      { taskType: "analysis" },
    );

    return {
      role: "user",
      content: `[${phase.toUpperCase()} PHASE HANDOFF — ${phaseMessages.length} turns condensed]:\n${result.content}`,
    };
  } catch (err) {
    // Non-fatal: return a minimal fallback summary so the next phase can still start.
    console.warn("[phase-compaction] Phase summarization failed:", { phase }, err);
    return {
      role: "user",
      content: `[${phase.toUpperCase()} PHASE HANDOFF]: Phase completed. ${phaseMessages.length} turns (summary unavailable).`,
    };
  }
}

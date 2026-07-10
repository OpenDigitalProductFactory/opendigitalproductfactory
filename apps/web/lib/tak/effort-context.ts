// apps/web/lib/tak/effort-context.ts
// Shared multi-coworker effort working context — BI-23A65B81 (EP-8C706944 P3).
//
// Work spanning many coworkers and sessions outside Build Studio was stitched
// only by shared FKs (backlogItemId / epicId); no object held the shared working
// context — decisions made, open questions, scratch notes — readable and
// writable by every participant. This is that object's pure logic: apply an
// append entry to the context arrays (dedupe + cap) and render the context as a
// rehydration briefing (Linear's artifact-as-memory). Deterministic, no DB.

/** The kind of entry a coworker appends to a shared effort context. */
export const EFFORT_ENTRY_KINDS = ["decision", "open-question", "note"] as const;
export type EffortEntryKind = (typeof EFFORT_ENTRY_KINDS)[number];

export function isKnownEffortEntryKind(kind: string): kind is EffortEntryKind {
  return (EFFORT_ENTRY_KINDS as readonly string[]).includes(kind);
}

/** The mutable arrays of an effort context. */
export type EffortContextState = {
  decisions: string[];
  openQuestions: string[];
  notes: string[];
  participantAgentIds: string[];
};

/** Keep each list bounded so an effort context can never balloon the prompt. */
export const EFFORT_LIST_CAP = 50;

function appendCapped(list: string[], value: string): string[] {
  const trimmed = value.trim();
  // Idempotent: an identical entry is a no-op (case-insensitive).
  if (list.some((x) => x.trim().toLowerCase() === trimmed.toLowerCase())) return list;
  const next = [...list, trimmed];
  return next.length > EFFORT_LIST_CAP ? next.slice(next.length - EFFORT_LIST_CAP) : next;
}

/**
 * Apply one append entry to the effort context state. Pure — returns the new
 * arrays; the runner persists them. `agentId` (the authoring coworker) is added
 * to the participant set.
 */
export function applyEffortEntry(
  state: EffortContextState,
  entry: { kind: EffortEntryKind; content: string; agentId?: string | null },
): EffortContextState {
  const next: EffortContextState = {
    decisions: state.decisions,
    openQuestions: state.openQuestions,
    notes: state.notes,
    participantAgentIds: state.participantAgentIds,
  };
  if (entry.kind === "decision") next.decisions = appendCapped(state.decisions, entry.content);
  else if (entry.kind === "open-question")
    next.openQuestions = appendCapped(state.openQuestions, entry.content);
  else next.notes = appendCapped(state.notes, entry.content);

  if (entry.agentId && !state.participantAgentIds.includes(entry.agentId)) {
    next.participantAgentIds = [...state.participantAgentIds, entry.agentId];
  }
  return next;
}

/** Cap on the rendered briefing so a large effort context can't dominate context. */
export const EFFORT_BRIEFING_CHAR_CAP = 3000;

/**
 * Render the effort context as a rehydration briefing block, or null when the
 * context is empty (strict no-op). This is what briefs a coworker joining the
 * effort in a fresh session.
 */
export function formatEffortContextBriefing(
  effortKey: string,
  title: string | null,
  state: EffortContextState,
): string | null {
  const hasContent =
    state.decisions.length > 0 || state.openQuestions.length > 0 || state.notes.length > 0;
  if (!hasContent) return null;

  const lines: string[] = [`EFFORT CONTEXT — ${title ?? effortKey}`];
  if (state.participantAgentIds.length > 0) {
    lines.push(`Participants: ${state.participantAgentIds.join(", ")}`);
  }
  if (state.decisions.length > 0) {
    lines.push("Decisions:");
    for (const d of state.decisions) lines.push(`- ${d}`);
  }
  if (state.openQuestions.length > 0) {
    lines.push("Open questions:");
    for (const q of state.openQuestions) lines.push(`- ${q}`);
  }
  if (state.notes.length > 0) {
    lines.push("Working notes:");
    for (const n of state.notes) lines.push(`- ${n}`);
  }
  const content = lines.join("\n");
  return content.length > EFFORT_BRIEFING_CHAR_CAP
    ? content.slice(0, EFFORT_BRIEFING_CHAR_CAP)
    : content;
}

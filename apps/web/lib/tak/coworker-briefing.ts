// apps/web/lib/tak/coworker-briefing.ts
// Session-start projection briefing — BI-A9052DCB (EP-8C706944 Phase 3).
//
// Instead of RAG over transcripts, precompute a compact "what you should know"
// block from governed records and inject it at session start (ChatGPT's
// reference-chat-history model: derived profile sections, not transcript search).
// This module assembles the block deterministically from already-selected source
// data — cheap, auditable, cache-friendly, and unit-testable with no DB/model.

/** The distilled inputs a briefing is assembled from. */
export type BriefingSources = {
  /** scope="user": display name / handle for the person; scope="org": org name. */
  subjectLabel: string;
  /** One-line business framing (BusinessContext.mission/valueProposition). */
  businessLine?: string | null;
  /** Highest-signal durable facts, already ranked (key + value). */
  topFacts: Array<{ key: string; value: string }>;
  /** The coworker's own role-local notes relevant to this subject. */
  notes: Array<{ noteKind: string; noteKey: string; content: string }>;
  /** Recent decisions/outcomes worth carrying forward. */
  recentDecisions: string[];
  /** Optional running spend note for spend-aware framing. */
  spendLine?: string | null;
};

export const BRIEFING_MAX_FACTS = 8;
export const BRIEFING_MAX_NOTES = 6;
export const BRIEFING_MAX_DECISIONS = 5;
export const BRIEFING_CONTENT_CHAR_CAP = 3000;

function clampList<T>(items: T[], max: number): T[] {
  return items.length > max ? items.slice(0, max) : items;
}

/**
 * Assemble the briefing block. Returns null when there is nothing worth saying
 * (no facts, notes, decisions, or business line) so the block is a strict no-op.
 */
export function buildBriefingContent(sources: BriefingSources): string | null {
  const facts = clampList(sources.topFacts, BRIEFING_MAX_FACTS);
  const notes = clampList(sources.notes, BRIEFING_MAX_NOTES);
  const decisions = clampList(sources.recentDecisions, BRIEFING_MAX_DECISIONS);

  const hasContent =
    facts.length > 0 ||
    notes.length > 0 ||
    decisions.length > 0 ||
    !!sources.businessLine;
  if (!hasContent) return null;

  const lines: string[] = [`BRIEFING — ${sources.subjectLabel}`];
  if (sources.businessLine) lines.push(`Context: ${sources.businessLine}`);
  if (sources.spendLine) lines.push(`Spend so far: ${sources.spendLine}`);

  if (facts.length > 0) {
    lines.push("Known facts:");
    for (const f of facts) lines.push(`- ${f.key}: ${f.value}`);
  }
  if (notes.length > 0) {
    lines.push("Your working notes:");
    for (const n of notes) lines.push(`- [${n.noteKind}] ${n.noteKey}: ${n.content}`);
  }
  if (decisions.length > 0) {
    lines.push("Recent decisions:");
    for (const d of decisions) lines.push(`- ${d}`);
  }

  const content = lines.join("\n");
  return content.length > BRIEFING_CONTENT_CHAR_CAP
    ? content.slice(0, BRIEFING_CONTENT_CHAR_CAP)
    : content;
}

/**
 * A stable digest of the inputs, so the offline refresh can skip regeneration
 * (and an unchanged write) when nothing material has changed. Order-sensitive by
 * design — a reordering of ranked facts is a meaningful change.
 */
export function briefingSourceDigest(sources: BriefingSources): string {
  const canonical = JSON.stringify({
    s: sources.subjectLabel,
    b: sources.businessLine ?? null,
    f: clampList(sources.topFacts, BRIEFING_MAX_FACTS).map((f) => `${f.key}=${f.value}`),
    n: clampList(sources.notes, BRIEFING_MAX_NOTES).map((n) => `${n.noteKind}:${n.noteKey}=${n.content}`),
    d: clampList(sources.recentDecisions, BRIEFING_MAX_DECISIONS),
    p: sources.spendLine ?? null,
  });
  // Small, dependency-free FNV-1a hash — enough to detect input change.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Render the stored briefing as a prependable history message (no-op if empty). */
export function formatBriefingMessage(
  content: string | null | undefined,
): { role: "user"; content: string } | null {
  if (!content) return null;
  return { role: "user", content: `[SESSION BRIEFING]\n${content}` };
}

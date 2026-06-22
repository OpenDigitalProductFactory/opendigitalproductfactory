// apps/web/lib/tak/compaction-digest.ts
//
// Extractive compaction digest (R9a / P11, context-engineering-standards.md).
//
// The agentic loop's compaction (compactAgenticMessages) keeps message[0] plus
// the last N messages and DROPS the middle of a long turn entirely. Anything the
// agent did in that dropped span — the tools it already ran, the ones that
// failed — is silently lost, so on a long local-window turn the model can repeat
// completed work or re-hit a known failure.
//
// Anthropic's compaction *summarizes* the dropped span. A full LLM summarization
// pass is the wrong tool on the local-first / single-GPU path: it would block
// the one model and compete for the very window we're trying to economize. So
// this is an EXTRACTIVE digest — a deterministic, zero-inference ledger of the
// tool activity in the dropped span (which tools ran, how often, what failed) —
// re-inserted as a short notice so that high-signal "what already happened"
// survives compaction without an extra inference call.
//
// Pure module — no imports, no I/O — declared against a minimal message shape so
// it stays out of the loop's dependency graph and is unit-tested directly.

/** Minimal structural shape of a chat message (ChatMessage is assignable). */
export type CompactionMessageLike = {
  role?: string;
  content?: unknown;
  toolCalls?: ReadonlyArray<{ id?: string; name?: string }> | null;
  toolCallId?: string;
};

type ToolTally = { calls: number; fails: number };

/**
 * Build a one-line digest of the TOOL ACTIVITY in a dropped (compacted-away)
 * message span: each tool used, how many times, and how many of those calls
 * failed. Failure is inferred from the tool result serialization (a failed
 * result is rendered `Error: …` by the loop). Returns null when the span has no
 * tool activity worth preserving (plain text truncation is acceptable; actions
 * are what matter for avoiding repeated/again-failing work). Pure.
 */
export function summarizeDroppedMessages(
  dropped: readonly CompactionMessageLike[] | null | undefined,
): string | null {
  if (!dropped || dropped.length === 0) return null;

  const tally = new Map<string, ToolTally>();
  const callIdToName = new Map<string, string>();

  for (const m of dropped) {
    if (m.role === "assistant" && Array.isArray(m.toolCalls)) {
      for (const tc of m.toolCalls) {
        const name = tc?.name;
        if (!name) continue;
        const row = tally.get(name) ?? { calls: 0, fails: 0 };
        row.calls += 1;
        tally.set(name, row);
        if (tc.id) callIdToName.set(tc.id, name);
      }
    } else if (m.role === "tool" && typeof m.content === "string") {
      // A failed tool result is serialized as "Error: …" by the loop.
      if (!m.content.startsWith("Error:")) continue;
      const name = m.toolCallId ? callIdToName.get(m.toolCallId) : undefined;
      if (!name) continue;
      const row = tally.get(name) ?? { calls: 0, fails: 0 };
      row.fails += 1;
      tally.set(name, row);
    }
  }

  if (tally.size === 0) return null;

  const parts = [...tally.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, { calls, fails }]) => `${name} ×${calls}${fails > 0 ? ` (${fails} failed)` : ""}`);

  return (
    `Earlier this turn, ${dropped.length} message(s) were compacted to fit the window. ` +
    `Tools already used: ${parts.join(", ")}. ` +
    `Don't repeat completed work; recheck any failures before retrying.`
  );
}

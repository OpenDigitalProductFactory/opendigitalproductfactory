// Proactive opening briefing for the coworker chat panel (BI-DED493BA,
// EP-B9DD37C7). The panel opened silent on every surface — "if we have to
// prompt to get proactivity, we have failed." This module composes a
// DETERMINISTIC briefing from the attention read-model (no LLM call): the
// single most pressing item routed to the human, why it needs them, and how
// much more is waiting. Grounded in queried rows so it cannot fabricate;
// recomputed fresh on every panel open and never persisted to the thread
// (kernel decision: deterministic-ephemeral-briefing, high confidence).

import type { AttentionItem } from "@/lib/attention/types";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";

export type OpeningBriefing = {
  /** Markdown for the assistant bubble (links render via ReactMarkdown). */
  content: string;
  itemCount: number;
};

/**
 * Wire shape returned to the panel by getOrCreateThreadSnapshot. Lives here
 * (not in the "use server" actions file) — server-action modules may only
 * export async functions; even a type export there has bitten before (#2707).
 */
export type OpeningBriefingPayload = {
  /** Markdown briefing for an ephemeral assistant bubble — never persisted. */
  content: string;
  agentId: string | null;
};

/** The "Needs you" inbox — the full view the briefing links to for the rest. */
const ATTENTION_INBOX_ROUTE = "/workspace/inbox";

/**
 * Normalize a thread routeContext to its surface prefix so items that deep-link
 * into the current surface outrank global ones: "/customer/marketing/foo" →
 * "/customer/marketing", "/build#B-123" → "/build".
 */
export function surfacePrefixFromRouteContext(routeContext: string): string {
  const path = routeContext.split("#")[0] ?? "";
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  return `/${segments.slice(0, 2).join("/")}`;
}

// Status synonyms and articles carry no information distinguishing a headline
// from its detail, so they're ignored when deciding whether the detail merely
// restates the headline.
const STATUS_STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "down", "offline", "unavailable", "unreachable", "not", "responding", "no",
]);

function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !STATUS_STOPWORDS.has(w)),
  );
}

/**
 * True when `context` adds no content words beyond `title` — i.e. it merely
 * restates the headline ("The knowledge graph is down" / "The knowledge graph
 * is unavailable"). Such a detail is dropped so the briefing doesn't render
 * "X is down — X is unavailable" (BI-49C4EA5D). A detail that names a real
 * consequence ("…— most features will fail") keeps content words and is kept.
 */
export function detailRestatesTitle(title: string, context: string | null | undefined): boolean {
  if (!context || !context.trim()) return true;
  const contextTokens = contentTokens(context);
  if (contextTokens.size === 0) return true;
  const titleTokens = contentTokens(title);
  for (const word of contextTokens) {
    if (!titleTokens.has(word)) return false;
  }
  return true;
}

/**
 * Compose the opening briefing, gated by the employee's Proactivity choice for
 * this coworker: quiet = stay silent (that's what quiet means), balanced =
 * speak when something actually needs the human, assertive = always present —
 * even the all-clear is said out loud.
 *
 * `items` must arrive in attention-triage order (the aggregator's contract);
 * the headline is the first surface-local item, falling back to the global top.
 */
export function composeOpeningBriefing(input: {
  routeContext: string;
  proactivityLevel: ProactivityLevel | null;
  items: AttentionItem[];
}): OpeningBriefing | null {
  const level = input.proactivityLevel ?? "balanced";
  if (level === "quiet") return null;

  if (input.items.length === 0) {
    if (level !== "assertive") return null;
    return {
      content:
        "Nothing is waiting on you right now — no approvals, escalations, or paused work. I'm watching this surface and will flag the next decision that needs you.",
      itemCount: 0,
    };
  }

  const prefix = surfacePrefixFromRouteContext(input.routeContext);
  const surfaceLocal = prefix === "/"
    ? []
    : input.items.filter((item) => item.deepLink.startsWith(prefix));
  const headline = surfaceLocal[0] ?? input.items[0];
  const remaining = input.items.length - 1;

  const headlineLink = `[${headline.title}](${headline.deepLink})`;
  const lines = [
    detailRestatesTitle(headline.title, headline.context)
      ? `**Most pressing:** ${headlineLink}`
      : `**Most pressing:** ${headlineLink} — ${headline.context}`,
  ];
  if (remaining > 0) {
    lines.push(
      `${remaining} more ${remaining === 1 ? "item is" : "items are"} waiting for your review → [open your Needs-you inbox](${ATTENTION_INBOX_ROUTE})`,
    );
  }

  return { content: lines.join("\n\n"), itemCount: input.items.length };
}

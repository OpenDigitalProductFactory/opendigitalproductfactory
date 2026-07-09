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

  const lines = [
    `**Most pressing:** [${headline.title}](${headline.deepLink}) — ${headline.context}`,
  ];
  if (remaining > 0) {
    lines.push(
      `${remaining} more ${remaining === 1 ? "item is" : "items are"} waiting for your review → [open your Needs-you inbox](${ATTENTION_INBOX_ROUTE})`,
    );
  }

  return { content: lines.join("\n\n"), itemCount: input.items.length };
}

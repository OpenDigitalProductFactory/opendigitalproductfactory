import type { ChatMessage } from "../ai-inference";
import { summarizeDroppedMessages } from "./compaction-digest";
import { resolveToolResultCharCap } from "./tool-result-budget";

// apps/web/lib/tak/context-pressure.ts
//
// Context pressure and bounded history assembly for the agentic loop.
//
// Large models degrade once their context fills past a model-specific band (the
// "dumb zone") — but the loop never measured how full the assembled prompt was,
// so drift into that band was silent. This estimates the assembled prompt's
// token load (~chars/4, matching the codebase's other estimators) and bands it
// into a heuristic pressure zone for per-dispatch logging.
//
// The pressure gauge reports estimated fill; compactAgenticMessages applies
// the existing history limits and retains bounded governed evidence. The loop is
// model-agnostic at its layer — the routing pipeline resolves the concrete
// model + context window below it — so the thresholds are heuristic,
// model-agnostic hints, NOT hard limits. A follow-up can thread the resolved
// model's real maxContextTokens for a precise ratio-of-window signal.
//
// No I/O; the assembly and gauge are tested without invoking inference.
//
// From the 2026-06-19 agent-architecture review (dumb-zone observability).

/**
 * Minimal structural shape of a chat message. Declared locally (rather than
 * importing ChatMessage) so this module stays free of the loop's import graph
 * and remains trivially unit-testable. ChatMessage is structurally assignable.
 */
export type ContextMessageLike = {
  role?: string;
  content?: unknown;
  toolCalls?: unknown[] | null;
};

export type ContextPressureZone = "sharp" | "warning" | "dumb";

export type ContextPressure = {
  estimatedTokens: number;
  zone: ContextPressureZone;
};

// Heuristic, model-agnostic dumb-zone hints in estimated tokens — NOT hard
// limits, and deliberately conservative so the gauge flags genuinely large
// contexts without crying wolf on frontier models. Tunable; a precise
// per-model ratio is a tracked follow-up.
export const CONTEXT_WARNING_ZONE_TOKENS = 100_000;
export const CONTEXT_DUMB_ZONE_TOKENS = 180_000;

// When the real model context window IS known (BI-9679EB1A), band by ratio-of-
// window instead of the absolute hints above — a 0.85-full 200k model is in the
// dumb zone, a 0.19-full 1M model is not. Tunable.
export const CONTEXT_WARNING_ZONE_RATIO = 0.6;
export const CONTEXT_DUMB_ZONE_RATIO = 0.8;

// Fraction of the real window devoted to RETAINED HISTORY (the rest covers the
// system prompt, tool schemas, the current turn, and output headroom). Used to
// size compaction caps from the real window — never BELOW today's floor, so the
// known-window path is strictly non-regressive.
const HISTORY_WINDOW_FRACTION = 0.5;
const AVG_TOKENS_PER_MSG = 750;

/**
 * Rough token estimate (~chars/4) for the assembled prompt actually sent to the
 * model this dispatch: the system prompt plus every message's content, plus any
 * assistant tool-call payloads. Pure.
 */
export function estimateContextTokens(
  messages: readonly ContextMessageLike[],
  systemPrompt: string,
): number {
  let chars = systemPrompt.length;
  for (const m of messages) {
    chars +=
      typeof m.content === "string"
        ? m.content.length
        : JSON.stringify(m.content ?? "").length;
    if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
      chars += JSON.stringify(m.toolCalls).length;
    }
  }
  return Math.ceil(chars / 4);
}

/**
 * Band an estimated token load into a dumb-zone pressure zone. Pure.
 *
 * When `maxContextTokens` is a known positive window, band by ratio-of-window
 * (precise per-model signal); otherwise fall back to the absolute, model-
 * agnostic hints. The param is optional, so existing call sites are unchanged.
 */
export function classifyContextPressure(
  estimatedTokens: number,
  maxContextTokens?: number | null,
): ContextPressure {
  const win = typeof maxContextTokens === "number" && maxContextTokens > 0 ? maxContextTokens : 0;
  let zone: ContextPressureZone;
  if (win > 0) {
    const ratio = estimatedTokens / win;
    zone =
      ratio >= CONTEXT_DUMB_ZONE_RATIO ? "dumb" : ratio >= CONTEXT_WARNING_ZONE_RATIO ? "warning" : "sharp";
  } else {
    zone =
      estimatedTokens >= CONTEXT_DUMB_ZONE_TOKENS
        ? "dumb"
        : estimatedTokens >= CONTEXT_WARNING_ZONE_TOKENS
          ? "warning"
          : "sharp";
  }
  return { estimatedTokens, zone };
}

export type CompactionCaps = {
  /** Max history messages retained (besides the always-kept first message). */
  maxHistory: number;
  /** Per-tool-result char cap. */
  toolCap: number;
  /** Per-text-message char cap. */
  textCap: number;
};

// EP-27FD96BC · P2 (BI-3C8220ED) — overload→trim feedback. The measured pressure
// zone tightens the window-derived history budget so an already-overloaded turn
// trims HARDER instead of only logging the overload. Never trims below `floor`.
// `sharp`/undefined = 1.0 (byte-for-byte the prior behavior — the regression guard).
const ZONE_TRIM_MULTIPLIER: Record<ContextPressureZone, number> = {
  sharp: 1.0,
  warning: 0.6,
  dumb: 0.4,
};

/**
 * Size the agentic loop's compaction caps from the real model window when known
 * (BI-9679EB1A), clamped to NEVER go below today's `floor`. Pure.
 *
 * Invariant: an unknown / non-positive window returns `floor` exactly (byte-for-
 * byte identical to pre-window behavior), and any known window only ever RAISES
 * a cap above the floor. So a frontier model retains more history; a small/local
 * model and the first dispatch (window not yet learned) are unchanged.
 *
 * When a live pressure `zone` is supplied (BI-3C8220ED), the window-derived
 * budget is scaled down for `warning`/`dumb` so a turn measured to be
 * overloaded trims harder — still never below `floor`, and identical to before
 * when the zone is `sharp` or omitted.
 */
export function deriveCompactionCaps(
  maxContextTokens: number | null | undefined,
  floor: CompactionCaps,
  zone?: ContextPressureZone,
): CompactionCaps {
  const win = typeof maxContextTokens === "number" && maxContextTokens > 0 ? maxContextTokens : 0;
  if (win === 0) return floor;
  const trim = zone ? ZONE_TRIM_MULTIPLIER[zone] : 1;
  const historyTokenBudget = Math.floor(win * HISTORY_WINDOW_FRACTION * trim);
  const historyBudgetChars = historyTokenBudget * 4;
  const maxHistory = Math.max(floor.maxHistory, Math.floor(historyTokenBudget / AVG_TOKENS_PER_MSG));
  const perMsgChars = Math.floor(historyBudgetChars / Math.max(1, maxHistory));
  const textCap = Math.max(floor.textCap, perMsgChars);
  const toolCap = Math.max(floor.toolCap, Math.floor(perMsgChars / 2));
  return { maxHistory, toolCap, textCap };
}

const MAX_AGENTIC_HISTORY_MESSAGES = 24;
const MAX_TOOL_RESULT_CHARS = 1_500;
const MAX_TEXT_MESSAGE_CHARS = 4_000;

function truncateMessageContent(content: string, maxChars: number, label: string): string {
  if (content.length <= maxChars) return content;
  const omitted = content.length - maxChars;
  const suffix = `\n...[truncated ${omitted} chars of earlier ${label}]`;
  return `${content.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

export function compactAgenticMessages(
  messages: ChatMessage[],
  maxContextTokens?: number | null,
  zone?: import("./context-pressure").ContextPressureZone,
  evidenceReaderNames: readonly string[] = [],
): ChatMessage[] {
  // BI-9679EB1A: size the caps from the real model window when known, never
  // below today's floor. Unknown window (incl. iteration 0) -> floor exactly,
  // so the unknown-window path is byte-for-byte identical to before.
  // BI-3C8220ED: a live overload `zone` tightens the trim (never below floor).
  const caps = deriveCompactionCaps(maxContextTokens, {
    maxHistory: MAX_AGENTIC_HISTORY_MESSAGES,
    toolCap: MAX_TOOL_RESULT_CHARS,
    textCap: MAX_TEXT_MESSAGE_CHARS,
  }, zone);
  let scopedMessages: ChatMessage[];
  if (messages.length <= caps.maxHistory) {
    scopedMessages = messages;
  } else {
    // R9a (P11): the middle of a long turn is dropped entirely. Before
    // discarding it, distill its TOOL ACTIVITY into a one-line digest — zero
    // inference, because the local-first single-GPU path can't afford a
    // summarization call — and re-insert it right after message[0] so "what was
    // already tried / what failed" survives compaction instead of being silently
    // lost (which lets the model repeat completed work or re-hit a known fail).
    const dropped = messages.slice(1, messages.length - (caps.maxHistory - 1));
    const digest = summarizeDroppedMessages(dropped);
    const tail = messages.slice(-(caps.maxHistory - 1));
    scopedMessages = digest
      ? [messages[0]!, { role: "assistant" as const, content: `[System notice] ${digest}` }, ...tail]
      : [messages[0]!, ...tail];
  }

  const retainedToolCallIds = new Set(
    scopedMessages.flatMap((message) =>
      message.role === "assistant" && message.toolCalls
        ? message.toolCalls.map((toolCall) => toolCall.id)
        : [],
    ),
  );
  const evidenceCallIds = new Set(scopedMessages.flatMap((message) =>
    (message.toolCalls ?? []).filter((call) => evidenceReaderNames.includes(call.name)).map((call) => call.id)));

  return scopedMessages
    .filter((message) =>
      message.role !== "tool" ||
      !message.toolCallId ||
      retainedToolCallIds.has(message.toolCallId),
    )
    .map((message) => {
      if (typeof message.content !== "string") return message;
      if (message.role === "tool") {
        return {
          ...message,
          // A governed reviewer must judge the bounded page it just read, not
          // a second 1,500-character prefix. Reuse the model-facing budget;
          // the terminal policy independently bounds the number of reads.
          content: truncateMessageContent(message.content,
            evidenceCallIds.has(message.toolCallId ?? "") ? resolveToolResultCharCap(maxContextTokens) : caps.toolCap,
            "tool output"),
        };
      }
      return {
        ...message,
        content: truncateMessageContent(message.content, caps.textCap, "message context"),
      };
    });
}

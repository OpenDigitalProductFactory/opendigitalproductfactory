/**
 * BI-08CE1ADF (EP-F7E35344 — AI Coworker Capability Inputs).
 *
 * A cheap, deterministic task classifier — DPF's analogue of Perplexity's
 * "Best" auto-router. Today a request's quality posture (reasoning depth →
 * the cost-per-success quality floor) is *caller-declared* via taskType, and
 * the very common default taskType `"conversation"` maps to nothing, so it
 * falls through to a blanket "medium". The result: a one-word greeting and a
 * multi-step refactor route with the same floor.
 *
 * This module infers complexity from the prompt CONTENT (no extra LLM call —
 * pure heuristics, so it is free and fully unit-testable). `inferContract`
 * uses it ONLY as the fallback when the task type carries no declared reasoning
 * depth, so every mapped task type and every explicit caller posture is
 * unchanged. The heuristics are intentionally conservative: only a clear
 * trivial signal lowers the floor, only a clear complex signal raises it,
 * everything else stays "medium".
 *
 * A future upgrade can swap the heuristic for a Haiku-class classification call
 * behind the same `classifyTask` signature without touching callers.
 */

export type TaskComplexity = "trivial" | "standard" | "complex";

export type TaskArchetype =
  | "greeting"
  | "status"
  | "lookup"
  | "generation"
  | "analysis"
  | "general";

export interface TaskClassification {
  complexity: TaskComplexity;
  reasoningDepth: "minimal" | "low" | "medium" | "high";
  archetype: TaskArchetype;
  /** Human-readable reasons, for routing observability. */
  signals: string[];
}

// Pure greeting / acknowledgement — nothing to reason about.
const GREETING_RE =
  /^(?:hi|hey|hello|yo|howdy|good (?:morning|afternoon|evening)|thanks?|thank you|thx|ok(?:ay)?|cool|great|got it|sounds good|nice|perfect|cheers)[\s!.]*$/i;

// Short status / lookup asks — shallow retrieval, not deep reasoning.
const STATUS_RE =
  /\b(?:status|what'?s the status|any update|is it (?:done|ready|up)|list|show me|what are|how many|when (?:is|does|did)|where is)\b/i;

// Markers of genuinely complex, multi-step work that warrant a stronger model.
const COMPLEX_RE =
  /\b(?:step[- ]by[- ]step|step \d|architect(?:ure|ural)?|design (?:a|the|doc)|refactor|migrat(?:e|ion)|investigat(?:e|ion)|root cause|debug|trace through|analy[sz]e|compare (?:and|the)|trade[- ]?offs?|implement(?:ation)?|end[- ]to[- ]end|comprehensive|in depth|reason through|prove|derive|optimi[sz]e|plan (?:out|the|a)|break (?:this|it) down|multi[- ]step)\b/i;

// Generation verbs — writing/building substantial output (default standard).
const GENERATION_RE =
  /\b(?:write|generate|create|build|draft|compose|produce|code|script|function|component)\b/i;

// Code / diff fences strongly imply non-trivial work.
const CODE_BLOCK_RE = /```|^\s*(?:diff --git|@@ |[+-]{3} )/m;

const LONG_INPUT_CHARS = 1500;
const SHORT_INPUT_CHARS = 60;

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join(" ");
  }
  return "";
}

function depthFor(complexity: TaskComplexity, archetype: TaskArchetype): TaskClassification["reasoningDepth"] {
  if (complexity === "complex") return "high";
  if (complexity === "trivial") return archetype === "greeting" ? "minimal" : "low";
  return "medium";
}

/**
 * Classify a request from its messages. Examines the latest user message (the
 * actual ask) plus total input size. Pure and synchronous.
 */
export function classifyTask(messages: Array<{ role: string; content: unknown }>): TaskClassification {
  const userTexts = messages.filter((m) => m.role === "user").map((m) => messageText(m.content));
  const latest = (userTexts[userTexts.length - 1] ?? "").trim();
  const totalChars = messages.reduce((sum, m) => sum + messageText(m.content).length, 0);
  const signals: string[] = [];

  // ── Trivial: pure greeting / acknowledgement ──────────────────────────
  if (latest.length > 0 && latest.length <= 40 && GREETING_RE.test(latest)) {
    return { complexity: "trivial", reasoningDepth: "minimal", archetype: "greeting", signals: ["greeting"] };
  }

  const hasCode = CODE_BLOCK_RE.test(latest);
  const isComplexLang = COMPLEX_RE.test(latest);
  const isLong = totalChars >= LONG_INPUT_CHARS;
  const isShort = latest.length > 0 && latest.length <= SHORT_INPUT_CHARS;
  const isStatus = STATUS_RE.test(latest);
  const questionCount = (latest.match(/\?/g) ?? []).length;

  // ── Complex: explicit complex language, code/diffs, very long, or many asks ─
  if (isComplexLang) signals.push("complex-language");
  if (hasCode) signals.push("code-or-diff");
  if (isLong) signals.push("long-input");
  if (questionCount >= 3) signals.push("multi-question");
  if (isComplexLang || hasCode || isLong || questionCount >= 3) {
    const archetype: TaskArchetype = isComplexLang || hasCode ? "analysis" : "general";
    return { complexity: "complex", reasoningDepth: "high", archetype, signals };
  }

  // ── Trivial: short status / lookup ────────────────────────────────────
  if (isStatus && isShort) {
    return { complexity: "trivial", reasoningDepth: "low", archetype: "status", signals: ["short-status"] };
  }
  if (isStatus) {
    return { complexity: "standard", reasoningDepth: "medium", archetype: "lookup", signals: ["status-lookup"] };
  }

  // ── Standard: everything else ─────────────────────────────────────────
  const archetype: TaskArchetype = GENERATION_RE.test(latest) ? "generation" : "general";
  signals.push("default-standard");
  return { complexity: "standard", reasoningDepth: depthFor("standard", archetype), archetype, signals };
}

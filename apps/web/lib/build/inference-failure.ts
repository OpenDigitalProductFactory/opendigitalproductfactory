/**
 * BI-F0005EB0 (EP-BS-UX-HARDENING) — shared classifier for "the AI call itself
 * failed" turns.
 *
 * When a Build Studio ideate/scout inference fails, the failure currently lands
 * in the conversation as an ordinary `assistant` AgentMessage — either the raw
 * provider/CLI error verbatim (the live repro:
 * `API Error: Unable to connect to API (ConnectionRefused)`) or one of the
 * friendly strings `describeToolRouteFailure` emits. Both leave the build
 * stalled in `ideate`, mis-classified by the custodian as the benign
 * "Waiting on evidence" state.
 *
 * This module is the single source of truth for "is this message content an
 * inference failure, and of what kind". It is consumed at three layers:
 *   1. progress-visibility — expose an `inferenceFailure` signal off the newest
 *      assistant turn.
 *   2. build-studio-workflow-actions / custodian — surface a danger
 *      "Retry the AI call" affordance instead of "Waiting on evidence".
 *   3. agent-coworker persist-time — sanitize the raw provider string and drive
 *      bounded auto-retry for transient kinds.
 *
 * Matching is deliberately CONSERVATIVE — anchored / whole-phrase patterns, not
 * loose substring hunts — so a legitimate assistant reply that merely mentions
 * the word "error" is never misread as a failed inference. Every pattern here is
 * grounded in a real emitter: the raw provider/CLI forms, and the exact copy in
 * describeToolRouteFailure (agentic-loop.ts) + the empty-response fallbacks in
 * agent-coworker.ts / agentic-loop.ts.
 */

export type InferenceFailureKind =
  | "connection"           // ConnectionRefused / ECONNREFUSED / "Unable to connect to API"
  | "rate-limit"           // paid providers briefly unavailable / momentarily busy
  | "provider-unavailable" // generic "temporarily unavailable"
  | "config"               // no credential / no eligible tool-capable endpoint configured
  | "empty-response";      // model returned nothing usable

/** Kinds where an immediate bounded retry is worth attempting (transient). */
export const TRANSIENT_INFERENCE_FAILURE_KINDS: readonly InferenceFailureKind[] = [
  "connection",
  "rate-limit",
  "provider-unavailable",
];

export function isTransientInferenceFailure(kind: InferenceFailureKind | null): boolean {
  return kind != null && TRANSIENT_INFERENCE_FAILURE_KINDS.includes(kind);
}

type Matcher = { kind: InferenceFailureKind; test: RegExp };

// Ordered most-specific → least-specific. First match wins, so the raw
// connection signatures and the exact friendly strings are checked before the
// broad "temporarily unavailable" catch-all.
const MATCHERS: Matcher[] = [
  // ── Raw provider / CLI connection errors ─────────────────────────────────
  // Live repro: "API Error: Unable to connect to API (ConnectionRefused)".
  { kind: "connection", test: /unable to connect to (?:the )?api/i },
  { kind: "connection", test: /connection\s*refused/i },
  { kind: "connection", test: /\bECONNREFUSED\b/ },
  { kind: "connection", test: /\bECONNRESET\b/ },
  { kind: "connection", test: /^\s*(?:API Error:\s*)?fetch failed\b/i },
  { kind: "connection", test: /network (?:error|timeout|unreachable)/i },

  // ── describeToolRouteFailure friendly outputs (agentic-loop.ts) ───────────
  // "Your paid AI providers (such as Claude or GPT) are briefly unavailable…"
  { kind: "rate-limit", test: /paid AI providers.*(?:briefly|momentarily) unavailable/i },
  // "The AI providers are momentarily busy (usually rate-limited or overloaded)…"
  { kind: "rate-limit", test: /AI providers are momentarily busy/i },
  { kind: "rate-limit", test: /\brate[- ]limit(?:ed|s)?\b/i },
  // "No AI provider credentials are configured for this feature…"
  { kind: "config", test: /No AI provider credentials are configured/i },
  // "No AI model that supports tools is active right now…"
  { kind: "config", test: /No AI model that supports tools is active/i },
  // agent-coworker NoProvidersAvailableError system copy / generic config gap.
  { kind: "config", test: /No AI providers are configured/i },
  { kind: "config", test: /No eligible AI endpoints/i },
  // describeToolRouteFailure generic no-endpoint copy. This is emitted after
  // routing rejects every candidate for a mixed set of reasons (for example
  // sensitivity clearance + model tier), so no model response occurred.
  { kind: "config", test: /^No AI model can handle this request right now\./i },
  // "The AI provider is temporarily unavailable. Please try again…" (fallback)
  { kind: "provider-unavailable", test: /AI provider is temporarily unavailable/i },
  { kind: "provider-unavailable", test: /AI (?:co-?workers?|providers?) are temporarily offline/i },

  // ── Empty / unusable model responses ─────────────────────────────────────
  // agent-coworker.ts quality gate: "**Unable to process this request.** …"
  { kind: "empty-response", test: /^\s*\*?\*?Unable to process this request/i },
  // agentic-loop.ts: "The model (X) returned an empty response and did not use any tools…"
  { kind: "empty-response", test: /returned an empty response and did not use any tools/i },
];

/**
 * Classify a persisted assistant-turn `content` string. Returns the failure
 * kind, or `null` when the content is a normal (non-failure) response.
 *
 * NOTE: deterministic context-overflow copy ("conversation is too long",
 * "too large for the active AI model's context window") is intentionally NOT
 * matched — a plain retry cannot fix it, so offering "Retry the AI call" there
 * would mislead. Those turns keep their own guidance path.
 */
export function classifyInferenceFailure(content: string | null | undefined): InferenceFailureKind | null {
  if (typeof content !== "string") {
    return null;
  }
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }
  for (const matcher of MATCHERS) {
    if (matcher.test.test(trimmed)) {
      return matcher.kind;
    }
  }
  return null;
}

// Raw machine-error signatures that must NEVER be shown to a user verbatim.
// These are the shapes a provider SDK / local CLI emits directly — distinct from
// the intentional, already-friendly copy describeToolRouteFailure produces. The
// persist-time guard rewrites only these; it leaves curated copy untouched.
const RAW_PROVIDER_ERROR_PATTERNS: RegExp[] = [
  /^\s*API Error:/i,
  /unable to connect to (?:the )?api/i,
  /connection\s*refused/i,
  /\bECONNREFUSED\b/,
  /\bECONNRESET\b/,
  /\bETIMEDOUT\b/,
  /\bENOTFOUND\b/,
  /^\s*(?:API Error:\s*)?fetch failed\b/i,
  /\b(?:HTTP\s*)?(?:4\d\d|5\d\d)\b.*\b(?:error|too many requests|internal server|bad gateway|service unavailable|gateway timeout)\b/i,
  /\bToo Many Requests\b/i,
];

/**
 * True when `content` looks like a raw provider/CLI machine error that should be
 * hidden from the user (and replaced with friendly copy) rather than persisted
 * as a visible assistant message. Curated friendly strings return false.
 */
export function isRawProviderError(content: string | null | undefined): boolean {
  if (typeof content !== "string") {
    return false;
  }
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }
  return RAW_PROVIDER_ERROR_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * User-facing, provider-detail-free copy for a failed inference turn. Used both
 * to replace the raw persisted string (so a non-technical user never sees
 * `API Error: …`) and to render the custodian/action details. Never leaks the
 * raw provider error — that stays in server logs for engineers.
 */
export function friendlyInferenceFailureMessage(kind: InferenceFailureKind): string {
  switch (kind) {
    case "connection":
      return "The AI service could not be reached, so this response did not complete. This is usually a brief connection hiccup — retry to try the request again.";
    case "rate-limit":
      return "The AI providers are briefly busy (usually a short rate-limit that clears within a minute). Retry in a moment to try again.";
    case "provider-unavailable":
      return "The AI provider is temporarily unavailable. Retry to try the request again — no setup change is needed.";
    case "config":
      return "No AI provider is available to handle this request. An administrator can connect one in Platform › AI › Providers & Routing, then you can retry.";
    case "empty-response":
      return "The AI model returned an empty response. Retry to try the request again; if it keeps happening, a different model or provider may be needed.";
  }
}

// apps/web/lib/build/inference-failure.ts
//
// BI-F0005EB0 — one canonical home for "did an AI inference turn fail?" so the
// WRITE side (don't persist raw provider errors) and the READ side (detect a
// failed turn and surface an honest danger state) cannot drift.
//
// Why a content classifier (not a DB flag): a failed ideate/scout turn most
// often manifests AS content — a provider returns the error string as its
// completion, or the ideate-research branch interpolates the raw error into the
// assistant message. There is no exception to hang a status column on, and
// AgentMessage has no error field. This module recognizes failure by signature,
// and (d) makes every NEW failure use CANONICAL_INFERENCE_FAILURE_MESSAGE, which
// the same classifier also recognizes — so detection covers both legacy raw rows
// and forward-going sanitized ones with no migration.

/** The single user-facing message the persist path substitutes for a raw
 *  provider error. Honest, non-alarming, and retry-oriented. The custodian
 *  surfaces the actual Retry affordance; this is the chat-panel breadcrumb. */
export const CANONICAL_INFERENCE_FAILURE_MESSAGE =
  "⚠️ The AI didn't respond just now — the request to the AI provider didn't go through. " +
  "This is usually a brief connection hiccup, not something you did. Use Retry to try again.";

/**
 * Signatures of an inference/provider failure that leaked into assistant
 * content. Anchored where possible (`^API Error:`) so a message that merely
 * *mentions* one of these words in normal prose is not misclassified. The
 * canonical message is matched separately (by identity/substring) below.
 */
export const INFERENCE_FAILURE_SIGNATURES: readonly RegExp[] = [
  /\bConnectionRefused\b/i,
  /\bECONNREFUSED\b/i,
  /Unable to connect to (?:the )?API/i,
  /^\s*API Error:/i,
  /All endpoints failed/i,
  /No endpoint available/i,
  /No eligible endpoints/i,
];

/** A short, stable phrase from the canonical message used to recognize our own
 *  sanitized rows without depending on the exact emoji/whitespace. */
const CANONICAL_FINGERPRINT = "the request to the AI provider didn't go through";

/** True when a stored assistant message content IS an inference failure (a raw
 *  provider error that leaked, or our canonical sanitized message). */
export function isInferenceFailureContent(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (t.includes(CANONICAL_FINGERPRINT)) return true;
  return INFERENCE_FAILURE_SIGNATURES.some((re) => re.test(t));
}

export type SanitizedAssistantContent = {
  /** What to persist: the canonical message when the input was a failure, else the input. */
  content: string;
  /** True when the input was classified as an inference failure and rewritten. */
  wasFailure: boolean;
  /** A trimmed excerpt of the original raw error, for observability — never shown as chat. */
  errorExcerpt: string | null;
};

/**
 * (d) Never persist a raw provider error as user-visible assistant content.
 * If `raw` is an inference failure, return the canonical message plus an excerpt
 * of the original (for logs/detection), else pass the content through unchanged.
 */
export function sanitizeAssistantContent(raw: string | null | undefined): SanitizedAssistantContent {
  const original = raw ?? "";
  if (!isInferenceFailureContent(original)) {
    return { content: original, wasFailure: false, errorExcerpt: null };
  }
  // Already our canonical message → keep it, but still flag as a failure turn.
  const alreadyCanonical = original.includes(CANONICAL_FINGERPRINT);
  return {
    content: CANONICAL_INFERENCE_FAILURE_MESSAGE,
    wasFailure: true,
    errorExcerpt: alreadyCanonical ? null : original.trim().slice(0, 240),
  };
}

export type FailedInferenceTurn = {
  errorExcerpt: string | null;
  observedAt: string | null;
};

export type InferenceTurnMessage = {
  role: string | null;
  content: string | null;
  createdAt: Date | string | null;
};

/**
 * (a) Detect a failed-inference turn: true iff the MOST RECENT assistant message
 * is an inference failure. `messages` are expected newest-first (as loaded by
 * getBuildProgressVisibility). A newer successful assistant turn ⇒ the failure
 * was recovered ⇒ returns null.
 */
export function detectFailedInferenceTurn(
  messages: readonly InferenceTurnMessage[],
): FailedInferenceTurn | null {
  const lastAssistant = messages.find((m) => m.role === "assistant" && (m.content ?? "").trim() !== "");
  if (!lastAssistant) return null;
  if (!isInferenceFailureContent(lastAssistant.content)) return null;
  return {
    errorExcerpt: (lastAssistant.content ?? "").trim().slice(0, 240),
    observedAt: normalizeObservedAt(lastAssistant.createdAt),
  };
}

function normalizeObservedAt(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

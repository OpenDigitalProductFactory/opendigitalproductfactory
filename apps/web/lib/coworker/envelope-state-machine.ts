// Pseudo-User Contract (spec §6.4 + §6.5) — CoworkerActionEnvelope state
// machine. Pure functions; no DB I/O lives here so the rules are
// independently testable and reusable from the API routes, the chat
// handler, and the future screen_propose_action handler refactor.
//
// Envelope lifecycle:
//
//   proposed ──approve──> approved ──execute──> executed
//        │                                     ╲
//        │                                      ╲──fail──> failed
//        ├──deny──> declined
//        └──cancel──> cancelled       (e.g. user navigated away, turn ended)
//
// The legal-transition table below is the canonical source of truth. The
// schema (BI-D887CD3B) keeps `status` as a plain TEXT column because the
// CHECK constraint was deliberately deferred here (commit on BI-D887CD3B);
// the state machine enforces the same invariant in application code,
// which is the layer where a useful error message can be produced.
//
// BI-0F9C291C / EP-COWORKER-INTERACTIVITY.

/** The closed enum of envelope statuses. Matches the schema string column
 *  and the spec §6.4 lifecycle. */
export type EnvelopeStatus =
  | "proposed"
  | "approved"
  | "declined"
  | "executed"
  | "failed"
  | "cancelled";

/** All valid statuses, exposed for runtime validation (e.g. when reading a
 *  row that might predate a future schema migration). */
export const ENVELOPE_STATUSES: readonly EnvelopeStatus[] = [
  "proposed",
  "approved",
  "declined",
  "executed",
  "failed",
  "cancelled",
] as const;

/** Terminal statuses — an envelope in one of these never transitions
 *  again. Used by callers that want to short-circuit (e.g. "this envelope
 *  is settled, no need to re-render the approval card"). */
export const TERMINAL_STATUSES: readonly EnvelopeStatus[] = [
  "declined",
  "executed",
  "failed",
  "cancelled",
] as const;

/** Legal transitions. The KEY is the current status; the VALUE is the
 *  set of statuses we can move to. */
const TRANSITIONS: Readonly<Record<EnvelopeStatus, readonly EnvelopeStatus[]>> = {
  proposed: ["approved", "declined", "cancelled"],
  approved: ["executed", "failed", "cancelled"],
  declined: [],
  executed: [],
  failed: [],
  cancelled: [],
};

/** True when `to` is reachable from `from` via a single transition. */
export function canTransition(from: EnvelopeStatus, to: EnvelopeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** True when the envelope is in a terminal status. */
export function isTerminal(status: EnvelopeStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Narrow guard: is the unknown string a valid EnvelopeStatus? Useful
 *  when reading raw DB rows or untrusted input. */
export function isEnvelopeStatus(value: unknown): value is EnvelopeStatus {
  return typeof value === "string" && (ENVELOPE_STATUSES as readonly string[]).includes(value);
}

// ─── Transition outcomes ─────────────────────────────────────────────────────

/** Discriminated union returned by transition helpers. Lets callers
 *  distinguish "you can move ahead" from "the state machine refused this
 *  transition" without exception handling. */
export type TransitionResult =
  | { ok: true; from: EnvelopeStatus; to: EnvelopeStatus }
  | { ok: false; reason: TransitionError; from: EnvelopeStatus; attemptedTo: EnvelopeStatus };

export type TransitionError =
  | "unknown_status" // input wasn't a valid EnvelopeStatus (corrupt row?)
  | "already_terminal" // current status is terminal — no further changes allowed
  | "illegal_transition"; // current status is valid, but `to` isn't reachable from it

/** Validate a proposed transition without applying it. Use this when the
 *  caller already has the envelope's status in hand (e.g. after a Prisma
 *  read) and wants a yes/no with a structured error. */
export function checkTransition(
  from: EnvelopeStatus,
  to: EnvelopeStatus,
): TransitionResult {
  if (!isEnvelopeStatus(from)) {
    return { ok: false, reason: "unknown_status", from, attemptedTo: to };
  }
  if (!isEnvelopeStatus(to)) {
    return { ok: false, reason: "unknown_status", from, attemptedTo: to };
  }
  if (isTerminal(from)) {
    return { ok: false, reason: "already_terminal", from, attemptedTo: to };
  }
  if (!canTransition(from, to)) {
    return { ok: false, reason: "illegal_transition", from, attemptedTo: to };
  }
  return { ok: true, from, to };
}

// ─── Named transitions (semantic verbs the API routes use) ──────────────────
//
// These are convenience wrappers around checkTransition with the target
// status hardcoded. They mirror the verbs in the spec §6.4 (approve,
// deny/decline, cancel) and the verbs the underlying tool execution
// emits (execute → executed | failed). Pure — they don't write anything.

export function transitionOnApprove(from: EnvelopeStatus): TransitionResult {
  return checkTransition(from, "approved");
}

export function transitionOnDeny(from: EnvelopeStatus): TransitionResult {
  return checkTransition(from, "declined");
}

export function transitionOnCancel(from: EnvelopeStatus): TransitionResult {
  return checkTransition(from, "cancelled");
}

export function transitionOnExecutionSuccess(from: EnvelopeStatus): TransitionResult {
  return checkTransition(from, "executed");
}

export function transitionOnExecutionFailure(from: EnvelopeStatus): TransitionResult {
  return checkTransition(from, "failed");
}

/** Human-readable description for a transition error. Stable strings so
 *  test assertions can pin them; the API routes pass these straight back
 *  in the response body. */
export function describeTransitionError(result: TransitionResult): string | null {
  if (result.ok) return null;
  switch (result.reason) {
    case "unknown_status":
      return `Envelope status is not a recognised value (got ${JSON.stringify(result.from)}); cannot transition to ${JSON.stringify(result.attemptedTo)}.`;
    case "already_terminal":
      return `Envelope is already in a terminal status (${result.from}); no further transitions are allowed.`;
    case "illegal_transition":
      return `Envelope cannot transition from ${result.from} to ${result.attemptedTo}. Legal transitions from ${result.from}: ${TRANSITIONS[result.from].join(", ") || "(none)"}.`;
  }
}

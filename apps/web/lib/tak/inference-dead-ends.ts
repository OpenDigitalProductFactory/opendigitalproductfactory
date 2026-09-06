// apps/web/lib/tak/inference-dead-ends.ts
//
// The replies a coworker gives when no model answered (BI-33F1EA72).
//
// WHY THESE LIVE TOGETHER, AND HERE. Measured on the live install
// (2026-08-23, served b8777fbb1952): 196 of 1,138 assistant messages — 17.2% —
// were dead ends, and they were dominated by provider availability:
//
//     provider temporarily unavailable      114   58%
//     providers momentarily busy             50   26%
//     no eligible model / routing            19   10%
//     local model not strong enough          12    6%
//
// Rung 4 of the escalation ladder was originally wired only to the last of
// those — 6% of the problem — because that was the one string I had seen in a
// session log. The other 84% still ended on "Please try again in about 30
// seconds", which asks the user to poll and is the exact shape the rung exists
// to replace: it names a limitation and stops.
//
// Kept out of agentic-loop.ts because that file is the largest module in the
// repo and its size ratchet only permits shrinking; copy this length does not
// belong in that budget.
import { describeContextCapacityFailure } from "./context-capacity-failure";
import { buildHumanHandoff } from "./escalation-ladder";

/** Routing eliminated every candidate — a real configuration question. */
export function noEligibleModelHandoff(): string {
  return buildHumanHandoff({
    blocker:
      "No AI model can handle this request right now — no available model met this turn's requirements.",
    steps: [
      "Open Platform > AI Operations > Providers & Routing.",
      "Check the active route for this coworker: provider status, data-policy or residency limits, capability requirements, and context size.",
    ],
    verify: "re-check which models this coworker can reach",
  });
}

/**
 * Routing eliminated every candidate specifically because no connected provider
 * is cleared for this coworker's data sensitivity — the confidential-data fence
 * working as designed, not an outage (BI-431524DF). The generic "no eligible
 * model" copy sends the operator to re-check provider status, which is the wrong
 * advice here: the providers ARE connected and active; they are held back only
 * because a personal-subscription account carries no commercial no-training
 * guarantee. Name the two real levers instead — clear a business cloud account,
 * or provision a capable local model — and never imply a personal subscription
 * should be attested.
 */
export function sensitivityClearanceHandoff(sensitivity: string): string {
  return buildHumanHandoff({
    blocker:
      `This coworker handles ${sensitivity} work, and none of the connected AI providers are cleared for ` +
      `${sensitivity} data. Cloud providers such as Claude or GPT stay limited to public work until their ` +
      `account's data policy is reviewed — a personal subscription is deliberately not cleared for ${sensitivity} ` +
      `data, so ${sensitivity} content is never sent to a provider that might train on it. The built-in local ` +
      `model is cleared for it but is not strong enough for this request.`,
    steps: [
      `To let a cloud provider handle ${sensitivity} work: open Platform > AI Operations > Providers & Routing, ` +
      `and only on a genuine business or enterprise account with a no-training agreement, attest its data policy ` +
      `(mark it operator-attested, or upload the contract).`,
      `To keep ${sensitivity} work fully on-premises: configure a stronger local model that is cleared for ${sensitivity} data.`,
    ],
    verify: `re-check which models this coworker can reach for ${sensitivity} work`,
  });
}

/**
 * Endpoints exist but all transiently failed. Genuinely nothing to configure,
 * so the hand-off is one step — but it stays a hand-off, so the reply ends on
 * the user's next action rather than on the outage.
 */
export function providersBusyHandoff(): string {
  return buildHumanHandoff({
    blocker:
      "Every AI provider is busy right now — usually rate-limited or briefly overloaded. Nothing is misconfigured.",
    steps: ["Give it about 30 seconds, then send the message again."],
    verify: "pick this up on the next try",
  });
}

export function modelMissingHandoff(): string {
  return buildHumanHandoff({
    blocker: "The selected AI model is no longer available from its provider, so the platform could not answer this turn.",
    steps: ["Open Platform > AI Operations > Providers & Routing and refresh that provider's models."],
    verify: "re-check the available models and pick this straight back up",
  });
}

export function requiredTerminalWriterNotEnforceableHandoff(): string {
  return buildHumanHandoff({
    blocker:
      "None of the available AI adapters can enforce this task's required governed receipt writer, so inference was not started and no receipt was created.",
    steps: [
      "Activate or route this task to an AI provider adapter that supports required tool choice.",
    ],
    verify: "resume this same task with its unchanged evidence and record the governed receipt",
  });
}


/**
 * The local model is present and healthy, but a background job on this host
 * holds the capacity reservation (BI-A89E4827).
 *
 * This is the dead end that stranded the owner: on a turn routed at
 * `restricted` sensitivity the local model is the ONLY endpoint policy allows,
 * so a capacity deferral is not one failed candidate among several — it is the
 * whole chain. `callWithFallbackChain` rethrows the deferral verbatim in that
 * case, and before this branch existed it matched none of the classifier's
 * patterns and fell through to `providerUnreachableHandoff`, which told the
 * owner to reconnect a provider. Every cloud provider was connected and
 * healthy; none of them was eligible. Reconnecting one could not have helped,
 * so the hand-off ended on a step that provably does nothing.
 *
 * The correct next action is to wait, and the correct thing to say is that
 * nothing is misconfigured — so this deliberately names NO settings surface.
 * Respects IDENTITY_BLOCK rule #5: no lease names, reason codes, or job ids.
 */
/**
 * "about 3 minutes" from a lease expiry, or null when there is nothing useful
 * to say (BI-94D44FDB).
 *
 * Deliberately RELATIVE rather than a clock time: the reply is read in the
 * owner's browser and the window is short, so "a couple of minutes" is both
 * more useful and free of any timezone question. `now` is injected so the
 * behaviour is pinned by tests rather than by the wall clock.
 */
export function describeCapacityWindow(
  expectedFreeAt: Date | null | undefined,
  now: Date,
): string | null {
  if (!(expectedFreeAt instanceof Date) || Number.isNaN(expectedFreeAt.getTime())) return null;
  const remainingMs = expectedFreeAt.getTime() - now.getTime();
  // A window already past, or implausibly far out, tells the owner nothing
  // trustworthy — better to say the honest generic thing than a wrong number.
  if (remainingMs <= 0 || remainingMs > 30 * 60_000) return null;
  const minutes = Math.max(1, Math.round(remainingMs / 60_000));
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}

export function localCapacityHeldHandoff(
  unprovenCapacity = false,
  expectedFreeAt: Date | null = null,
  now: Date = new Date(),
): string {
  const window = describeCapacityWindow(expectedFreeAt, now);
  return buildHumanHandoff({
    blocker: unprovenCapacity
      ? "I couldn't confirm the local AI model was free to use, so I held off rather than risk disrupting something else running on this machine. Nothing is misconfigured."
      : "The only AI model allowed to handle this request is tied up with a background job on this machine, so I couldn't answer. Nothing is misconfigured.",
    steps: [
      // BI-EBE25715: `expectedFreeAt` is ONE lease's expiry, not the time until
      // the host is actually free. When other claims are waiting behind it the
      // reservation is re-taken the moment it clears, so "send again in about
      // two minutes" reads as a promise the platform cannot keep — observed on
      // a host running 9-46 queued claims, where the same turn was refused for
      // over an hour on that advice. Name the window as the earliest it COULD
      // free, and say plainly that it depends on what else is queued.
      window
        ? `Send the message again in ${window} at the earliest — sooner only if nothing else is waiting for this machine.`
        : "It frees up when that job finishes. I can't tell from here how long that will be, so send the message again when you want me to retry.",
    ],
    verify: "check whether it has freed up",
  });
}

/**
 * Nothing above matched, so we do not know why (BI-A89E4827).
 *
 * The earlier copy asserted a cause — "an expired sign-in or exhausted quota is
 * the usual cause" — on the strength of a population measurement (114 of 196
 * dead ends were provider-unavailable, BI-33F1EA72). That is a fact about the
 * population, not about the turn in front of us, and this branch is by
 * construction the one that matched nothing. Stating it as the cause is the
 * failure mode `Never Fabricate` names: a confident diagnosis with no evidence
 * behind it, which sent the owner to a settings page that could not help.
 *
 * The population prior is still the best first thing to CHECK. It is offered as
 * a check, and the reply says plainly that the cause is not known from here.
 */
export function unexplainedDeadEndHandoff(): string {
  return buildHumanHandoff({
    blocker: "I couldn't get an answer from any AI model just now, and I can't tell from here what stopped it.",
    steps: [
      "Open Platform > AI Operations > Providers & Routing.",
      "Check whether a provider needs reconnecting — the most common cause, though not the only one.",
    ],
    verify: "re-check what this coworker can reach and tell you what I find",
  });
}

/** True when `error` is a local host-capacity deferral, however it reached us.
 *
 * Matched by NAME rather than by importing `LocalProviderCapacityDeferredError`,
 * for the reason `dispatch-failure-class.ts` documents: a shared module that
 * reaches into routing internals is how promoter-only code got dragged into the
 * web bundle (BI-76651B7B). The name check also survives the error crossing a
 * queue boundary, and the message fallback covers a deferral that arrives as a
 * plain string with no type left on it.
 */
export function isLocalCapacityDeferral(error: unknown, message: string): boolean {
  const name = typeof error === "object" && error !== null && "name" in error
    ? (error as { name?: unknown }).name
    : undefined;
  return name === "LocalProviderCapacityDeferredError"
    || /Local provider dispatch deferred/i.test(message);
}

/**
 * The window the routing layer attached to a capacity deferral, if it survived.
 *
 * Read structurally rather than by importing the error class, for the same
 * bundle reason as isLocalCapacityDeferral above. Absent when the error crossed
 * a boundary that kept only its message.
 */
function readExpectedFreeAt(error: unknown): Date | null {
  if (typeof error !== "object" || error === null || !("expectedFreeAt" in error)) return null;
  const value = (error as { expectedFreeAt?: unknown }).expectedFreeAt;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function isRequiredTerminalWriterNotEnforceable(error: unknown, message: string): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === "required_terminal_writer_not_enforceable") return true;
  const marker = /required[_-]terminal[_-]writer[_-]not[_-]enforceable/i;
  if (!marker.test(message)) return false;
  if (!/^All endpoints failed/i.test(message)) return true;
  const serializedAttempts = /Attempts:\s*(\[.*\])\s*$/s.exec(message)?.[1];
  if (!serializedAttempts) return false;
  try {
    const attempts = JSON.parse(serializedAttempts) as unknown;
    return Array.isArray(attempts)
      && attempts.length > 0
      && attempts.every((attempt) => {
        if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return false;
        const attemptError = (attempt as Record<string, unknown>)["error"];
        return typeof attemptError === "string" && marker.test(attemptError);
      });
  } catch {
    return false;
  }
}

/**
 * Plain-language, non-technical explanation for a turn that failed because
 * routing could not complete a tool-using call (BI-23E0714C).
 *
 * Lives here rather than in agentic-loop.ts for the reason at the top of this
 * file: that module is the largest in the repo and its size ratchet only
 * permits shrinking. It is re-exported from there so existing callers and tests
 * are unaffected.
 *
 * The classifier exists so a non-technical operator is never sent to fix config
 * that is already correct:
 *
 *  - REQUEST_TOO_LARGE  → context overflow; start a new thread.
 *  - local host capacity held → wait; touching provider settings cannot help.
 *  - No credential for ANY non-local provider → permanent config gap; point to setup.
 *    MUST be checked before the threshold branch: a threshold skip layered on top of
 *    a credential gap matches the threshold pattern but the real fix is "connect a
 *    provider", not "wait for a rate-limit to clear" (BI-AUDIT-003).
 *  - local bypassed for tool count + paid providers transiently down → rate-limit;
 *    nothing is misconfigured.
 *  - genuinely no tool-capable endpoint active → point to the REAL surface.
 *  - anything else → say we do not know, and offer the check.
 */
function describeToolRouteFailureMessage(
  errorMessage: string,
  toolCount: number,
  error?: unknown,
): string {
  const msg = errorMessage ?? "";

  if (msg.startsWith("REQUEST_TOO_LARGE:")) {
    return "Your conversation is too long for this AI provider. Please start a new thread to continue.";
  }

  if (isRequiredTerminalWriterNotEnforceable(error, msg)) {
    return requiredTerminalWriterNotEnforceableHandoff();
  }

  // Checked early, and before the credential and threshold branches: a deferral
  // is a host-capacity state, not a configuration one, and every branch below
  // that names a settings surface would be wrong advice for it.
  if (isLocalCapacityDeferral(error, msg)) {
    return localCapacityHeldHandoff(
      /capacity-reservation-unavailable/i.test(msg),
      readExpectedFreeAt(error),
    );
  }

  // Local runner rejected the request because prompt + tool schemas exceed the
  // model's served context window (e.g. Docker Model Runner HTTP 400
  // exceed_context_size_error). This is DETERMINISTIC, not a transient rate-limit,
  // so the "try again shortly" branches below would mislead — and a fresh thread
  // alone won't help if the tool surface itself is too big. Point at the real
  // levers (shorter input / fewer active tools / larger-context model).
  if (/exceed_context_size|exceeds the available context size/i.test(msg)) {
    return (
      "That request was too large for the active AI model's context window — usually too many " +
      "tools active at once, or a long conversation. Try a shorter message or start a new thread. " +
      "If it keeps happening, this coworker has more tools active than the local model can hold and needs right-sizing."
    );
  }

  // Permanent configuration gap: a non-local provider is in the chain but has no
  // credential row. This is NOT transient — the operator must connect a provider.
  // Check this BEFORE the threshold branch: when codex has no credential AND local
  // is threshold-blocked, the threshold pattern matches but the user needs to
  // configure a provider, not wait for a rate-limit.
  if (/No credential for/i.test(msg)) {
    return (
      "No AI provider credentials are configured for this feature. " +
      "Open Platform › AI Operations › Providers & Routing, connect a cloud provider " +
      "(Claude, OpenAI, Google, or similar), then try again."
    );
  }

  // Most common real cause: the bundled local model was bypassed because this
  // coworker exposes more tools than a small local model can reliably handle,
  // and no paid provider was available to take the work. This is NOT a
  // misconfiguration, so do not point the operator at a settings page.
  if (/exceeds threshold|skipped local fallback/i.test(msg)) {
    // Prefer the exact count the router reported ("58 tools exceeds threshold");
    // fall back to the tool count we were handed.
    const reported = msg.match(/(\d+)\s+tools?\s+exceeds threshold/i);
    const count = reported ? Number(reported[1]) : toolCount;
    const tools = count > 0 ? `${count} of them` : "many";
    return (
      "Your paid AI providers (such as Claude or GPT) are briefly unavailable right now — " +
      "usually a short rate-limit that clears within a minute — and this coworker uses too many " +
      `tools (${tools}) for the bundled local model to run on its own. Nothing is misconfigured. ` +
      "Please wait a moment and try again."
    );
  }

  // Genuine config gap: routing found no active model that supports tools at all.
  if (/No eligible endpoints/i.test(msg) && /toolUse/i.test(msg)) {
    return (
      "No AI model that supports tools is active right now. Open Platform > AI > " +
      "Providers & Routing to activate a tool-capable provider, then try again."
    );
  }

  const contextCapacityFailure = describeContextCapacityFailure(msg);
  if (contextCapacityFailure) return contextCapacityFailure;

  // Data-governance gap, NOT an outage: every candidate was eliminated because no
  // connected provider is cleared for this coworker's data sensitivity (the router
  // appends this clause when an active, capable provider was dropped purely on
  // clearance). Must be checked BEFORE the generic "No eligible endpoints" branch,
  // whose copy ("re-check provider status") is wrong advice here — the providers
  // are connected; they simply are not cleared for confidential data. (BI-431524DF)
  const clearanceBlock = msg.match(/No connected provider is cleared for '([^']+)' data/i);
  if (clearanceBlock) {
    return sensitivityClearanceHandoff(clearanceBlock[1]);
  }

  // Config/capacity gap: routing eliminated EVERY candidate (e.g. the cloud
  // provider's sign-in expired AND the bundled local model's context window is
  // too small for this coworker's larger requests). This reaches here as a plain
  // "No eligible endpoints for task type '…'" with no `toolUse` token, so the
  // branch above misses it.
  if (/No eligible endpoints/i.test(msg)) {
    return noEligibleModelHandoff();
  }

  // Endpoints exist but all transiently failed (rate-limit / overload / network).
  if (/All endpoints failed/i.test(msg)) {
    return providersBusyHandoff();
  }

  return unexplainedDeadEndHandoff();
}

export type InferenceDeadEndKind =
  | "model-missing"
  | "credentials"
  | "capacity"
  | "policy-or-capability"
  | "context"
  | "busy"
  | "required-terminal-writer-not-enforceable"
  | "terminal-writer-missing"
  | "unknown";

export type InferenceDeadEndOutcome = {
  kind: InferenceDeadEndKind;
  message: string;
};

function isAllEndpointNetworkOutage(message: string): boolean {
  if (!/All endpoints failed/i.test(message)) return false;
  const attemptsMarker = message.match(/Attempts:\s*/i);
  if (attemptsMarker?.index === undefined) return false;
  const serializedAttempts = message.slice(attemptsMarker.index + attemptsMarker[0].length).trim();
  let attempts: unknown;
  try {
    attempts = JSON.parse(serializedAttempts);
  } catch {
    return false;
  }
  if (!Array.isArray(attempts) || attempts.length === 0) return false;
  const dispatchedAttempts = attempts.filter((attempt) => {
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return true;
    const error = (attempt as Record<string, unknown>)["error"];
    return typeof error !== "string" || !/required-terminal-writer-not-enforceable/i.test(error);
  });
  if (dispatchedAttempts.length === 0) return false;
  return dispatchedAttempts.every((attempt) => {
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return false;
    const error = (attempt as Record<string, unknown>)["error"];
    if (typeof error !== "string" || error.trim().length === 0) return false;
    return /network error|fetch failed|\bECONN(?:REFUSED|RESET|ABORTED)\b|\bENOTFOUND\b|\bEAI_AGAIN\b|\bETIMEDOUT\b|\bUND_ERR_(?:CONNECT_TIMEOUT|SOCKET)\b|socket hang up|getaddrinfo|connect(?:ion)? (?:refused|reset|timed out)|connect timeout/i.test(error);
  });
}

export function describeToolRouteFailureOutcome(
  errorMessage: string,
  toolCount: number,
  error?: unknown,
): InferenceDeadEndOutcome {
  const msg = errorMessage ?? "";
  if (isRequiredTerminalWriterNotEnforceable(error, msg)) {
    return {
      kind: "required-terminal-writer-not-enforceable",
      message: requiredTerminalWriterNotEnforceableHandoff(),
    };
  }
  if (/model[_ ]not[_ ]found|model not found|provider model inventory changed/i.test(msg)) {
    return { kind: "model-missing", message: modelMissingHandoff() };
  }
  const message = describeToolRouteFailureMessage(msg, toolCount, error);
  if (/REQUEST_TOO_LARGE|exceed_context_size|available context size/i.test(msg)) return { kind: "context", message };
  if (isLocalCapacityDeferral(error, msg)) return { kind: "capacity", message };
  if (/No credential|auth(?:entication|orization)? (?:failed|error)|unauthorized/i.test(msg)) return { kind: "credentials", message };
  if (/No eligible endpoints|toolUse required|tool-capable/i.test(msg)) return { kind: "policy-or-capability", message };
  if (/rate.?limit|overload|\bbusy\b|status(?:Code)?[\"']?:\s*(?:429|529)/i.test(msg)) return { kind: "busy", message };
  if (isAllEndpointNetworkOutage(msg)) return { kind: "busy", message };
  return { kind: "unknown", message };
}

export function describeToolRouteFailure(
  errorMessage: string,
  toolCount: number,
  error?: unknown,
): string {
  return describeToolRouteFailureOutcome(errorMessage, toolCount, error).message;
}

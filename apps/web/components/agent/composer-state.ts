// Truthful composer states for the coworker panel input (BI-D028B2A8).
//
// The composer previously collapsed every disabled reason into one boolean and
// showed "Sending..." for all of them — including "the thread never loaded",
// which is what an operator sees after a portal self-upgrade invalidates a
// stale tab's server actions. Each lifecycle state now carries its own honest
// placeholder; "sending" covers only the window between send-click and the
// send request settling.

export type ComposerState =
  | "ready"
  | "busy"
  | "sending"
  | "connecting"
  | "clearing"
  | "load-failed"
  | "invalid-session";

// BI-836B0304: "failed" is a transient/retryable load problem (stale bundle,
// network blip) — the reload-to-reconnect banner fits it. "invalid-session"
// is a valid session whose userId has no matching User row (e.g. a stale
// session after a re-seed); no retry or reload can ever fix that, so it gets
// its own state and an explicit re-auth prompt instead of collapsing into
// the same dead "couldn't load" banner.
export type ThreadLoadState = "loading" | "ready" | "failed" | "invalid-session";

export function composerInputDisabled(state: ComposerState): boolean {
  return (
    state === "connecting" ||
    state === "clearing" ||
    state === "load-failed" ||
    state === "invalid-session"
  );
}

export function composerPlaceholder(state: ComposerState): string {
  switch (state) {
    case "sending":
      return "Sending…";
    case "connecting":
      return "Connecting…";
    case "clearing":
      return "Clearing conversation…";
    case "load-failed":
      return "Couldn't load this conversation";
    case "invalid-session":
      return "Sign in again to continue";
    case "busy":
      return "Agent is working... type your next message";
    case "ready":
      return "Ask your co-worker...";
  }
}

export function deriveComposerState(input: {
  isClearing: boolean;
  threadLoadState: ThreadLoadState;
  threadId: string | null;
  sendsInFlight: number;
  isBusy: boolean;
}): ComposerState {
  if (input.isClearing) return "clearing";
  if (input.threadLoadState === "invalid-session") return "invalid-session";
  if (input.threadLoadState === "failed") return "load-failed";
  if (!input.threadId) return "connecting";
  if (input.sendsInFlight > 0) return "sending";
  if (input.isBusy) return "busy";
  return "ready";
}

/**
 * Clearing a conversation is destructive and irreversible, so the control is
 * disabled unless there is actually a loaded thread with something in it and
 * nothing in flight. Lives here beside the other composer-affordance rules
 * rather than in the panel, so the panel stays a layout.
 */
export function isClearDisabled(
  messages: readonly unknown[],
  busy: boolean,
  isClearing: boolean,
  threadId?: string | null,
) {
  return !threadId || messages.length === 0 || busy || isClearing;
}

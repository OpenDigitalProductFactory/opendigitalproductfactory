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
  | "load-failed";

export type ThreadLoadState = "loading" | "ready" | "failed";

export function composerInputDisabled(state: ComposerState): boolean {
  return state === "connecting" || state === "clearing" || state === "load-failed";
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
  if (input.threadLoadState === "failed") return "load-failed";
  if (!input.threadId) return "connecting";
  if (input.sendsInFlight > 0) return "sending";
  if (input.isBusy) return "busy";
  return "ready";
}

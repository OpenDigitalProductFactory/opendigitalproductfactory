import { describe, expect, it } from "vitest";

import {
  composerInputDisabled,
  composerPlaceholder,
  deriveComposerState,
  type ComposerState,
} from "./composer-state";

describe("composerPlaceholder", () => {
  it("never claims Sending for thread lifecycle states (BI-D028B2A8)", () => {
    const lifecycleStates: ComposerState[] = ["ready", "busy", "connecting", "clearing", "load-failed"];
    for (const state of lifecycleStates) {
      expect(composerPlaceholder(state)).not.toMatch(/sending/i);
    }
  });

  it("reserves Sending for the send-in-flight state only", () => {
    expect(composerPlaceholder("sending")).toBe("Sending…");
  });

  it("gives each blocked state a truthful label", () => {
    expect(composerPlaceholder("connecting")).toBe("Connecting…");
    expect(composerPlaceholder("clearing")).toBe("Clearing conversation…");
    expect(composerPlaceholder("load-failed")).toBe("Couldn't load this conversation");
  });
});

describe("composerInputDisabled", () => {
  it("disables input only when there is no usable thread", () => {
    expect(composerInputDisabled("connecting")).toBe(true);
    expect(composerInputDisabled("clearing")).toBe(true);
    expect(composerInputDisabled("load-failed")).toBe(true);
  });

  it("keeps input usable while ready, busy, or sending (non-blocking send)", () => {
    expect(composerInputDisabled("ready")).toBe(false);
    expect(composerInputDisabled("busy")).toBe(false);
    expect(composerInputDisabled("sending")).toBe(false);
  });
});

describe("deriveComposerState", () => {
  const base = {
    isClearing: false,
    threadLoadState: "ready" as const,
    threadId: "thread-1",
    sendsInFlight: 0,
    isBusy: false,
  };

  it("is ready with a loaded idle thread", () => {
    expect(deriveComposerState(base)).toBe("ready");
  });

  it("prioritizes clearing over everything else", () => {
    expect(
      deriveComposerState({ ...base, isClearing: true, threadLoadState: "failed", threadId: null }),
    ).toBe("clearing");
  });

  it("reports load-failed instead of pretending to send", () => {
    expect(deriveComposerState({ ...base, threadLoadState: "failed", threadId: null })).toBe("load-failed");
  });

  it("reports connecting while the thread has not loaded yet", () => {
    expect(deriveComposerState({ ...base, threadLoadState: "loading", threadId: null })).toBe("connecting");
  });

  it("is sending only while a send request is unsettled", () => {
    expect(deriveComposerState({ ...base, sendsInFlight: 1, isBusy: true })).toBe("sending");
    expect(deriveComposerState({ ...base, sendsInFlight: 0, isBusy: true })).toBe("busy");
  });
});

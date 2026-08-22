import { describe, expect, it } from "vitest";
import {
  shouldDispatchAutoMessageImmediately,
  shouldSuppressAutoMessage,
} from "./agent-auto-message";

describe("agent auto message helpers", () => {
  it("dispatches immediately for route-level prompts without a target build", () => {
    expect(
      shouldDispatchAutoMessageImmediately({
        targetBuildId: null,
        activeBuildId: "FB-123",
        threadId: "thread-1",
      }),
    ).toBe(true);
  });

  it("dispatches immediately when the target build is already active and the thread is ready", () => {
    expect(
      shouldDispatchAutoMessageImmediately({
        targetBuildId: "FB-123",
        activeBuildId: "FB-123",
        threadId: "thread-1",
      }),
    ).toBe(true);
  });

  it("queues when the target build is active but the thread is not ready yet", () => {
    expect(
      shouldDispatchAutoMessageImmediately({
        targetBuildId: "FB-123",
        activeBuildId: "FB-123",
        threadId: null,
      }),
    ).toBe(false);
  });

  it("does not suppress the same message when it is retriggered after the burst window", () => {
    expect(
      shouldSuppressAutoMessage({
        last: { signature: "refine::FB-123", at: 1000 },
        nextSignature: "refine::FB-123",
        now: 2500,
      }),
    ).toBe(false);
  });

  it("suppresses near-duplicate open-panel events within the burst window", () => {
    expect(
      shouldSuppressAutoMessage({
        last: { signature: "refine::FB-123", at: 1000 },
        nextSignature: "refine::FB-123",
        now: 1500,
      }),
    ).toBe(true);
  });
});

describe("auto-message dispatch — a retry must never be silently stranded", () => {
  it("dispatches immediately when the target build's thread is already active", () => {
    // The "Retry the AI call" case: owner is sitting on the build, thread is up.
    expect(shouldDispatchAutoMessageImmediately({
      targetBuildId: "FB-1",
      activeBuildId: "FB-1",
      threadId: "thread-1",
    })).toBe(true);
  });

  it("does NOT dispatch immediately when the thread is not yet loaded", () => {
    // Correct — but the caller must then QUEUE it and drain when ready, rather
    // than dropping it. Stranding here is what made retry clicks disappear.
    expect(shouldDispatchAutoMessageImmediately({
      targetBuildId: "FB-1",
      activeBuildId: "FB-1",
      threadId: null,
    })).toBe(false);
  });

  it("does NOT dispatch immediately when a different build is active", () => {
    expect(shouldDispatchAutoMessageImmediately({
      targetBuildId: "FB-1",
      activeBuildId: "FB-2",
      threadId: "thread-2",
    })).toBe(false);
  });

  it("dispatches route-level messages that name no build", () => {
    expect(shouldDispatchAutoMessageImmediately({
      targetBuildId: null,
      activeBuildId: null,
      threadId: null,
    })).toBe(true);
  });

  it("suppresses only a genuine double-click, not a deliberate retry", () => {
    const last = { signature: "retry::FB-1", at: 1_000 };
    // Same click twice in 200ms — suppressed.
    expect(shouldSuppressAutoMessage({ last, nextSignature: "retry::FB-1", now: 1_200 })).toBe(true);
    // The owner pressing retry again a minute later must NOT be swallowed.
    expect(shouldSuppressAutoMessage({ last, nextSignature: "retry::FB-1", now: 61_000 })).toBe(false);
  });
});

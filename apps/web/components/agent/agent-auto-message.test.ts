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

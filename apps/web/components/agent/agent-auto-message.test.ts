import { describe, expect, it } from "vitest";
import {
  planAutoMessage,
  queuedAutoMessageIsForThread,
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

describe("planAutoMessage", () => {
  const base = {
    message: "do the thing",
    targetBuildId: null as string | null,
    requestedRouteContext: null as string | null,
    threadContext: "build:FB-1",
    activeBuildId: "FB-1",
    threadId: "th-1",
  };

  it("sends a route-level message with no target build right away", () => {
    // The onboarding COO introducing each setup step depends on this.
    expect(planAutoMessage(base).send).toBe(true);
  });

  it("queues until threadContext catches up with a requested route switch", () => {
    const plan = planAutoMessage({ ...base, requestedRouteContext: "build:FB-2" });
    expect(plan).toEqual({
      send: false, message: "do the thing", targetBuildId: null, routeContext: "build:FB-2",
    });
  });

  it("sends immediately when the target build is already the active one", () => {
    expect(planAutoMessage({ ...base, targetBuildId: "FB-1" }).send).toBe(true);
  });

  it("queues a message aimed at a build that is not active yet", () => {
    const plan = planAutoMessage({ ...base, targetBuildId: "FB-2", activeBuildId: "FB-1" });
    expect(plan).toEqual({
      send: false, message: "do the thing", targetBuildId: "FB-2", routeContext: null,
    });
  });

  it("queues rather than sending when no thread exists yet", () => {
    expect(planAutoMessage({ ...base, targetBuildId: "FB-1", threadId: null }).send).toBe(false);
  });
});

describe("queuedAutoMessageIsForThread", () => {
  const base = {
    queued: { targetBuildId: "FB-1", routeContext: null } as {
      targetBuildId?: string | null; routeContext?: string | null;
    } | null,
    threadId: "th-1" as string | null,
    activeBuildId: "FB-1" as string | null,
    pathname: "/build",
    threadContext: "build:FB-1" as string | null,
  };

  it("releases a message whose target build is the active build on /build", () => {
    expect(queuedAutoMessageIsForThread(base)).toBe(true);
  });

  it("holds while the thread has not loaded", () => {
    expect(queuedAutoMessageIsForThread({ ...base, threadId: null })).toBe(false);
  });

  it("holds when a different build is active — never submit to the wrong thread", () => {
    expect(queuedAutoMessageIsForThread({ ...base, activeBuildId: "FB-2" })).toBe(false);
  });

  it("holds off /build, where no build is the expected target", () => {
    expect(queuedAutoMessageIsForThread({ ...base, pathname: "/workspace" })).toBe(false);
  });

  it("holds when the queued route context does not match the thread's", () => {
    expect(queuedAutoMessageIsForThread({
      ...base, queued: { targetBuildId: "FB-1", routeContext: "build:FB-9" },
    })).toBe(false);
  });

  it("is false for nothing queued rather than throwing", () => {
    expect(queuedAutoMessageIsForThread({ ...base, queued: null })).toBe(false);
  });
});

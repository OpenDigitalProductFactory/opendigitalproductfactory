import { describe, it, expect, vi } from "vitest";
import { agentEventBus, type AgentEvent } from "./agent-event-bus";

describe("agentEventBus", () => {
  it("delivers events to subscribers", () => {
    const handler = vi.fn();
    const unsub = agentEventBus.subscribe("thread-1", handler);

    const event: AgentEvent = { type: "tool:start", tool: "search_project_files", iteration: 0 };
    agentEventBus.emit("thread-1", event);

    expect(handler).toHaveBeenCalledWith(event);
    unsub();
  });

  it("does not deliver events to other threads", () => {
    const handler = vi.fn();
    const unsub = agentEventBus.subscribe("thread-2", handler);

    agentEventBus.emit("thread-1", { type: "done" });

    expect(handler).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops delivery", () => {
    const handler = vi.fn();
    const unsub = agentEventBus.subscribe("thread-3", handler);
    unsub();

    agentEventBus.emit("thread-3", { type: "done" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers on same thread", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const unsub1 = agentEventBus.subscribe("thread-4", handler1);
    const unsub2 = agentEventBus.subscribe("thread-4", handler2);

    agentEventBus.emit("thread-4", { type: "done" });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
    unsub1();
    unsub2();
  });

  it("cleans up empty subscriber sets", () => {
    const handler = vi.fn();
    const unsub = agentEventBus.subscribe("thread-5", handler);
    unsub();

    // Emitting to a cleaned-up thread should not throw
    agentEventBus.emit("thread-5", { type: "done" });
    expect(handler).not.toHaveBeenCalled();
  });
});

// ─── BI-QUIESCE-006 system-channel additions ───────────────────────────

const sampleSystemEvent: AgentEvent = {
  type: "system:quiescence",
  level: "draining",
  runId: "QR-2026-05-24-test1234",
  swapEtaSeconds: 300,
  deferReason: null,
  deferSurface: null,
  outcome: "draining",
};

describe("agentEventBus.subscribeSystem + broadcastSystem", () => {
  it("delivers a broadcast to a system-channel subscriber", () => {
    const handler = vi.fn();
    const unsub = agentEventBus.subscribeSystem(handler);
    agentEventBus.broadcastSystem(sampleSystemEvent);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(sampleSystemEvent);
    unsub();
  });

  it("delivers a broadcast to every system-channel subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    const ua = agentEventBus.subscribeSystem(a);
    const ub = agentEventBus.subscribeSystem(b);
    agentEventBus.broadcastSystem(sampleSystemEvent);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    ua();
    ub();
  });

  it("isolates subscriber failures so later observers still receive the event", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = agentEventBus.subscribeSystem(() => {
      throw new Error("broken observer");
    });
    const survivor = vi.fn();
    const surviving = agentEventBus.subscribeSystem(survivor);

    expect(() => agentEventBus.broadcastSystem(sampleSystemEvent)).not.toThrow();
    expect(survivor).toHaveBeenCalledWith(sampleSystemEvent);
    expect(consoleError).toHaveBeenCalledOnce();

    failing();
    surviving();
    consoleError.mockRestore();
  });

  it("ALSO fans out to per-thread subscribers (legacy compatibility)", () => {
    // Legacy SSE consumers subscribe to their own threadId and have no
    // knowledge of the system channel. broadcastSystem must reach them
    // so the platform banner works without per-consumer code changes.
    const threadHandler = vi.fn();
    const unsubThread = agentEventBus.subscribe("legacy-thread-banner", threadHandler);
    agentEventBus.broadcastSystem(sampleSystemEvent);
    expect(threadHandler).toHaveBeenCalledTimes(1);
    expect(threadHandler).toHaveBeenCalledWith(sampleSystemEvent);
    unsubThread();
  });

  it("unsub removes the subscriber so subsequent broadcasts don't fire", () => {
    const handler = vi.fn();
    const unsub = agentEventBus.subscribeSystem(handler);
    unsub();
    agentEventBus.broadcastSystem(sampleSystemEvent);
    expect(handler).not.toHaveBeenCalled();
  });

  it("carries cleared/succeeded payload shape", () => {
    const handler = vi.fn();
    const unsub = agentEventBus.subscribeSystem(handler);
    agentEventBus.broadcastSystem({
      type: "system:quiescence",
      level: "cleared",
      runId: "QR-X",
      swapEtaSeconds: null,
      deferReason: null,
      deferSurface: null,
      outcome: "succeeded",
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "system:quiescence",
        level: "cleared",
        outcome: "succeeded",
      }),
    );
    unsub();
  });

  it("carries cleared/deferred payload with defer surface", () => {
    const handler = vi.fn();
    const unsub = agentEventBus.subscribeSystem(handler);
    agentEventBus.broadcastSystem({
      type: "system:quiescence",
      level: "cleared",
      runId: "QR-Y",
      swapEtaSeconds: null,
      deferReason: "Hard blocker exceeded budget",
      deferSurface: "build-studio.phase.build",
      outcome: "deferred",
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "deferred",
        deferSurface: "build-studio.phase.build",
      }),
    );
    unsub();
  });
});

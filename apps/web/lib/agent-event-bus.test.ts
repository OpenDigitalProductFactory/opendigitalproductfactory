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

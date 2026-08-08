// apps/web/lib/mcp/tasks-lifecycle.test.ts
import { describe, it, expect } from "vitest";
import { mcpTaskStateForWire, isTerminalTaskStatus, tasksLifecycleEnabled } from "./tasks-lifecycle";

describe("tasks-lifecycle state adapter (Slice 4 Phase 0)", () => {
  it("maps DPF/A2A statuses to MCP-spec wire states", () => {
    expect(mcpTaskStateForWire("submitted")).toBe("working");
    expect(mcpTaskStateForWire("working")).toBe("working");
    expect(mcpTaskStateForWire("input-required")).toBe("input_required");
    expect(mcpTaskStateForWire("auth-required")).toBe("input_required");
    expect(mcpTaskStateForWire("completed")).toBe("completed");
    expect(mcpTaskStateForWire("failed")).toBe("failed");
    expect(mcpTaskStateForWire("canceled")).toBe("cancelled");
    expect(mcpTaskStateForWire("rejected")).toBe("failed");
    expect(mcpTaskStateForWire("archived")).toBe("completed");
  });

  it("defaults an unknown status to working (never throws)", () => {
    expect(mcpTaskStateForWire("something-new")).toBe("working");
  });

  it("classifies terminal vs non-terminal statuses", () => {
    for (const s of ["completed", "failed", "canceled", "rejected", "archived"]) {
      expect(isTerminalTaskStatus(s)).toBe(true);
    }
    for (const s of ["submitted", "working", "input-required", "auth-required"]) {
      expect(isTerminalTaskStatus(s)).toBe(false);
    }
  });

  it("is enabled unless MCP_TASKS_LIFECYCLE=off", () => {
    const prev = process.env.MCP_TASKS_LIFECYCLE;
    delete process.env.MCP_TASKS_LIFECYCLE;
    expect(tasksLifecycleEnabled()).toBe(true);
    process.env.MCP_TASKS_LIFECYCLE = "off";
    expect(tasksLifecycleEnabled()).toBe(false);
    if (prev === undefined) delete process.env.MCP_TASKS_LIFECYCLE;
    else process.env.MCP_TASKS_LIFECYCLE = prev;
  });
});

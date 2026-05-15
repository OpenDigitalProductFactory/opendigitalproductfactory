import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformIssueReport: { create },
  },
}));

import {
  detectRepeatedToolCall,
  recordRepeatedToolIssue,
  type ExecutedToolRecord,
} from "./runtime-issues";

function makeCall(name: string, args: Record<string, unknown> = {}): ExecutedToolRecord {
  return { name, args, result: { success: true } };
}

describe("detectRepeatedToolCall", () => {
  it("returns null when fewer than threshold matching calls", () => {
    const executedTools = [makeCall("a"), makeCall("a")];
    expect(detectRepeatedToolCall({ executedTools, iteration: 10 })).toBeNull();
  });

  it("returns null when iteration <= 5 (loop warm-up window)", () => {
    const executedTools = [makeCall("a"), makeCall("a"), makeCall("a")];
    expect(detectRepeatedToolCall({ executedTools, iteration: 5 })).toBeNull();
  });

  it("flags 3 identical calls within the window", () => {
    const executedTools = [makeCall("a"), makeCall("a"), makeCall("a")];
    const result = detectRepeatedToolCall({ executedTools, iteration: 10 });
    expect(result).not.toBeNull();
    expect(result?.toolName).toBe("a");
    expect(result?.count).toBe(3);
  });

  it("treats differently-keyed args as distinct calls", () => {
    const executedTools = [
      makeCall("a", { x: 1 }),
      makeCall("a", { x: 2 }),
      makeCall("a", { x: 3 }),
    ];
    expect(detectRepeatedToolCall({ executedTools, iteration: 10 })).toBeNull();
  });

  it("treats identical-after-key-sort args as the same hash", () => {
    const executedTools = [
      makeCall("a", { x: 1, y: 2 }),
      makeCall("a", { y: 2, x: 1 }),
      makeCall("a", { y: 2, x: 1 }),
    ];
    expect(detectRepeatedToolCall({ executedTools, iteration: 10 })).not.toBeNull();
  });

  it("only inspects the trailing window", () => {
    // Three matches but all outside the trailing 2-call window
    const executedTools = [
      makeCall("a"),
      makeCall("a"),
      makeCall("a"),
      makeCall("b"),
      makeCall("c"),
    ];
    expect(detectRepeatedToolCall({ executedTools, iteration: 10, window: 2 })).toBeNull();
  });

  it("surfaces the last failure error as a reasonHint", () => {
    const executedTools: ExecutedToolRecord[] = [
      { name: "a", args: {}, result: { success: true } },
      { name: "a", args: {}, result: { success: false, error: "timeout after 30s" } },
      { name: "a", args: {}, result: { success: false, error: "timeout after 30s" } },
    ];
    const result = detectRepeatedToolCall({ executedTools, iteration: 10 });
    expect(result?.reasonHint).toContain("timeout after 30s");
  });
});

describe("recordRepeatedToolIssue", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({});
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("writes a PlatformIssueReport with the expected fields and source coworker_runtime", async () => {
    const result = await recordRepeatedToolIssue({
      repeated: { toolName: "create_backlog_item", count: 3, signature: "s", reasonHint: "" },
      routeContext: "/customer",
      userId: "user-1",
      agentId: "AGT-1",
      threadId: "thread-1",
      taskRunId: "run-1",
    });
    expect(result).not.toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(payload.data.type).toBe("agent_stuck");
    expect(payload.data.source).toBe("coworker_runtime");
    expect(payload.data.threadId).toBe("thread-1");
    expect(payload.data.taskRunId).toBe("run-1");
    expect(payload.data.agentId).toBe("AGT-1");
    expect(payload.data.routeContext).toBe("/customer");
    expect(typeof payload.data.reportId).toBe("string");
    expect((payload.data.reportId as string).startsWith("PIR-")).toBe(true);
  });

  it("skips writing on /build routes (Build Studio owns its own verification)", async () => {
    const result = await recordRepeatedToolIssue({
      repeated: { toolName: "x", count: 3, signature: "s", reasonHint: "" },
      routeContext: "/build/feature-123",
      userId: "u",
      agentId: "a",
      threadId: null,
      taskRunId: null,
    });
    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns null on DB failure but does not throw", async () => {
    create.mockRejectedValue(new Error("db down"));
    const result = await recordRepeatedToolIssue({
      repeated: { toolName: "x", count: 3, signature: "s", reasonHint: "" },
      routeContext: "/customer",
      userId: "u",
      agentId: "a",
      threadId: null,
      taskRunId: null,
    });
    expect(result).toBeNull();
  });
});

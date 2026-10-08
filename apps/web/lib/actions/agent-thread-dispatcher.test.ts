// BI-287E1DD0: a delegated child runs as a durable job; the kill switch restores
// the in-process dispatch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrepare, mockRun, mockSend } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockRun: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("@/lib/tak/child-thread-runtime", () => ({
  prepareChildExecution: mockPrepare,
  runChildThreadExecution: mockRun,
}));
vi.mock("@/lib/jobs", () => ({ jobs: { send: mockSend } }));

import { dispatchAgentThread } from "./agent-thread-dispatcher";

const context = {
  threadId: "child-1",
  taskRunId: "TR-CHILD-1",
  userId: "user-1",
  agentId: "agent-mkt",
  routeContext: "/coworker",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrepare.mockResolvedValue(context);
  mockRun.mockResolvedValue(undefined);
  mockSend.mockResolvedValue({ ids: ["evt-1"] });
});
afterEach(() => {
  delete process.env.DPF_CHILD_THREAD_DURABLE_DISPATCH;
});

describe("dispatchAgentThread", () => {
  it("sends one durable job keyed on the child's TaskRun", async () => {
    await dispatchAgentThread("child-1", "user-1");

    expect(mockSend).toHaveBeenCalledWith({
      id: "agent-child-thread-run:TR-CHILD-1",
      name: "agent/child-thread.run",
      data: context,
    });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("propagates a refused send so the spawn fails the child", async () => {
    mockSend.mockRejectedValue(new Error("job engine unavailable"));
    await expect(dispatchAgentThread("child-1", "user-1")).rejects.toThrow("job engine unavailable");
  });

  it("runs in process when the kill switch is off", async () => {
    process.env.DPF_CHILD_THREAD_DURABLE_DISPATCH = "off";
    await dispatchAgentThread("child-1", "user-1");

    expect(mockRun).toHaveBeenCalledWith(context);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

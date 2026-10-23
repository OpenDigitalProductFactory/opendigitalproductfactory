import { describe, expect, it } from "vitest";
import { loopToolContext } from "./agentic-loop-tool-context";

describe("captured execution context", () => {
  it("preserves the admitted fence without deriving identity from later state", () => {
    const taskExecutionFence = { schemaVersion: 1 as const, reservation: "original", dispatchClaim: "dispatch", authorityDigest: null, requestDigest: "9".repeat(64) };
    expect(loopToolContext({ routeContext: "/build", agentId: "reviewer", threadId: "thread",
      taskRunId: "task", taskExecutionFence, interactionMode: "autonomous", chatHistory: [] }))
      .toMatchObject({ taskRunId: "task", taskExecutionFence });
  });
  it("leaves legacy callers unversioned", () => {
    expect(loopToolContext({ routeContext: "/build", agentId: "reviewer", threadId: "thread",
      taskRunId: "task", interactionMode: "autonomous", chatHistory: [] }).taskExecutionFence).toBeUndefined();
  });
});

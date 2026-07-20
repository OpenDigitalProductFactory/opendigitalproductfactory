import { describe, expect, it } from "vitest";
import { collaborationReturnMessage } from "./collaboration-return-message";

describe("collaborationReturnMessage", () => {
  it("projects a validated server-authored COO return into the visible conversation", () => {
    expect(collaborationReturnMessage({
      type: "collaboration:return",
      parentThreadId: "parent-1",
      childThreadId: "child-1",
      fromAgentId: "AGT-902",
      toAgentId: "coo",
      taskRunId: "task-1",
      outcome: "completed",
      ownerMessage: "My recommendation: conditional",
    }, "/workspace")).toEqual(expect.objectContaining({
      id: "provider-advisory-child-1",
      role: "assistant",
      agentId: "coo",
      content: "My recommendation: conditional",
      routeContext: "/workspace",
    }));
  });

  it("ignores ordinary collaboration returns and empty content", () => {
    expect(collaborationReturnMessage({
      type: "collaboration:return",
      parentThreadId: "parent-1",
      childThreadId: "child-1",
      fromAgentId: "AGT-902",
      toAgentId: "coo",
      taskRunId: "task-1",
      outcome: "completed",
    }, "/workspace")).toBeNull();
  });
});

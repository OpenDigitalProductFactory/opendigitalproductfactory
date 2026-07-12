import { describe, expect, it, vi } from "vitest";

import {
  buildProposalToolResult,
  divertToolCallToProposal,
  shouldProposeToolCall,
  type ProposalPersistence,
} from "./propose-interception";

describe("shouldProposeToolCall", () => {
  it("diverts side-effecting non-artifact tools under a propose boundary", () => {
    expect(shouldProposeToolCall({ sideEffect: true }, true)).toBe(true);
  });

  it("never diverts when the propose boundary is inactive (act runs directly)", () => {
    expect(shouldProposeToolCall({ sideEffect: true }, false)).toBe(false);
  });

  it("lets curated artifacts run directly — they are the safe self-task writes", () => {
    expect(shouldProposeToolCall({ sideEffect: true, coworkerArtifact: true }, true)).toBe(false);
  });

  it("leaves read-only tools alone", () => {
    expect(shouldProposeToolCall({ sideEffect: false }, true)).toBe(false);
    expect(shouldProposeToolCall(undefined, true)).toBe(false);
  });

  it("defers proposal-mode tools to the loop's own approval-return path", () => {
    expect(shouldProposeToolCall({ sideEffect: true, executionMode: "proposal" }, true)).toBe(false);
  });
});

describe("buildProposalToolResult", () => {
  it("tells the model the action is pending approval and not to retry", () => {
    const result = buildProposalToolResult("add_customer_contact", "prop-1");
    expect(result.success).toBe(true);
    expect(result.entityId).toBe("prop-1");
    expect(result.message).toMatch(/add customer contact/);
    expect(result.message).toMatch(/approv/i);
    expect(result.message).toMatch(/do not retry/i);
    expect(result.data).toEqual({ proposalId: "prop-1", status: "proposed" });
  });
});

describe("divertToolCallToProposal", () => {
  it("persists a proposal whose actionType is the tool name and parameters are the args", async () => {
    const createAssistantMessage = vi.fn(async () => ({ id: "msg-1" }));
    const createProposal = vi.fn(async (input: { proposalId: string }) => ({ proposalId: input.proposalId }));
    const persistence: ProposalPersistence = { createAssistantMessage, createProposal };

    const result = await divertToolCallToProposal({
      persistence,
      toolName: "add_customer_contact",
      args: { name: "Dan Warfield", role: "primary" },
      agentId: "customer-advisor",
      threadId: "thread-1",
      routeContext: "/customer",
      taskRunId: "run-1",
    });

    expect(createAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", agentId: "customer-advisor", taskRunId: "run-1" }),
    );
    expect(createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        messageId: "msg-1",
        actionType: "add_customer_contact",
        parameters: { name: "Dan Warfield", role: "primary" },
        taskRunId: "run-1",
      }),
    );
    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("proposed");
    // The proposalId round-trips from the persistence layer into the result.
    const createdId = createProposal.mock.calls[0][0].proposalId;
    expect(result.entityId).toBe(createdId);
  });
});

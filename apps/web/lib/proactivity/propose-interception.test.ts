import { describe, expect, it, vi } from "vitest";

import {
  buildProposalToolResult,
  divertToolCallToProposal,
  interceptToolCallAsProposal,
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

describe("interceptToolCallAsProposal: a room cadence's declared writes run (BI-C1781121)", () => {
  const sideEffect = { sideEffect: true } as const;
  const call = {
    toolDef: sideEffect,
    proposeSideEffects: true,
    toolName: "record_execution_evidence",
    args: { itemId: "BI-1" },
    agentId: "AGT-WS-PORTFOLIO",
    threadId: "thread-1",
    routeContext: "/ops/workrooms",
    taskRunId: "TR-SCHED-1234ABCD",
  };
  function persistence() {
    return {
      createAssistantMessage: vi.fn(async () => ({ id: "msg-1" })),
      createProposal: vi.fn(async (input: { proposalId: string }) => ({ proposalId: input.proposalId })),
    };
  }

  it("does not divert a write the run's room mandate declares for this agent", async () => {
    const store = persistence();
    const resolveMandatedTools = vi.fn(async () => ["record_execution_evidence", "record_workroom_evidence"]);
    const result = await interceptToolCallAsProposal(call, { persistence: store, resolveMandatedTools });
    expect(result).toBeNull();
    expect(resolveMandatedTools).toHaveBeenCalledWith({ taskRunId: "TR-SCHED-1234ABCD", agentId: "AGT-WS-PORTFOLIO" });
    expect(store.createProposal).not.toHaveBeenCalled();
  });

  it("still diverts every write the mandate does not declare", async () => {
    const store = persistence();
    const result = await interceptToolCallAsProposal(
      { ...call, toolName: "update_backlog_item_status" },
      { persistence: store, resolveMandatedTools: async () => ["record_execution_evidence"] },
    );
    expect(result?.data?.status).toBe("proposed");
    expect(store.createProposal).toHaveBeenCalledTimes(1);
  });

  it("diverts when the mandate cannot be read (fail closed)", async () => {
    const store = persistence();
    const result = await interceptToolCallAsProposal(call, {
      persistence: store,
      resolveMandatedTools: async () => { throw new Error("db down"); },
    });
    expect(result?.data?.status).toBe("proposed");
  });

  it("never consults the mandate outside a propose boundary", async () => {
    const resolveMandatedTools = vi.fn(async () => []);
    expect(await interceptToolCallAsProposal({ ...call, proposeSideEffects: false }, { persistence: persistence(), resolveMandatedTools })).toBeNull();
    expect(resolveMandatedTools).not.toHaveBeenCalled();
  });
});
